// Package payments: provider-agnostic charges behind the Provider interface.
// MVP ships MockProvider that mirrors the Omise charge/source flow
// (PromptPay: pending + QR payload; card: requires_action + authorize_uri
// "3-D Secure" step) and an idempotent webhook (dedupe by event id, no-op
// when the charge is already final). config.Validate refuses PAYMENT_PROVIDER=mock
// in production.
//
// Owner: Wave-1 "api-core". Routes are the frozen contract (docs/API.md).
package payments

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/email"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/orders/state"
	"github.com/shopship/shop/api/internal/platform"
)

// Provider is implemented by MockProvider now and an Omise adapter later.
type Provider interface {
	Name() string // "mock" | "omise"
	CreateCharge(ctx context.Context, in ChargeInput) (Charge, error)
	GetCharge(ctx context.Context, chargeID string) (Charge, error)
	// ParseWebhook verifies and decodes a webhook request body.
	ParseWebhook(ctx context.Context, headers map[string]string, body []byte) (WebhookEvent, error)
	Refund(ctx context.Context, chargeID string, amountSatang int64) error
}

type ChargeInput struct {
	OrderNo      string
	AmountSatang int64
	Method       string // promptpay | card
	CardToken    string // card only (Omise.js token; mock accepts "tokn_test_*")
	ReturnURI    string // card 3-DS return
	ExpiresAt    time.Time
}

type Charge struct {
	ID           string
	Status       string // pending | requires_action | successful | failed | expired | refunded
	AmountSatang int64
	Method       string
	QRPayload    string
	QRImageURL   string
	AuthorizeURI string
	FailureCode  string
	FailureMsg   string
	ExpiresAt    *int64 // unix seconds
}

type WebhookEvent struct {
	ID       string
	Type     string // charge.complete ...
	ChargeID string
}

// ProviderFor returns the configured provider.
func ProviderFor(d *platform.Deps) Provider {
	if d.Cfg.PaymentProvider == "mock" {
		return &MockProvider{DB: d.DB, WebhookSecret: d.Cfg.WebhookSecret, Now: d.Now,
			AuthorizeBase: d.Cfg.WebBaseURL + "/api/v1/payments/mock/authorize/"}
	}
	return unavailable{name: d.Cfg.PaymentProvider}
}

func isFinal(s string) bool {
	return s == "successful" || s == "failed" || s == "expired" || s == "refunded"
}

type handler struct {
	d *platform.Deps
	p Provider
}

func Register(rt platform.Routes, d *platform.Deps) {
	h := &handler{d: d, p: ProviderFor(d)}
	g := rt.V1.Group("/payments", httpx.NeedDB(d.DB), func(c *gin.Context) { httpx.NoStore(c); c.Next() })
	g.POST("/charges", auth.RequireUser(), h.createCharge)
	g.GET("/charges/:charge_id", auth.RequireUser(), h.getCharge)
	// Dev/staging only (404 unless PAYMENT_PROVIDER=mock): simulate the payer.
	g.POST("/mock/charges/:charge_id/complete", h.mockComplete)
	g.GET("/mock/authorize/:charge_id", h.mockAuthorize) // mock 3-DS page (HTML) -> redirects to return_uri
}

// RegisterWebhooks mounts provider webhooks OUTSIDE the CSRF/session
// middleware (router.go mounts it on the bare /api/v1 group).
func RegisterWebhooks(v1 *gin.RouterGroup, d *platform.Deps) {
	h := &handler{d: d, p: ProviderFor(d)}
	v1.POST("/webhooks/payments/:provider", httpx.NeedDB(d.DB), h.webhook)
}

// ---------- response ----------

type promptPay struct {
	QRPayload  string    `json:"qr_payload"`
	QRImageURL *string   `json:"qr_image_url"`
	ExpiresAt  time.Time `json:"expires_at"`
}

type ChargeOut struct {
	ChargeID       string     `json:"charge_id"`
	OrderNo        string     `json:"order_no"`
	Method         string     `json:"method"`
	Status         string     `json:"status"`
	AmountSatang   int64      `json:"amount_satang"`
	PromptPay      *promptPay `json:"promptpay"`
	AuthorizeURI   *string    `json:"authorize_uri"`
	FailureCode    *string    `json:"failure_code"`
	FailureMessage *string    `json:"failure_message"`
}

