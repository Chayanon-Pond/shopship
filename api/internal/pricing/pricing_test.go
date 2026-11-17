package pricing

import (
	"strings"
	"testing"
	"time"
)

// assertInvariants checks the money identities every quote must satisfy.
func assertInvariants(t *testing.T, cart Cart, q Quote) {
	t.Helper()
	var list, sub, alloc, disc int64
	for i, l := range q.Lines {
		if l.UnitPriceSatang < 0 || l.LineTotalSatang < 0 || l.AllocatedDiscount < 0 {
			t.Fatalf("line %d negative: %+v", i, l)
		}
		if l.UnitPriceSatang > l.ListUnitPriceSatang {
			t.Fatalf("line %d unit above list: %+v", i, l)
		}
		if l.Adjustments == nil || len(l.Adjustments) > 1 {
			t.Fatalf("line %d adjustments: %+v", i, l.Adjustments)
		}
		if l.Availability.Status == AvailOK {
			var la int64
			for _, a := range l.Adjustments {
				la += a.AmountSatang
			}
			if l.LineTotalSatang != int64(l.Qty)*l.UnitPriceSatang-la {
				t.Fatalf("line %d total identity broken: %+v", i, l)
			}
			if l.AllocatedDiscount > l.LineTotalSatang {
				t.Fatalf("line %d allocation above line total: %+v", i, l)
			}
			list += int64(l.Qty) * l.ListUnitPriceSatang
		} else if l.LineTotalSatang != 0 || l.AllocatedDiscount != 0 {
			t.Fatalf("unavailable line %d is charged: %+v", i, l)
		}
		if (l.PriceSource.Kind == SourceList) != (l.Lowest30dSatang == nil) {
			t.Fatalf("line %d lowest_30d vs source: %+v", i, l)
		}
		sub += l.LineTotalSatang
		alloc += l.AllocatedDiscount
	}
	for _, a := range q.Adjustments {
		if a.AmountSatang <= 0 || (a.Layer != 3 && a.Layer != 4) {
			t.Fatalf("bad cart adjustment %+v", a)
		}
		disc += a.AmountSatang
	}
	tt := q.Totals
	switch {
	case tt.ListSubtotalSatang != list, tt.SubtotalSatang != sub, tt.DiscountSatang != disc:
		t.Fatalf("totals sums: %+v list=%d sub=%d disc=%d", tt, list, sub, disc)
	case alloc != disc:
		t.Fatalf("Σ allocations %d != discount %d", alloc, disc)
	case tt.ShippingSatang != q.Shipping.FeeSatang-q.Shipping.DiscountSatang:
		t.Fatalf("shipping identity %+v %+v", tt, q.Shipping)
	case tt.GrandTotalSatang != tt.SubtotalSatang-tt.DiscountSatang+tt.ShippingSatang:
		t.Fatalf("grand total identity %+v", tt)
	case tt.SavingsSatang != tt.ListSubtotalSatang-tt.SubtotalSatang+tt.DiscountSatang+q.Shipping.DiscountSatang:
		t.Fatalf("savings identity %+v", tt)
	case tt.GrandTotalSatang < 0, tt.DiscountSatang > tt.SubtotalSatang, tt.ShippingSatang < 0, tt.SavingsSatang < 0:
		t.Fatalf("negative/over-discount totals %+v", tt)
	case q.Shipping.DiscountSatang > q.Shipping.FeeSatang:
		t.Fatalf("shipping discount above fee %+v", q.Shipping)
	}
	if q.Lines == nil || q.Adjustments == nil || q.Hints == nil {
		t.Fatal("nil list in quote (must be [])")
	}
	_ = cart
}

func line(v int64, qty int, price int64) Line {
	return Line{VariantID: v, ProductID: v * 10, CategoryID: 1, Qty: qty, ListUnitPrice: price, Stock: 999, Active: true}
}

var t0 = time.Date(2026, 11, 17, 3, 0, 0, 0, time.UTC)

func active(p Promotion) Promotion {
	p.Status = "active"
	if p.StartsAt.IsZero() {
		p.StartsAt = t0.Add(-24 * time.Hour)
	}
	switch p.Layer {
	case 4:
		p.AutoApply = false
	default:
		p.AutoApply = true
	}
	if p.Label == "" {
		p.Label = p.Name
	}
	return p
}

