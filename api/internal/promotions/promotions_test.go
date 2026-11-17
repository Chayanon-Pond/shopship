package promotions

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shopship/shop/api/internal/admin/demo"
	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/config"
	"github.com/shopship/shop/api/internal/platform"
	"github.com/shopship/shop/api/internal/pricing"
	"github.com/shopship/shop/api/internal/testdb"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

var testNow = time.Date(2026, 11, 17, 3, 0, 0, 0, time.UTC)

type catalog struct {
	bags, socks, gadgets int64 // category ids
	tote, sock, watch    int64 // variant ids
	user, trade          int64 // user ids (standard / wholesale)
}

func mustExec(t *testing.T, q Querier, sql string, args ...any) {
	t.Helper()
	if _, err := q.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func scalar[T any](t *testing.T, q Querier, sql string, args ...any) T {
	t.Helper()
	var v T
	if err := q.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return v
}

// seedCatalog creates a tiny catalog + two users, then the demo promotions.
func seedCatalog(t *testing.T, pool *pgxpool.Pool) catalog {
	t.Helper()
	var c catalog
	c.bags = scalar[int64](t, pool, `INSERT INTO categories (slug, name, sort_order) VALUES ('bags', 'กระเป๋า', 1) RETURNING id`)
	c.gadgets = scalar[int64](t, pool, `INSERT INTO categories (slug, name, sort_order) VALUES ('gadgets', 'แกดเจ็ต', 2) RETURNING id`)
	apparel := scalar[int64](t, pool, `INSERT INTO categories (slug, name, sort_order) VALUES ('apparel', 'เสื้อผ้า', 3) RETURNING id`)
	c.socks = scalar[int64](t, pool, `INSERT INTO categories (slug, name, parent_id) VALUES ('socks', 'ถุงเท้า', $1) RETURNING id`, apparel)
	prod := func(slug, name string, cat int64, sold int) int64 {
		return scalar[int64](t, pool, `INSERT INTO products (slug, name, category_id, status, sold_count) VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
			slug, name, cat, sold)
	}
	variant := func(pid int64, sku string, price int64) int64 {
		return scalar[int64](t, pool, `INSERT INTO product_variants (product_id, sku, name, price_satang, stock) VALUES ($1, $2, '', $3, 500) RETURNING id`,
			pid, sku, price)
	}
	c.tote = variant(prod("tote", "ถุงผ้า", c.bags, 10), "TOTE", 25000)
	c.sock = variant(prod("socks", "ถุงเท้า", c.socks, 5), "SOCK", 9900)
	c.watch = variant(prod("watch", "นาฬิกา", c.gadgets, 99), "WATCH", 89000)
	// list prices were set long before the test clock (price_history trigger uses the real now())
	mustExec(t, pool, `UPDATE price_history SET changed_at = $1`, testNow.Add(-90*24*time.Hour))
	c.user = scalar[int64](t, pool, `INSERT INTO users (email, name, tier) VALUES ('a@example.com', 'A', 'gold') RETURNING id`)
	if err := seedDemoAt(context.Background(), pool, testNow); err != nil {
		t.Fatal(err)
	}
	// keep only the watch in the flash sales so the other lines exercise the promotions
	mustExec(t, pool, `DELETE FROM flash_sale_items WHERE variant_id <> $1`, c.watch)
	c.trade = scalar[int64](t, pool, `INSERT INTO users (email, name, group_id) VALUES ('t@example.com', 'T',
		(SELECT id FROM customer_groups WHERE code = 'wholesale')) RETURNING id`)
	return c
}

func TestSeedDemoIdempotentAndQuotes(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	c := seedCatalog(t, pool)
	if err := seedDemoAt(ctx, pool, testNow); err != nil { // second run is a no-op
		t.Fatal(err)
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM coupon_codes WHERE code = 'WELCOME100'`); n != 1 {
		t.Fatalf("codes duplicated: %d", n)
	}
	cp, err := ActiveCampaign(ctx, pool, testNow)
	if err != nil || cp == nil || cp.Slug != "11-11" || len(cp.Banners) != 1 || cp.Theme.Accent == "" {
		t.Fatalf("active campaign: %+v %v", cp, err)
	}
	if len(cp.PromoCodes) != 2 || cp.PromoCodes[0].Code != "1111SALE" || cp.PromoCodes[1].Code != "FREESHIP11" ||
		cp.PromoCodes[0].Description == "" || cp.PromoCodes[0].EndsAt == nil || !cp.PromoCodes[0].EndsAt.Equal(cp.EndsAt) {
		t.Fatalf("11.11 promo codes: %+v", cp.PromoCodes)
	}
	// after 11.11 ends the always-on campaign takes over and advertises WELCOME100
	later := testNow.Add(5 * 24 * time.Hour)
	if cp, err := ActiveCampaign(ctx, pool, later); err != nil || cp == nil || cp.Slug != "everyday" ||
		len(cp.PromoCodes) != 1 || cp.PromoCodes[0].Code != "WELCOME100" || cp.PromoCodes[0].EndsAt != nil || len(cp.Banners) != 0 {
		t.Fatalf("everyday campaign: %+v %v", cp, err)
	}
	// batch-generated codes are never advertised
	pid := scalar[int64](t, pool, `SELECT promotion_id FROM coupon_codes WHERE code = 'FREESHIP11'`)
	mustExec(t, pool, `INSERT INTO coupon_codes (promotion_id, code) VALUES ($1, 'FS11BATCH01')`, pid)
	if codes, err := CampaignCodes(ctx, pool, cp.ID, testNow); err != nil || len(codes) != 1 || codes[0].Code != "1111SALE" {
		t.Fatalf("batch codes advertised: %+v %v", codes, err)
	}
	mustExec(t, pool, `DELETE FROM coupon_codes WHERE code = 'FS11BATCH01'`)
	cur, next, err := CurrentFlashSales(ctx, pool, testNow)
	if err != nil || cur == nil || next == nil || len(cur.Items) != 1 || cur.Items[0].Product.Slug != "watch" {
		t.Fatalf("flash: %+v %+v %v", cur, next, err)
	}
	if cur.Items[0].SalePriceSatang != 62300 || cur.Items[0].Lowest30dSatang == nil || *cur.Items[0].Product.Flash.Lowest30dSatang != 89000 {
		t.Fatalf("flash item: %+v", cur.Items[0])
	}

	guest := func(items []Item, code string) pricing.Quote {
		q, err := Quote(ctx, pool, QuoteInput{Items: items, CouponCode: code, BaseShippingFee: 4000, Now: testNow})
		if err != nil {
			t.Fatal(err)
		}
		return q
	}
	// guest: socks buy-2-get-1, flash watch, spend ฿1,500 get ฿150, free shipping
	q := guest([]Item{{c.sock, 3}, {c.watch, 1}}, "")
	if q.Lines[0].Adjustments[0].AmountSatang != 9900 || q.Lines[1].PriceSource.Kind != pricing.SourceFlashSale {
		t.Fatalf("guest lines: %+v", q.Lines)
	}
	// subtotal 19800 + 62300 = 82100 < 99000 -> free shipping gap 16900; login hint (tiers/groups exist)
	if q.Totals.SubtotalSatang != 82100 || len(q.Hints) < 2 || q.Hints[0].Kind != pricing.HintFreeShippingGap || q.Hints[0].AmountSatang != 16900 {
		t.Fatalf("guest totals/hints: %+v %+v", q.Totals, q.Hints)
	}
	for code, reason := range map[string]string{"SONGKRAN": pricing.ReasonExpired, "SALE1212": pricing.ReasonNotStarted,
		"WELCOME100": pricing.ReasonLoginRequired, "NOPE": pricing.ReasonNotFound} {
		if q := guest([]Item{{c.watch, 1}}, code); q.Coupon == nil || q.Coupon.ReasonCode != reason {
			t.Errorf("%s: %+v", code, q.Coupon)
		}
	}
	// deactivated code -> inactive (not "not found")
	mustExec(t, pool, `UPDATE coupon_codes SET is_active = false WHERE code = 'FREESHIP11'`)
	if q := guest([]Item{{c.watch, 1}}, "freeship11"); q.Coupon.ReasonCode != pricing.ReasonInactive {
		t.Errorf("inactive: %+v", q.Coupon)
	}
	// wholesale customer: 12 totes -> quantity break 10 % (22500) beats group 8 % (23000)
	tradeCust, _ := LoadCustomer(ctx, pool, c.trade)
	q, err = Quote(ctx, pool, QuoteInput{Items: []Item{{c.tote, 12}, {c.sock, 1}}, Customer: tradeCust, BaseShippingFee: 4000, Now: testNow})
	if err != nil {
		t.Fatal(err)
	}
	if q.Lines[0].PriceSource.Kind != pricing.SourceQuantityBreak || q.Lines[0].UnitPriceSatang != 22500 ||
		q.Lines[1].PriceSource.Kind != pricing.SourceGroupPrice || q.Lines[1].UnitPriceSatang != 9108 {
		t.Fatalf("trade lines: %+v", q.Lines)
	}
	if q.Lines[0].Lowest30dSatang == nil || *q.Lines[0].Lowest30dSatang != 25000 {
		t.Fatalf("lowest_30d from price_history: %+v", q.Lines[0].Lowest30dSatang)
	}
	// 270000 + 9108 >= 150000 -> layer 3 ฿150; shipping free
	if len(q.Adjustments) != 1 || q.Adjustments[0].AmountSatang != 15000 || q.Shipping.DiscountSatang != 4000 {
		t.Fatalf("trade cart: %+v %+v", q.Adjustments, q.Shipping)
	}
	// preview sees draft rules, the public quote does not
	mustExec(t, pool, `INSERT INTO promotions (name, label, kind, layer, status, starts_at, amount_satang, auto_apply)
		VALUES ('draft', 'draft ลด 1', 'cart_amount', 3, 'draft', $1, 100000, true)`, testNow.Add(-time.Hour))
	pv, err := Preview(ctx, pool, QuoteInput{Items: []Item{{c.watch, 1}}, Now: testNow})
	if err != nil || len(pv.Adjustments) != 1 || pv.Adjustments[0].Label != "draft ลด 1" {
		t.Fatalf("preview: %+v %v", pv.Adjustments, err)
	}
	if q := guest([]Item{{c.watch, 1}}, ""); len(q.Adjustments) != 0 {
		t.Fatalf("draft leaked: %+v", q.Adjustments)
	}
	// offers: gold member price + qty breaks
	gold := &pricing.Customer{ID: c.user, Tier: "gold"}
	offers, err := Offers(ctx, pool, []int64{c.tote, c.sock, 999999}, gold, testNow)
	if err != nil || len(offers) != 2 {
		t.Fatalf("offers: %+v %v", offers, err)
	}
	// 5+ = 5 % (23750) is not cheaper than the Gold price, so only 10+ is offered
	if offers[0].PriceSource.Kind != pricing.SourceTierPrice || offers[0].PriceSatang != 23750 || len(offers[0].QtyBreaks) != 1 ||
		offers[0].QtyBreaks[0].MinQty != 10 || offers[0].QtyBreaks[0].UnitPriceSatang != 22500 || offers[0].Lowest30dSatang == nil {
		t.Fatalf("offer tote: %+v", offers[0])
	}
	if len(offers[1].Badges) != 1 || offers[1].Badges[0] != "ซื้อ 2 แถม 1" {
		t.Fatalf("offer sock badges: %+v", offers[1])
	}
}

// ---------- concurrency ----------

var orderSeq atomic.Int64

func insertOrder(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	n := orderSeq.Add(1)
	var id int64
	err := tx.QueryRow(ctx, `INSERT INTO orders (order_no, user_id, email, ship_name, ship_phone, ship_line1, ship_subdistrict,
		ship_district, ship_province, ship_postal_code, subtotal_satang, grand_total_satang, quote_hash, pricing_snapshot,
		payment_method, idempotency_key, payment_due_at)
		VALUES ($1, $2, 'x@example.com', 'X', '0812345678', '1', 'a', 'b', 'c', '10110', 1000, 1000, 'h', '{}', 'promptpay', $3, now())
		RETURNING id`, fmt.Sprintf("SS261117%06d", n), userID, fmt.Sprintf("idem-key-%d", n)).Scan(&id)
	return id, err
}

func codeQuote(promoID int64, code string) pricing.Quote {
	return pricing.Quote{
		Lines:       []pricing.QuoteLine{},
		Adjustments: []pricing.Adjustment{{PromotionID: promoID, Layer: 4, Label: "x", AmountSatang: 1000, CouponCode: code}},
		Coupon:      &pricing.CouponState{Code: code, Status: pricing.CouponApplied},
	}
}

func TestRedeemUsageLimitConcurrent(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	user := scalar[int64](t, pool, `INSERT INTO users (email) VALUES ('c@example.com') RETURNING id`)
	pid := scalar[int64](t, pool, `INSERT INTO promotions (name, label, kind, layer, status, starts_at, amount_satang, auto_apply, usage_limit)
		VALUES ('ten', 'ten', 'cart_amount', 4, 'active', now(), 1000, false, 10) RETURNING id`)
	mustExec(t, pool, `INSERT INTO coupon_codes (promotion_id, code) VALUES ($1, 'TEN')`, pid)
	q := codeQuote(pid, "TEN")

	var ok, limited atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
				oid, err := insertOrder(ctx, tx, user)
				if err != nil {
					return err
				}
				return Redeem(ctx, tx, q, oid, user)
			})
			var le *LimitError
			switch {
			case err == nil:
				ok.Add(1)
			case errors.As(err, &le) && le.ReasonCode == pricing.ReasonUsageLimit && errors.Is(err, ErrLimitReached):
				limited.Add(1)
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != 10 || limited.Load() != 190 {
		t.Fatalf("ok=%d limited=%d", ok.Load(), limited.Load())
	}
	if n := scalar[int](t, pool, `SELECT used_count FROM promotions WHERE id = $1`, pid); n != 10 {
		t.Fatalf("used_count=%d", n)
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM promotion_redemptions WHERE promotion_id = $1 AND coupon_code_id IS NOT NULL`, pid); n != 10 {
		t.Fatalf("redemptions=%d", n)
	}

	// Release is idempotent and gives the use back exactly once.
	oid := scalar[int64](t, pool, `SELECT order_id FROM promotion_redemptions WHERE promotion_id = $1 LIMIT 1`, pid)
	for i := 0; i < 2; i++ {
		if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error { return Release(ctx, tx, oid) }); err != nil {
			t.Fatal(err)
		}
	}
	if n := scalar[int](t, pool, `SELECT used_count FROM promotions WHERE id = $1`, pid); n != 9 {
		t.Fatalf("after release used_count=%d", n)
	}
	// Confirm flips the remaining reserved ones.
	other := scalar[int64](t, pool, `SELECT order_id FROM promotion_redemptions WHERE promotion_id = $1 AND status = 'reserved' LIMIT 1`, pid)
	if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error { return Confirm(ctx, tx, other) }); err != nil {
		t.Fatal(err)
	}
	if s := scalar[string](t, pool, `SELECT status FROM promotion_redemptions WHERE order_id = $1`, other); s != "confirmed" {
		t.Fatalf("confirm: %s", s)
	}
}

func TestRedeemPerCustomerConcurrent(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	user := scalar[int64](t, pool, `INSERT INTO users (email) VALUES ('p@example.com') RETURNING id`)
	pid := scalar[int64](t, pool, `INSERT INTO promotions (name, label, kind, layer, status, starts_at, amount_satang, auto_apply, per_customer_limit)
		VALUES ('two', 'two', 'cart_amount', 4, 'active', now(), 1000, false, 2) RETURNING id`)
	q := codeQuote(pid, "TWO")
	var ok, limited atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
				oid, err := insertOrder(ctx, tx, user)
				if err != nil {
					return err
				}
				return Redeem(ctx, tx, q, oid, user)
			})
			var le *LimitError
			switch {
			case err == nil:
				ok.Add(1)
			case errors.As(err, &le) && le.ReasonCode == pricing.ReasonPerCustomerLimit:
				limited.Add(1)
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != 2 || limited.Load() != 48 {
		t.Fatalf("ok=%d limited=%d", ok.Load(), limited.Load())
	}
	if n := scalar[int](t, pool, `SELECT used_count FROM promotions WHERE id = $1`, pid); n != 2 {
		t.Fatalf("used_count=%d (rolled-back tx must not count)", n)
	}
}

func TestFlashQtyLimitConcurrent(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	cat := scalar[int64](t, pool, `INSERT INTO categories (slug, name) VALUES ('c', 'c') RETURNING id`)
	pid := scalar[int64](t, pool, `INSERT INTO products (slug, name, category_id, status) VALUES ('p', 'p', $1, 'active') RETURNING id`, cat)
	vid := scalar[int64](t, pool, `INSERT INTO product_variants (product_id, sku, price_satang, stock) VALUES ($1, 'V', 10000, 1000) RETURNING id`, pid)
	sid := scalar[int64](t, pool, `INSERT INTO flash_sales (name, status, starts_at, ends_at) VALUES ('f', 'active', now(), now() + interval '1 hour') RETURNING id`)
	fid := scalar[int64](t, pool, `INSERT INTO flash_sale_items (flash_sale_id, variant_id, sale_price_satang, qty_limit) VALUES ($1, $2, 5000, 10) RETURNING id`, sid, vid)
	var ok, soldOut atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error { return ReserveFlash(ctx, tx, fid, 1) })
			switch {
			case err == nil:
				ok.Add(1)
			case errors.Is(err, ErrFlashSoldOut):
				soldOut.Add(1)
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != 10 || soldOut.Load() != 190 {
		t.Fatalf("ok=%d soldOut=%d", ok.Load(), soldOut.Load())
	}
	if n := scalar[int](t, pool, `SELECT sold_qty FROM flash_sale_items WHERE id = $1`, fid); n != 10 {
		t.Fatalf("sold_qty=%d", n)
	}
	// engine falls back to list price once the allocation is gone
	q, err := Quote(ctx, pool, QuoteInput{Items: []Item{{vid, 1}}, Now: time.Now()})
	if err != nil || q.Lines[0].PriceSource.Kind != pricing.SourceList {
		t.Fatalf("sold out flash still priced: %+v %v", q.Lines, err)
	}
	if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error { return ReleaseFlash(ctx, tx, fid, 3) }); err != nil {
		t.Fatal(err)
	}
	if n := scalar[int](t, pool, `SELECT sold_qty FROM flash_sale_items WHERE id = $1`, fid); n != 7 {
		t.Fatalf("after release sold_qty=%d", n)
	}
}

// ---------- HTTP ----------

type testServer struct {
	r    *gin.Engine
	user *auth.User
}

func newServer(t *testing.T, pool *pgxpool.Pool) *testServer {
	gin.SetMode(gin.TestMode)
	ts := &testServer{r: gin.New()}
	d := &platform.Deps{DB: pool, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Now: func() time.Time { return testNow },
		Cfg: config.Config{ShippingFlatRateSatang: 4000}}
	v1 := ts.r.Group("/api/v1", func(c *gin.Context) {
		if ts.user != nil {
			c.Set("auth.user", ts.user) // what auth.LoadSession does
		}
		c.Next()
	})
	Register(platform.Routes{V1: v1, Admin: v1.Group("/admin", auth.RequireStaff())}, d)
	return ts
}

func (ts *testServer) do(t *testing.T, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rd)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	ts.r.ServeHTTP(w, req)
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func TestHTTP(t *testing.T) {
	pool := testdb.New(t)
	c := seedCatalog(t, pool)
	ts := newServer(t, pool)

	code, body := ts.do(t, "GET", "/api/v1/campaigns/active", nil)
	if code != 200 || body["data"].(map[string]any)["slug"] != "11-11" {
		t.Fatalf("campaign: %d %v", code, body)
	}
	code, body = ts.do(t, "GET", "/api/v1/banners?placement=home_hero", nil)
	if code != 200 || len(body["data"].([]any)) != 1 { // only the running campaign's banner
		t.Fatalf("banners: %d %v", code, body)
	}
	code, body = ts.do(t, "GET", "/api/v1/flash-sales/current", nil)
	if code != 200 || body["data"].(map[string]any)["current"] == nil {
		t.Fatalf("flash: %d %v", code, body)
	}
	code, body = ts.do(t, "GET", fmt.Sprintf("/api/v1/offers?variant_ids=%d,%d", c.tote, c.sock), nil)
	if code != 200 || len(body["data"].([]any)) != 2 {
		t.Fatalf("offers: %d %v", code, body)
	}
	if code, _ = ts.do(t, "GET", "/api/v1/offers?variant_ids=x", nil); code != 400 {
		t.Fatalf("offers bad ids: %d", code)
	}

	// admin RBAC
	if code, _ = ts.do(t, "GET", "/api/v1/admin/promotions", nil); code != 401 {
		t.Fatalf("no session: %d", code)
	}
	ts.user = &auth.User{ID: c.user, Email: "a@example.com", Role: auth.RoleStaff}
	if code, _ = ts.do(t, "GET", "/api/v1/admin/promotions?state=ended", nil); code != 200 {
		t.Fatalf("staff read: %d", code)
	}
	if code, _ = ts.do(t, "POST", "/api/v1/admin/promotions", map[string]any{}); code != 403 {
		t.Fatalf("staff write: %d", code)
	}
	ts.user.Role = auth.RoleAdmin

	code, body = ts.do(t, "GET", "/api/v1/admin/promotions?state=ended", nil)
	if code != 200 || len(body["data"].([]any)) != 1 || body["data"].([]any)[0].(map[string]any)["name"] != "สงกรานต์ ลด 100" {
		t.Fatalf("ended filter: %d %v", code, body)
	}
	code, body = ts.do(t, "POST", "/api/v1/admin/promotions", map[string]any{"name": "x", "label": "x", "kind": "cart_percent", "starts_at": testNow})
	if code != 422 || body["error"].(map[string]any)["fields"].(map[string]any)["percent_bp"] == nil {
		t.Fatalf("validation: %d %v", code, body)
	}
	code, body = ts.do(t, "POST", "/api/v1/admin/promotions", map[string]any{
		"name": "ทดสอบ", "label": "โค้ด TEST ลด 10%", "kind": "cart_percent", "status": "active", "starts_at": testNow.Add(-time.Hour),
		"percent_bp": 1000, "max_discount_satang": 5000, "codes": []string{"test10"},
		"targets": []map[string]any{{"type": "category", "id": c.gadgets}}})
	if code != 201 {
		t.Fatalf("create: %d %v", code, body)
	}
	p := body["data"].(map[string]any)
	if p["layer"].(float64) != 4 || p["state"] != "running" || p["codes"].([]any)[0].(map[string]any)["code"] != "TEST10" ||
		p["targets"].([]any)[0].(map[string]any)["name"] != "แกดเจ็ต" {
		t.Fatalf("created: %v", p)
	}
	id := int64(p["id"].(float64))
	code, body = ts.do(t, "PATCH", fmt.Sprintf("/api/v1/admin/promotions/%d", id), map[string]any{"priority": 5, "max_discount_satang": nil})
	if code != 200 || body["data"].(map[string]any)["priority"].(float64) != 5 || body["data"].(map[string]any)["max_discount_satang"] != nil ||
		body["data"].(map[string]any)["percent_bp"].(float64) != 1000 {
		t.Fatalf("patch: %d %v", code, body)
	}
	code, body = ts.do(t, "POST", fmt.Sprintf("/api/v1/admin/promotions/%d/codes", id), map[string]any{"generate": map[string]any{"count": 5, "prefix": "VIP", "length": 6}})
	if code != 200 || len(body["data"].([]any)) != 5 {
		t.Fatalf("generate: %d %v", code, body)
	}
	if code, _ = ts.do(t, "POST", fmt.Sprintf("/api/v1/admin/promotions/%d/codes", id), map[string]any{"codes": []string{"TEST10"}}); code != 409 {
		t.Fatalf("duplicate code: %d", code)
	}
	code, body = ts.do(t, "POST", "/api/v1/admin/promotions/preview", map[string]any{
		"lines": []map[string]any{{"variant_id": c.watch, "qty": 2}}, "coupon_code": "TEST10", "user_id": c.user, "postal_code": "10110"})
	if code != 200 {
		t.Fatalf("preview: %d %v", code, body)
	}
	pq := body["data"].(map[string]any)
	if pq["coupon"].(map[string]any)["status"] != "applied" || pq["shipping"].(map[string]any)["fee_satang"].(float64) != 4000 {
		t.Fatalf("preview quote: %v", pq)
	}
	if code, _ = ts.do(t, "DELETE", fmt.Sprintf("/api/v1/admin/promotions/%d", id), nil); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if code, _ = ts.do(t, "GET", fmt.Sprintf("/api/v1/admin/promotions/%d", id), nil); code != 404 {
		t.Fatalf("deleted still there: %d", code)
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM audit_logs WHERE action LIKE 'promotion.%' OR action LIKE 'coupon_code.%'`); n < 4 {
		t.Fatalf("audit rows: %d", n)
	}

	// flash sales: overlap with the running seeded sale -> 409; below list price required
	code, body = ts.do(t, "POST", "/api/v1/admin/flash-sales", map[string]any{"name": "dup", "status": "active",
		"starts_at": testNow, "ends_at": testNow.Add(time.Hour), "items": []map[string]any{{"variant_id": c.watch, "sale_price_satang": 50000, "qty_limit": 5}}})
	if code != 409 {
		t.Fatalf("overlap: %d %v", code, body)
	}
	code, body = ts.do(t, "POST", "/api/v1/admin/flash-sales", map[string]any{"name": "ok", "status": "draft",
		"starts_at": testNow, "ends_at": testNow.Add(time.Hour), "items": []map[string]any{{"variant_id": c.tote, "sale_price_satang": 26000, "qty_limit": 5}}})
	if code != 422 {
		t.Fatalf("sale >= list: %d %v", code, body)
	}
	code, body = ts.do(t, "POST", "/api/v1/admin/flash-sales", map[string]any{"name": "ok", "status": "draft",
		"starts_at": testNow, "ends_at": testNow.Add(time.Hour), "items": []map[string]any{{"variant_id": c.tote, "sale_price_satang": 20000, "qty_limit": 5}}})
	if code != 201 || len(body["data"].(map[string]any)["items"].([]any)) != 1 {
		t.Fatalf("flash create: %d %v", code, body)
	}
	fsID := int64(body["data"].(map[string]any)["id"].(float64))
	code, body = ts.do(t, "PUT", fmt.Sprintf("/api/v1/admin/flash-sales/%d/items", fsID), []map[string]any{
		{"variant_id": c.sock, "sale_price_satang": 5000, "qty_limit": 9, "per_customer_limit": 1}})
	if code != 200 || body["data"].(map[string]any)["items"].([]any)[0].(map[string]any)["sku"] != "SOCK" {
		t.Fatalf("items: %d %v", code, body)
	}

	// campaigns + customer groups
	code, body = ts.do(t, "POST", "/api/v1/admin/campaigns", map[string]any{"slug": "mid-year", "name": "Mid Year",
		"starts_at": testNow, "ends_at": testNow.Add(48 * time.Hour), "theme": map[string]any{"accent": "#123456"}})
	if code != 201 || body["data"].(map[string]any)["state"] != "running" {
		t.Fatalf("campaign create: %d %v", code, body)
	}
	if code, _ = ts.do(t, "POST", "/api/v1/admin/campaigns", map[string]any{"slug": "Bad Slug", "name": "x"}); code != 422 {
		t.Fatalf("campaign validation: %d", code)
	}
	code, body = ts.do(t, "GET", "/api/v1/admin/customer-groups", nil)
	if code != 200 || len(body["data"].([]any)) != 2 {
		t.Fatalf("groups: %d %v", code, body)
	}
	gid := scalar[int64](t, pool, `SELECT id FROM customer_groups WHERE code = 'wholesale'`)
	if code, _ = ts.do(t, "DELETE", fmt.Sprintf("/api/v1/admin/customer-groups/%d", gid), nil); code != 204 {
		t.Fatalf("group delete: %d", code)
	}
	if s := scalar[string](t, pool, `SELECT status FROM promotions WHERE name = 'ขายส่ง ลด 8%'`); s != "archived" {
		t.Fatalf("orphaned group price should be archived: %s", s)
	}
	if g := scalar[*int64](t, pool, `SELECT group_id FROM users WHERE id = $1`, c.trade); g != nil {
		t.Fatalf("member group not cleared")
	}
}

// SeedDemo on api-core's real demo catalog (admin/demo seam) gives a
// coherent demo: something running, targets resolved, quotes price.
func TestSeedDemoOnDemoCatalog(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	demo.PromotionsSeeder = SeedDemo
	t.Cleanup(func() { demo.PromotionsSeeder = nil })
	now := time.Now().UTC()
	if _, err := demo.Seed(ctx, pool, demo.Options{Now: now, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}); err != nil {
		t.Fatal(err)
	}
	if n := scalar[int](t, pool, `SELECT count(*) FROM promotion_targets`); n < 3 {
		t.Fatalf("targets not resolved: %d", n)
	}
	cur, _, err := CurrentFlashSales(ctx, pool, now)
	if err != nil || cur == nil || len(cur.Items) == 0 {
		t.Fatalf("no running flash sale: %+v %v", cur, err)
	}
	if cp, err := ActiveCampaign(ctx, pool, now); err != nil || cp == nil {
		t.Fatalf("no active campaign: %v", err)
	}
	vid := scalar[int64](t, pool, `SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
		JOIN categories c ON c.id = p.category_id WHERE c.slug = 'bags' AND v.stock >= 10 AND v.is_active ORDER BY v.price_satang LIMIT 1`)
	cust, err := LoadCustomer(ctx, pool, scalar[int64](t, pool, `SELECT id FROM users WHERE email = 'wholesale@shopship.local'`))
	if err != nil || cust == nil {
		t.Fatalf("wholesale user: %v", err)
	}
	q, err := Quote(ctx, pool, QuoteInput{Items: []Item{{vid, 10}}, CouponCode: "WELCOME100", Customer: cust, BaseShippingFee: 4000, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if q.Lines[0].PriceSource.Kind != pricing.SourceQuantityBreak || q.Coupon.Status != pricing.CouponApplied {
		t.Fatalf("demo quote: %+v %+v", q.Lines[0], q.Coupon)
	}
}