func nz(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func loadCharge(ctx context.Context, q httpx.Querier, provider, chargeID string, userID int64) (ChargeOut, error) {
	var c ChargeOut
	var qr, qrURL, authURI, fc, fm string
	var exp *time.Time
	err := q.QueryRow(ctx, `SELECT p.provider_charge_id, o.order_no, p.method, p.status, p.amount_satang, p.qr_payload, p.qr_image_url,
			p.authorize_uri, p.failure_code, p.failure_message, p.expires_at
		FROM payments p JOIN orders o ON o.id = p.order_id
		WHERE p.provider = $1 AND p.provider_charge_id = $2 AND ($3 = 0 OR o.user_id = $3)`, provider, chargeID, userID).
		Scan(&c.ChargeID, &c.OrderNo, &c.Method, &c.Status, &c.AmountSatang, &qr, &qrURL, &authURI, &fc, &fm, &exp)
	if err != nil {
		return c, err
	}
	if c.Method == "promptpay" && qr != "" {
		pp := &promptPay{QRPayload: qr, QRImageURL: nz(qrURL)}
		if exp != nil {
			pp.ExpiresAt = exp.UTC()
		}
		c.PromptPay = pp
	}
	if c.Status == "requires_action" {
		c.AuthorizeURI = nz(authURI)
	}
	c.FailureCode, c.FailureMessage = nz(fc), nz(fm)
	return c, nil
}

// ---------- handlers ----------

func (h *handler) validReturnURI(u string) bool {
	if u == "" {
		return true
	}
	if strings.HasPrefix(u, "/") && !strings.HasPrefix(u, "//") {
		return true
	}
	base := h.d.Cfg.WebBaseURL
	return base != "" && (u == base || strings.HasPrefix(u, base+"/"))
}

func (h *handler) createCharge(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	var in struct {
		OrderNo   string `json:"order_no"`
		Method    string `json:"method"`
		CardToken string `json:"card_token"`
		ReturnURI string `json:"return_uri"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	f := map[string]string{}
	if in.Method != "promptpay" && in.Method != "card" {
		f["method"] = "วิธีชำระเงินไม่ถูกต้อง"
	}
	if !h.validReturnURI(in.ReturnURI) {
		f["return_uri"] = "return_uri ไม่ถูกต้อง"
	}
	if len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	ctx := c.Request.Context()
	var orderID, total int64
	var status string
	var due time.Time
	err := h.d.DB.QueryRow(ctx, `SELECT id, status, grand_total_satang, payment_due_at FROM orders WHERE order_no = $1 AND user_id = $2`,
		in.OrderNo, u.ID).Scan(&orderID, &status, &total, &due)
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if status != state.PendingPayment || !due.After(h.d.Now()) {
		httpx.Error(c, http.StatusConflict, httpx.CodeInvalidState, "คำสั่งซื้อนี้ไม่อยู่ในสถานะรอชำระเงิน", nil)
		return
	}
	// Re-calling returns the open charge (same method).
	var open string
	err = h.d.DB.QueryRow(ctx, `SELECT provider_charge_id FROM payments WHERE order_id = $1 AND provider = $2 AND method = $3
		AND status IN ('pending', 'requires_action') AND (expires_at IS NULL OR expires_at > $4) ORDER BY id DESC LIMIT 1`,
		orderID, h.p.Name(), in.Method, h.d.Now()).Scan(&open)
	if err == nil {
		out, err := loadCharge(ctx, h.d.DB, h.p.Name(), open, u.ID)
		if err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
		httpx.Data(c, http.StatusCreated, out)
		return
	} else if !httpx.IsNoRows(err) {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	// Switching method: the previous open charge is abandoned locally.
	if _, err := h.d.DB.Exec(ctx, `UPDATE payments SET status = 'expired' WHERE order_id = $1 AND status IN ('pending', 'requires_action')`, orderID); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	ch, err := h.p.CreateCharge(ctx, ChargeInput{OrderNo: in.OrderNo, AmountSatang: total, Method: in.Method,
		CardToken: strings.TrimSpace(in.CardToken), ReturnURI: in.ReturnURI, ExpiresAt: due})
	if errors.Is(err, ErrBadToken) {
		httpx.Validation(c, map[string]string{"card_token": "โทเคนบัตรไม่ถูกต้อง"})
		return
	}
	if errors.Is(err, ErrUnavailable) {
		httpx.Error(c, http.StatusServiceUnavailable, httpx.CodeUnavailable, "ระบบชำระเงินไม่พร้อมให้บริการ", nil)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	var exp *time.Time
	if ch.ExpiresAt != nil {
		t := time.Unix(*ch.ExpiresAt, 0).UTC()
		exp = &t
	}
	_, err = h.d.DB.Exec(ctx, `INSERT INTO payments (order_id, provider, method, provider_charge_id, status, amount_satang,
			qr_payload, qr_image_url, authorize_uri, failure_code, failure_message, expires_at)
		VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, '', '', $9)`,
		orderID, h.p.Name(), in.Method, ch.ID, total, ch.QRPayload, ch.QRImageURL, ch.AuthorizeURI, exp)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if _, err := h.d.DB.Exec(ctx, `UPDATE orders SET payment_method = $2 WHERE id = $1 AND payment_method <> $2`, orderID, in.Method); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	// Apply the provider's initial status (card success/failure is immediate).
	if err := Sync(ctx, h.d, h.p, ch.ID); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	out, err := loadCharge(ctx, h.d.DB, h.p.Name(), ch.ID, u.ID)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusCreated, out)
}

func (h *handler) getCharge(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	ctx := c.Request.Context()
	id := c.Param("charge_id")
	out, err := loadCharge(ctx, h.d.DB, h.p.Name(), id, u.ID)
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if !isFinal(out.Status) {
		if err := Sync(ctx, h.d, h.p, id); err != nil && !errors.Is(err, ErrUnavailable) {
			httpx.Internal(c, h.d.Log, err)
			return
		}
		if out, err = loadCharge(ctx, h.d.DB, h.p.Name(), id, u.ID); err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
	}
	httpx.Data(c, http.StatusOK, out)
}

func (h *handler) mock() (*MockProvider, bool) {
	m, ok := h.p.(*MockProvider)
	return m, ok && h.d.Cfg.PaymentProvider == "mock" && !h.d.Cfg.IsProduction()
}

func (h *handler) mockComplete(c *gin.Context) {
	m, ok := h.mock()
	if !ok {
		httpx.NotFound(c)
		return
	}
	var in struct {
		Outcome string `json:"outcome"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	if in.Outcome == "" {
		in.Outcome = "successful"
	}
	if in.Outcome != "successful" && in.Outcome != "failed" {
		httpx.Validation(c, map[string]string{"outcome": "outcome ต้องเป็น successful หรือ failed"})
		return
	}
	ctx := c.Request.Context()
	id := c.Param("charge_id")
	if err := m.Complete(ctx, id, in.Outcome); err != nil {
		if errors.Is(err, ErrChargeNotFound) {
			httpx.NotFound(c)
			return
		}
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if err := h.emit(ctx, id); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	out, err := loadCharge(ctx, h.d.DB, h.p.Name(), id, 0)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, out)
}

// emit processes a synthetic charge.complete event exactly like a webhook.
func (h *handler) emit(ctx context.Context, chargeID string) error {
	ev := WebhookEvent{ID: "evnt_mock_" + strings.ToLower(auth.RandomToken(9)), Type: "charge.complete", ChargeID: chargeID}
	body := fmt.Sprintf(`{"id":%q,"type":"charge.complete","data":{"id":%q},"synthetic":true}`, ev.ID, chargeID)
	return ProcessEvent(ctx, h.d, h.p, ev, []byte(body))
}

func (h *handler) mockAuthorize(c *gin.Context) {
	m, ok := h.mock()
	if !ok {
		httpx.NotFound(c)
		return
	}
	ctx := c.Request.Context()
	id := c.Param("charge_id")
	ch, err := m.GetCharge(ctx, id)
	if errors.Is(err, ErrChargeNotFound) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	ret, _ := m.ReturnURI(ctx, id)
	if action := c.Query("action"); action == "approve" || action == "decline" {
		outcome := "successful"
		if action == "decline" {
			outcome = "failed"
		}
		if ch.Status == "requires_action" {
			if err := m.Complete(ctx, id, outcome); err != nil {
				httpx.Internal(c, h.d.Log, err)
				return
			}
			if err := h.emit(ctx, id); err != nil {
				httpx.Internal(c, h.d.Log, err)
				return
			}
		}
		if ret == "" {
			ret = h.d.Cfg.WebBaseURL + "/"
		}
		sep := "?"
		if strings.Contains(ret, "?") {
			sep = "&"
		}
		c.Redirect(http.StatusSeeOther, ret+sep+"charge_id="+url.QueryEscape(id))
		return
	}
	e := html.EscapeString
	amount := fmt.Sprintf("฿%d.%02d", ch.AmountSatang/100, ch.AmountSatang%100)
	page := `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mock 3-D Secure</title><link rel="icon" href="data:,"><style>body{font-family:system-ui,sans-serif;background:#f5f5f7;margin:0;display:grid;place-items:center;min-height:100vh}
.c{background:#fff;border-radius:16px;padding:28px;max-width:360px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,.08)}
a{display:block;text-align:center;padding:12px;border-radius:10px;margin-top:10px;text-decoration:none;font-weight:600}
.ok{background:#0071e3;color:#fff}.no{background:#eee;color:#111}small{color:#666}</style></head><body><div class="c">
<h1 style="font-size:20px">ยืนยันการชำระเงิน (จำลอง)</h1><p>ยอดชำระ <b>` + e(amount) + `</b></p>
<p><small>หน้านี้เป็นระบบจำลอง 3-D Secure สำหรับทดสอบเท่านั้น ไม่มีการตัดเงินจริง</small></p>`
	if ch.Status == "requires_action" {
		page += `<a class="ok" href="?action=approve">อนุมัติ (Approve)</a><a class="no" href="?action=decline">ปฏิเสธ (Decline)</a>`
	} else {
		page += `<p>สถานะ: ` + e(ch.Status) + `</p><a class="no" href="?action=approve">กลับไปที่ร้าน</a>`
	}
	page += `</div></body></html>`
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(page))
}

