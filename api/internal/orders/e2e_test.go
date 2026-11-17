package orders_test

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shopship/shop/api/internal/orders"
	"github.com/shopship/shop/api/internal/testdb"
	"github.com/shopship/shop/api/internal/testdb/apitest"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

type quote struct {
	QuoteHash string `json:"quote_hash"`
	Shipping  struct {
		FeeSatang int64 `json:"fee_satang"`
	} `json:"shipping"`
	Totals struct {
		GrandTotalSatang int64 `json:"grand_total_satang"`
	} `json:"totals"`
}

type order struct {
	OrderNo string `json:"order_no"`
	Status  string `json:"status"`
	Items   []struct {
		Qty int `json:"qty"`
	} `json:"items"`
	Totals struct {
		GrandTotalSatang int64 `json:"grand_total_satang"`
	} `json:"totals"`
	Payment *struct {
		Status   string `json:"status"`
		ChargeID string `json:"charge_id"`
	} `json:"payment"`
	Shipment *struct {
		ID         int64  `json:"id"`
		TrackingNo string `json:"tracking_no"`
		Status     string `json:"status"`
	} `json:"shipment"`
	Timeline []struct {
		Status string `json:"status"`
	} `json:"timeline"`
}

type charge struct {
	ChargeID  string `json:"charge_id"`
	Status    string `json:"status"`
	PromptPay *struct {
		QRPayload string `json:"qr_payload"`
	} `json:"promptpay"`
	AuthorizeURI *string `json:"authorize_uri"`
}

// buyer = signed-in customer with an address and qty of variant in the cart.
func buyer(t *testing.T, e *apitest.Env, email string, variantID int64, qty int) (*apitest.Client, int64) {
	t.Helper()
	uid := e.UserNoPassword(email, "customer")
	addr := e.Address(uid)
	c := e.SessionClient(uid)
	c.Do("POST", "/api/v1/cart/items", map[string]any{"variant_id": variantID, "qty": qty}).Must(t, 200)
	return c, addr
}

func getQuote(t *testing.T, c *apitest.Client, addr int64) quote {
	t.Helper()
	var q quote
	c.Do("POST", "/api/v1/cart/quote", map[string]any{"address_id": addr}).Must(t, 200).Data(t, &q)
	return q
}

func checkout(c *apitest.Client, key string, addr int64, hash string) apitest.Resp {
	return c.Do("POST", "/api/v1/orders", map[string]any{"address_id": addr, "payment_method": "promptpay", "quote_hash": hash},
		"Idempotency-Key", key)
}

func stockOf(e *apitest.Env, vid int64) int {
	var s int
	e.Scalar(&s, `SELECT stock FROM product_variants WHERE id = $1`, vid)
	return s
}

