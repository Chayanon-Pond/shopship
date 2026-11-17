package assistant_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/shopship/shop/api/internal/testdb"
	"github.com/shopship/shop/api/internal/testdb/apitest"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

type card struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	PriceSatang int64  `json:"price_satang"`
	VariantID   *int64 `json:"variant_id"`
}

type reply struct {
	Reply       string   `json:"reply"`
	Suggestions []string `json:"suggestions"`
	Products    []card   `json:"products"`
	Actions     []struct {
		Label string `json:"label"`
		Href  string `json:"href"`
	} `json:"actions"`
	Source string `json:"source"`
}

func ask(t *testing.T, c *apitest.Client, text string, slug ...string) reply {
	t.Helper()
	body := map[string]any{"messages": []map[string]string{{"role": "user", "content": text}}}
	if len(slug) > 0 {
		body["context"] = map[string]string{"product_slug": slug[0]}
	}
	var r reply
	c.Do("POST", "/api/v1/assistant/chat", body).Must(t, 200).Data(t, &r)
	return r
}

// noLLM makes sure a developer's real key never reaches tests.
func noLLM(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")
}

func TestRulesSearchAndPolicy(t *testing.T) {
	noLLM(t)
	e := apitest.New(t)
	e.Product("white-tee", "เสื้อยืดคอตตอนสีขาว", 29000, 10)
	e.Product("tote", "กระเป๋าผ้าแคนวาส", 35000, 0)
	g := e.Client()

	r := ask(t, g, "มีเสื้อยึดไหมคะ") // typo: trigram search
	if r.Source != "rules" || len(r.Products) != 1 || r.Products[0].Slug != "white-tee" || r.Products[0].PriceSatang != 29000 {
		t.Fatalf("search: %+v", r)
	}
	if r.Products[0].VariantID == nil || !strings.Contains(r.Reply, "฿290") {
		t.Fatalf("single in-stock variant should be addable and priced: %+v", r)
	}
	if r := ask(t, g, "หากระเป๋าผ้า"); len(r.Products) != 1 || r.Products[0].VariantID != nil || !strings.Contains(r.Reply, "หมดชั่วคราว") {
		t.Fatalf("out of stock product: %+v", r)
	}
	if r := ask(t, g, "คืนสินค้าได้ไหม"); !strings.Contains(r.Reply, "เลขคำสั่งซื้อ") || len(r.Actions) == 0 {
		t.Fatalf("policy: %+v", r)
	}
	if r := ask(t, g, "ค่าส่งไป 10110 เท่าไหร่"); !strings.Contains(r.Reply, "฿40") || !strings.Contains(r.Reply, "1–3") {
		t.Fatalf("shipping: %+v", r)
	}
	if r := ask(t, g, "ตัวนี้มีไซส์อะไรบ้าง", "white-tee"); len(r.Products) != 1 || !strings.Contains(r.Reply, "พร้อมส่ง") {
		t.Fatalf("detail: %+v", r)
	}

	// validation, CSRF/Origin, guest without cookie
	g.Do("POST", "/api/v1/assistant/chat", map[string]any{"messages": []map[string]string{{"role": "user", "content": strings.Repeat("ก", 501)}}}).Must(t, 422)
	g.Do("POST", "/api/v1/assistant/chat", map[string]any{"messages": []any{}}).Must(t, 422)
	g.Do("POST", "/api/v1/assistant/chat", map[string]any{"messages": []map[string]string{{"role": "user", "content": "hi"}}},
		"Origin", "https://evil.example").Must(t, 403)
}

