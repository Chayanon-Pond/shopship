package promotions

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/shopship/shop/api/internal/pricing"
)

// Querier is satisfied by *pgxpool.Pool, *pgx.Conn and pgx.Tx, so every
// loader works inside or outside a transaction.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Item is a cart row before catalog data is joined in.
type Item struct {
	VariantID int64
	Qty       int
}

type loadOpts struct {
	drafts bool // admin preview: draft promotions/flash sales count as active
}

// LoadRuleset loads everything pricing.Price needs besides the cart lines:
// every active promotion whose window contains now (all layers), the active
// flash-sale items in window for the cart's variants, the promotion behind
// cart.CouponCode whatever its status/window (so the engine can say
// "expired"), and — for a signed-in customer — their usage counters.
//
// Frozen interface (docs/WAVES.md). customer nil = guest.
func LoadRuleset(ctx context.Context, q Querier, cart pricing.Cart, customer *pricing.Customer, now time.Time) (pricing.Ruleset, pricing.Context, error) {
	return loadRuleset(ctx, q, cart, customer, now, loadOpts{})
}

func loadRuleset(ctx context.Context, q Querier, cart pricing.Cart, customer *pricing.Customer, now time.Time, o loadOpts) (pricing.Ruleset, pricing.Context, error) {
	now = now.UTC()
	pctx := pricing.Context{Now: now, Customer: customer, QuoteTTL: pricing.DefaultQuoteTTL}
	var rs pricing.Ruleset

	code := strings.ToUpper(strings.TrimSpace(cart.CouponCode))
	statusCond := "p.status = 'active'"
	if o.drafts {
		statusCond = "p.status IN ('active', 'draft')"
	}
	// Active-in-window promotions, plus the coded promotion regardless of state.
	rows, err := q.Query(ctx, `
		SELECT `+promoCols+` FROM promotions p
		 WHERE (`+statusCond+` AND p.starts_at <= $1 AND (p.ends_at IS NULL OR p.ends_at > $1))
		    OR ($2 <> '' AND p.layer = 4 AND p.id IN (SELECT promotion_id FROM coupon_codes WHERE code = $2))
		 ORDER BY p.id`, now, code)
	if err != nil {
		return rs, pctx, fmt.Errorf("promotions: load: %w", err)
	}
	promos, err := pgx.CollectRows(rows, scanPromo)
	if err != nil {
		return rs, pctx, fmt.Errorf("promotions: load: %w", err)
	}
	if o.drafts {
		for i := range promos {
			if promos[i].Status == "draft" {
				promos[i].Status = "active"
			}
		}
	}
	if err := attachRuleDetails(ctx, q, promos, code); err != nil {
		return rs, pctx, err
	}
	rs.Promotions = promos

	ids := make([]int64, 0, len(cart.Lines))
	for _, l := range cart.Lines {
		ids = append(ids, l.VariantID)
	}
	if len(ids) > 0 {
		fs, err := loadFlashItems(ctx, q, ids, now, o.drafts)
		if err != nil {
			return rs, pctx, err
		}
		rs.FlashItems = fs
	}

	if customer != nil && customer.ID != 0 {
		pctx.PromotionUsage = map[int64]int{}
		pctx.FlashUsage = map[int64]int{}
		rows, err := q.Query(ctx, `SELECT promotion_id, count(*) FROM promotion_redemptions
			WHERE user_id = $1 AND status <> 'released' GROUP BY promotion_id`, customer.ID)
		if err != nil {
			return rs, pctx, fmt.Errorf("promotions: usage: %w", err)
		}
		var pid int64
		var n int
		if _, err := pgx.ForEachRow(rows, []any{&pid, &n}, func() error { pctx.PromotionUsage[pid] = n; return nil }); err != nil {
			return rs, pctx, fmt.Errorf("promotions: usage: %w", err)
		}
		rows, err = q.Query(ctx, `SELECT r.flash_sale_item_id, sum(r.qty)::int FROM stock_reservations r
			JOIN orders o ON o.id = r.order_id
			WHERE o.user_id = $1 AND r.flash_sale_item_id IS NOT NULL AND r.status <> 'released'
			GROUP BY r.flash_sale_item_id`, customer.ID)
		if err != nil {
			return rs, pctx, fmt.Errorf("promotions: flash usage: %w", err)
		}
		if _, err := pgx.ForEachRow(rows, []any{&pid, &n}, func() error { pctx.FlashUsage[pid] = n; return nil }); err != nil {
			return rs, pctx, fmt.Errorf("promotions: flash usage: %w", err)
		}
	}
	return rs, pctx, nil
}