func TestGuestCartMergeAndQuote(t *testing.T) {
	e := apitest.New(t)
	_, v1 := e.Product("tee", "เสื้อยืด", 29000, 10)
	_, v2 := e.Product("mug", "แก้วมัค", 22000, 3)
	e.User("merge@example.com", "password-123", "customer")

	g := e.Client()
	// empty cart: no cookie created
	var cart struct {
		Items []struct {
			VariantID int64 `json:"variant_id"`
			Qty       int   `json:"qty"`
		} `json:"items"`
		ItemCount int     `json:"item_count"`
		Coupon    *string `json:"coupon_code"`
		Quote     quote   `json:"quote"`
	}
	g.Do("GET", "/api/v1/cart", nil).Must(t, 200).Data(t, &cart)
	if len(cart.Items) != 0 || g.Cookie("shopship_cart") != "" {
		t.Fatal("GET /cart must not create a cart")
	}
	g.Do("POST", "/api/v1/cart/items", map[string]any{"variant_id": v1, "qty": 2}).Must(t, 200)
	if g.Cookie("shopship_cart") == "" {
		t.Fatal("guest cart cookie not set")
	}
	g.Do("POST", "/api/v1/cart/items", map[string]any{"variant_id": v2, "qty": 4}).Must(t, 409) // > stock
	g.Do("POST", "/api/v1/cart/items", map[string]any{"variant_id": v2, "qty": 1}).Must(t, 200)
	g.Do("PATCH", fmt.Sprintf("/api/v1/cart/items/%d", v2), map[string]any{"qty": 3}).Must(t, 200)
	g.Do("PUT", "/api/v1/cart/coupon", map[string]any{"code": "hello10"}).Must(t, 200).Data(t, &cart)
	if cart.Coupon == nil || *cart.Coupon != "HELLO10" || cart.ItemCount != 5 {
		t.Fatalf("cart = %+v", cart)
	}
	// quote: shipping 0 without postal code, flat 4000 with one
	var q quote
	g.Do("POST", "/api/v1/cart/quote", map[string]any{}).Must(t, 200).Data(t, &q)
	if q.Shipping.FeeSatang != 0 || q.QuoteHash == "" {
		t.Fatalf("quote no postal = %+v", q)
	}
	g.Do("POST", "/api/v1/cart/quote", map[string]any{"postal_code": "10110"}).Must(t, 200).Data(t, &q)
	if q.Shipping.FeeSatang != 4000 || q.Totals.GrandTotalSatang != 2*29000+3*22000+4000 {
		t.Fatalf("quote = %+v", q)
	}
	g.Do("POST", "/api/v1/cart/quote", map[string]any{"postal_code": "abc"}).Must(t, 422)
	var rate struct {
		Carrier   string `json:"carrier"`
		FeeSatang int64  `json:"fee_satang"`
		EtaDays   [2]int `json:"eta_days"`
	}
	g.Do("POST", "/api/v1/shipping/quote", map[string]any{"postal_code": "96000"}).Must(t, 200).Data(t, &rate)
	if rate.Carrier != "flash_mock" || rate.FeeSatang != 4000 || rate.EtaDays != [2]int{2, 5} {
		t.Fatalf("shipping quote = %+v", rate)
	}

	// user already has v1 x1 in their own cart -> merged: v1 = 3, v2 = 3
	uid := int64(0)
	e.Scalar(&uid, `SELECT id FROM users WHERE email = 'merge@example.com'`)
	e.Exec(`INSERT INTO carts (user_id) VALUES ($1)`, uid)
	e.Exec(`INSERT INTO cart_items (cart_id, variant_id, qty) SELECT id, $2, 1 FROM carts WHERE user_id = $1`, uid, v1)
	g.Login("merge@example.com", "password-123").Must(t, 200)
	if g.Cookie("shopship_cart") != "" {
		t.Fatal("guest cart cookie not cleared after login")
	}
	g.Do("GET", "/api/v1/cart", nil).Must(t, 200).Data(t, &cart)
	got := map[int64]int{}
	for _, it := range cart.Items {
		got[it.VariantID] = it.Qty
	}
	if got[v1] != 3 || got[v2] != 3 || cart.Coupon == nil || *cart.Coupon != "HELLO10" {
		t.Fatalf("merged cart = %+v", cart)
	}
	var merged int
	e.Scalar(&merged, `SELECT count(*) FROM carts WHERE status = 'merged'`)
	if merged != 1 {
		t.Fatalf("merged carts = %d", merged)
	}
	g.Do("DELETE", fmt.Sprintf("/api/v1/cart/items/%d", v2), nil).Must(t, 200)
	g.Do("DELETE", "/api/v1/cart/coupon", nil).Must(t, 200).Data(t, &cart)
	if len(cart.Items) != 1 || cart.Coupon != nil {
		t.Fatalf("after delete = %+v", cart)
	}
}

