package payments

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shopship/shop/api/internal/auth"
)

// Mock card tokens (docs/API.md §9).
const (
	TokenSuccess = "tokn_test_success" // charge succeeds at once
	TokenFailure = "tokn_test_failure" // declined at authorization
	Token3DS     = "tokn_test_3ds"     // requires_action -> mock 3-D Secure page
)

var (
	ErrBadToken       = errors.New("payments: unknown card token")
	ErrChargeNotFound = errors.New("payments: charge not found")
	ErrBadSignature   = errors.New("payments: invalid webhook signature")
	ErrUnavailable    = errors.New("payments: provider not available")
)

// MockProvider mirrors Omise's charge/source flow. Its state lives in
// mock_provider_charges (what Omise would hold on its side); the API's own
// copy is the payments table, refreshed from here on every webhook.
type MockProvider struct {
	DB            *pgxpool.Pool
	WebhookSecret string
	AuthorizeBase string // e.g. http://localhost:3000/api/v1/payments/mock/authorize/
	Now           func() time.Time
}

func (m *MockProvider) Name() string { return "mock" }

func (m *MockProvider) now() time.Time {
	if m.Now != nil {
		return m.Now()
	}
	return time.Now()
}

func newChargeID() string {
	t := strings.ToLower(auth.RandomToken(9))
	t = strings.NewReplacer("-", "x", "_", "z").Replace(t)
	return "chrg_mock_" + t
}

func (m *MockProvider) CreateCharge(ctx context.Context, in ChargeInput) (Charge, error) {
	id := newChargeID()
	status := "pending"
	var qr, failCode, failMsg string
	exp := in.ExpiresAt
	if exp.IsZero() {
		exp = m.now().Add(15 * time.Minute)
	}
	switch in.Method {
	case "promptpay":
		qr = PromptPayPayload(in.OrderNo, in.AmountSatang)
	case "card":
		switch in.CardToken {
		case TokenSuccess:
			status = "successful"
		case TokenFailure:
			status, failCode, failMsg = "failed", "payment_rejected", "บัตรถูกปฏิเสธโดยธนาคารผู้ออกบัตร"
		case Token3DS, "":
			status = "requires_action"
		default:
			return Charge{}, ErrBadToken
		}
	default:
		return Charge{}, fmt.Errorf("payments: unknown method %q", in.Method)
	}
	_, err := m.DB.Exec(ctx, `INSERT INTO mock_provider_charges (id, order_no, method, status, amount_satang, card_token, return_uri,
			qr_payload, failure_code, failure_msg, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		id, in.OrderNo, in.Method, status, in.AmountSatang, in.CardToken, in.ReturnURI, qr, failCode, failMsg, exp)
	if err != nil {
		return Charge{}, err
	}
	return m.GetCharge(ctx, id)
}

func (m *MockProvider) GetCharge(ctx context.Context, id string) (Charge, error) {
	// Lazy expiry, like the provider would do on its side.
	if _, err := m.DB.Exec(ctx, `UPDATE mock_provider_charges SET status = 'expired'
		WHERE id = $1 AND status IN ('pending', 'requires_action') AND expires_at <= $2`, id, m.now()); err != nil {
		return Charge{}, err
	}
	var c Charge
	var exp *time.Time
	err := m.DB.QueryRow(ctx, `SELECT id, status, amount_satang, method, qr_payload, failure_code, failure_msg, expires_at
		FROM mock_provider_charges WHERE id = $1`, id).Scan(&c.ID, &c.Status, &c.AmountSatang, &c.Method, &c.QRPayload,
		&c.FailureCode, &c.FailureMsg, &exp)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrChargeNotFound
	}
	if err != nil {
		return c, err
	}
	if exp != nil {
		u := exp.Unix()
		c.ExpiresAt = &u
	}
	if c.Status == "requires_action" {
		c.AuthorizeURI = m.AuthorizeBase + c.ID
	}
	return c, nil
}

// webhookBody is the mock (Omise-shaped) event.
type webhookBody struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Data struct {
		ID string `json:"id"`
	} `json:"data"`
}

func (m *MockProvider) ParseWebhook(_ context.Context, headers map[string]string, body []byte) (WebhookEvent, error) {
	got := headers["X-Webhook-Secret"]
	if m.WebhookSecret == "" || subtle.ConstantTimeCompare([]byte(m.WebhookSecret), []byte(got)) != 1 {
		return WebhookEvent{}, ErrBadSignature
	}
	var b webhookBody
	if err := json.Unmarshal(body, &b); err != nil || b.ID == "" || b.Data.ID == "" {
		return WebhookEvent{}, fmt.Errorf("payments: malformed webhook")
	}
	return WebhookEvent{ID: b.ID, Type: b.Type, ChargeID: b.Data.ID}, nil
}

func (m *MockProvider) Refund(ctx context.Context, chargeID string, amountSatang int64) error {
	tag, err := m.DB.Exec(ctx, `UPDATE mock_provider_charges SET status = 'refunded', refunded_satang = refunded_satang + $2
		WHERE id = $1 AND status IN ('successful', 'refunded')`, chargeID, amountSatang)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrChargeNotFound
	}
	return nil
}

// Complete simulates the payer (mock only): successful or failed.
func (m *MockProvider) Complete(ctx context.Context, id, outcome string) error {
	st := "successful"
	fc, fm := "", ""
	if outcome == "failed" {
		st, fc, fm = "failed", "payment_rejected", "การชำระเงินไม่สำเร็จ"
	}
	tag, err := m.DB.Exec(ctx, `UPDATE mock_provider_charges SET status = $2, failure_code = $3, failure_msg = $4
		WHERE id = $1 AND status IN ('pending', 'requires_action') AND (expires_at IS NULL OR expires_at > $5)`, id, st, fc, fm, m.now())
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := m.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM mock_provider_charges WHERE id = $1)`, id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrChargeNotFound
		}
	}
	return nil
}

