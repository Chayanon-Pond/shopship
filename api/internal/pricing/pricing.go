package pricing

import (
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"
)

// ErrNotImplemented is kept for source compatibility with Wave 0 callers; the
// engine never returns it.
var ErrNotImplemented = errors.New("pricing: not implemented")

// ErrInvalidCart is wrapped by Price for malformed input (qty < 1, negative
// prices). Cart rows from the DB never trigger it (CHECK constraints).
var ErrInvalidCart = errors.New("pricing: invalid cart")

// DefaultQuoteTTL is used when Context.QuoteTTL is zero.
const DefaultQuoteTTL = 10 * time.Minute

// Availability statuses.
const (
	AvailOK                = "ok"
	AvailInsufficientStock = "insufficient_stock"
	AvailOutOfStock        = "out_of_stock"
	AvailUnavailable       = "unavailable"
)

// Price source kinds.
const (
	SourceList          = "list"
	SourceFlashSale     = "flash_sale"
	SourceQuantityBreak = "quantity_break"
	SourceGroupPrice    = "group_price"
	SourceTierPrice     = "tier_price"
)

// Hint kinds.
const (
	HintFreeShippingGap  = "free_shipping_gap"
	HintCartPromoGap     = "cart_promo_gap"
	HintBuyXGetYGap      = "buy_x_get_y_gap"
	HintLoginForMember   = "login_for_member_price"
	HintQuantityBreakGap = "quantity_break_gap"
)

// Price computes a Quote. Pure: same inputs -> same Quote (incl. quote_hash).
//
// Rules (approved, see docs/API.md §6.2):
//  1. unit price = lowest of flash / quantity-break / group % / tier % (never stack);
//     percent rounding half-up on the unit price.
//  2. line promo buy_x_get_y: one per line, flash lines excluded.
//  3. cart automatic: single best spend-X-get-Y (cart_percent/cart_amount, layer 3).
//  4. one code per cart; an exclusive code is compared with layer 3, the
//     better one is kept and the coupon reason explains it.
//  5. shipping: one free-shipping rule (layer 5 auto or layer 4 code).
//
// Ties: higher priority, then lower id. Cart-level discounts are allocated to
// lines by largest remainder. Each applied rule is one labelled adjustment.
func Price(cart Cart, rs Ruleset, ctx Context) (Quote, error) {
	for i, l := range cart.Lines {
		if l.Qty < 1 || l.ListUnitPrice < 0 {
			return Quote{}, fmt.Errorf("%w: line %d (variant %d) qty=%d price=%d", ErrInvalidCart, i, l.VariantID, l.Qty, l.ListUnitPrice)
		}
	}
	e := &engine{cart: cart, ctx: ctx, now: ctx.Now.UTC()}
	e.promos = slices.Clone(rs.Promotions)
	sort.SliceStable(e.promos, func(a, b int) bool { return better(e.promos[a], e.promos[b]) })
	e.flash = slices.Clone(rs.FlashItems)
	sort.SliceStable(e.flash, func(a, b int) bool { return e.flash[a].ID < e.flash[b].ID })

	e.layer1()
	e.layer2()
	e.cartLevel()
	e.shipping()
	e.hints()
	return e.quote(), nil
}

// better orders promotions for ties: priority desc, then id asc.
func better(a, b Promotion) bool {
	if a.Priority != b.Priority {
		return a.Priority > b.Priority
	}
	return a.ID < b.ID
}

type lineState struct {
	in       Line
	ok       bool
	avail    Availability
	unit     int64
	src      PriceSource
	srcStart time.Time // start of the winning promotion (for lowest_30d)
	flash    bool
	adj      *Adjustment
	total    int64 // qty×unit − layer-2 (0 when not ok)
	alloc    int64
	l3alloc  int64 // part of alloc coming from layer 3 (base for a stacking code)
}

type engine struct {
	cart   Cart
	ctx    Context
	now    time.Time
	promos []Promotion // sorted priority desc, id asc
	flash  []FlashItem
	lines  []*lineState

	cartAdjs []Adjustment
	l3       *cartWin
	coupon   *CouponState
	codeFree *Promotion // layer-4 free-shipping code waiting for step 5
	ship     Shipping
	hintsOut []Hint
}