const promoCols = `p.id, p.name, p.label, p.kind, p.layer, p.status, p.starts_at, p.ends_at, p.priority, p.exclusive, p.auto_apply,
	coalesce(p.percent_bp, 0), coalesce(p.amount_satang, 0), coalesce(p.buy_qty, 0), coalesce(p.get_qty, 0), coalesce(p.get_percent_bp, 0),
	p.min_spend_satang, coalesce(p.max_discount_satang, 0), coalesce(p.usage_limit, 0), coalesce(p.per_customer_limit, 0), p.used_count,
	p.customer_group_ids, p.tiers`

func scanPromo(row pgx.CollectableRow) (pricing.Promotion, error) {
	var p pricing.Promotion
	var kind string
	var layer int16
	err := row.Scan(&p.ID, &p.Name, &p.Label, &kind, &layer, &p.Status, &p.StartsAt, &p.EndsAt, &p.Priority, &p.Exclusive, &p.AutoApply,
		&p.PercentBP, &p.AmountSatang, &p.BuyQty, &p.GetQty, &p.GetPercentBP,
		&p.MinSpendSatang, &p.MaxDiscountSatang, &p.UsageLimit, &p.PerCustomerLimit, &p.UsedCount,
		&p.CustomerGroupIDs, &p.Tiers)
	p.Kind, p.Layer = pricing.Kind(kind), int(layer)
	p.StartsAt = p.StartsAt.UTC()
	if p.EndsAt != nil {
		e := p.EndsAt.UTC()
		p.EndsAt = &e
	}
	if p.CustomerGroupIDs == nil {
		p.CustomerGroupIDs = []int64{}
	}
	if p.Tiers == nil {
		p.Tiers = []string{}
	}
	return p, err
}

// attachRuleDetails loads targets, qty tiers and active codes. A deactivated
// code typed by the customer is attached too, with the promotion marked
// paused, so the engine reports "inactive" instead of "not found".
func attachRuleDetails(ctx context.Context, q Querier, promos []pricing.Promotion, typed string) error {
	if len(promos) == 0 {
		return nil
	}
	idx := make(map[int64]int, len(promos))
	ids := make([]int64, len(promos))
	for i, p := range promos {
		idx[p.ID], ids[i] = i, p.ID
	}
	rows, err := q.Query(ctx, `SELECT promotion_id, target_type, coalesce(category_id, product_id, variant_id)
		FROM promotion_targets WHERE promotion_id = ANY($1) ORDER BY id`, ids)
	if err != nil {
		return fmt.Errorf("promotions: targets: %w", err)
	}
	var pid, tid int64
	var typ string
	if _, err := pgx.ForEachRow(rows, []any{&pid, &typ, &tid}, func() error {
		p := &promos[idx[pid]]
		p.Targets = append(p.Targets, pricing.Target{Type: typ, ID: tid})
		return nil
	}); err != nil {
		return fmt.Errorf("promotions: targets: %w", err)
	}
	rows, err = q.Query(ctx, `SELECT promotion_id, min_qty, coalesce(unit_price_satang, 0), coalesce(percent_bp, 0)
		FROM promotion_qty_tiers WHERE promotion_id = ANY($1) ORDER BY promotion_id, min_qty`, ids)
	if err != nil {
		return fmt.Errorf("promotions: qty tiers: %w", err)
	}
	var t pricing.QtyTier
	if _, err := pgx.ForEachRow(rows, []any{&pid, &t.MinQty, &t.UnitPriceSatang, &t.PercentBP}, func() error {
		p := &promos[idx[pid]]
		p.QtyTiers = append(p.QtyTiers, t)
		return nil
	}); err != nil {
		return fmt.Errorf("promotions: qty tiers: %w", err)
	}
	rows, err = q.Query(ctx, `SELECT promotion_id, code, is_active FROM coupon_codes
		WHERE promotion_id = ANY($1) AND (is_active OR code = $2) ORDER BY id`, ids, typed)
	if err != nil {
		return fmt.Errorf("promotions: codes: %w", err)
	}
	var code string
	var active bool
	if _, err := pgx.ForEachRow(rows, []any{&pid, &code, &active}, func() error {
		p := &promos[idx[pid]]
		p.Codes = append(p.Codes, code)
		if !active && p.Status == "active" {
			p.Status = "paused"
		}
		return nil
	}); err != nil {
		return fmt.Errorf("promotions: codes: %w", err)
	}
	return nil
}