func TestCheckoutPayShip(t *testing.T) {
	e := apitest.New(t)
	_, vid := e.Product("earbuds", "หูฟังไร้สาย", 120000, 5)
	c, addr := buyer(t, e, "buyer@example.com", vid, 2)
	q := getQuote(t, c, addr)
	if q.Totals.GrandTotalSatang != 2*120000+4000 {
		t.Fatalf("grand total = %d", q.Totals.GrandTotalSatang)
	}

	// stale hash -> 409 price_changed with the fresh quote
	r := checkout(c, "key-stale-0001", addr, "deadbeef")
	if r.Status != 409 || r.Code() != "price_changed" || !strings.Contains(string(r.Body), `"quote_hash"`) {
		t.Fatalf("stale hash = %d %s", r.Status, r.Body)
	}
	c.Do("POST", "/api/v1/orders", map[string]any{"address_id": addr, "payment_method": "promptpay", "quote_hash": q.QuoteHash}).Must(t, 400) // no key

	var o order
	checkout(c, "key-checkout-0001", addr, q.QuoteHash).Must(t, 201).Data(t, &o)
	if o.Status != "pending_payment" || len(o.Items) != 1 || o.Totals.GrandTotalSatang != q.Totals.GrandTotalSatang {
		t.Fatalf("order = %+v", o)
	}
	if stockOf(e, vid) != 3 {
		t.Fatalf("stock after order = %d", stockOf(e, vid))
	}
	var held int
	e.Scalar(&held, `SELECT count(*) FROM stock_reservations WHERE status = 'held'`)
	if held != 1 {
		t.Fatalf("held reservations = %d", held)
	}
	// cart converted -> new empty cart
	var cart struct {
		Items []any `json:"items"`
	}
	c.Do("GET", "/api/v1/cart", nil).Must(t, 200).Data(t, &cart)
	if len(cart.Items) != 0 {
		t.Fatal("cart not converted")
	}

	// PromptPay charge (re-call returns the open charge)
	var ch, ch2 charge
	c.Do("POST", "/api/v1/payments/charges", map[string]any{"order_no": o.OrderNo, "method": "promptpay"}).Must(t, 201).Data(t, &ch)
	if ch.Status != "pending" || ch.PromptPay == nil || !strings.HasPrefix(ch.PromptPay.QRPayload, "000201") {
		t.Fatalf("charge = %+v", ch)
	}
	c.Do("POST", "/api/v1/payments/charges", map[string]any{"order_no": o.OrderNo, "method": "promptpay"}).Must(t, 201).Data(t, &ch2)
	if ch2.ChargeID != ch.ChargeID {
		t.Fatal("re-call created a second charge")
	}
	// another user cannot see it
	stranger := e.SessionClient(e.UserNoPassword("stranger@example.com", "customer"))
	stranger.Do("GET", "/api/v1/payments/charges/"+ch.ChargeID, nil).Must(t, 404)
	stranger.Do("GET", "/api/v1/orders/"+o.OrderNo, nil).Must(t, 404)

	// webhook auth + unknown event before payment = harmless
	wh := e.Client()
	body := map[string]any{"id": "evnt_test_1", "type": "charge.complete", "data": map[string]any{"id": ch.ChargeID}}
	wh.Do("POST", "/api/v1/webhooks/payments/mock", body, "X-Webhook-Secret", "wrong").Must(t, 401)
	wh.Do("POST", "/api/v1/webhooks/payments/mock", body, "X-Webhook-Secret", apitest.WebhookSecret).Must(t, 200)
	c.Do("GET", "/api/v1/orders/"+o.OrderNo, nil).Must(t, 200).Data(t, &o)
	if o.Status != "pending_payment" {
		t.Fatal("webhook trusted a non-final charge")
	}

	// payer pays (mock) -> emits the webhook -> order paid
	c.Do("POST", "/api/v1/payments/mock/charges/"+ch.ChargeID+"/complete", map[string]any{"outcome": "successful"}).Must(t, 200)
	c.Do("GET", "/api/v1/payments/charges/"+ch.ChargeID, nil).Must(t, 200).Data(t, &ch)
	c.Do("GET", "/api/v1/orders/"+o.OrderNo, nil).Must(t, 200).Data(t, &o)
	if ch.Status != "successful" || o.Status != "paid" || o.Payment == nil || o.Payment.Status != "successful" {
		t.Fatalf("after pay: charge %s order %s", ch.Status, o.Status)
	}
	// duplicate webhook delivery -> 200 no-op
	wh.Do("POST", "/api/v1/webhooks/payments/mock", map[string]any{"id": "evnt_test_2", "type": "charge.complete", "data": map[string]any{"id": ch.ChargeID}},
		"X-Webhook-Secret", apitest.WebhookSecret).Must(t, 200)
	wh.Do("POST", "/api/v1/webhooks/payments/mock", map[string]any{"id": "evnt_test_2", "type": "charge.complete", "data": map[string]any{"id": ch.ChargeID}},
		"X-Webhook-Secret", apitest.WebhookSecret).Must(t, 200)
	var committed, sold, histPaid int
	e.Scalar(&committed, `SELECT count(*) FROM stock_reservations WHERE status = 'committed'`)
	e.Scalar(&sold, `SELECT sold_count FROM products WHERE slug = 'earbuds'`)
	e.Scalar(&histPaid, `SELECT count(*) FROM order_status_history WHERE to_status = 'paid'`)
	if committed != 1 || sold != 2 || histPaid != 1 {
		t.Fatalf("committed=%d sold=%d paid history=%d", committed, sold, histPaid)
	}
	c.Do("POST", "/api/v1/orders/"+o.OrderNo+"/cancel", nil).Must(t, 409) // paid: customer cannot cancel

	// back office: staff packs, creates shipment -> shipped, mock tracking -> delivered
	staff := e.SessionClient(e.UserNoPassword("packer@example.com", "staff"))
	staff.Do("POST", "/api/v1/admin/orders/"+o.OrderNo+"/shipments", map[string]any{}).Must(t, 409) // not packing yet
	staff.Do("POST", "/api/v1/admin/orders/"+o.OrderNo+"/status", map[string]any{"to": "cancelled"}).Must(t, 403)
	staff.Do("POST", "/api/v1/admin/orders/"+o.OrderNo+"/status", map[string]any{"to": "packing"}).Must(t, 200)
	var sh struct {
		ID         int64  `json:"id"`
		TrackingNo string `json:"tracking_no"`
		LabelURL   string `json:"label_url"`
		FeeSatang  int64  `json:"fee_satang"`
	}
	staff.Do("POST", "/api/v1/admin/orders/"+o.OrderNo+"/shipments", map[string]any{}).Must(t, 201).Data(t, &sh)
	if len(sh.TrackingNo) != 14 || !strings.HasPrefix(sh.TrackingNo, "TH") || !strings.HasSuffix(sh.TrackingNo, "MK") || sh.FeeSatang != 4000 {
		t.Fatalf("shipment = %+v", sh)
	}
	lbl := staff.Do("GET", sh.LabelURL, nil).Must(t, 200)
	if !strings.Contains(string(lbl.Body), sh.TrackingNo) {
		t.Fatal("label lacks tracking number")
	}
	c.Do("GET", "/api/v1/orders/"+o.OrderNo, nil).Must(t, 200).Data(t, &o)
	if o.Status != "shipped" || o.Shipment == nil || o.Shipment.TrackingNo != sh.TrackingNo {
		t.Fatalf("order after shipment = %+v", o)
	}
	var ao order
	staff.Do("GET", "/api/v1/admin/orders/"+o.OrderNo, nil).Must(t, 200).Data(t, &ao)
	if ao.Shipment == nil || ao.Shipment.ID != sh.ID {
		t.Fatalf("admin order shipment id = %+v", ao.Shipment)
	}
	for i := 0; i < 4; i++ {
		staff.Do("POST", fmt.Sprintf("/api/v1/admin/shipments/%d/mock-advance", sh.ID), nil).Must(t, 200)
	}
	staff.Do("POST", fmt.Sprintf("/api/v1/admin/shipments/%d/mock-advance", sh.ID), nil).Must(t, 409)
	var tr struct {
		Status string `json:"status"`
		Events []any  `json:"events"`
	}
	c.Do("GET", "/api/v1/orders/"+o.OrderNo+"/tracking", nil).Must(t, 200).Data(t, &tr)
	c.Do("GET", "/api/v1/orders/"+o.OrderNo, nil).Must(t, 200).Data(t, &o)
	if tr.Status != "delivered" || len(tr.Events) != 5 || o.Status != "delivered" {
		t.Fatalf("tracking %s (%d events), order %s", tr.Status, len(tr.Events), o.Status)
	}
	// carrier webhook dedupe
	ev := map[string]any{"tracking_no": sh.TrackingNo, "status": "delivered", "description": "x", "location": "y", "occurred_at": "2026-11-17T10:00:00Z"}
	e.Client().Do("POST", "/api/v1/webhooks/shipping/flash_mock", ev, "X-Webhook-Secret", apitest.WebhookSecret).Must(t, 200)
	e.Client().Do("POST", "/api/v1/webhooks/shipping/flash_mock", ev, "X-Webhook-Secret", apitest.WebhookSecret).Must(t, 200)
	var evs int
	e.Scalar(&evs, `SELECT count(*) FROM shipment_events`)
	if evs != 6 {
		t.Fatalf("shipment events = %d", evs)
	}
	// admin refunds a delivered order (orders:manage)
	admin := e.SessionClient(e.UserNoPassword("boss@example.com", "admin"))
	admin.Do("POST", "/api/v1/admin/orders/"+o.OrderNo+"/status", map[string]any{"to": "refunded", "note": "ลูกค้าคืนสินค้า"}).Must(t, 200)
	var ps string
	e.Scalar(&ps, `SELECT status FROM payments WHERE provider_charge_id = $1`, ch.ChargeID)
	if ps != "refunded" {
		t.Fatalf("payment after refund = %s", ps)
	}
	// list + dashboard
	var list []any
	c.Do("GET", "/api/v1/orders", nil).Must(t, 200).Data(t, &list)
	if len(list) != 1 {
		t.Fatalf("orders list = %d", len(list))
	}
	staff.Do("GET", "/api/v1/admin/orders?q="+strings.ToLower(o.OrderNo), nil).Must(t, 200)
	staff.Do("GET", "/api/v1/admin/dashboard", nil).Must(t, 200)
}