type cartWin struct {
	p      Promotion
	amount int64
	elig   []int // line indexes
}

func (e *engine) customer() *Customer { return e.ctx.Customer }

func (e *engine) inWindow(p Promotion) bool {
	if e.now.Before(p.StartsAt) {
		return false
	}
	return p.EndsAt == nil || e.now.Before(*p.EndsAt)
}

// audienceOK checks group/tier audience. Non-empty audience needs a customer.
func (e *engine) audienceOK(p Promotion) bool {
	c := e.customer()
	if len(p.CustomerGroupIDs) > 0 && (c == nil || !slices.Contains(p.CustomerGroupIDs, c.GroupID)) {
		return false
	}
	if len(p.Tiers) > 0 && (c == nil || !slices.Contains(p.Tiers, c.Tier)) {
		return false
	}
	return true
}

func (e *engine) usage(id int64) int {
	if e.ctx.PromotionUsage == nil {
		return 0
	}
	return e.ctx.PromotionUsage[id]
}

// autoEligible: an automatic promotion of the given layer may apply to this
// customer now (targets/min spend checked separately).
func (e *engine) autoEligible(p Promotion, layer int) bool {
	if p.Layer != layer || !p.AutoApply || p.Status != "active" || !e.inWindow(p) {
		return false
	}
	if p.UsageLimit > 0 && p.UsedCount >= p.UsageLimit {
		return false
	}
	c := e.customer()
	if layer == 1 && c == nil { // trade/member prices require login
		return false
	}
	if p.PerCustomerLimit > 0 && (c == nil || e.usage(p.ID) >= p.PerCustomerLimit) {
		return false
	}
	return e.audienceOK(p)
}

func targets(p Promotion, l Line) bool {
	if len(p.Targets) == 0 {
		return true
	}
	for _, t := range p.Targets {
		switch t.Type {
		case "category":
			if t.ID == l.CategoryID || (l.ParentCategoryID != 0 && t.ID == l.ParentCategoryID) {
				return true
			}
		case "product":
			if t.ID == l.ProductID {
				return true
			}
		case "variant":
			if t.ID == l.VariantID {
				return true
			}
		}
	}
	return false
}

// ---------- layer 1: unit price ----------

func (e *engine) layer1() {
	for _, l := range e.cart.Lines {
		ls := &lineState{in: l, unit: l.ListUnitPrice, src: PriceSource{Kind: SourceList, Label: ""}}
		switch {
		case !l.Active:
			ls.avail = Availability{Status: AvailUnavailable, AvailableQty: 0}
		case l.Stock <= 0:
			ls.avail = Availability{Status: AvailOutOfStock, AvailableQty: 0}
		case l.Stock < l.Qty:
			ls.avail = Availability{Status: AvailInsufficientStock, AvailableQty: l.Stock}
		default:
			ls.ok = true
			ls.avail = Availability{Status: AvailOK, AvailableQty: l.Stock}
		}

		best := l.ListUnitPrice
		// Flash first so an equal-priced promotion does not displace it.
		for _, f := range e.flash {
			if f.VariantID != l.VariantID || e.now.Before(f.StartsAt) || !e.now.Before(f.EndsAt) {
				continue
			}
			if f.SoldQty+l.Qty > f.QtyLimit {
				continue // not split: fall back to the next best source
			}
			if c := e.customer(); c != nil && f.PerCustomerLimit > 0 && e.flashUsage(f.ID)+l.Qty > f.PerCustomerLimit {
				continue
			}
			if f.SalePriceSatang < best {
				best = f.SalePriceSatang
				id := f.ID
				ls.src = PriceSource{Kind: SourceFlashSale, Label: f.Label, FlashSaleItemID: &id}
				ls.srcStart = f.StartsAt
				ls.flash = true
			}
		}
		for _, p := range e.promos {
			if !e.autoEligible(p, 1) || !targets(p, l) {
				continue
			}
			price, ok := l1Price(p, l)
			if !ok || price >= best {
				continue
			}
			best = price
			id := p.ID
			ls.src = PriceSource{Kind: string(p.Kind), Label: p.Label, PromotionID: &id}
			ls.srcStart = p.StartsAt
			ls.flash = false
		}
		ls.unit = best
		e.lines = append(e.lines, ls)
	}
}