func mustPrice(t *testing.T, c Cart, rs Ruleset, ctx Context) Quote {
	t.Helper()
	if ctx.Now.IsZero() {
		ctx.Now = t0
	}
	q, err := Price(c, rs, ctx)
	if err != nil {
		t.Fatal(err)
	}
	assertInvariants(t, c, q)
	return q
}

var member = &Customer{ID: 1, GroupID: 2, Tier: "gold"}

func TestRounding(t *testing.T) {
	cases := []struct {
		price int64
		bp    int
		want  int64
	}{
		{25000, 800, 23000},
		{9999, 1000, 8999},   // 8999.1 -> 8999
		{9995, 1000, 8996},   // 8995.5 -> 8996 (half up)
		{105, 5000, 53},      // 52.5 -> 53
		{1, 5000, 1},         // 0.5 -> 1
		{1, 10000, 0},        // free
		{12345, 0, 12345},    // no discount
		{59000, 1000, 53100}, // offers fixture: Gold 10 %
	}
	for _, c := range cases {
		if got := percentPrice(c.price, c.bp); got != c.want {
			t.Errorf("percentPrice(%d, %d) = %d, want %d", c.price, c.bp, got, c.want)
		}
	}
	if got := percentAmount(311000, 500); got != 15550 {
		t.Errorf("percentAmount = %d", got)
	}
	if got := percentAmount(333, 5000); got != 167 { // 166.5 -> 167
		t.Errorf("percentAmount half-up = %d", got)
	}
	// group % applied on the unit price, then × qty (not on the line)
	q := mustPrice(t, Cart{Lines: []Line{line(1, 3, 9995)}},
		Ruleset{Promotions: []Promotion{active(Promotion{ID: 1, Kind: KindGroupPrice, Layer: 1, PercentBP: 1000, CustomerGroupIDs: []int64{2}})}},
		Context{Customer: member})
	if q.Lines[0].UnitPriceSatang != 8996 || q.Lines[0].LineTotalSatang != 3*8996 {
		t.Fatalf("unit rounding: %+v", q.Lines[0])
	}
}