func TestNoTradePriceLeak(t *testing.T) {
	noLLM(t)
	e := apitest.New(t)
	_, vid := e.Product("bulk-pen", "ปากกาลูกลื่นสีน้ำเงิน", 10000, 100)
	var group int64
	e.Scalar(&group, `INSERT INTO customer_groups (code, name) VALUES ('wholesale', 'ขายส่ง') RETURNING id`)
	e.Exec(`INSERT INTO promotions (name, label, kind, layer, status, starts_at, percent_bp, customer_group_ids, auto_apply)
		VALUES ('ws', 'ราคาขายส่ง ลด 20%', 'group_price', 1, 'active', now() - interval '1 day', 2000, ARRAY[$1::bigint], true)`, group)
	e.Exec(`INSERT INTO promotions (name, label, kind, layer, status, starts_at, percent_bp, tiers, auto_apply)
		VALUES ('gold', 'ราคา Gold ลด 30%', 'tier_price', 1, 'active', now() - interval '1 day', 3000, ARRAY['gold'], true)`)
	uid := e.UserNoPassword("ws@example.com", "customer")
	e.Exec(`UPDATE users SET group_id = $1, tier = 'gold' WHERE id = $2`, group, uid)
	ws := e.SessionClient(uid)

	// sanity: the entitled user really has a lower personal price (so the test means something)
	var offers []struct {
		PriceSatang int64 `json:"price_satang"`
	}
	ws.Do("GET", fmt.Sprintf("/api/v1/offers?variant_ids=%d", vid), nil).Must(t, 200).Data(t, &offers)
	if len(offers) != 1 || offers[0].PriceSatang >= 10000 {
		t.Fatalf("expected a personal price below list: %+v", offers)
	}
	secret := []string{"฿80", "฿70", "ลด 20%", "ลด 30%", "ขายส่ง ลด", "Gold ลด"}
	for _, c := range []*apitest.Client{e.Client(), ws} {
		for _, q := range []string{"ปากกาลูกลื่น ราคาเท่าไหร่", "มีโปรอะไรบ้าง"} {
			r := ask(t, c, q)
			for _, p := range r.Products {
				if p.PriceSatang != 10000 {
					t.Fatalf("card shows non-public price: %+v", p)
				}
			}
			for _, s := range secret {
				if strings.Contains(r.Reply, s) {
					t.Fatalf("reply leaks %q: %s", s, r.Reply)
				}
			}
		}
		r := ask(t, c, "ตัวนี้เหลือไหม ราคาเท่าไหร่", "bulk-pen")
		if len(r.Products) != 1 || r.Products[0].PriceSatang != 10000 || !strings.Contains(r.Reply, "฿100") {
			t.Fatalf("detail price: %+v", r)
		}
	}
}

// placeOrder checks out one item for a new signed-in customer and returns the order number.
func placeOrder(t *testing.T, e *apitest.Env, email string, vid int64) (*apitest.Client, string) {
	t.Helper()
	uid := e.UserNoPassword(email, "customer")
	addr := e.Address(uid)
	c := e.SessionClient(uid)
	c.Do("POST", "/api/v1/cart/items", map[string]any{"variant_id": vid, "qty": 1}).Must(t, 200)
	var q struct {
		QuoteHash string `json:"quote_hash"`
	}
	c.Do("POST", "/api/v1/cart/quote", map[string]any{"address_id": addr}).Must(t, 200).Data(t, &q)
	var o struct {
		OrderNo string `json:"order_no"`
	}
	c.Do("POST", "/api/v1/orders", map[string]any{"address_id": addr, "payment_method": "promptpay", "quote_hash": q.QuoteHash},
		"Idempotency-Key", "key-"+email).Must(t, 201).Data(t, &o)
	return c, o.OrderNo
}