func (e *engine) flashUsage(id int64) int {
	if e.ctx.FlashUsage == nil {
		return 0
	}
	return e.ctx.FlashUsage[id]
}

// l1Price is the unit price a layer-1 promotion gives this line.
func l1Price(p Promotion, l Line) (int64, bool) {
	switch p.Kind {
	case KindQuantityBreak:
		var best int64 = -1
		for _, t := range p.QtyTiers {
			if t.MinQty > l.Qty {
				continue
			}
			var price int64
			if t.UnitPriceSatang > 0 {
				price = t.UnitPriceSatang
			} else if t.PercentBP > 0 {
				price = percentPrice(l.ListUnitPrice, t.PercentBP)
			} else {
				continue
			}
			if best < 0 || price < best {
				best = price
			}
		}
		return best, best >= 0
	case KindGroupPrice, KindTierPrice:
		if p.PercentBP <= 0 {
			return 0, false
		}
		return percentPrice(l.ListUnitPrice, p.PercentBP), true
	}
	return 0, false
}

// ---------- layer 2: buy X get Y ----------

func bxgyAmount(p Promotion, qty int, unit int64) int64 {
	if p.BuyQty < 1 || p.GetQty < 1 {
		return 0
	}
	free := (qty / (p.BuyQty + p.GetQty)) * p.GetQty
	return int64(free) * percentOf(unit, p.GetPercentBP)
}

func (e *engine) layer2() {
	for _, ls := range e.lines {
		if !ls.ok {
			continue
		}
		gross := int64(ls.in.Qty) * ls.unit
		ls.total = gross
		if ls.flash {
			continue
		}
		for _, p := range e.promos {
			if p.Kind != KindBuyXGetY || !e.autoEligible(p, 2) || !targets(p, ls.in) || gross < p.MinSpendSatang {
				continue
			}
			amt := bxgyAmount(p, ls.in.Qty, ls.unit)
			if amt <= 0 || (ls.adj != nil && amt <= ls.adj.AmountSatang) {
				continue
			}
			ls.adj = &Adjustment{PromotionID: p.ID, Layer: 2, Label: p.Label, AmountSatang: amt}
		}
		if ls.adj != nil {
			ls.total = gross - ls.adj.AmountSatang
		}
	}
}

// ---------- layers 3 + 4 ----------

// eligible returns the ok lines a promotion targets and their base sum.
func (e *engine) eligible(p Promotion, base func(*lineState) int64) ([]int, int64) {
	var idx []int
	var sum int64
	for i, ls := range e.lines {
		if !ls.ok || !targets(p, ls.in) {
			continue
		}
		idx = append(idx, i)
		sum += base(ls)
	}
	return idx, sum
}

func lineTotal(ls *lineState) int64 { return ls.total }
func afterL3(ls *lineState) int64   { return ls.total - ls.l3alloc }

// cartAmount: the discount a cart_percent/cart_amount promotion gives on base.
func cartAmount(p Promotion, base int64) int64 {
	var amt int64
	switch p.Kind {
	case KindCartPercent:
		amt = percentAmount(base, p.PercentBP)
	case KindCartAmount:
		amt = p.AmountSatang
	}
	if p.MaxDiscountSatang > 0 && amt > p.MaxDiscountSatang {
		amt = p.MaxDiscountSatang
	}
	if amt > base {
		amt = base
	}
	if amt < 0 {
		amt = 0
	}
	return amt
}

func (e *engine) bestL3() *cartWin {
	var win *cartWin
	for _, p := range e.promos {
		if (p.Kind != KindCartPercent && p.Kind != KindCartAmount) || !e.autoEligible(p, 3) {
			continue
		}
		idx, sum := e.eligible(p, lineTotal)
		if len(idx) == 0 || sum <= 0 || sum < p.MinSpendSatang {
			continue
		}
		amt := cartAmount(p, sum)
		if amt <= 0 || (win != nil && amt <= win.amount) {
			continue
		}
		win = &cartWin{p: p, amount: amt, elig: idx}
	}
	return win
}