func TestFormatBaht(t *testing.T) {
	for in, want := range map[int64]string{0: "฿0", 21100: "฿211", 15550: "฿155.50", 100000: "฿1,000", 123456789: "฿1,234,567.89", 5: "฿0.05"} {
		if got := FormatBaht(in); got != want {
			t.Errorf("FormatBaht(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestAllocateLargestRemainder(t *testing.T) {
	cases := []struct {
		amount  int64
		weights []int64
		want    []int64
	}{
		{15550, []int64{252000, 59000}, []int64{12600, 2950}},
		{100, []int64{100, 100, 100}, []int64{34, 33, 33}}, // tie on remainder -> lower index
		{2, []int64{1, 1, 1}, []int64{1, 1, 0}},
		{10, []int64{0, 5, 5}, []int64{0, 5, 5}},
		{7, []int64{3, 3, 4}, []int64{2, 2, 3}}, // 2.1, 2.1, 2.8 -> +1 to the largest remainder
		{0, []int64{3, 4}, []int64{0, 0}},
		{9, []int64{3, 4}, []int64{3, 4}}, // clamped to Σ weights
	}
	for _, c := range cases {
		got := allocate(c.amount, c.weights)
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("allocate(%d, %v) = %v, want %v", c.amount, c.weights, got, c.want)
				break
			}
		}
	}
}

func TestLayer1LowestWinsNeverStacks(t *testing.T) {
	rs := Ruleset{Promotions: []Promotion{
		active(Promotion{ID: 1, Name: "qb", Kind: KindQuantityBreak, Layer: 1, QtyTiers: []QtyTier{{MinQty: 5, PercentBP: 500}, {MinQty: 10, PercentBP: 1000}}}),
		active(Promotion{ID: 2, Name: "group", Kind: KindGroupPrice, Layer: 1, PercentBP: 800, CustomerGroupIDs: []int64{2}}),
		active(Promotion{ID: 3, Name: "gold", Kind: KindTierPrice, Layer: 1, PercentBP: 700, Tiers: []string{"gold"}}),
	}}
	for _, c := range []struct {
		qty      int
		wantKind string
		wantUnit int64
	}{
		{1, SourceGroupPrice, 9200},
		{5, SourceGroupPrice, 9200}, // 5 % qb < 8 % group
		{10, SourceQuantityBreak, 9000},
		{50, SourceQuantityBreak, 9000},
	} {
		q := mustPrice(t, Cart{Lines: []Line{line(1, c.qty, 10000)}}, rs, Context{Customer: member})
		l := q.Lines[0]
		if l.PriceSource.Kind != c.wantKind || l.UnitPriceSatang != c.wantUnit {
			t.Errorf("qty %d: %s %d, want %s %d", c.qty, l.PriceSource.Kind, l.UnitPriceSatang, c.wantKind, c.wantUnit)
		}
	}
	// guests never get layer-1 member/trade prices, and are told to log in
	q := mustPrice(t, Cart{Lines: []Line{line(1, 10, 10000)}}, rs, Context{})
	if q.Lines[0].PriceSource.Kind != SourceList || len(q.Hints) != 1 || q.Hints[0].Kind != HintLoginForMember {
		t.Fatalf("guest: %+v hints %+v", q.Lines[0].PriceSource, q.Hints)
	}
	// silver customer, no group: neither group nor tier price; qb still applies (login only)
	q = mustPrice(t, Cart{Lines: []Line{line(1, 5, 10000)}}, rs, Context{Customer: &Customer{ID: 9, Tier: "silver"}})
	if q.Lines[0].PriceSource.Kind != SourceQuantityBreak || q.Lines[0].UnitPriceSatang != 9500 {
		t.Fatalf("audience: %+v", q.Lines[0])
	}
}

func TestTiesPriorityThenID(t *testing.T) {
	mk := func(id int64, prio int) Promotion {
		return active(Promotion{ID: id, Name: "p", Label: "p" + string(rune('0'+id)), Kind: KindGroupPrice, Layer: 1, PercentBP: 1000, CustomerGroupIDs: []int64{2}, Priority: prio})
	}
	q := mustPrice(t, Cart{Lines: []Line{line(1, 1, 10000)}}, Ruleset{Promotions: []Promotion{mk(9, 0), mk(5, 0), mk(7, 3)}}, Context{Customer: member})
	if *q.Lines[0].PriceSource.PromotionID != 7 {
		t.Fatalf("priority: got %d", *q.Lines[0].PriceSource.PromotionID)
	}
	q = mustPrice(t, Cart{Lines: []Line{line(1, 1, 10000)}}, Ruleset{Promotions: []Promotion{mk(9, 0), mk(5, 0)}}, Context{Customer: member})
	if *q.Lines[0].PriceSource.PromotionID != 5 {
		t.Fatalf("id asc: got %d", *q.Lines[0].PriceSource.PromotionID)
	}
	// layer 3 tie on amount
	l3 := func(id int64, prio int) Promotion {
		return active(Promotion{ID: id, Name: "c", Kind: KindCartAmount, Layer: 3, AmountSatang: 1000, Priority: prio})
	}
	q = mustPrice(t, Cart{Lines: []Line{line(1, 1, 10000)}}, Ruleset{Promotions: []Promotion{l3(30, 0), l3(20, 0), l3(40, 1)}}, Context{})
	if len(q.Adjustments) != 1 || q.Adjustments[0].PromotionID != 40 {
		t.Fatalf("l3 tie: %+v", q.Adjustments)
	}
	// but a strictly bigger amount beats priority
	big := active(Promotion{ID: 50, Name: "big", Kind: KindCartAmount, Layer: 3, AmountSatang: 2000})
	q = mustPrice(t, Cart{Lines: []Line{line(1, 1, 10000)}}, Ruleset{Promotions: []Promotion{l3(40, 9), big}}, Context{})
	if q.Adjustments[0].PromotionID != 50 {
		t.Fatalf("l3 best: %+v", q.Adjustments)
	}
}

func TestFlashFallback(t *testing.T) {
	fi := FlashItem{ID: 1, Label: "Flash", VariantID: 1, SalePriceSatang: 5000, QtyLimit: 10, SoldQty: 8, PerCustomerLimit: 2,
		StartsAt: t0.Add(-time.Hour), EndsAt: t0.Add(time.Hour)}
	grp := active(Promotion{ID: 2, Name: "g", Kind: KindGroupPrice, Layer: 1, PercentBP: 1000, CustomerGroupIDs: []int64{2}})
	rs := Ruleset{FlashItems: []FlashItem{fi}, Promotions: []Promotion{grp}}
	// fits: flash
	q := mustPrice(t, Cart{Lines: []Line{line(1, 2, 10000)}}, rs, Context{Customer: member})
	if q.Lines[0].PriceSource.Kind != SourceFlashSale || q.Lines[0].UnitPriceSatang != 5000 {
		t.Fatalf("flash: %+v", q.Lines[0])
	}
	// 3 > remaining 2 -> whole line falls back to next best (group), not split
	q = mustPrice(t, Cart{Lines: []Line{line(1, 3, 10000)}}, rs, Context{Customer: member})
	if q.Lines[0].PriceSource.Kind != SourceGroupPrice || q.Lines[0].UnitPriceSatang != 9000 {
		t.Fatalf("flash qty_limit fallback: %+v", q.Lines[0])
	}
	// per-customer limit consumed
	q = mustPrice(t, Cart{Lines: []Line{line(1, 1, 10000)}}, rs, Context{Customer: member, FlashUsage: map[int64]int{1: 2}})
	if q.Lines[0].PriceSource.Kind != SourceGroupPrice {
		t.Fatalf("flash per-customer fallback: %+v", q.Lines[0])
	}
	// window edges: starts inclusive, ends exclusive
	q = mustPrice(t, Cart{Lines: []Line{line(1, 1, 10000)}}, rs, Context{Now: fi.EndsAt})
	if q.Lines[0].PriceSource.Kind != SourceList {
		t.Fatalf("flash at end: %+v", q.Lines[0])
	}
	q = mustPrice(t, Cart{Lines: []Line{line(1, 1, 10000)}}, rs, Context{Now: fi.StartsAt})
	if q.Lines[0].PriceSource.Kind != SourceFlashSale {
		t.Fatalf("flash at start: %+v", q.Lines[0])
	}
}

func TestBuyXGetY(t *testing.T) {
	b2g1 := active(Promotion{ID: 1, Name: "b2g1", Label: "ซื้อ 2 แถม 1", Kind: KindBuyXGetY, Layer: 2, BuyQty: 2, GetQty: 1, GetPercentBP: 10000})
	b1g1half := active(Promotion{ID: 2, Name: "b1g1", Label: "ชิ้นที่ 2 ลด 50%", Kind: KindBuyXGetY, Layer: 2, BuyQty: 1, GetQty: 1, GetPercentBP: 5000})
	for _, c := range []struct {
		qty    int
		promos []Promotion
		wantID int64
		amount int64
		hint   bool
	}{
		{1, []Promotion{b2g1}, 0, 0, false},
		{2, []Promotion{b2g1}, 0, 0, true}, // add 1 more -> free
		{3, []Promotion{b2g1}, 1, 999, false},
		{7, []Promotion{b2g1}, 1, 2 * 999, false},
		{8, []Promotion{b2g1}, 1, 2 * 999, true},
		{2, []Promotion{b2g1, b1g1half}, 2, 499, false}, // 2nd unit 999 -> round_half_up(499.5)=500, i.e. 499 off
		{4, []Promotion{b2g1, b1g1half}, 1, 999, false}, // 1×999 beats 2×499
		{3, []Promotion{b2g1, b1g1half}, 1, 999, false},
	} {
		q := mustPrice(t, Cart{Lines: []Line{line(1, c.qty, 999)}}, Ruleset{Promotions: c.promos}, Context{})
		adj := q.Lines[0].Adjustments
		if c.wantID == 0 && len(adj) != 0 || c.wantID != 0 && (len(adj) != 1 || adj[0].PromotionID != c.wantID || adj[0].AmountSatang != c.amount) {
			t.Errorf("qty %d: adj %+v", c.qty, adj)
		}
		gotHint := false
		for _, h := range q.Hints {
			if h.Kind == HintBuyXGetYGap {
				gotHint = true
			}
		}
		if gotHint != c.hint {
			t.Errorf("qty %d: hint %v, hints %+v", c.qty, gotHint, q.Hints)
		}
	}
}

func TestCartLevelAndCodes(t *testing.T) {
	auto := active(Promotion{ID: 21, Name: "ครบ1000ลด150", Label: "ช้อปครบ ฿1,000 ลด ฿150", Kind: KindCartAmount, Layer: 3, AmountSatang: 15000, MinSpendSatang: 100000})
	pct := active(Promotion{ID: 22, Name: "5%", Kind: KindCartPercent, Layer: 3, PercentBP: 500, MaxDiscountSatang: 12000, MinSpendSatang: 200000})
	excl := active(Promotion{ID: 42, Name: "X", Label: "โค้ด X", Kind: KindCartPercent, Layer: 4, Exclusive: true, PercentBP: 2000, MaxDiscountSatang: 50000, Codes: []string{"BIG20"}})
	stack := active(Promotion{ID: 43, Name: "S", Label: "โค้ด S", Kind: KindCartAmount, Layer: 4, AmountSatang: 5000, Codes: []string{"S50"}})
	rs := Ruleset{Promotions: []Promotion{auto, pct, excl, stack}}

	// min spend not met -> gap hint
	q := mustPrice(t, Cart{Lines: []Line{line(1, 1, 90000)}}, rs, Context{})
	if len(q.Adjustments) != 0 || len(q.Hints) != 1 || q.Hints[0].Kind != HintCartPromoGap || q.Hints[0].AmountSatang != 10000 {
		t.Fatalf("gap: %+v %+v", q.Adjustments, q.Hints)
	}
	if !strings.Contains(q.Hints[0].Message, "฿100") {
		t.Errorf("hint message %q", q.Hints[0].Message)
	}
	// 250000: pct gives 12500 (cap 12000) < 15000 -> auto amount wins
	q = mustPrice(t, Cart{Lines: []Line{line(1, 1, 250000)}}, rs, Context{})
	if q.Adjustments[0].PromotionID != 21 {
		t.Fatalf("best l3: %+v", q.Adjustments)
	}
	// exclusive code better (20 % of 250000 = 50000 > 15000): layer 3 dropped silently
	q = mustPrice(t, Cart{CouponCode: "big20", Lines: []Line{line(1, 1, 250000)}}, rs, Context{})
	if len(q.Adjustments) != 1 || q.Adjustments[0].PromotionID != 42 || q.Adjustments[0].AmountSatang != 50000 || q.Coupon.Status != CouponApplied {
		t.Fatalf("exclusive wins: %+v %+v", q.Adjustments, q.Coupon)
	}
	// exclusive equal -> keep automatic
	eq := excl
	eq.PercentBP, eq.MaxDiscountSatang = 1000, 15000
	q = mustPrice(t, Cart{CouponCode: "BIG20", Lines: []Line{line(1, 1, 250000)}}, Ruleset{Promotions: []Promotion{auto, eq}}, Context{})
	if q.Adjustments[0].PromotionID != 21 || q.Coupon.ReasonCode != ReasonExclusiveLost || q.Coupon.Status != CouponNotApplied {
		t.Fatalf("exclusive equal: %+v %+v", q.Adjustments, q.Coupon)
	}
	// non-exclusive code stacks on top of layer 3, allocated on the remaining base
	q = mustPrice(t, Cart{CouponCode: "S50", Lines: []Line{line(1, 1, 150000), line(2, 1, 50000)}}, rs, Context{})
	if len(q.Adjustments) != 2 || q.Adjustments[0].Layer != 3 || q.Adjustments[1].Layer != 4 || q.Adjustments[1].CouponCode != "S50" ||
		q.Totals.DiscountSatang != 20000 {
		t.Fatalf("stack: %+v", q.Adjustments)
	}
	// unknown code
	q = mustPrice(t, Cart{CouponCode: "NOPE", Lines: []Line{line(1, 1, 1000)}}, rs, Context{})
	if q.Coupon.Status != CouponInvalid || q.Coupon.ReasonCode != ReasonNotFound {
		t.Fatalf("not found: %+v", q.Coupon)
	}
	// cart_amount larger than the cart never goes negative
	huge := active(Promotion{ID: 60, Name: "H", Kind: KindCartAmount, Layer: 4, AmountSatang: 1_000_000, Codes: []string{"HUGE"}})
	q = mustPrice(t, Cart{CouponCode: "HUGE", BaseShippingFee: 4000, Lines: []Line{line(1, 1, 1000)}}, Ruleset{Promotions: []Promotion{huge}}, Context{})
	if q.Totals.GrandTotalSatang != 4000 || q.Totals.DiscountSatang != 1000 {
		t.Fatalf("clamp: %+v", q.Totals)
	}
}

func TestCouponReasons(t *testing.T) {
	end := t0.Add(24 * time.Hour)
	base := func(mut func(*Promotion)) Ruleset {
		p := active(Promotion{ID: 9, Name: "C", Label: "โค้ด C", Kind: KindCartAmount, Layer: 4, AmountSatang: 1000, Codes: []string{"CODE1"}, EndsAt: &end})
		mut(&p)
		return Ruleset{Promotions: []Promotion{p}}
	}
	other := &Customer{ID: 3, GroupID: 1, Tier: "standard"}
	cart := Cart{CouponCode: "code1", Lines: []Line{line(1, 2, 10000)}}
	cases := []struct {
		name   string
		mut    func(*Promotion)
		ctx    Context
		reason string
		status string
	}{
		{"applied", func(*Promotion) {}, Context{}, "", CouponApplied},
		{"inactive", func(p *Promotion) { p.Status = "paused" }, Context{}, ReasonInactive, CouponInvalid},
		{"not started (edge: 1ns before)", func(p *Promotion) { p.StartsAt = t0.Add(time.Nanosecond) }, Context{}, ReasonNotStarted, CouponInvalid},
		{"starts exactly now", func(p *Promotion) { p.StartsAt = t0 }, Context{}, "", CouponApplied},
		{"expired at end (exclusive)", func(p *Promotion) { e := t0; p.EndsAt = &e }, Context{}, ReasonExpired, CouponInvalid},
		{"usage limit", func(p *Promotion) { p.UsageLimit, p.UsedCount = 10, 10 }, Context{}, ReasonUsageLimit, CouponInvalid},
		{"per-customer guest", func(p *Promotion) { p.PerCustomerLimit = 1 }, Context{}, ReasonLoginRequired, CouponInvalid},
		{"per-customer used", func(p *Promotion) { p.PerCustomerLimit = 1 }, Context{Customer: member, PromotionUsage: map[int64]int{9: 1}}, ReasonPerCustomerLimit, CouponInvalid},
		{"per-customer ok", func(p *Promotion) { p.PerCustomerLimit = 2 }, Context{Customer: member, PromotionUsage: map[int64]int{9: 1}}, "", CouponApplied},
		{"group audience guest", func(p *Promotion) { p.CustomerGroupIDs = []int64{2} }, Context{}, ReasonLoginRequired, CouponInvalid},
		{"group audience other", func(p *Promotion) { p.CustomerGroupIDs = []int64{2} }, Context{Customer: other}, ReasonAudience, CouponNotApplied},
		{"tier audience ok", func(p *Promotion) { p.Tiers = []string{"gold"} }, Context{Customer: member}, "", CouponApplied},
		{"min spend", func(p *Promotion) { p.MinSpendSatang = 50000 }, Context{}, ReasonMinSpend, CouponNotApplied},
		{"no eligible items", func(p *Promotion) { p.Targets = []Target{{Type: "category", ID: 99}} }, Context{}, ReasonNoEligibleItems, CouponNotApplied},
		{"parent category target", func(p *Promotion) { p.Targets = []Target{{Type: "category", ID: 77}} }, Context{}, "", CouponApplied},
		{"auto promo is not a code", func(p *Promotion) { p.Layer, p.AutoApply, p.Status = 3, true, "paused" }, Context{}, ReasonNotFound, CouponInvalid},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cc := cart
			cc.Lines = []Line{line(1, 2, 10000)}
			cc.Lines[0].ParentCategoryID = 77
			q := mustPrice(t, cc, base(c.mut), c.ctx)
			if q.Coupon == nil || q.Coupon.Code != "CODE1" || q.Coupon.ReasonCode != c.reason || q.Coupon.Status != c.status || q.Coupon.Message == "" {
				t.Fatalf("coupon %+v", q.Coupon)
			}
			if (c.status == CouponApplied) != (len(q.Adjustments) == 1) {
				t.Fatalf("adjustments %+v", q.Adjustments)
			}
		})
	}
	// no code -> null coupon
	if q := mustPrice(t, Cart{Lines: []Line{line(1, 1, 100)}}, Ruleset{}, Context{}); q.Coupon != nil {
		t.Fatal("coupon should be nil")
	}
}

