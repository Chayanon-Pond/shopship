package orders_test

import (
	"context"
	"testing"
	"time"

	"github.com/shopship/shop/api/internal/orders"
	"github.com/shopship/shop/api/internal/testdb/apitest"
)

type promoOrder struct {
	OrderNo string `json:"order_no"`
	Status  string `json:"status"`
	Items   []struct {
		VariantID       int64 `json:"variant_id"`
		Qty             int   `json:"qty"`
		UnitPriceSatang int64 `json:"unit_price_satang"`
		PriceSource     struct {
			Kind string `json:"kind"`
		} `json:"price_source"`
	} `json:"items"`
	Adjustments []struct {
		Layer      int    `json:"layer"`
		CouponCode string `json:"coupon_code"`
	} `json:"adjustments"`
	CouponCode *string `json:"coupon_code"`
	Totals     struct {
		DiscountSatang   int64 `json:"discount_satang"`
		GrandTotalSatang int64 `json:"grand_total_satang"`
	} `json:"totals"`
}

// Seasonal code + trade tier (quantity break for the wholesale group) +
// flash item -> pay -> confirmed; a second order cancelled and a third
// expired release stock, flash sold_qty and promotion usage.
func TestCheckoutWithPromotions(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()
	_, tote := e.Product("tote", "ถุงผ้าแคนวาส", 25000, 100)
	_, watch := e.Product("watch", "สมาร์ทวอทช์", 89000, 50)

	var group, qb, code, fsItem int64
	e.Scalar(&group, `INSERT INTO customer_groups (code, name) VALUES ('wholesale', 'ขายส่ง') RETURNING id`)
	e.Scalar(&qb, `INSERT INTO promotions (name, label, kind, layer, status, starts_at, customer_group_ids)
		VALUES ('trade tote', 'ราคาส่ง 10 ชิ้นขึ้นไป', 'quantity_break', 1, 'active', now() - interval '1 day', ARRAY[$1::bigint]) RETURNING id`, group)
	e.Exec(`INSERT INTO promotion_qty_tiers (promotion_id, min_qty, unit_price_satang) VALUES ($1, 10, 21000)`, qb)
	e.Exec(`INSERT INTO promotion_targets (promotion_id, target_type, variant_id) VALUES ($1, 'variant', $2)`, qb, tote)
	e.Scalar(&code, `INSERT INTO promotions (name, label, kind, layer, status, auto_apply, starts_at, ends_at, percent_bp, usage_limit, per_customer_limit, season_tag)
		VALUES ('songkran', 'โค้ดสงกรานต์ ลด 10%', 'cart_percent', 4, 'active', false, now() - interval '1 day', now() + interval '10 days', 1000, 5, 1, 'songkran') RETURNING id`)
	e.Exec(`INSERT INTO coupon_codes (promotion_id, code) VALUES ($1, 'SONGKRAN26')`, code)
	var fs int64
	e.Scalar(&fs, `INSERT INTO flash_sales (name, label, status, starts_at, ends_at) VALUES ('11.11', 'Flash Sale 11.11', 'active', now() - interval '1 hour', now() + interval '1 day') RETURNING id`)
	e.Scalar(&fsItem, `INSERT INTO flash_sale_items (flash_sale_id, variant_id, sale_price_satang, qty_limit) VALUES ($1, $2, 59000, 10) RETURNING id`, fs, watch)

	newBuyer := func(email string) (*apitest.Client, int64) {
		uid := e.UserNoPassword(email, "customer")
		e.Exec(`UPDATE users SET group_id = $2 WHERE id = $1`, uid, group)
		addr := e.Address(uid)
		c := e.SessionClient(uid)
		c.Do("POST", "/api/v1/cart/items", map[string]any{"variant_id": tote, "qty": 12}).Must(t, 200)
		c.Do("POST", "/api/v1/cart/items", map[string]any{"variant_id": watch, "qty": 1}).Must(t, 200)
		c.Do("PUT", "/api/v1/cart/coupon", map[string]any{"code": "songkran26"}).Must(t, 200)
		return c, addr
	}
	place := func(c *apitest.Client, addr int64, key string) promoOrder {
		t.Helper()
		q := getQuote(t, c, addr)
		var o promoOrder
		checkout(c, key, addr, q.QuoteHash).Must(t, 201).Data(t, &o)
		return o
	}
	scalarInt := func(sql string, args ...any) int {
		var n int
		e.Scalar(&n, sql, args...)
		return n
	}

	// ---- order 1: pay -> confirm ----
	c1, a1 := newBuyer("trade1@example.com")
	o1 := place(c1, a1, "promo-key-0001")
	src := map[int64]string{}
	unit := map[int64]int64{}
	for _, it := range o1.Items {
		src[it.VariantID], unit[it.VariantID] = it.PriceSource.Kind, it.UnitPriceSatang
	}
	if src[tote] != "quantity_break" || unit[tote] != 21000 || src[watch] != "flash_sale" || unit[watch] != 59000 {
		t.Fatalf("price sources = %v %v", src, unit)
	}
	subtotal := int64(12*21000 + 59000)
	if o1.CouponCode == nil || *o1.CouponCode != "SONGKRAN26" || o1.Totals.DiscountSatang != subtotal/10 {
		t.Fatalf("coupon = %v discount %d", o1.CouponCode, o1.Totals.DiscountSatang)
	}
	if n := scalarInt(`SELECT count(*) FROM promotion_redemptions WHERE status = 'reserved'`); n != 2 {
		t.Fatalf("reserved redemptions = %d", n)
	}
	if scalarInt(`SELECT sold_qty FROM flash_sale_items WHERE id = $1`, fsItem) != 1 || scalarInt(`SELECT used_count FROM promotions WHERE id = $1`, code) != 1 {
		t.Fatal("flash sold_qty / used_count not reserved")
	}
	var ch charge
	c1.Do("POST", "/api/v1/payments/charges", map[string]any{"order_no": o1.OrderNo, "method": "promptpay"}).Must(t, 201).Data(t, &ch)
	c1.Do("POST", "/api/v1/payments/mock/charges/"+ch.ChargeID+"/complete", map[string]any{"outcome": "successful"}).Must(t, 200)
	c1.Do("GET", "/api/v1/orders/"+o1.OrderNo, nil).Must(t, 200).Data(t, &o1)
	if o1.Status != "paid" {
		t.Fatalf("order1 = %s", o1.Status)
	}
	if n := scalarInt(`SELECT count(*) FROM promotion_redemptions WHERE status = 'confirmed'`); n != 2 {
		t.Fatalf("confirmed redemptions = %d", n)
	}
	// the same customer cannot use the code twice (per_customer_limit 1): quote reports it
	c1.Do("POST", "/api/v1/cart/items", map[string]any{"variant_id": tote, "qty": 1}).Must(t, 200)
	c1.Do("PUT", "/api/v1/cart/coupon", map[string]any{"code": "SONGKRAN26"}).Must(t, 200)
	var q2 struct {
		Coupon struct {
			Status     string `json:"status"`
			ReasonCode string `json:"reason_code"`
		} `json:"coupon"`
	}
	c1.Do("POST", "/api/v1/cart/quote", map[string]any{"address_id": a1}).Must(t, 200).Data(t, &q2)
	if q2.Coupon.ReasonCode != "per_customer_limit_reached" {
		t.Fatalf("second use coupon = %+v", q2.Coupon)
	}

	// ---- order 2: customer cancels -> everything released ----
	c2, a2 := newBuyer("trade2@example.com")
	o2 := place(c2, a2, "promo-key-0002")
	if scalarInt(`SELECT used_count FROM promotions WHERE id = $1`, code) != 2 || scalarInt(`SELECT sold_qty FROM flash_sale_items WHERE id = $1`, fsItem) != 2 {
		t.Fatal("order2 not reserved")
	}
	c2.Do("POST", "/api/v1/orders/"+o2.OrderNo+"/cancel", nil).Must(t, 200)
	if scalarInt(`SELECT used_count FROM promotions WHERE id = $1`, code) != 1 || scalarInt(`SELECT sold_qty FROM flash_sale_items WHERE id = $1`, fsItem) != 1 {
		t.Fatal("cancel did not release code usage / flash allocation")
	}
	if scalarInt(`SELECT count(*) FROM promotion_redemptions r JOIN orders o ON o.id = r.order_id WHERE o.order_no = $1 AND r.status = 'released'`, o2.OrderNo) != 2 {
		t.Fatal("order2 redemptions not released")
	}

	// ---- order 3: expires -> released once ----
	c3, a3 := newBuyer("trade3@example.com")
	place(c3, a3, "promo-key-0003")
	stockTote := stockOf(e, tote)
	e.Advance(16 * time.Minute)
	for i := 0; i < 2; i++ { // idempotent
		if _, err := orders.ExpireNow(ctx, e.Deps); err != nil {
			t.Fatal(err)
		}
	}
	if scalarInt(`SELECT used_count FROM promotions WHERE id = $1`, code) != 1 || scalarInt(`SELECT sold_qty FROM flash_sale_items WHERE id = $1`, fsItem) != 1 ||
		stockOf(e, tote) != stockTote+12 || stockOf(e, watch) != 49 {
		t.Fatalf("expiry release: used=%d sold=%d tote=%d watch=%d",
			scalarInt(`SELECT used_count FROM promotions WHERE id = $1`, code), scalarInt(`SELECT sold_qty FROM flash_sale_items WHERE id = $1`, fsItem),
			stockOf(e, tote), stockOf(e, watch))
	}
	if scalarInt(`SELECT used_count FROM promotions WHERE id = $1`, qb) != 1 {
		t.Fatalf("trade promo used_count = %d", scalarInt(`SELECT used_count FROM promotions WHERE id = $1`, qb))
	}
}