func (e *engine) applyCart(w *cartWin, layer int, code string, base func(*lineState) int64) {
	weights := make([]int64, len(w.elig))
	for k, i := range w.elig {
		weights[k] = base(e.lines[i])
	}
	for k, share := range allocate(w.amount, weights) {
		ls := e.lines[w.elig[k]]
		ls.alloc += share
		if layer == 3 {
			ls.l3alloc += share
		}
	}
	e.cartAdjs = append(e.cartAdjs, Adjustment{PromotionID: w.p.ID, Layer: layer, Label: w.p.Label, AmountSatang: w.amount, CouponCode: code})
}

func (e *engine) cartLevel() {
	l3 := e.bestL3()
	code := strings.ToUpper(strings.TrimSpace(e.cart.CouponCode))
	var codeWin *cartWin
	if code != "" {
		codeWin = e.evalCode(code, l3)
	}
	if l3 != nil && !(codeWin != nil && codeWin.p.Exclusive) {
		e.l3 = l3
		e.applyCart(l3, 3, "", lineTotal)
	}
	if codeWin != nil {
		if !codeWin.p.Exclusive {
			// stacks on top of layer 3: base = line totals after the layer-3 share
			idx, sum := e.eligible(codeWin.p, afterL3)
			codeWin.elig, codeWin.amount = idx, cartAmount(codeWin.p, sum)
		}
		if codeWin.amount > 0 {
			e.applyCart(codeWin, 4, code, afterL3)
			e.coupon = &CouponState{Code: code, Status: CouponApplied, Message: fmt.Sprintf("ใช้โค้ด %s แล้ว ลด %s", code, FormatBaht(codeWin.amount))}
		} else {
			e.coupon = couponState(code, ReasonNoEligibleItems, fmt.Sprintf("ไม่มีสินค้าในตะกร้าที่ร่วมรายการกับโค้ด %s", code))
		}
	}
}

func couponState(code, reason, msg string) *CouponState {
	st := CouponNotApplied
	switch reason {
	case ReasonNotFound, ReasonInactive, ReasonNotStarted, ReasonExpired, ReasonUsageLimit, ReasonPerCustomerLimit, ReasonLoginRequired:
		st = CouponInvalid
	}
	return &CouponState{Code: code, Status: st, ReasonCode: reason, Message: msg}
}

func (e *engine) findCode(code string) (Promotion, bool) {
	var found *Promotion
	for i := range e.promos {
		p := &e.promos[i]
		if p.Layer != 4 || !slices.Contains(p.Codes, code) {
			continue
		}
		if found == nil || p.ID < found.ID {
			found = p
		}
	}
	if found == nil {
		return Promotion{}, false
	}
	return *found, true
}