func TestFreeShipping(t *testing.T) {
	auto := active(Promotion{ID: 31, Name: "fs", Label: "ส่งฟรี", Kind: KindFreeShipping, Layer: 5, MinSpendSatang: 99900})
	code := active(Promotion{ID: 44, Name: "fsc", Label: "โค้ดส่งฟรี", Kind: KindFreeShipping, Layer: 4, MaxDiscountSatang: 3000, Codes: []string{"FREESHIP"}})
	rs := Ruleset{Promotions: []Promotion{auto, code}}
	q := mustPrice(t, Cart{BaseShippingFee: 4000, Lines: []Line{line(1, 1, 99900)}}, rs, Context{})
	if q.Shipping.DiscountSatang != 4000 || *q.Shipping.PromotionID != 31 || q.Totals.ShippingSatang != 0 {
		t.Fatalf("auto fs: %+v", q.Shipping)
	}
	q = mustPrice(t, Cart{BaseShippingFee: 4000, CouponCode: "FREESHIP", Lines: []Line{line(1, 1, 99900)}}, rs, Context{})
	if q.Coupon.ReasonCode != ReasonShippingAlreadyFree || *q.Shipping.PromotionID != 31 {
		t.Fatalf("already free: %+v %+v", q.Coupon, q.Shipping)
	}
	q = mustPrice(t, Cart{BaseShippingFee: 4000, CouponCode: "FREESHIP", Lines: []Line{line(1, 1, 50000)}}, rs, Context{})
	if q.Coupon.Status != CouponApplied || q.Shipping.DiscountSatang != 3000 || *q.Shipping.PromotionID != 44 || len(q.Adjustments) != 0 {
		t.Fatalf("code fs capped: %+v %+v", q.Coupon, q.Shipping)
	}
	// under threshold, no code: gap hint
	q = mustPrice(t, Cart{BaseShippingFee: 4000, Lines: []Line{line(1, 1, 87900)}}, rs, Context{})
	if len(q.Hints) != 1 || q.Hints[0].Kind != HintFreeShippingGap || q.Hints[0].AmountSatang != 12000 || q.Hints[0].Message != "ช้อปเพิ่มอีก ฿120 รับส่งฟรี" {
		t.Fatalf("hint %+v", q.Hints)
	}
}

