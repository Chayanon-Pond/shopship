package pricing

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// Inputs that reproduce docs/fixtures/cart-quote-*.json (the frontend mocks).
// Every field must match except quote_hash, expires_at and available_qty.

var fxNow = time.Date(2026, 11, 17, 3, 0, 0, 0, time.UTC)

func ts(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}
func tp(s string) *time.Time { t := ts(s); return &t }

const (
	catFashion = 1
	catBags    = 5
	catSocks   = 13
	catApparel = 10 // parent of socks
	catGadgets = 20
)

func fxPromo31() Promotion { // auto free shipping over ฿999
	return Promotion{ID: 31, Name: "ส่งฟรี 999", Label: "ส่งฟรีเมื่อช้อปครบ ฿999", Kind: KindFreeShipping, Layer: 5, Status: "active",
		StartsAt: ts("2026-11-01T00:00:00Z"), AutoApply: true, MinSpendSatang: 99900}
}

func fxPromo12(targets ...Target) Promotion { // trade group 8 %
	return Promotion{ID: 12, Name: "ลูกค้าขายส่ง ลด 8%", Label: "ราคาขายส่ง", Kind: KindGroupPrice, Layer: 1, Status: "active",
		StartsAt: ts("2026-11-01T00:00:00Z"), AutoApply: true, Priority: 1, PercentBP: 800, CustomerGroupIDs: []int64{2}, Targets: targets}
}

type scenario struct {
	name    string
	fixture string
	cart    Cart
	rs      Ruleset
	ctx     Context
}

func fixtureScenarios() []scenario {
	return []scenario{
		{
			name: "A trade tier + non-exclusive code + free shipping", fixture: "cart-quote-trade-code-freeship.json",
			cart: Cart{CouponCode: " trade5 ", BaseShippingFee: 4000, Lines: []Line{
				{VariantID: 101, ProductID: 11, CategoryID: catBags, Qty: 12, ListUnitPrice: 25000, Stock: 50, Active: true},
				{VariantID: 205, ProductID: 12, CategoryID: catFashion, Qty: 1, ListUnitPrice: 59000, Stock: 50, Active: true},
			}},
			rs: Ruleset{Promotions: []Promotion{
				{ID: 11, Name: "ราคาส่งถุงผ้า", Label: "ราคาส่ง 10 ชิ้นขึ้นไป", Kind: KindQuantityBreak, Layer: 1, Status: "active",
					StartsAt: ts("2026-11-01T00:00:00Z"), AutoApply: true, CustomerGroupIDs: []int64{2},
					QtyTiers: []QtyTier{{MinQty: 10, UnitPriceSatang: 21000}, {MinQty: 50, UnitPriceSatang: 19000}},
					Targets:  []Target{{Type: "product", ID: 11}}},
				fxPromo12(Target{Type: "category", ID: catBags}), // 23000 > 21000: quantity break wins (lowest, never stacked)
				fxPromo31(),
				{ID: 41, Name: "โค้ดขายส่ง 5%", Label: "โค้ด TRADE5 ลด 5%", Kind: KindCartPercent, Layer: 4, Status: "active",
					StartsAt: ts("2026-11-01T00:00:00Z"), PercentBP: 500, MaxDiscountSatang: 20000, PerCustomerLimit: 10, UsedCount: 37,
					CustomerGroupIDs: []int64{2}, Codes: []string{"TRADE5"}},
			}},
			ctx: Context{Now: fxNow, Customer: &Customer{ID: 501, GroupID: 2, Tier: "standard"}, PromotionUsage: map[int64]int{41: 3}},
		},
		{
			name: "B exclusive code loses to automatic layer 3", fixture: "cart-quote-exclusive-loses.json",
			cart: Cart{CouponCode: "SAVE10X", BaseShippingFee: 4000, Lines: []Line{
				{VariantID: 301, ProductID: 13, CategoryID: catGadgets, Qty: 1, ListUnitPrice: 120000, Stock: 50, Active: true},
			}},
			rs: Ruleset{Promotions: []Promotion{
				{ID: 21, Name: "ครบ 1000 ลด 150", Label: "ช้อปครบ ฿1,000 ลด ฿150", Kind: KindCartAmount, Layer: 3, Status: "active",
					StartsAt: ts("2026-11-10T17:00:00Z"), EndsAt: tp("2026-11-17T17:00:00Z"), AutoApply: true, AmountSatang: 15000, MinSpendSatang: 100000},
				fxPromo31(),
				{ID: 42, Name: "โค้ด 11.11 exclusive", Label: "โค้ด SAVE10X ลด 10%", Kind: KindCartPercent, Layer: 4, Status: "active",
					StartsAt: ts("2026-11-10T17:00:00Z"), EndsAt: tp("2026-11-17T17:00:00Z"), Exclusive: true, PercentBP: 1000,
					MaxDiscountSatang: 10000, UsageLimit: 1000, UsedCount: 412, PerCustomerLimit: 1, Codes: []string{"SAVE10X"}},
			}},
			ctx: Context{Now: fxNow, Customer: &Customer{ID: 7, Tier: "standard"}},
		},
		{
			name: "C flash line + buy-2-get-1, guest, under free-shipping threshold", fixture: "cart-quote-flash.json",
			cart: Cart{BaseShippingFee: 4000, Lines: []Line{
				{VariantID: 401, ProductID: 14, CategoryID: catGadgets, Qty: 1, ListUnitPrice: 89000, Stock: 38, Active: true,
					PriceHistory: []PricePoint{{89000, ts("2026-09-01T00:00:00Z")}, {85000, ts("2026-10-25T00:00:00Z")}, {89000, ts("2026-11-05T00:00:00Z")}}},
				{VariantID: 502, ProductID: 15, CategoryID: catSocks, ParentCategoryID: catApparel, Qty: 3, ListUnitPrice: 9900, Stock: 50, Active: true},
			}},
			rs: Ruleset{
				Promotions: []Promotion{
					{ID: 15, Name: "ถุงเท้า 2 แถม 1", Label: "ซื้อ 2 แถม 1", Kind: KindBuyXGetY, Layer: 2, Status: "active",
						StartsAt: ts("2026-11-01T00:00:00Z"), AutoApply: true, BuyQty: 2, GetQty: 1, GetPercentBP: 10000,
						Targets: []Target{{Type: "category", ID: catSocks}}},
					// a flash line is excluded from layer 2 even when targeted
					{ID: 16, Name: "แกดเจ็ต 1 แถม 1", Label: "ซื้อ 1 แถม 1", Kind: KindBuyXGetY, Layer: 2, Status: "active",
						StartsAt: ts("2026-11-01T00:00:00Z"), AutoApply: true, BuyQty: 1, GetQty: 1, GetPercentBP: 10000,
						Targets: []Target{{Type: "variant", ID: 401}}},
					fxPromo12(),
					fxPromo31(),
				},
				FlashItems: []FlashItem{{ID: 71, FlashSaleID: 7, Label: "Flash Sale 11.11", VariantID: 401, SalePriceSatang: 59000,
					QtyLimit: 100, SoldQty: 62, PerCustomerLimit: 1, StartsAt: ts("2026-11-17T03:00:00Z"), EndsAt: ts("2026-11-17T15:00:00Z")}},
			},
			ctx: Context{Now: fxNow},
		},
		{
			name: "D expired seasonal code", fixture: "cart-quote-invalid-seasonal.json",
			cart: Cart{CouponCode: "SONGKRAN26", BaseShippingFee: 4000, Lines: []Line{
				{VariantID: 205, ProductID: 12, CategoryID: catFashion, Qty: 2, ListUnitPrice: 59000, Stock: 50, Active: true},
			}},
			rs: Ruleset{Promotions: []Promotion{
				fxPromo31(),
				{ID: 43, Name: "สงกรานต์ 2026", Label: "โค้ดสงกรานต์ ลด ฿100", Kind: KindCartAmount, Layer: 4, Status: "active",
					StartsAt: ts("2026-04-10T17:00:00Z"), EndsAt: tp("2026-04-16T17:00:00Z"), AmountSatang: 10000, MinSpendSatang: 50000,
					UsageLimit: 500, UsedCount: 500, Codes: []string{"SONGKRAN26"}},
			}},
			ctx: Context{Now: fxNow},
		},
	}
}