// evalCode validates the code and returns the cart-level win it would bring
// (nil when invalid/not applied, with e.coupon set; nil + e.codeFree for a
// free-shipping code, decided in step 5).
func (e *engine) evalCode(code string, l3 *cartWin) *cartWin {
	p, ok := e.findCode(code)
	if !ok {
		e.coupon = couponState(code, ReasonNotFound, fmt.Sprintf("ไม่พบโค้ด %s", code))
		return nil
	}
	c := e.customer()
	switch {
	case p.Status != "active":
		e.coupon = couponState(code, ReasonInactive, fmt.Sprintf("โค้ด %s ไม่สามารถใช้งานได้ในขณะนี้", code))
	case e.now.Before(p.StartsAt):
		e.coupon = couponState(code, ReasonNotStarted, fmt.Sprintf("โค้ด %s ใช้ได้ตั้งแต่ %s", code, thaiDate(p.StartsAt)))
	case p.EndsAt != nil && !e.now.Before(*p.EndsAt):
		e.coupon = couponState(code, ReasonExpired, fmt.Sprintf("โค้ด %s หมดอายุแล้ว (สิ้นสุด %s)", code, thaiLastDay(*p.EndsAt)))
	case p.UsageLimit > 0 && p.UsedCount >= p.UsageLimit:
		e.coupon = couponState(code, ReasonUsageLimit, fmt.Sprintf("โค้ด %s ถูกใช้ครบจำนวนสิทธิ์แล้ว", code))
	case c == nil && (p.PerCustomerLimit > 0 || len(p.CustomerGroupIDs) > 0 || len(p.Tiers) > 0):
		e.coupon = couponState(code, ReasonLoginRequired, fmt.Sprintf("กรุณาเข้าสู่ระบบเพื่อใช้โค้ด %s", code))
	case p.PerCustomerLimit > 0 && e.usage(p.ID) >= p.PerCustomerLimit:
		e.coupon = couponState(code, ReasonPerCustomerLimit, fmt.Sprintf("คุณใช้โค้ด %s ครบจำนวนสิทธิ์แล้ว", code))
	case !e.audienceOK(p):
		e.coupon = couponState(code, ReasonAudience, fmt.Sprintf("โค้ด %s ใช้ได้เฉพาะลูกค้าบางกลุ่ม", code))
	}
	if e.coupon != nil {
		return nil
	}
	idx, sum := e.eligible(p, lineTotal)
	if len(idx) == 0 || sum <= 0 {
		e.coupon = couponState(code, ReasonNoEligibleItems, fmt.Sprintf("ไม่มีสินค้าในตะกร้าที่ร่วมรายการกับโค้ด %s", code))
		return nil
	}
	if sum < p.MinSpendSatang {
		e.coupon = couponState(code, ReasonMinSpend, fmt.Sprintf("โค้ด %s ใช้ได้เมื่อช้อปครบ %s (ขาดอีก %s)",
			code, FormatBaht(p.MinSpendSatang), FormatBaht(p.MinSpendSatang-sum)))
		return nil
	}
	switch p.Kind {
	case KindFreeShipping:
		e.codeFree = &p
		return nil
	case KindCartPercent, KindCartAmount:
	default:
		e.coupon = couponState(code, ReasonNotFound, fmt.Sprintf("ไม่พบโค้ด %s", code))
		return nil
	}
	w := &cartWin{p: p, elig: idx, amount: cartAmount(p, sum)}
	if p.Exclusive && l3 != nil && w.amount <= l3.amount {
		e.coupon = couponState(code, ReasonExclusiveLost,
			fmt.Sprintf("โค้ด %s ใช้ร่วมกับโปรอื่นไม่ได้ และลดน้อยกว่าโปร '%s' ที่ได้รับอยู่แล้ว", code, l3.p.Label))
		return nil
	}
	return w
}

// ---------- layer 5: shipping ----------

func (e *engine) netSum(p Promotion) ([]int, int64) { return e.eligible(p, lineTotal) }

func (e *engine) shipping() {
	fee := e.cart.BaseShippingFee
	if fee < 0 {
		fee = 0
	}
	e.ship = Shipping{FeeSatang: fee}
	shipDiscount := func(p Promotion) int64 {
		d := fee
		if p.MaxDiscountSatang > 0 && d > p.MaxDiscountSatang {
			d = p.MaxDiscountSatang
		}
		return d
	}
	var win *Promotion
	var winD int64
	for i := range e.promos {
		p := e.promos[i]
		if p.Kind != KindFreeShipping || !e.autoEligible(p, 5) {
			continue
		}
		idx, sum := e.netSum(p)
		if len(idx) == 0 || sum < p.MinSpendSatang {
			continue
		}
		if d := shipDiscount(p); win == nil || d > winD {
			win, winD = &e.promos[i], d
		}
	}
	code := strings.ToUpper(strings.TrimSpace(e.cart.CouponCode))
	if e.codeFree != nil {
		if win != nil {
			e.coupon = couponState(code, ReasonShippingAlreadyFree, fmt.Sprintf("คำสั่งซื้อนี้ได้ส่งฟรีอยู่แล้ว ไม่ต้องใช้โค้ด %s", code))
		} else {
			win, winD = e.codeFree, shipDiscount(*e.codeFree)
			e.coupon = &CouponState{Code: code, Status: CouponApplied, Message: fmt.Sprintf("ใช้โค้ด %s แล้ว รับส่งฟรี", code)}
		}
	}
	if win != nil {
		id := win.ID
		e.ship.DiscountSatang = winD
		e.ship.PromotionID = &id
		e.ship.Label = win.Label
	}
}

// ---------- hints ----------

