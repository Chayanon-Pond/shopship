package pricing

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

// Hash returns the quote_hash: hex sha256 of the canonical priced result.
//
// It covers everything that changes what the customer pays or what gets
// recorded on the order (lines incl. price source, unit/line totals,
// allocations, availability status; cart adjustments; shipping; totals; the
// coupon code/status/reason). It deliberately excludes expires_at, hints,
// Thai messages and availability.available_qty, so a quote taken a minute
// earlier — or while someone else bought a unit of a well-stocked item — still
// matches at POST /orders.
func Hash(q Quote) string {
	type line struct {
		VariantID   int64
		Qty         int
		List, Unit  int64
		Src         PriceSource
		Adj         []Adjustment
		Total       int64
		Alloc       int64
		Low         *int64
		AvailStatus string
	}
	type coupon struct{ Code, Status, Reason string }
	c := struct {
		V      int
		Lines  []line
		Adjs   []Adjustment
		Ship   Shipping
		Totals Totals
		Coupon *coupon
	}{V: 1, Adjs: q.Adjustments, Ship: q.Shipping, Totals: q.Totals}
	for _, l := range q.Lines {
		c.Lines = append(c.Lines, line{l.VariantID, l.Qty, l.ListUnitPriceSatang, l.UnitPriceSatang, l.PriceSource,
			l.Adjustments, l.LineTotalSatang, l.AllocatedDiscount, l.Lowest30dSatang, l.Availability.Status})
	}
	if q.Coupon != nil {
		c.Coupon = &coupon{q.Coupon.Code, q.Coupon.Status, q.Coupon.ReasonCode}
	}
	b, err := json.Marshal(c)
	if err != nil { // cannot happen: plain structs
		panic(err)
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
