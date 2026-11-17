package orders

import (
	"context"
	"time"

	"github.com/shopship/shop/api/internal/catalog"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/pricing"
)

type PriceSourceOut struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
}

type ItemOut struct {
	ID                  int64          `json:"-"`
	VariantID           *int64         `json:"variant_id"`
	ProductSlug         string         `json:"product_slug"`
	SKU                 string         `json:"sku"`
	ProductName         string         `json:"product_name"`
	VariantName         string         `json:"variant_name"`
	ImageURL            string         `json:"image_url"`
	Qty                 int            `json:"qty"`
	ListUnitPriceSatang int64          `json:"list_unit_price_satang"`
	UnitPriceSatang     int64          `json:"unit_price_satang"`
	PriceSource         PriceSourceOut `json:"price_source"`
	LineDiscountSatang  int64          `json:"line_discount_satang"`
	LineTotalSatang     int64          `json:"line_total_satang"`
	AllocatedDiscount   int64          `json:"allocated_discount_satang"`
	Lowest30dSatang     *int64         `json:"lowest_30d_satang"`
}

type Totals struct {
	ListSubtotalSatang     int64 `json:"list_subtotal_satang"`
	SubtotalSatang         int64 `json:"subtotal_satang"`
	DiscountSatang         int64 `json:"discount_satang"`
	ShippingFeeSatang      int64 `json:"shipping_fee_satang"`
	ShippingDiscountSatang int64 `json:"shipping_discount_satang"`
	SavingsSatang          int64 `json:"savings_satang"`
	GrandTotalSatang       int64 `json:"grand_total_satang"`
}

type AddressOut struct {
	Label         string `json:"label"`
	RecipientName string `json:"recipient_name"`
	Phone         string `json:"phone"`
	Line1         string `json:"line1"`
	Line2         string `json:"line2"`
	Subdistrict   string `json:"subdistrict"`
	District      string `json:"district"`
	Province      string `json:"province"`
	PostalCode    string `json:"postal_code"`
	Country       string `json:"country"`
	IsDefault     bool   `json:"is_default"`
}

type PaymentOut struct {
	Status    string     `json:"status"`
	Method    string     `json:"method"`
	ChargeID  string     `json:"charge_id"`
	ExpiresAt *time.Time `json:"expires_at"`
}

type ShipmentOut struct {
	ID         int64  `json:"-"`
	Carrier    string `json:"carrier"`
	TrackingNo string `json:"tracking_no"`
	Status     string `json:"status"`
	LabelURL   string `json:"label_url,omitempty"`
}

type TimelineOut struct {
	Status string    `json:"status"`
	At     time.Time `json:"at"`
	Note   string    `json:"note"`
}

// Order is the customer order shape (docs/API.md §8).
type Order struct {
	ID              int64                `json:"-"`
	UserID          int64                `json:"-"`
	OrderNo         string               `json:"order_no"`
	Status          string               `json:"status"`
	Items           []ItemOut            `json:"items"`
	Adjustments     []pricing.Adjustment `json:"adjustments"`
	Totals          Totals               `json:"totals"`
	CouponCode      *string              `json:"coupon_code"`
	PaymentMethod   string               `json:"payment_method"`
	ShippingAddress AddressOut           `json:"shipping_address"`
	Email           string               `json:"email"`
	CustomerNote    string               `json:"customer_note"`
	Payment         *PaymentOut          `json:"payment"`
	Shipment        *ShipmentOut         `json:"shipment"`
	Timeline        []TimelineOut        `json:"timeline"`
	PaymentDueAt    time.Time            `json:"payment_due_at"`
	PaidAt          *time.Time           `json:"paid_at"`
	CancelledAt     *time.Time           `json:"cancelled_at"`
	CreatedAt       time.Time            `json:"created_at"`
}

func utcPtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// LoadOrder reads the full order by order_no. userID > 0 restricts to that owner.
func LoadOrder(ctx context.Context, q httpx.Querier, orderNo string, userID int64, withLabel bool) (Order, error) {
	var o Order
	var coupon string
	a := &o.ShippingAddress
	err := q.QueryRow(ctx, `SELECT id, user_id, order_no, status, email, ship_name, ship_phone, ship_line1, ship_line2, ship_subdistrict,
			ship_district, ship_province, ship_postal_code, subtotal_satang, discount_satang, shipping_fee_satang,
			shipping_discount_satang, savings_satang, grand_total_satang, coupon_code, customer_note, payment_method,
			payment_due_at, paid_at, cancelled_at, created_at, coalesce(pricing_snapshot->>'address_label', '')
		FROM orders WHERE order_no = $1 AND ($2 = 0 OR user_id = $2)`, orderNo, userID).
		Scan(&o.ID, &o.UserID, &o.OrderNo, &o.Status, &o.Email, &a.RecipientName, &a.Phone, &a.Line1, &a.Line2, &a.Subdistrict,
			&a.District, &a.Province, &a.PostalCode, &o.Totals.SubtotalSatang, &o.Totals.DiscountSatang, &o.Totals.ShippingFeeSatang,
			&o.Totals.ShippingDiscountSatang, &o.Totals.SavingsSatang, &o.Totals.GrandTotalSatang, &coupon, &o.CustomerNote,
			&o.PaymentMethod, &o.PaymentDueAt, &o.PaidAt, &o.CancelledAt, &o.CreatedAt, &a.Label)
	if err != nil {
		return o, err
	}
	a.Country = "TH"
	if coupon != "" {
		o.CouponCode = &coupon
	}
	o.PaymentDueAt, o.CreatedAt = o.PaymentDueAt.UTC(), o.CreatedAt.UTC()
	o.PaidAt, o.CancelledAt = utcPtr(o.PaidAt), utcPtr(o.CancelledAt)

	rows, err := q.Query(ctx, `SELECT oi.id, oi.variant_id, coalesce(p.slug, ''), oi.sku, oi.product_name, oi.variant_name, oi.image_url, oi.qty,
			oi.list_unit_price_satang, oi.unit_price_satang, oi.price_source_kind, oi.price_source_label, oi.line_discount_satang,
			oi.line_total_satang, oi.allocated_discount_satang, oi.lowest_30d_satang
		FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1 ORDER BY oi.id`, o.ID)
	if err != nil {
		return o, err
	}
	o.Items = []ItemOut{}
	for rows.Next() {
		var it ItemOut
		if err := rows.Scan(&it.ID, &it.VariantID, &it.ProductSlug, &it.SKU, &it.ProductName, &it.VariantName, &it.ImageURL, &it.Qty,
			&it.ListUnitPriceSatang, &it.UnitPriceSatang, &it.PriceSource.Kind, &it.PriceSource.Label, &it.LineDiscountSatang,
			&it.LineTotalSatang, &it.AllocatedDiscount, &it.Lowest30dSatang); err != nil {
			rows.Close()
			return o, err
		}
		o.Totals.ListSubtotalSatang += int64(it.Qty) * it.ListUnitPriceSatang
		o.Items = append(o.Items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return o, err
	}

	rows, err = q.Query(ctx, `SELECT coalesce(promotion_id, 0), layer, label, amount_satang, coupon_code FROM order_adjustments
		WHERE order_id = $1 ORDER BY layer, id`, o.ID)
	if err != nil {
		return o, err
	}
	o.Adjustments = []pricing.Adjustment{}
	for rows.Next() {
		var ad pricing.Adjustment
		if err := rows.Scan(&ad.PromotionID, &ad.Layer, &ad.Label, &ad.AmountSatang, &ad.CouponCode); err != nil {
			rows.Close()
			return o, err
		}
		o.Adjustments = append(o.Adjustments, ad)
	}
	rows.Close()

	var p PaymentOut
	err = q.QueryRow(ctx, `SELECT status, method, provider_charge_id, expires_at FROM payments WHERE order_id = $1 ORDER BY id DESC LIMIT 1`, o.ID).
		Scan(&p.Status, &p.Method, &p.ChargeID, &p.ExpiresAt)
	if err == nil {
		p.ExpiresAt = utcPtr(p.ExpiresAt)
		o.Payment = &p
	} else if !httpx.IsNoRows(err) {
		return o, err
	}

	var s ShipmentOut
	err = q.QueryRow(ctx, `SELECT id, carrier, tracking_no, status, label_url FROM shipments WHERE order_id = $1 ORDER BY id DESC LIMIT 1`, o.ID).
		Scan(&s.ID, &s.Carrier, &s.TrackingNo, &s.Status, &s.LabelURL)
	if err == nil {
		if !withLabel {
			s.LabelURL = ""
		}
		o.Shipment = &s
	} else if !httpx.IsNoRows(err) {
		return o, err
	}

	rows, err = q.Query(ctx, `SELECT to_status, created_at, note FROM order_status_history WHERE order_id = $1 AND to_status <> from_status
		ORDER BY created_at, id`, o.ID)
	if err != nil {
		return o, err
	}
	defer rows.Close()
	o.Timeline = []TimelineOut{}
	for rows.Next() {
		var t TimelineOut
		if err := rows.Scan(&t.Status, &t.At, &t.Note); err != nil {
			return o, err
		}
		t.At = t.At.UTC()
		o.Timeline = append(o.Timeline, t)
	}
	return o, rows.Err()
}

// Summary is OrderSummary.
type Summary struct {
	OrderNo          string         `json:"order_no"`
	Status           string         `json:"status"`
	ItemCount        int            `json:"item_count"`
	GrandTotalSatang int64          `json:"grand_total_satang"`
	CreatedAt        time.Time      `json:"created_at"`
	FirstItemImage   *catalog.Image `json:"first_item_image"`
}

// Summaries lists OrderSummary rows for a WHERE fragment on orders o.
func Summaries(ctx context.Context, q httpx.Querier, where string, limit, offset int, args ...any) ([]Summary, error) {
	n := len(args)
	args = append(args, limit, offset)
	rows, err := q.Query(ctx, `SELECT o.order_no, o.status, coalesce((SELECT sum(qty) FROM order_items WHERE order_id = o.id), 0)::int,
			o.grand_total_satang, o.created_at, img.id, img.url, img.alt, img.width, img.height
		FROM orders o
		LEFT JOIN LATERAL (SELECT i.id, i.url, i.alt, i.width, i.height FROM order_items oi
			JOIN product_images i ON i.product_id = oi.product_id WHERE oi.order_id = o.id
			ORDER BY oi.id, i.sort_order, i.id LIMIT 1) img ON true
		WHERE `+where+` ORDER BY o.created_at DESC, o.id DESC LIMIT $`+itoa(n+1)+` OFFSET $`+itoa(n+2), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Summary{}
	for rows.Next() {
		var s Summary
		var iid *int64
		var iurl, ialt *string
		var iw, ih *int
		if err := rows.Scan(&s.OrderNo, &s.Status, &s.ItemCount, &s.GrandTotalSatang, &s.CreatedAt, &iid, &iurl, &ialt, &iw, &ih); err != nil {
			return nil, err
		}
		s.CreatedAt = s.CreatedAt.UTC()
		if iid != nil {
			s.FirstItemImage = &catalog.Image{ID: *iid, URL: *iurl, Alt: *ialt, Width: *iw, Height: *ih}
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