// normalize drops the fields fixtures may legitimately differ on.
func normalize(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	delete(m, "quote_hash")
	delete(m, "expires_at")
	for _, l := range m["lines"].([]any) {
		delete(l.(map[string]any)["availability"].(map[string]any), "available_qty")
	}
	return m
}

func TestFixtureScenarios(t *testing.T) {
	for _, sc := range fixtureScenarios() {
		t.Run(sc.name, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "fixtures", sc.fixture))
			if err != nil {
				t.Fatal(err)
			}
			var env struct {
				Data json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(raw, &env); err != nil {
				t.Fatal(err)
			}
			var want any
			if err := json.Unmarshal(env.Data, &want); err != nil {
				t.Fatal(err)
			}
			wm := want.(map[string]any)
			delete(wm, "quote_hash")
			delete(wm, "expires_at")
			for _, l := range wm["lines"].([]any) {
				delete(l.(map[string]any)["availability"].(map[string]any), "available_qty")
			}

			q, err := Price(sc.cart, sc.rs, sc.ctx)
			if err != nil {
				t.Fatal(err)
			}
			got := normalize(t, q)
			if !reflect.DeepEqual(got, wm) {
				gb, _ := json.MarshalIndent(got, "", "  ")
				wb, _ := json.MarshalIndent(wm, "", "  ")
				t.Fatalf("quote mismatch\n--- got\n%s\n--- want\n%s", gb, wb)
			}
			if !q.ExpiresAt.Equal(fxNow.Add(10 * time.Minute)) {
				t.Errorf("expires_at = %v", q.ExpiresAt)
			}
			assertInvariants(t, sc.cart, q)
			// deterministic
			q2, _ := Price(sc.cart, sc.rs, sc.ctx)
			if q2.QuoteHash != q.QuoteHash || len(q.QuoteHash) != 64 {
				t.Errorf("hash not deterministic: %s vs %s", q.QuoteHash, q2.QuoteHash)
			}
		})
	}
}