func TestSeasonalWindowEdges(t *testing.T) {
	start := t0
	end := t0.Add(7 * 24 * time.Hour)
	p := active(Promotion{ID: 1, Name: "12.12", Kind: KindCartAmount, Layer: 3, AmountSatang: 1000, StartsAt: start, EndsAt: &end})
	rs := Ruleset{Promotions: []Promotion{p}}
	for _, c := range []struct {
		now  time.Time
		want bool
	}{
		{start.Add(-time.Nanosecond), false}, {start, true}, {end.Add(-time.Nanosecond), true}, {end, false},
	} {
		q := mustPrice(t, Cart{Lines: []Line{line(1, 1, 5000)}}, rs, Context{Now: c.now})
		if (len(q.Adjustments) == 1) != c.want {
			t.Errorf("now=%v applied=%v", c.now, !c.want)
		}
	}
	// Thai end date: an end at Bangkok midnight shows the previous day
	if got := thaiLastDay(time.Date(2026, 4, 16, 17, 0, 0, 0, time.UTC)); got != "16 เม.ย. 2026" {
		t.Errorf("thaiLastDay = %q", got)
	}
}

func TestLowest30d(t *testing.T) {
	start := time.Date(2026, 11, 17, 0, 0, 0, 0, time.UTC)
	h := []PricePoint{
		{Price: 70000, At: start.Add(-60 * 24 * time.Hour)}, // superseded before the window
		{Price: 90000, At: start.Add(-40 * 24 * time.Hour)}, // in effect at window start
		{Price: 85000, At: start.Add(-10 * 24 * time.Hour)},
		{Price: 60000, At: start.Add(time.Hour)}, // after start: ignored
	}
	if got := lowest30d(h, start, 89000); got != 85000 {
		t.Errorf("lowest30d = %d", got)
	}
	if got := lowest30d(h[:2], start, 89000); got != 90000 {
		t.Errorf("lowest30d (only prior) = %d", got)
	}
	if got := lowest30d(nil, start, 89000); got != 89000 {
		t.Errorf("lowest30d (no history) = %d", got)
	}
}