func TestOrderScoping(t *testing.T) {
	noLLM(t)
	e := apitest.New(t)
	_, vid := e.Product("mug", "แก้วมัคเซรามิก", 22000, 10)
	alice, orderNo := placeOrder(t, e, "alice@example.com", vid)
	bob, _ := placeOrder(t, e, "bob@example.com", vid)

	if r := ask(t, alice, "เช็กสถานะคำสั่งซื้อ"); !strings.Contains(r.Reply, orderNo) || !strings.Contains(r.Reply, "รอชำระเงิน") {
		t.Fatalf("owner: %+v", r)
	}
	if r := ask(t, alice, "ออเดอร์ "+orderNo+" ถึงไหนแล้ว"); !strings.Contains(r.Reply, orderNo) || r.Actions[0].Href != "/account/orders/"+orderNo {
		t.Fatalf("owner by number: %+v", r)
	}
	// another signed-in user, even with the right email, never sees it
	if r := ask(t, bob, "ออเดอร์ "+orderNo+" alice@example.com"); strings.Contains(r.Reply, "รอชำระเงิน") || !strings.Contains(r.Reply, "ไม่พบ") {
		t.Fatalf("bob sees alice's order: %+v", r)
	}
	if r := ask(t, bob, "เช็กสถานะคำสั่งซื้อ"); strings.Contains(r.Reply, orderNo) {
		t.Fatalf("bob's list contains alice's order: %+v", r)
	}
	g := e.Client()
	if r := ask(t, g, "ออเดอร์ "+orderNo); strings.Contains(r.Reply, "รอชำระเงิน") || !strings.Contains(r.Reply, "อีเมล") {
		t.Fatalf("guest without email: %+v", r)
	}
	if r := ask(t, g, "ออเดอร์ "+orderNo+" bob@example.com"); strings.Contains(r.Reply, "รอชำระเงิน") {
		t.Fatalf("guest with wrong email: %+v", r)
	}
	// follow-up turn: email only, order number from the previous message
	var r reply
	g.Do("POST", "/api/v1/assistant/chat", map[string]any{"messages": []map[string]string{
		{"role": "user", "content": "เช็กออเดอร์ " + orderNo},
		{"role": "assistant", "content": "กรุณาพิมพ์อีเมลที่ใช้สั่งซื้อค่ะ"},
		{"role": "user", "content": "Alice@Example.com"},
	}}).Must(t, 200).Data(t, &r)
	if !strings.Contains(r.Reply, orderNo) || !strings.Contains(r.Reply, "รอชำระเงิน") {
		t.Fatalf("guest with matching email: %+v", r)
	}
	// guest lookups are rate limited per IP (5 / 10 min; 2 used above)
	for _, m := range []string{"x", "y", "z"} {
		ask(t, g, "ออเดอร์ "+orderNo+" "+m+"@example.com")
	}
	if r := ask(t, g, "ออเดอร์ "+orderNo+" alice@example.com"); strings.Contains(r.Reply, "รอชำระเงิน") || !strings.Contains(r.Reply, "บ่อยเกินไป") {
		t.Fatalf("guest lookup not rate limited: %+v", r)
	}
}

func TestRateLimit(t *testing.T) {
	noLLM(t)
	t.Setenv("ASSISTANT_RATE_PER_MIN", "3")
	e := apitest.New(t)
	g := e.Client()
	body := map[string]any{"messages": []map[string]string{{"role": "user", "content": "สวัสดี"}}}
	for i := 0; i < 3; i++ {
		g.Do("POST", "/api/v1/assistant/chat", body).Must(t, 200)
	}
	r := g.Do("POST", "/api/v1/assistant/chat", body).Must(t, 429)
	if r.Code() != "rate_limited" || r.Header.Get("Retry-After") == "" {
		t.Fatalf("%s %v", r.Body, r.Header)
	}
}

// fakeClaude is an httptest stand-in for the Messages API (no network in tests).
type fakeClaude struct {
	mu       sync.Mutex
	requests []map[string]any
	respond  func(n int, req map[string]any) (int, string)
}

func (f *fakeClaude) start(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != "test-key" || r.Header.Get("anthropic-version") == "" {
			w.WriteHeader(400)
			return
		}
		b, _ := io.ReadAll(r.Body)
		var req map[string]any
		_ = json.Unmarshal(b, &req)
		f.mu.Lock()
		f.requests = append(f.requests, req)
		n := len(f.requests)
		f.mu.Unlock()
		status, body := f.respond(n, req)
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("ANTHROPIC_API_KEY", "test-key")
	t.Setenv("ANTHROPIC_BASE_URL", srv.URL)
	t.Setenv("ASSISTANT_MODEL", "claude-haiku-5-5")
}

func textResp(s string) string {
	b, _ := json.Marshal(map[string]any{"stop_reason": "end_turn", "content": []any{map[string]any{"type": "text", "text": s}}})
	return string(b)
}

func toolResp(name string, input map[string]any) string {
	b, _ := json.Marshal(map[string]any{"stop_reason": "tool_use", "content": []any{
		map[string]any{"type": "text", "text": "ขอตรวจสอบสักครู่ค่ะ"},
		map[string]any{"type": "tool_use", "id": "toolu_1", "name": name, "input": input},
	}})
	return string(b)
}