func TestCardFlows(t *testing.T) {
	e := apitest.New(t)
	_, vid := e.Product("watch", "สมาร์ทวอทช์", 89000, 10)
	for _, tc := range []struct{ token, want string }{
		{"tokn_test_success", "successful"}, {"tokn_test_failure", "failed"}, {"tokn_test_3ds", "requires_action"},
	} {
		c, addr := buyer(t, e, tc.token+"@example.com", vid, 1)
		q := getQuote(t, c, addr)
		var o order
		checkout(c, "key-"+tc.token, addr, q.QuoteHash).Must(t, 201).Data(t, &o)
		var ch charge
		c.Do("POST", "/api/v1/payments/charges", map[string]any{"order_no": o.OrderNo, "method": "card", "card_token": tc.token,
			"return_uri": "/checkout/pay/" + o.OrderNo}).Must(t, 201).Data(t, &ch)
		if ch.Status != tc.want {
			t.Fatalf("%s: charge %s", tc.token, ch.Status)
		}
		if tc.want == "requires_action" {
			if ch.AuthorizeURI == nil {
				t.Fatal("no authorize_uri")
			}
			page := e.Client().Do("GET", "/api/v1/payments/mock/authorize/"+ch.ChargeID, nil).Must(t, 200)
			if !strings.Contains(string(page.Body), "Approve") {
				t.Fatal("3DS page")
			}
			r := e.Client().Do("GET", "/api/v1/payments/mock/authorize/"+ch.ChargeID+"?action=approve", nil).Must(t, http.StatusSeeOther)
			if !strings.HasPrefix(r.Header.Get("Location"), "/checkout/pay/"+o.OrderNo) {
				t.Fatalf("redirect = %s", r.Header.Get("Location"))
			}
		}
		c.Do("GET", "/api/v1/orders/"+o.OrderNo, nil).Must(t, 200).Data(t, &o)
		wantOrder := map[string]string{"successful": "paid", "failed": "pending_payment", "requires_action": "paid"}[tc.want]
		if o.Status != wantOrder {
			t.Fatalf("%s: order %s", tc.token, o.Status)
		}
	}
}