func TestAvailability(t *testing.T) {
	lines := []Line{line(1, 2, 1000), line(2, 5, 1000), line(3, 1, 1000), line(4, 1, 1000)}
	lines[1].Stock = 3
	lines[2].Stock = 0
	lines[3].Active = false
	q := mustPrice(t, Cart{Lines: lines}, Ruleset{Promotions: []Promotion{active(Promotion{ID: 1, Name: "c", Kind: KindCartAmount, Layer: 3, AmountSatang: 500})}}, Context{})
	want := []string{AvailOK, AvailInsufficientStock, AvailOutOfStock, AvailUnavailable}
	for i, w := range want {
		if q.Lines[i].Availability.Status != w {
			t.Errorf("line %d: %s want %s", i, q.Lines[i].Availability.Status, w)
		}
	}
	if q.Totals.SubtotalSatang != 2000 || q.Lines[0].AllocatedDiscount != 500 {
		t.Fatalf("only ok lines charged: %+v", q.Totals)
	}
	if _, err := Price(Cart{Lines: []Line{line(1, 0, 1)}}, Ruleset{}, Context{}); err == nil {
		t.Fatal("qty 0 must error")
	}
}

func TestHashIgnoresVolatileFields(t *testing.T) {
	c := Cart{Lines: []Line{line(1, 1, 1000)}}
	q1 := mustPrice(t, c, Ruleset{}, Context{})
	c.Lines[0].Stock = 5
	q2 := mustPrice(t, c, Ruleset{}, Context{Now: t0.Add(time.Minute)})
	if q1.QuoteHash != q2.QuoteHash {
		t.Fatal("hash changed with stock level / time only")
	}
	c.Lines[0].ListUnitPrice = 1001
	if q3 := mustPrice(t, c, Ruleset{}, Context{}); q3.QuoteHash == q1.QuoteHash {
		t.Fatal("hash must change with price")
	}
}