func (h *handler) webhook(c *gin.Context) {
	if c.Param("provider") != h.p.Name() {
		httpx.NotFound(c)
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		httpx.BadRequest(c, "")
		return
	}
	headers := map[string]string{"X-Webhook-Secret": c.GetHeader("X-Webhook-Secret"), "Omise-Signature": c.GetHeader("Omise-Signature")}
	ev, err := h.p.ParseWebhook(c.Request.Context(), headers, body)
	if errors.Is(err, ErrBadSignature) {
		httpx.Error(c, http.StatusUnauthorized, httpx.CodeUnauthorized, "invalid webhook signature", nil)
		return
	}
	if err != nil {
		httpx.BadRequest(c, "invalid webhook")
		return
	}
	if err := ProcessEvent(c.Request.Context(), h.d, h.p, ev, body); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"received": true}})
}

// ProcessEvent stores the event (dedupe on provider+event_id; a duplicate is
// a no-op) and syncs the charge from the provider.
func ProcessEvent(ctx context.Context, d *platform.Deps, p Provider, ev WebhookEvent, body []byte) error {
	if !jsonValid(body) {
		body = []byte("{}")
	}
	var id int64
	err := d.DB.QueryRow(ctx, `INSERT INTO payment_webhook_events (provider, event_id, event_type, charge_id, payload)
		VALUES ($1, $2, $3, $4, $5) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
		p.Name(), ev.ID, ev.Type, ev.ChargeID, body).Scan(&id)
	if httpx.IsNoRows(err) {
		return nil // duplicate delivery
	}
	if err != nil {
		return err
	}
	perr := Sync(ctx, d, p, ev.ChargeID)
	msg := ""
	if perr != nil {
		msg = perr.Error()
		if errors.Is(perr, ErrChargeNotFound) {
			perr = nil
		}
	}
	if _, err := d.DB.Exec(ctx, `UPDATE payment_webhook_events SET processed_at = now(), error = $2 WHERE id = $1`, id, msg); err != nil {
		return err
	}
	return perr
}

func jsonValid(b []byte) bool {
	s := strings.TrimSpace(string(b))
	return strings.HasPrefix(s, "{") && strings.HasSuffix(s, "}")
}

// Sync re-fetches the charge from the provider (never trusting a webhook
// body) and applies it: an already-final local charge is a no-op; success
// marks the order paid (or refunds automatically when the order was already
// cancelled/expired).
func Sync(ctx context.Context, d *platform.Deps, p Provider, chargeID string) error {
	ch, err := p.GetCharge(ctx, chargeID)
	if err != nil {
		return err
	}
	refundAfter := false
	err = httpx.InTx(ctx, d.DB, func(tx pgx.Tx) error {
		var payID, orderID int64
		var cur, method string
		err := tx.QueryRow(ctx, `SELECT id, order_id, status, method FROM payments WHERE provider = $1 AND provider_charge_id = $2 FOR UPDATE`,
			p.Name(), chargeID).Scan(&payID, &orderID, &cur, &method)
		if httpx.IsNoRows(err) {
			return ErrChargeNotFound
		}
		if err != nil {
			return err
		}
		if isFinal(cur) || cur == ch.Status {
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE payments SET status = $2, failure_code = $3, failure_message = $4, authorize_uri = $5,
				paid_at = CASE WHEN $2 = 'successful' THEN now() ELSE paid_at END WHERE id = $1`,
			payID, ch.Status, ch.FailureCode, ch.FailureMsg, ch.AuthorizeURI); err != nil {
			return err
		}
		if ch.Status != "successful" {
			return nil
		}
		st, err := state.Lock(ctx, tx, orderID)
		if err != nil {
			return err
		}
		if st != state.PendingPayment {
			refundAfter = true
			_, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, from_status, to_status, note)
				VALUES ($1, $2, $2, 'ได้รับชำระหลังคำสั่งซื้อถูกยกเลิก คืนเงินอัตโนมัติ')`, orderID, st)
			return err
		}
		note := "PromptPay"
		if method == "card" {
			note = "บัตรเครดิต/เดบิต"
		}
		_, err = state.Transition(ctx, tx, orderID, state.Paid, nil, note)
		return err
	})
	if err != nil || !refundAfter {
		return err
	}
	if err := p.Refund(ctx, chargeID, ch.AmountSatang); err != nil {
		return err
	}
	return httpx.InTx(ctx, d.DB, func(tx pgx.Tx) error {
		var payID, orderID int64
		err := tx.QueryRow(ctx, `UPDATE payments SET status = 'refunded' WHERE provider = $1 AND provider_charge_id = $2
			RETURNING id, order_id`, p.Name(), chargeID).Scan(&payID, &orderID)
		if httpx.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		return email.EnqueueRefund(ctx, tx, orderID, payID, ch.AmountSatang, true)
	})
}

// RefundOrder refunds the order's successful charge via the provider and
// marks it refunded (used by admin cancel-after-payment and refund). No
// successful charge = nothing to refund.
func RefundOrder(ctx context.Context, d *platform.Deps, tx pgx.Tx, orderID int64) error {
	p := ProviderFor(d)
	var payID, amount int64
	var chargeID string
	err := tx.QueryRow(ctx, `SELECT id, provider_charge_id, amount_satang FROM payments WHERE order_id = $1 AND status = 'successful'
		ORDER BY id DESC LIMIT 1 FOR UPDATE`, orderID).Scan(&payID, &chargeID, &amount)
	if httpx.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := p.Refund(ctx, chargeID, amount); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE payments SET status = 'refunded' WHERE id = $1`, payID); err != nil {
		return err
	}
	return email.EnqueueRefund(ctx, tx, orderID, payID, amount, false)
}