func loadFlashItems(ctx context.Context, q Querier, variantIDs []int64, now time.Time, drafts bool) ([]pricing.FlashItem, error) {
	statusCond := "fs.status = 'active'"
	if drafts {
		statusCond = "fs.status IN ('active', 'draft')"
	}
	rows, err := q.Query(ctx, `
		SELECT fi.id, fs.id, fs.label, fi.variant_id, fi.sale_price_satang, fi.qty_limit, fi.sold_qty,
		       coalesce(fi.per_customer_limit, 0), fs.starts_at, fs.ends_at
		  FROM flash_sale_items fi JOIN flash_sales fs ON fs.id = fi.flash_sale_id
		 WHERE `+statusCond+` AND fs.starts_at <= $1 AND fs.ends_at > $1 AND fi.variant_id = ANY($2)
		 ORDER BY fi.id`, now, variantIDs)
	if err != nil {
		return nil, fmt.Errorf("promotions: flash items: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (pricing.FlashItem, error) {
		var f pricing.FlashItem
		err := r.Scan(&f.ID, &f.FlashSaleID, &f.Label, &f.VariantID, &f.SalePriceSatang, &f.QtyLimit, &f.SoldQty,
			&f.PerCustomerLimit, &f.StartsAt, &f.EndsAt)
		f.StartsAt, f.EndsAt = f.StartsAt.UTC(), f.EndsAt.UTC()
		return f, err
	})
}