func TestQuantityBreakHint(t *testing.T) {
	qb := active(Promotion{ID: 7, Name: "qb", Kind: KindQuantityBreak, Layer: 1, QtyTiers: []QtyTier{{MinQty: 5, PercentBP: 500}, {MinQty: 10, PercentBP: 1000}}})
	rs := Ruleset{Promotions: []Promotion{qb}}
	find := func(q Quote) *Hint {
		for i := range q.Hints {
			if q.Hints[i].Kind == HintQuantityBreakGap {
				return &q.Hints[i]
			}
		}
		return nil
	}
	q := mustPrice(t, Cart{Lines: []Line{line(1, 3, 25000)}}, rs, Context{Customer: member})
	h := find(q)
	if h == nil || h.QtyNeeded != 2 || h.UnitPriceSatang != 23750 || h.PercentBP != 500 || h.PromotionID != 7 || h.VariantID != 1 ||
		h.Message != "หยิบเพิ่มอีก 2 ชิ้น รับราคาส่ง ลด 5% (฿237.50/ชิ้น)" {
		t.Fatalf("hint %+v", h)
	}
	q = mustPrice(t, Cart{Lines: []Line{line(1, 8, 25000)}}, rs, Context{Customer: member})
	if h := find(q); h == nil || h.QtyNeeded != 2 || h.UnitPriceSatang != 22500 || h.Message != "หยิบเพิ่มอีก 2 ชิ้น รับราคาส่ง ลด 10% (฿225/ชิ้น)" {
		t.Fatalf("hint at tier 1: %+v", h)
	}
	if h := find(mustPrice(t, Cart{Lines: []Line{line(1, 10, 25000)}}, rs, Context{Customer: member})); h != nil {
		t.Fatalf("top tier reached: %+v", h)
	}
	if h := find(mustPrice(t, Cart{Lines: []Line{line(1, 3, 25000)}}, rs, Context{})); h != nil {
		t.Fatalf("guest gets qb hint: %+v", h)
	}
	// a better group price already: tier not cheaper -> no hint
	grp := active(Promotion{ID: 8, Name: "g", Kind: KindGroupPrice, Layer: 1, PercentBP: 1200, CustomerGroupIDs: []int64{2}})
	if h := find(mustPrice(t, Cart{Lines: []Line{line(1, 3, 25000)}}, Ruleset{Promotions: []Promotion{qb, grp}}, Context{Customer: member})); h != nil {
		t.Fatalf("hint despite better price: %+v", h)
	}
	for bp, want := range map[int]string{1000: "10%", 250: "2.5%", 125: "1.25%", 5: "0.05%"} {
		if got := formatBP(bp); got != want {
			t.Errorf("formatBP(%d)=%q", bp, got)
		}
	}
}

func TestQuantityBreakHintPerLine(t *testing.T) {
	qb := active(Promotion{ID: 7, Name: "qb", Kind: KindQuantityBreak, Layer: 1, QtyTiers: []QtyTier{{MinQty: 10, UnitPriceSatang: 900}}})
	q := mustPrice(t, Cart{Lines: []Line{line(1, 4, 1000), line(2, 9, 1000)}}, Ruleset{Promotions: []Promotion{qb}}, Context{Customer: member})
	var got []Hint
	for _, h := range q.Hints {
		if h.Kind == HintQuantityBreakGap {
			got = append(got, h)
		}
	}
	if len(got) != 2 || got[0].VariantID != 1 || got[0].QtyNeeded != 6 || got[1].VariantID != 2 || got[1].QtyNeeded != 1 ||
		got[1].Message != "หยิบเพิ่มอีก 1 ชิ้น รับราคาส่ง ฿9/ชิ้น" || got[1].PercentBP != 0 {
		t.Fatalf("per-line hints %+v", got)
	}
}