// ReturnURI is the card 3-DS return target stored with the mock charge.
func (m *MockProvider) ReturnURI(ctx context.Context, id string) (string, error) {
	var u string
	err := m.DB.QueryRow(ctx, `SELECT return_uri FROM mock_provider_charges WHERE id = $1`, id).Scan(&u)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrChargeNotFound
	}
	return u, err
}

// unavailable is used for providers not wired yet (omise).
type unavailable struct{ name string }

func (u unavailable) Name() string { return u.name }
func (unavailable) CreateCharge(context.Context, ChargeInput) (Charge, error) {
	return Charge{}, ErrUnavailable
}
func (unavailable) GetCharge(context.Context, string) (Charge, error) {
	return Charge{}, ErrUnavailable
}
func (unavailable) ParseWebhook(context.Context, map[string]string, []byte) (WebhookEvent, error) {
	return WebhookEvent{}, ErrUnavailable
}
func (unavailable) Refund(context.Context, string, int64) error { return ErrUnavailable }

// ---------- PromptPay EMVCo payload ----------

func tlv(tag, val string) string { return fmt.Sprintf("%s%02d%s", tag, len(val), val) }

// PromptPayPayload builds a Thai QR (bill payment, tag 30) payload with CRC16.
// The biller id is a fake test value; the order number is reference 1.
func PromptPayPayload(orderNo string, amountSatang int64) string {
	merchant := tlv("00", "A000000677010112") + tlv("01", "010556000000000") + tlv("02", orderNo)
	amount := fmt.Sprintf("%d.%02d", amountSatang/100, amountSatang%100)
	p := tlv("00", "01") + tlv("01", "12") + tlv("30", merchant) + tlv("53", "764") + tlv("54", amount) + tlv("58", "TH") + "6304"
	return p + fmt.Sprintf("%04X", crc16(p))
}

// crc16 is CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as EMVCo requires.
func crc16(s string) uint16 {
	crc := uint16(0xFFFF)
	for i := 0; i < len(s); i++ {
		crc ^= uint16(s[i]) << 8
		for b := 0; b < 8; b++ {
			if crc&0x8000 != 0 {
				crc = crc<<1 ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}