// LoadLines joins cart items with catalog data (price, stock, category,
// active flag). Unknown variants come back as unavailable lines (price 0).
// PriceHistory is filled later by AttachPriceHistory (it depends on the
// ruleset's promotion start dates).
func LoadLines(ctx context.Context, q Querier, items []Item) ([]pricing.Line, error) {
	if len(items) == 0 {
		return []pricing.Line{}, nil
	}
	ids := make([]int64, len(items))
	for i, it := range items {
		ids[i] = it.VariantID
	}
	rows, err := q.Query(ctx, `
		SELECT v.id, v.product_id, p.category_id, coalesce(c.parent_id, 0), v.price_satang, v.stock,
		       v.is_active AND p.status = 'active' AND p.deleted_at IS NULL
		  FROM product_variants v
		  JOIN products p ON p.id = v.product_id
		  JOIN categories c ON c.id = p.category_id
		 WHERE v.id = ANY($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("promotions: lines: %w", err)
	}
	byID := map[int64]pricing.Line{}
	var l pricing.Line
	if _, err := pgx.ForEachRow(rows, []any{&l.VariantID, &l.ProductID, &l.CategoryID, &l.ParentCategoryID, &l.ListUnitPrice, &l.Stock, &l.Active},
		func() error { byID[l.VariantID] = l; return nil }); err != nil {
		return nil, fmt.Errorf("promotions: lines: %w", err)
	}
	out := make([]pricing.Line, len(items))
	for i, it := range items {
		ln, ok := byID[it.VariantID]
		if !ok {
			ln = pricing.Line{VariantID: it.VariantID}
		}
		ln.Qty = it.Qty
		out[i] = ln
	}
	return out, nil
}

// AttachPriceHistory fills Line.PriceHistory for lines that a layer-1
// promotion or flash item in rs could reprice: the price in effect 30 days
// before the earliest such start, and every change since.
func AttachPriceHistory(ctx context.Context, q Querier, lines []pricing.Line, rs pricing.Ruleset) error {
	var ids []int64
	var since []time.Time
	pos := map[int64][]int{}
	for i, l := range lines {
		var earliest time.Time
		consider := func(t time.Time) {
			if earliest.IsZero() || t.Before(earliest) {
				earliest = t
			}
		}
		for _, f := range rs.FlashItems {
			if f.VariantID == l.VariantID {
				consider(f.StartsAt)
			}
		}
		for _, p := range rs.Promotions {
			if p.Layer == 1 && targetsLine(p, l) {
				consider(p.StartsAt)
			}
		}
		if earliest.IsZero() {
			continue
		}
		if _, dup := pos[l.VariantID]; !dup {
			ids = append(ids, l.VariantID)
			since = append(since, earliest.Add(-30*24*time.Hour))
		}
		pos[l.VariantID] = append(pos[l.VariantID], i)
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := q.Query(ctx, `
		SELECT v.id, ph.price_satang, ph.changed_at
		  FROM unnest($1::bigint[], $2::timestamptz[]) AS v(id, since)
		  CROSS JOIN LATERAL (
		      (SELECT price_satang, changed_at FROM price_history
		        WHERE variant_id = v.id AND changed_at <= v.since ORDER BY changed_at DESC LIMIT 1)
		      UNION ALL
		      (SELECT price_satang, changed_at FROM price_history
		        WHERE variant_id = v.id AND changed_at > v.since)
		  ) ph
		 ORDER BY v.id, ph.changed_at`, ids, since)
	if err != nil {
		return fmt.Errorf("promotions: price history: %w", err)
	}
	var vid int64
	var pp pricing.PricePoint
	_, err = pgx.ForEachRow(rows, []any{&vid, &pp.Price, &pp.At}, func() error {
		pp.At = pp.At.UTC()
		for _, i := range pos[vid] {
			lines[i].PriceHistory = append(lines[i].PriceHistory, pp)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("promotions: price history: %w", err)
	}
	return nil
}

func targetsLine(p pricing.Promotion, l pricing.Line) bool {
	if len(p.Targets) == 0 {
		return true
	}
	for _, t := range p.Targets {
		switch {
		case t.Type == "category" && (t.ID == l.CategoryID || (l.ParentCategoryID != 0 && t.ID == l.ParentCategoryID)),
			t.Type == "product" && t.ID == l.ProductID,
			t.Type == "variant" && t.ID == l.VariantID:
			return true
		}
	}
	return false
}

// QuoteInput is the one-call path for cart/orders/preview.
type QuoteInput struct {
	Items           []Item
	CouponCode      string
	BaseShippingFee int64
	Customer        *pricing.Customer // nil = guest
	Now             time.Time
}

// Quote = LoadLines + LoadRuleset + AttachPriceHistory + pricing.Price.
// Call it inside the checkout transaction (after locking the variants) to
// re-price; it reads only.
func Quote(ctx context.Context, q Querier, in QuoteInput) (pricing.Quote, error) {
	return quote(ctx, q, in, loadOpts{})
}

func quote(ctx context.Context, q Querier, in QuoteInput, o loadOpts) (pricing.Quote, error) {
	lines, err := LoadLines(ctx, q, in.Items)
	if err != nil {
		return pricing.Quote{}, err
	}
	cart := pricing.Cart{Lines: lines, CouponCode: in.CouponCode, BaseShippingFee: in.BaseShippingFee}
	rs, pctx, err := loadRuleset(ctx, q, cart, in.Customer, in.Now, o)
	if err != nil {
		return pricing.Quote{}, err
	}
	if err := AttachPriceHistory(ctx, q, cart.Lines, rs); err != nil {
		return pricing.Quote{}, err
	}
	return pricing.Price(cart, rs, pctx)
}

// LoadCustomer reads a user's pricing identity (group, tier). Returns nil for
// unknown/inactive users.
func LoadCustomer(ctx context.Context, q Querier, userID int64) (*pricing.Customer, error) {
	c := &pricing.Customer{ID: userID}
	err := q.QueryRow(ctx, `SELECT coalesce(group_id, 0), tier FROM users WHERE id = $1 AND is_active AND deleted_at IS NULL`, userID).
		Scan(&c.GroupID, &c.Tier)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

func uniq(ids []int64) []int64 {
	s := slices.Clone(ids)
	slices.Sort(s)
	return slices.Compact(s)
}
