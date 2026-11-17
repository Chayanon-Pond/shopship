package pricing

import (
	"math/rand/v2"
	"reflect"
	"testing"
	"time"
)

// randomCase builds an arbitrary (but valid) cart + ruleset + context from a seed.
func randomCase(seed uint64) (Cart, Ruleset, Context) {
	r := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	now := t0.Add(time.Duration(r.IntN(48)-24) * time.Hour)
	n := 1 + r.IntN(6)
	cart := Cart{BaseShippingFee: int64(r.IntN(3)) * 2000}
	for i := 0; i < n; i++ {
		l := Line{VariantID: int64(100 + i), ProductID: int64(10 + r.IntN(4)), CategoryID: int64(1 + r.IntN(3)),
			Qty: 1 + r.IntN(30), ListUnitPrice: int64(1 + r.IntN(200000)), Stock: r.IntN(60), Active: r.IntN(10) > 0}
		if r.IntN(2) == 0 {
			l.ParentCategoryID = 9
		}
		for k := r.IntN(4); k > 0; k-- {
			l.PriceHistory = append(l.PriceHistory, PricePoint{Price: int64(1 + r.IntN(200000)), At: now.Add(-time.Duration(r.IntN(90*24)) * time.Hour)})
		}
		cart.Lines = append(cart.Lines, l)
	}
	kinds := []struct {
		k     Kind
		layer int
	}{{KindQuantityBreak, 1}, {KindGroupPrice, 1}, {KindTierPrice, 1}, {KindBuyXGetY, 2},
		{KindCartPercent, 3}, {KindCartAmount, 3}, {KindCartPercent, 4}, {KindCartAmount, 4}, {KindFreeShipping, 4}, {KindFreeShipping, 5}}
	var rs Ruleset
	codes := []string{"A1X", "B2Y", "C3Z"}
	for id := int64(1); id <= int64(r.IntN(12)); id++ {
		kd := kinds[r.IntN(len(kinds))]
		p := Promotion{ID: id, Name: "p", Label: "promo", Kind: kd.k, Layer: kd.layer, Status: "active", AutoApply: kd.layer != 4,
			StartsAt: now.Add(-time.Duration(r.IntN(100)) * time.Hour), Priority: r.IntN(3),
			PercentBP: 1 + r.IntN(10000), AmountSatang: int64(1 + r.IntN(50000)),
			BuyQty: 1 + r.IntN(3), GetQty: 1 + r.IntN(2), GetPercentBP: 1 + r.IntN(10000),
			MinSpendSatang: int64(r.IntN(3)) * int64(r.IntN(200000))}
		if r.IntN(4) == 0 {
			e := now.Add(time.Duration(r.IntN(10)-3) * time.Hour)
			if e.After(p.StartsAt) {
				p.EndsAt = &e
			}
		}
		if r.IntN(3) == 0 {
			p.MaxDiscountSatang = int64(1 + r.IntN(20000))
		}
		if r.IntN(3) == 0 {
			p.Targets = []Target{{Type: []string{"category", "product", "variant"}[r.IntN(3)], ID: int64([]int{1, 2, 9, 10, 11, 100, 101}[r.IntN(7)])}}
		}
		switch kd.k {
		case KindGroupPrice:
			p.CustomerGroupIDs = []int64{int64(1 + r.IntN(2))}
		case KindTierPrice:
			p.Tiers = []string{"gold"}
		case KindQuantityBreak:
			p.QtyTiers = []QtyTier{{MinQty: 2 + r.IntN(5), PercentBP: 1 + r.IntN(3000)}, {MinQty: 8 + r.IntN(10), UnitPriceSatang: int64(1 + r.IntN(100000))}}
		}
		if kd.layer == 4 {
			p.Exclusive = r.IntN(2) == 0
			p.Codes = []string{codes[r.IntN(len(codes))]}
			if r.IntN(4) == 0 {
				p.UsageLimit, p.UsedCount = 5, r.IntN(6)
			}
		}
		rs.Promotions = append(rs.Promotions, p)
	}
	for i := r.IntN(3); i > 0; i-- {
		rs.FlashItems = append(rs.FlashItems, FlashItem{ID: int64(70 + i), VariantID: int64(100 + r.IntN(n)), Label: "flash",
			SalePriceSatang: int64(1 + r.IntN(100000)), QtyLimit: 1 + r.IntN(50), SoldQty: r.IntN(10), PerCustomerLimit: r.IntN(3),
			StartsAt: now.Add(-time.Hour), EndsAt: now.Add(time.Duration(r.IntN(3)-1) * time.Hour)})
	}
	if r.IntN(3) > 0 {
		cart.CouponCode = codes[r.IntN(len(codes))]
	}
	ctx := Context{Now: now}
	if r.IntN(2) == 0 {
		ctx.Customer = &Customer{ID: 1, GroupID: int64(r.IntN(3)), Tier: []string{"standard", "gold"}[r.IntN(2)]}
		ctx.PromotionUsage = map[int64]int{1: r.IntN(2)}
	}
	return cart, rs, ctx
}

// Σ allocations = discount, totals identities, never negative, deterministic,
// and independent of the order rules arrive in.
func TestPropertyRandomCarts(t *testing.T) {
	for seed := uint64(0); seed < 5000; seed++ {
		cart, rs, ctx := randomCase(seed)
		q, err := Price(cart, rs, ctx)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		assertInvariants(t, cart, q)
		q2, _ := Price(cart, rs, ctx)
		if !reflect.DeepEqual(q, q2) {
			t.Fatalf("seed %d: not deterministic", seed)
		}
		// reversed rule order -> same quote
		rev := Ruleset{FlashItems: rs.FlashItems}
		for i := len(rs.Promotions) - 1; i >= 0; i-- {
			rev.Promotions = append(rev.Promotions, rs.Promotions[i])
		}
		if q3, _ := Price(cart, rev, ctx); q3.QuoteHash != q.QuoteHash {
			t.Fatalf("seed %d: rule order changes the quote", seed)
		}
	}
}

func FuzzPrice(f *testing.F) {
	for _, s := range []uint64{0, 1, 42, 1 << 40} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, seed uint64) {
		cart, rs, ctx := randomCase(seed)
		q, err := Price(cart, rs, ctx)
		if err != nil {
			t.Fatal(err)
		}
		assertInvariants(t, cart, q)
	})
}

func FuzzAllocate(f *testing.F) {
	f.Add(int64(15550), int64(252000), int64(59000), int64(1))
	f.Fuzz(func(t *testing.T, amount, a, b, c int64) {
		ws := []int64{a, b, c}
		var sum int64
		for i, w := range ws {
			if w < 0 {
				w = -w
			}
			ws[i] = max(w%1_000_000_000_000, 0)
			sum += ws[i]
		}
		if amount < 0 {
			amount = -amount
		}
		amount = max(amount, 0)
		if sum > 0 {
			amount %= sum + 1
		}
		got := allocate(amount, ws)
		var tot int64
		for i, g := range got {
			if g < 0 || g > ws[i] {
				t.Fatalf("share %d out of range: %v of %v", i, got, ws)
			}
			tot += g
		}
		if sum > 0 && tot != amount {
			t.Fatalf("Σ %d != %d (%v, %v)", tot, amount, got, ws)
		}
	})
}