// usage_limit reached between quote and checkout -> 409 limit_reached.
func TestCouponUsageLimitRace(t *testing.T) {
	e := apitest.New(t)
	_, v := e.Product("mug", "แก้วมัค", 22000, 100)
	var code int64
	e.Scalar(&code, `INSERT INTO promotions (name, label, kind, layer, status, auto_apply, starts_at, amount_satang, usage_limit)
		VALUES ('one shot', 'ลด 50 บาท', 'cart_amount', 4, 'active', false, now() - interval '1 day', 5000, 1) RETURNING id`)
	e.Exec(`INSERT INTO coupon_codes (promotion_id, code) VALUES ($1, 'ONESHOT')`, code)
	a, aa := buyer(t, e, "a@example.com", v, 1)
	b, ba := buyer(t, e, "b@example.com", v, 1)
	for _, c := range []*apitest.Client{a, b} {
		c.Do("PUT", "/api/v1/cart/coupon", map[string]any{"code": "ONESHOT"}).Must(t, 200)
	}
	qa, qb := getQuote(t, a, aa), getQuote(t, b, ba)
	checkout(a, "oneshot-a-0001", aa, qa.QuoteHash).Must(t, 201)
	r := checkout(b, "oneshot-b-0001", ba, qb.QuoteHash)
	// b's quote is stale: the re-priced quote now says usage_limit_reached
	if r.Status != 409 || (r.Code() != "price_changed" && r.Code() != "limit_reached") {
		t.Fatalf("second use = %d %s", r.Status, r.Body)
	}
	var used int
	e.Scalar(&used, `SELECT used_count FROM promotions WHERE id = $1`, code)
	if used != 1 {
		t.Fatalf("used_count = %d", used)
	}
}