func TestIdempotencyReplay(t *testing.T) {
	e := apitest.New(t)
	_, vid := e.Product("socks", "ถุงเท้า", 9900, 10)
	c, addr := buyer(t, e, "idem@example.com", vid, 3)
	q := getQuote(t, c, addr)
	var o1, o2 order
	checkout(c, "same-key-123456", addr, q.QuoteHash).Must(t, 201).Data(t, &o1)
	checkout(c, "same-key-123456", addr, q.QuoteHash).Must(t, 200).Data(t, &o2)
	if o1.OrderNo != o2.OrderNo {
		t.Fatal("replay created another order")
	}
	if r := c.Do("POST", "/api/v1/orders", map[string]any{"address_id": addr, "payment_method": "card", "quote_hash": q.QuoteHash},
		"Idempotency-Key", "same-key-123456"); r.Status != 409 || r.Code() != "idempotency_conflict" {
		t.Fatalf("different body = %d %s", r.Status, r.Body)
	}
	var n int
	e.Scalar(&n, `SELECT count(*) FROM orders`)
	if n != 1 || stockOf(e, vid) != 7 {
		t.Fatalf("orders=%d stock=%d", n, stockOf(e, vid))
	}
}

func TestReservationExpiryReleasesStock(t *testing.T) {
	e := apitest.New(t)
	_, vid := e.Product("tent", "เต็นท์", 249000, 4)
	c, addr := buyer(t, e, "slow@example.com", vid, 3)
	q := getQuote(t, c, addr)
	var o order
	checkout(c, "key-expiry-0001", addr, q.QuoteHash).Must(t, 201).Data(t, &o)
	var ch charge
	c.Do("POST", "/api/v1/payments/charges", map[string]any{"order_no": o.OrderNo, "method": "promptpay"}).Must(t, 201).Data(t, &ch)
	if stockOf(e, vid) != 1 {
		t.Fatalf("stock = %d", stockOf(e, vid))
	}
	ctx := context.Background()
	if n, err := orders.ExpireNow(ctx, e.Deps); err != nil || n != 0 {
		t.Fatalf("premature expiry: %d %v", n, err)
	}
	e.Advance(16 * time.Minute)
	if n, err := orders.ExpireNow(ctx, e.Deps); err != nil || n != 1 {
		t.Fatalf("expiry: %d %v", n, err)
	}
	if n, err := orders.ExpireNow(ctx, e.Deps); err != nil || n != 0 {
		t.Fatalf("second expiry run: %d %v", n, err)
	}
	c.Do("GET", "/api/v1/orders/"+o.OrderNo, nil).Must(t, 200).Data(t, &o)
	if o.Status != "cancelled" || stockOf(e, vid) != 4 {
		t.Fatalf("after expiry: %s stock %d", o.Status, stockOf(e, vid))
	}
	var released int
	e.Scalar(&released, `SELECT count(*) FROM stock_reservations WHERE status = 'released'`)
	if released != 1 {
		t.Fatalf("released = %d", released)
	}
	// late payment after expiry -> charge expired at the provider
	if r := c.Do("POST", "/api/v1/payments/mock/charges/"+ch.ChargeID+"/complete", map[string]any{"outcome": "successful"}); r.Status != 200 {
		t.Fatalf("late complete = %d", r.Status)
	}
	c.Do("GET", "/api/v1/orders/"+o.OrderNo, nil).Must(t, 200).Data(t, &o)
	if o.Status != "cancelled" || stockOf(e, vid) != 4 {
		t.Fatalf("late payment changed order: %s", o.Status)
	}
	// customer cancel path also releases (fresh order)
	c.Do("POST", "/api/v1/cart/items", map[string]any{"variant_id": vid, "qty": 2}).Must(t, 200)
	q = getQuote(t, c, addr)
	checkout(c, "key-expiry-0002", addr, q.QuoteHash).Must(t, 201).Data(t, &o)
	c.Do("POST", "/api/v1/orders/"+o.OrderNo+"/cancel", nil).Must(t, 200).Data(t, &o)
	c.Do("POST", "/api/v1/orders/"+o.OrderNo+"/cancel", nil).Must(t, 409)
	if o.Status != "cancelled" || stockOf(e, vid) != 4 {
		t.Fatalf("cancel: %s stock %d", o.Status, stockOf(e, vid))
	}
}