func (e *engine) hints() {
	e.hintsOut = []Hint{}
	// free shipping gap
	if e.ship.PromotionID == nil {
		var best *Promotion
		var gap int64
		for i := range e.promos {
			p := e.promos[i]
			if p.Kind != KindFreeShipping || !e.autoEligible(p, 5) {
				continue
			}
			idx, sum := e.netSum(p)
			if len(idx) == 0 || sum >= p.MinSpendSatang {
				continue
			}
			if g := p.MinSpendSatang - sum; best == nil || g < gap {
				best, gap = &e.promos[i], g
			}
		}
		if best != nil {
			e.hintsOut = append(e.hintsOut, Hint{Kind: HintFreeShippingGap, Message: fmt.Sprintf("ช้อปเพิ่มอีก %s รับส่งฟรี", FormatBaht(gap)),
				AmountSatang: gap, PromotionID: best.ID})
		}
	}
	// cart promo gap: an unmet layer-3 promotion that would beat the current one
	var cur int64
	if e.l3 != nil {
		cur = e.l3.amount
	}
	var bestP *Promotion
	var bestGap int64
	for i := range e.promos {
		p := e.promos[i]
		if (p.Kind != KindCartPercent && p.Kind != KindCartAmount) || !e.autoEligible(p, 3) {
			continue
		}
		idx, sum := e.eligible(p, lineTotal)
		if len(idx) == 0 || sum >= p.MinSpendSatang || cartAmount(p, p.MinSpendSatang) <= cur {
			continue
		}
		if g := p.MinSpendSatang - sum; bestP == nil || g < bestGap {
			bestP, bestGap = &e.promos[i], g
		}
	}
	if bestP != nil {
		e.hintsOut = append(e.hintsOut, Hint{Kind: HintCartPromoGap, Message: fmt.Sprintf("ช้อปเพิ่มอีก %s รับโปร %s", FormatBaht(bestGap), bestP.Label),
			AmountSatang: bestGap, PromotionID: bestP.ID})
	}
	// buy X get Y gap: adding a few units makes the next ones discounted/free
	seen := map[int64]bool{}
	for _, ls := range e.lines {
		if !ls.ok || ls.flash {
			continue
		}
		for _, p := range e.promos {
			if p.Kind != KindBuyXGetY || !e.autoEligible(p, 2) || !targets(p, ls.in) || p.BuyQty < 1 || p.GetQty < 1 {
				continue
			}
			if ls.adj != nil && ls.adj.PromotionID != p.ID {
				continue
			}
			rem := ls.in.Qty % (p.BuyQty + p.GetQty)
			if rem >= p.BuyQty && !seen[p.ID] {
				seen[p.ID] = true
				need := p.BuyQty + p.GetQty - rem
				what := "รับฟรี"
				if p.GetPercentBP < bpWhole {
					what = "รับส่วนลด"
				}
				e.hintsOut = append(e.hintsOut, Hint{Kind: HintBuyXGetYGap,
					Message: fmt.Sprintf("หยิบเพิ่มอีก %d ชิ้น %sตามโปร %s", need, what, p.Label), PromotionID: p.ID})
			}
			break
		}
	}
	// quantity break: the next tier would lower this line's unit price (signed-in
	// only, like all layer 1). One hint per line (the best next tier across promotions).
	for _, ls := range e.lines {
		if !ls.ok || ls.flash {
			continue
		}
		var best *Hint
		for _, p := range e.promos {
			if p.Kind != KindQuantityBreak || !e.autoEligible(p, 1) || !targets(p, ls.in) {
				continue
			}
			var next *QtyTier
			var nextPrice int64
			for i := range p.QtyTiers {
				t := &p.QtyTiers[i]
				if t.MinQty <= ls.in.Qty || (next != nil && t.MinQty >= next.MinQty) {
					continue
				}
				price := t.UnitPriceSatang
				if price <= 0 {
					price = percentPrice(ls.in.ListUnitPrice, t.PercentBP)
				}
				if price < ls.unit {
					next, nextPrice = t, price
				}
			}
			if next == nil {
				continue
			}
			need := next.MinQty - ls.in.Qty
			if best != nil && (need > best.QtyNeeded || (need == best.QtyNeeded && nextPrice >= best.UnitPriceSatang)) {
				continue // keep the nearest (then cheapest) tier; promos are already in tie order
			}
			msg := fmt.Sprintf("หยิบเพิ่มอีก %d ชิ้น รับราคาส่ง %s/ชิ้น", need, FormatBaht(nextPrice))
			bp := 0
			if next.UnitPriceSatang <= 0 {
				bp = next.PercentBP
				msg = fmt.Sprintf("หยิบเพิ่มอีก %d ชิ้น รับราคาส่ง ลด %s (%s/ชิ้น)", need, formatBP(bp), FormatBaht(nextPrice))
			}
			best = &Hint{Kind: HintQuantityBreakGap, Message: msg, PromotionID: p.ID, VariantID: ls.in.VariantID,
				QtyNeeded: need, UnitPriceSatang: nextPrice, PercentBP: bp}
		}
		if best != nil {
			e.hintsOut = append(e.hintsOut, *best)
		}
	}
	// guest: member/trade prices exist for something in the cart
	if e.customer() == nil {
		for _, p := range e.promos {
			if p.Layer != 1 || p.Status != "active" || !e.inWindow(p) {
				continue
			}
			hit := false
			for _, ls := range e.lines {
				if targets(p, ls.in) {
					hit = true
					break
				}
			}
			if hit {
				e.hintsOut = append(e.hintsOut, Hint{Kind: HintLoginForMember, Message: "เข้าสู่ระบบเพื่อดูราคาสมาชิก"})
				break
			}
		}
	}
}

