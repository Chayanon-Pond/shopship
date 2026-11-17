package pricing

import (
	"math/bits"
	"sort"
	"strconv"
	"strings"
	"time"
)

// bpWhole is 100 % in basis points.
const bpWhole = 10000

// PercentPrice is the engine's layer-1 percent rule (half-up on the unit
// price), exported so offers/admin previews show identical numbers.
func PercentPrice(price int64, bp int) int64 { return percentPrice(price, bp) }

// percentPrice returns round_half_up(price × (10000 − bp) / 10000): the unit
// price after a bp discount. bp is clamped to 0..10000.
func percentPrice(price int64, bp int) int64 {
	return price - percentOf(price, bp)
}

// percentOf returns the discount part: price − round_half_up(price × (10000−bp)/10000).
// Computed as the complement so percentPrice is exactly half-up on the
// resulting price (the approved rule), not on the discount.
func percentOf(price int64, bp int) int64 {
	if bp <= 0 || price <= 0 {
		return 0
	}
	if bp >= bpWhole {
		return price
	}
	after := mulDivHalfUp(price, int64(bpWhole-bp), bpWhole)
	return price - after
}

// percentAmount = round_half_up(base × bp / 10000), used for cart-level percent codes.
func percentAmount(base int64, bp int) int64 {
	if bp <= 0 || base <= 0 {
		return 0
	}
	if bp >= bpWhole {
		return base
	}
	return mulDivHalfUp(base, int64(bp), bpWhole)
}

// mulDivHalfUp computes round_half_up(a × b / d) for a, b >= 0, d > 0 with a
// 128-bit intermediate (no overflow for any int64 money amount).
func mulDivHalfUp(a, b, d int64) int64 {
	hi, lo := bits.Mul64(uint64(a), uint64(b))
	var carry uint64
	lo, carry = bits.Add64(lo, uint64(d)/2, 0)
	hi += carry
	q, _ := bits.Div64(hi, lo, uint64(d))
	return int64(q)
}

// allocate splits amount across weights proportionally by the largest
// remainder method: Σ result = amount exactly, and every share <= its weight
// (requires 0 <= amount <= Σ weights). Ties on the remainder go to the lower
// index, so the result is deterministic.
func allocate(amount int64, weights []int64) []int64 {
	out := make([]int64, len(weights))
	var total int64
	for _, w := range weights {
		if w > 0 {
			total += w
		}
	}
	if amount <= 0 || total <= 0 {
		return out
	}
	if amount > total {
		amount = total
	}
	type rem struct {
		i int
		r uint64
	}
	rems := make([]rem, 0, len(weights))
	var given int64
	for i, w := range weights {
		if w <= 0 {
			continue
		}
		hi, lo := bits.Mul64(uint64(amount), uint64(w))
		q, r := bits.Div64(hi, lo, uint64(total))
		out[i] = int64(q)
		given += int64(q)
		rems = append(rems, rem{i, r})
	}
	sort.SliceStable(rems, func(a, b int) bool {
		if rems[a].r != rems[b].r {
			return rems[a].r > rems[b].r
		}
		return rems[a].i < rems[b].i
	})
	for k := 0; given < amount && k < len(rems); k++ {
		out[rems[k].i]++
		given++
	}
	return out
}

// FormatBaht renders satang as the storefront does: "฿211", "฿155.50", "฿1,000".
func FormatBaht(satang int64) string {
	neg := satang < 0
	if neg {
		satang = -satang
	}
	baht, st := satang/100, satang%100
	s := strconv.FormatInt(baht, 10)
	var b strings.Builder
	if neg {
		b.WriteByte('-')
	}
	b.WriteString("฿")
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(c)
	}
	if st != 0 {
		b.WriteByte('.')
		if st < 10 {
			b.WriteByte('0')
		}
		b.WriteString(strconv.FormatInt(st, 10))
	}
	return b.String()
}

// formatBP renders basis points as a percent: 1000 -> "10%", 250 -> "2.5%".
func formatBP(bp int) string {
	s := strconv.Itoa(bp / 100)
	if r := bp % 100; r != 0 {
		f := strconv.Itoa(100 + r)[1:]
		s += "." + strings.TrimRight(f, "0")
	}
	return s + "%"
}

// Bangkok is Asia/Bangkok (UTC+7, no DST). A fixed zone avoids a tzdata
// dependency on Windows/scratch images.
var Bangkok = time.FixedZone("Asia/Bangkok", 7*60*60)

var thaiMonths = [...]string{"ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."}

// thaiDate formats t as "16 เม.ย. 2026" in Bangkok time.
func thaiDate(t time.Time) string {
	t = t.In(Bangkok)
	return strconv.Itoa(t.Day()) + " " + thaiMonths[t.Month()-1] + " " + strconv.Itoa(t.Year())
}

// thaiLastDay is the last Bangkok calendar day a window ending at end covers
// (an end at Bangkok midnight means "through the previous day").
func thaiLastDay(end time.Time) string { return thaiDate(end.Add(-time.Nanosecond)) }