// 200 buyers race for 50 units: exactly 50 orders, stock 0, no oversell.
func TestConcurrentCheckoutNoOversell(t *testing.T) {
	e := apitest.New(t)
	_, vid := e.Product("flash-item", "สินค้าลดราคา", 59000, 50)
	const n = 200
	type b struct {
		c    *apitest.Client
		addr int64
		hash string
	}
	buyers := make([]b, n)
	for i := 0; i < n; i++ {
		c, addr := buyer(t, e, fmt.Sprintf("racer%03d@example.com", i), vid, 1)
		buyers[i] = b{c, addr, ""}
	}
	for i := range buyers {
		buyers[i].hash = getQuote(t, buyers[i].c, buyers[i].addr).QuoteHash
	}
	var ok, conflict, other atomic.Int64
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			r := checkout(buyers[i].c, fmt.Sprintf("race-key-%04d", i), buyers[i].addr, buyers[i].hash)
			switch {
			case r.Status == 201:
				ok.Add(1)
			case r.Status == 409 && (r.Code() == "out_of_stock" || r.Code() == "price_changed"):
				conflict.Add(1)
			default:
				other.Add(1)
				t.Errorf("unexpected %d %s", r.Status, r.Body)
			}
		}(i)
	}
	close(start)
	wg.Wait()
	var orders, reserved int
	e.Scalar(&orders, `SELECT count(*) FROM orders`)
	e.Scalar(&reserved, `SELECT coalesce(sum(qty), 0)::int FROM stock_reservations WHERE status = 'held'`)
	t.Logf("ok=%d conflict=%d other=%d", ok.Load(), conflict.Load(), other.Load())
	if ok.Load() != 50 || conflict.Load() != n-50 || orders != 50 || reserved != 50 || stockOf(e, vid) != 0 {
		t.Fatalf("ok=%d conflict=%d orders=%d reserved=%d stock=%d", ok.Load(), conflict.Load(), orders, reserved, stockOf(e, vid))
	}
}