// ---------- assemble ----------

func (e *engine) quote() Quote {
	q := Quote{Lines: make([]QuoteLine, 0, len(e.lines)), Adjustments: e.cartAdjs, Shipping: e.ship, Coupon: e.coupon, Hints: e.hintsOut}
	if q.Adjustments == nil {
		q.Adjustments = []Adjustment{}
	}
	var t Totals
	for _, ls := range e.lines {
		ql := QuoteLine{
			VariantID:           ls.in.VariantID,
			Qty:                 ls.in.Qty,
			ListUnitPriceSatang: ls.in.ListUnitPrice,
			UnitPriceSatang:     ls.unit,
			PriceSource:         ls.src,
			Adjustments:         []Adjustment{},
			LineTotalSatang:     ls.total,
			AllocatedDiscount:   ls.alloc,
			Availability:        ls.avail,
		}
		if ls.adj != nil {
			ql.Adjustments = append(ql.Adjustments, *ls.adj)
		}
		if ls.src.Kind != SourceList {
			low := lowest30d(ls.in.PriceHistory, ls.srcStart, ls.in.ListUnitPrice)
			ql.Lowest30dSatang = &low
		}
		if ls.ok {
			t.ListSubtotalSatang += int64(ls.in.Qty) * ls.in.ListUnitPrice
			t.SubtotalSatang += ls.total
		}
		q.Lines = append(q.Lines, ql)
	}
	for _, a := range q.Adjustments {
		t.DiscountSatang += a.AmountSatang
	}
	t.ShippingSatang = e.ship.FeeSatang - e.ship.DiscountSatang
	t.SavingsSatang = t.ListSubtotalSatang - t.SubtotalSatang + t.DiscountSatang + e.ship.DiscountSatang
	t.GrandTotalSatang = t.SubtotalSatang - t.DiscountSatang + t.ShippingSatang
	q.Totals = t
	ttl := e.ctx.QuoteTTL
	if ttl <= 0 {
		ttl = DefaultQuoteTTL
	}
	q.ExpiresAt = e.now.Add(ttl)
	q.QuoteHash = Hash(q)
	return q
}

// lowest30d mirrors SQL variant_lowest_price_30d(variant, start): the price in
// effect 30 days before start plus every change in (start−30d, start). With no
// history the current list price is the reference.
func lowest30d(hist []PricePoint, start time.Time, list int64) int64 {
	from := start.Add(-30 * 24 * time.Hour)
	var lastBefore *PricePoint
	low := int64(-1)
	for i := range hist {
		h := hist[i]
		switch {
		case !h.At.After(from):
			if lastBefore == nil || h.At.After(lastBefore.At) {
				lastBefore = &hist[i]
			}
		case h.At.Before(start):
			if low < 0 || h.Price < low {
				low = h.Price
			}
		}
	}
	if lastBefore != nil && (low < 0 || lastBefore.Price < low) {
		low = lastBefore.Price
	}
	if low < 0 {
		return list
	}
	return low
}
