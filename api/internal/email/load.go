package email

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Querier is satisfied by *pgxpool.Pool and pgx.Tx.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// errGone = the order/user behind an outbox row no longer exists (permanent).
var errGone = errors.New("email: subject row not found")

// carrierNames maps shipments.carrier to a display name.
var carrierNames = map[string]string{"flash": "Flash Express", "flash_mock": "Flash Express (ทดสอบ)"}

// TrackingURL is the public tracking page for a parcel. The mock carrier
// has none, so it points at the customer's order page (which shows the
// tracking timeline). The Flash Express URL format must be confirmed when
// the real adapter lands.
func TrackingURL(webBase, carrier, trackingNo, orderNo string) string {
	if carrier == "flash" {
		return "https://www.flashexpress.co.th/fle/tracking?se=" + url.QueryEscape(trackingNo)
	}
	return webBase + "/account/orders/" + url.PathEscape(orderNo)
}

// LoadOrder reads the order summary used by every order template.
// now decides whether the pay-by link is still offered.
func LoadOrder(ctx context.Context, q Querier, webBase string, orderID int64, now time.Time) (*Order, string, error) {
	o := &Order{}
	var name string
	var paidAt *time.Time
	var l1, l2, sub, dist, prov, pc string
	err := q.QueryRow(ctx, `SELECT o.order_no, o.status, o.payment_method, o.created_at, o.paid_at, o.payment_due_at,
			o.subtotal_satang, o.discount_satang, o.shipping_fee_satang, o.savings_satang, o.grand_total_satang,
			o.coupon_code, o.ship_name, o.ship_phone, o.ship_line1, o.ship_line2, o.ship_subdistrict, o.ship_district,
			o.ship_province, o.ship_postal_code, o.customer_note, coalesce(u.name, '')
		FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`, orderID).
		Scan(&o.No, &o.Status, &o.PaymentMethod, &o.CreatedAt, &paidAt, &o.PayBy,
			&o.SubtotalSatang, &o.DiscountSatang, &o.ShippingFeeSatang, &o.SavingsSatang, &o.GrandTotalSatang,
			&o.CouponCode, &o.ShipName, &o.ShipPhone, &l1, &l2, &sub, &dist, &prov, &pc, &o.CustomerNote, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", errGone
	}
	if err != nil {
		return nil, "", err
	}
	if paidAt != nil {
		o.PaidAt = *paidAt
	}
	var parts []string
	for _, s := range []string{l1, l2, sub, dist, prov, pc} {
		if s = strings.TrimSpace(s); s != "" {
			parts = append(parts, s)
		}
	}
	o.ShipAddress = strings.Join(parts, " ")
	o.URL = webBase + "/account/orders/" + url.PathEscape(o.No)
	if o.Status == "pending_payment" && o.PayBy.After(now) {
		o.PayURL = webBase + "/checkout/pay/" + url.PathEscape(o.No)
	}

	rows, err := q.Query(ctx, `SELECT id, product_name, variant_name, sku, image_url, qty, unit_price_satang,
			list_unit_price_satang, line_total_satang, price_source_label
		FROM order_items WHERE order_id = $1 ORDER BY id`, orderID)
	if err != nil {
		return nil, "", err
	}
	idx := map[int64]int{}
	for rows.Next() {
		var id int64
		var it Item
		if err := rows.Scan(&id, &it.Name, &it.Variant, &it.SKU, &it.ImageURL, &it.Qty, &it.UnitSatang,
			&it.ListUnitSatang, &it.LineTotalSatang, &it.PriceLabel); err != nil {
			rows.Close()
			return nil, "", err
		}
		idx[id] = len(o.Items)
		o.Items = append(o.Items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, "", err
	}

	rows, err = q.Query(ctx, `SELECT order_item_id, layer, label, amount_satang FROM order_adjustments
		WHERE order_id = $1 ORDER BY layer, id`, orderID)
	if err != nil {
		return nil, "", err
	}
	for rows.Next() {
		var itemID *int64
		var layer int
		var ln Line
		if err := rows.Scan(&itemID, &layer, &ln.Label, &ln.Amount); err != nil {
			rows.Close()
			return nil, "", err
		}
		switch {
		case layer == 2 && itemID != nil:
			if i, ok := idx[*itemID]; ok {
				o.Items[i].Adjustments = append(o.Items[i].Adjustments, ln)
			}
		case layer == 5:
			if o.ShippingDiscount == nil {
				l := ln
				o.ShippingDiscount = &l
			} else {
				o.ShippingDiscount.Amount += ln.Amount
			}
		case layer == 3 || layer == 4:
			o.Discounts = append(o.Discounts, ln)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	return o, name, nil
}

// LoadShipment returns the order's latest shipment, or nil.
func LoadShipment(ctx context.Context, q Querier, webBase string, orderID int64, orderNo string) (*Shipment, error) {
	var carrier, no string
	err := q.QueryRow(ctx, `SELECT carrier, tracking_no FROM shipments WHERE order_id = $1 ORDER BY id DESC LIMIT 1`, orderID).Scan(&carrier, &no)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	name := carrierNames[carrier]
	if name == "" {
		name = carrier
	}
	return &Shipment{Carrier: name, TrackingNo: no, TrackingURL: TrackingURL(webBase, carrier, no, orderNo)}, nil
}

// outboxRow is one claimed email_outbox row.
type outboxRow struct {
	ID          int64
	Kind        string
	Key         string
	To          string
	UserID      *int64
	OrderID     *int64
	Payload     []byte
	Attempts    int
	MaxAttempts int
}

// buildData loads what the row's template needs.
func buildData(ctx context.Context, q Querier, webBase string, r outboxRow, now time.Time) (Data, error) {
	d := Data{Email: r.To, WebURL: webBase, Link: webBase, Now: now}
	var p struct {
		Reason       string `json:"reason"`
		WasPaid      bool   `json:"was_paid"`
		AmountSatang int64  `json:"amount_satang"`
		LatePayment  bool   `json:"late_payment"`
	}
	if len(r.Payload) > 0 {
		if err := json.Unmarshal(r.Payload, &p); err != nil {
			return d, err
		}
	}
	d.Reason, d.WasPaid, d.RefundSatang, d.LatePayment = p.Reason, p.WasPaid, p.AmountSatang, p.LatePayment

	if r.Kind == KindWelcome {
		if r.UserID == nil {
			return d, errGone
		}
		err := q.QueryRow(ctx, `SELECT name FROM users WHERE id = $1`, *r.UserID).Scan(&d.Name)
		if errors.Is(err, pgx.ErrNoRows) {
			return d, errGone
		}
		return d, err
	}
	if r.OrderID == nil {
		return d, errGone
	}
	o, name, err := LoadOrder(ctx, q, webBase, *r.OrderID, now)
	if err != nil {
		return d, err
	}
	d.Order, d.Name = o, name
	if r.Kind == KindOrderPlaced || r.Kind == KindPaymentReceived {
		d.Link = o.URL
	}
	if r.Kind == KindOrderShipped || r.Kind == KindOrderDelivered {
		if d.Shipment, err = LoadShipment(ctx, q, webBase, *r.OrderID, o.No); err != nil {
			return d, err
		}
	}
	return d, nil
}