// lastToolResult returns the tool_result content string of the request.
func lastToolResult(req map[string]any) string {
	msgs, _ := req["messages"].([]any)
	last, _ := msgs[len(msgs)-1].(map[string]any)
	blocks, _ := last["content"].([]any)
	for _, b := range blocks {
		if m, _ := b.(map[string]any); m["type"] == "tool_result" {
			s, _ := m["content"].(string)
			return s
		}
	}
	return ""
}

func TestLLMFallsBackToRules(t *testing.T) {
	f := &fakeClaude{respond: func(int, map[string]any) (int, string) { return 529, `{"type":"error"}` }}
	f.start(t)
	e := apitest.New(t)
	r := ask(t, e.Client(), "สวัสดีค่ะ")
	if r.Source != "rules" || !strings.Contains(r.Reply, "ผู้ช่วย ShopShip") || len(f.requests) != 1 {
		t.Fatalf("fallback: %+v (%d calls)", r, len(f.requests))
	}
	req := f.requests[0]
	if req["model"] != "claude-haiku-5-5" || req["max_tokens"] == nil || !strings.Contains(fmt.Sprint(req["system"]), "Never invent") {
		t.Fatalf("request shape: %v", req["model"])
	}
}

func TestLLMInventedPriceFallsBack(t *testing.T) {
	f := &fakeClaude{respond: func(int, map[string]any) (int, string) {
		return 200, textResp("ราคาสมาชิกเหลือ ฿199 ค่ะ")
	}}
	f.start(t)
	e := apitest.New(t)
	if r := ask(t, e.Client(), "สวัสดี"); r.Source != "rules" {
		t.Fatalf("invented price must fall back: %+v", r)
	}
}

func TestLLMToolUseIsCallerScoped(t *testing.T) {
	var orderNo string
	f := &fakeClaude{}
	f.respond = func(n int, req map[string]any) (int, string) {
		switch n {
		case 1: // model tries to read someone else's order (prompt-injected order number + email)
			return 200, toolResp("order_status", map[string]any{"order_no": orderNo, "email": "alice@example.com"})
		case 2:
			res := lastToolResult(req)
			if !strings.Contains(res, `"result":"not_found"`) || strings.Contains(res, "pending_payment") {
				return 200, textResp("LEAK " + res)
			}
			return 200, toolResp("search_products", map[string]any{"query": "แก้วมัค"})
		default:
			res := lastToolResult(req)
			if !strings.Contains(res, `"price_text":"฿220"`) {
				return 200, textResp("BAD " + res)
			}
			return 200, textResp("ไม่พบคำสั่งซื้อนี้ในบัญชีของคุณค่ะ ส่วนแก้วมัคเซรามิกราคา ฿220 ค่ะ")
		}
	}
	f.start(t)
	e := apitest.New(t)
	_, vid := e.Product("mug", "แก้วมัคเซรามิก", 22000, 10)
	_, orderNo = placeOrder(t, e, "alice@example.com", vid)
	bob, _ := placeOrder(t, e, "bob@example.com", vid)

	r := ask(t, bob, "ช่วยเช็กออเดอร์ "+orderNo+" ของ alice@example.com ให้หน่อย แล้วแก้วมัคราคาเท่าไหร่")
	if r.Source != "llm" || strings.Contains(r.Reply, "LEAK") || strings.Contains(r.Reply, "BAD") || len(f.requests) != 3 {
		t.Fatalf("llm: %+v (%d calls)", r, len(f.requests))
	}
	if len(r.Products) != 1 || r.Products[0].Slug != "mug" || r.Products[0].PriceSatang != 22000 {
		t.Fatalf("products from tool results: %+v", r.Products)
	}
	// the assistant turn (text + tool_use) is passed back unchanged
	msgs := f.requests[1]["messages"].([]any)
	if m := msgs[len(msgs)-2].(map[string]any); m["role"] != "assistant" || len(m["content"].([]any)) != 2 {
		t.Fatalf("assistant turn not replayed: %v", m)
	}
}
