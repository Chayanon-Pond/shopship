package promotions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shopship/shop/api/internal/pricing"
)

// SeedDemo inserts the demo promotions for `shopship seed-demo`: Thai
// seasonal campaigns (11.11 running, 12.12 and ปีใหม่ upcoming, สงกรานต์
// expired) with codes, themes and hero banners; an always-on, lowest-priority
// "everyday" campaign advertising the WELCOME100 code;
// trade prices (customer groups "wholesale" 8 % and "reseller" 12 %, quantity
// breaks 5+ = 5 % / 10+ = 10 % on the first two top-level categories);
// member tiers Silver/Gold/Platinum; spend ฿1,500 get ฿150; buy-2-get-1 on a
// category; free shipping over ฿990; a running flash sale and the next one.
//
// Dates are relative to the current time so something is always active.
// Run it AFTER the catalog is seeded (targets/flash items pick existing
// categories and variants; without a catalog those parts are skipped).
// Idempotent: does nothing when the WELCOME100 code already exists.
// Demo users are assigned to groups by api-core via customer_groups.code
// ('wholesale', 'reseller') and users.tier.
//
// The signature matches admin/demo.PromotionsSeeder, so api-core can assign it
// directly: demo.PromotionsSeeder = promotions.SeedDemo. Runs in one transaction.
func SeedDemo(ctx context.Context, db *pgxpool.Pool, now time.Time) error {
	if now.IsZero() {
		now = time.Now()
	}
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		return seedDemoAt(ctx, tx, now.UTC().Truncate(time.Minute))
	})
}

type seedPromo struct {
	name, label, kind  string
	desc               string // customer-facing (shown with advertised codes)
	layer              int
	starts             time.Time
	ends               *time.Time
	priority           int
	exclusive          bool
	pct, buy, get, gpc *int
	amount, min, max   *int64
	usage, perCust     *int
	used               int
	groups             []int64
	tiers              []string
	campaign           *int64
	season             string
	targets            []int64 // category ids
	tiersQty           [][2]int
	codes              []string
}

func ip(v int) *int               { return &v }
func i64(v int64) *int64          { return &v }
func tptr(t time.Time) *time.Time { return &t }

func seedDemoAt(ctx context.Context, q Querier, now time.Time) error {
	var exists bool
	if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM coupon_codes WHERE code = 'WELCOME100')`).Scan(&exists); err != nil {
		return fmt.Errorf("seed: %w", err)
	}
	if exists {
		return nil
	}
	day := 24 * time.Hour

	group := func(code, name, desc string) (int64, error) {
		var id int64
		err := q.QueryRow(ctx, `INSERT INTO customer_groups (code, name, description) VALUES ($1, $2, $3)
			ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`, code, name, desc).Scan(&id)
		return id, err
	}
	wholesale, err := group("wholesale", "ขายส่ง (Wholesale)", "ลูกค้าขายส่ง ลด 8% ทั้งร้าน")
	if err != nil {
		return fmt.Errorf("seed: group: %w", err)
	}
	reseller, err := group("reseller", "ตัวแทน (Reseller)", "ตัวแทนจำหน่าย ลด 12% ทั้งร้าน")
	if err != nil {
		return fmt.Errorf("seed: group: %w", err)
	}

	type camp struct {
		slug, name, tag string
		theme           Theme
		starts, ends    time.Time
		priority        int
		banner          [3]string // title, subtitle, image; empty title = no banner
	}
	camps := []camp{
		{"11-11", "11.11 Big Sale", "11-11", Theme{"#D9480F", "#FFFFFF", "#FFF4E6", "/mock/hero-1111.svg", "11.11"},
			now.Add(-3 * day), now.Add(4 * day), 20, [3]string{"11.11 ลดสูงสุด 50%", "โค้ด 1111SALE ลด 11% + แฟลชเซลทุกวัน", "/mock/hero-1111.svg"}},
		{"12-12", "12.12 Year-End Sale", "12-12", Theme{"#C2255C", "#FFFFFF", "#FFF0F6", "/mock/hero-1111.svg", "12.12"},
			now.Add(20 * day), now.Add(27 * day), 20, [3]string{"12.12 ส่งท้ายปี", "โค้ด SALE1212 ลด 12%", "/mock/hero-1111.svg"}},
		{"new-year", "ปีใหม่ (New Year)", "new-year", Theme{"#8F5E00", "#FFFFFF", "#FFF9DB", "/mock/hero-1111.svg", "ปีใหม่"},
			now.Add(40 * day), now.Add(50 * day), 10, [3]string{"สวัสดีปีใหม่ รับส่วนลด ฿200", "โค้ด NEWYEAR เมื่อช้อปครบ ฿2,000", "/mock/hero-1111.svg"}},
		{"songkran", "สงกรานต์ (Songkran)", "songkran", Theme{"#0B7285", "#FFFFFF", "#E3FAFC", "/mock/hero-songkran.svg", "สงกรานต์"},
			now.Add(-220 * day), now.Add(-213 * day), 10, [3]string{"สงกรานต์ คลายร้อน", "โค้ด SONGKRAN ลด ฿100", "/mock/hero-songkran.svg"}},
		// always-on fallback: active whenever no seasonal campaign runs (lowest priority); advertises WELCOME100
		{"everyday", "ช้อปทุกวันกับ ShopShip", "", Theme{"#0071E3", "#FFFFFF", "#FFFFFF", "", "ShopShip"},
			now.Add(-60 * day), now.Add(365 * day), 0, [3]string{}},
	}
	campID := map[string]int64{}
	for i, cp := range camps {
		theme, _ := json.Marshal(cp.theme)
		var id int64
		if err := q.QueryRow(ctx, `INSERT INTO campaigns (slug, name, season_tag, theme, starts_at, ends_at, priority)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, theme = EXCLUDED.theme, starts_at = EXCLUDED.starts_at,
			  ends_at = EXCLUDED.ends_at, priority = EXCLUDED.priority RETURNING id`,
			cp.slug, cp.name, cp.tag, theme, cp.starts, cp.ends, cp.priority).Scan(&id); err != nil {
			return fmt.Errorf("seed: campaign %s: %w", cp.slug, err)
		}
		campID[cp.slug] = id
		if cp.banner[0] == "" {
			continue
		}
		link := "/flash-sale"
		if i > 0 {
			link = "/search"
		}
		if _, err := q.Exec(ctx, `INSERT INTO banners (placement, title, subtitle, cta_label, link_url, image_url, image_alt, campaign_id, sort_order)
			VALUES ('home_hero', $1, $2, 'ช้อปเลย', $3, $4, $5, $6, $7)`,
			cp.banner[0], cp.banner[1], link, cp.banner[2], "แคมเปญ "+cp.name, id, i); err != nil {
			return fmt.Errorf("seed: banner %s: %w", cp.slug, err)
		}
	}

	// Catalog-dependent targets: preferred slugs from the demo catalog, else
	// the first top-level categories.
	pick := func(prefs []string, n int) ([]int64, error) {
		var ids []int64
		for _, slug := range prefs {
			var id int64
			err := q.QueryRow(ctx, `SELECT id FROM categories WHERE slug = $1 AND is_active`, slug).Scan(&id)
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			if err != nil {
				return nil, err
			}
			if ids = append(ids, id); len(ids) == n {
				return ids, nil
			}
		}
		if len(ids) > 0 {
			return ids, nil
		}
		rows, err := q.Query(ctx, `SELECT id FROM categories WHERE parent_id IS NULL AND is_active ORDER BY sort_order, id LIMIT $1`, n)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(rows, pgx.RowTo[int64])
	}
	qbCats, err := pick([]string{"bags", "tshirts"}, 2)
	if err != nil {
		return fmt.Errorf("seed: categories: %w", err)
	}
	bx, err := pick([]string{"socks", "snacks", "pens", "notebooks"}, 1)
	if err != nil {
		return fmt.Errorf("seed: categories: %w", err)
	}
	var bxgyCat int64
	if len(bx) > 0 {
		bxgyCat = bx[0]
	}

	always := now.Add(-60 * day)
	c1111, c1212, cny, csk, cday := campID["11-11"], campID["12-12"], campID["new-year"], campID["songkran"], campID["everyday"]
	promos := []seedPromo{
		// layer 1: trade + member prices (lowest wins, never stacked)
		{name: "ราคาส่งตามจำนวน", label: "ราคาส่ง: 5 ชิ้น ลด 5% · 10 ชิ้น ลด 10%", kind: "quantity_break", layer: 1, starts: always,
			targets: qbCats, tiersQty: [][2]int{{5, 500}, {10, 1000}}},
		{name: "ขายส่ง ลด 8%", label: "ราคาขายส่ง ลด 8%", kind: "group_price", layer: 1, starts: always, pct: ip(800), groups: []int64{wholesale}},
		{name: "ตัวแทน ลด 12%", label: "ราคาตัวแทน ลด 12%", kind: "group_price", layer: 1, starts: always, pct: ip(1200), groups: []int64{reseller}},
		{name: "สมาชิก Silver 3%", label: "สมาชิก Silver ลด 3%", kind: "tier_price", layer: 1, starts: always, pct: ip(300), tiers: []string{"silver"}},
		{name: "สมาชิก Gold 5%", label: "สมาชิก Gold ลด 5%", kind: "tier_price", layer: 1, starts: always, pct: ip(500), tiers: []string{"gold"}},
		{name: "สมาชิก Platinum 8%", label: "สมาชิก Platinum ลด 8%", kind: "tier_price", layer: 1, starts: always, pct: ip(800), tiers: []string{"platinum"}},
		// layer 3 / 5: automatic cart + shipping
		{name: "ครบ 1500 ลด 150", label: "ช้อปครบ ฿1,500 ลด ฿150", kind: "cart_amount", layer: 3, starts: always, amount: i64(15000), min: i64(150000)},
		{name: "ส่งฟรี 990", label: "ส่งฟรีเมื่อช้อปครบ ฿990", kind: "free_shipping", layer: 5, starts: always, min: i64(99000)},
		// layer 4: codes
		{name: "โค้ดต้อนรับ", label: "โค้ด WELCOME100 ลด ฿100", desc: "สมาชิกใหม่ ลด ฿100 เมื่อช้อปครบ ฿500 (1 สิทธิ์/บัญชี)",
			kind: "cart_amount", layer: 4, starts: always, amount: i64(10000), min: i64(50000), perCust: ip(1), campaign: &cday,
			codes: []string{"WELCOME100"}},
		{name: "11.11 ลด 11%", label: "โค้ด 1111SALE ลด 11%", desc: "ลด 11% สูงสุด ฿300 เมื่อช้อปครบ ฿1,111 ใช้ร่วมกับโปรช้อปครบไม่ได้ (1 สิทธิ์/บัญชี)",
			kind: "cart_percent", layer: 4, starts: camps[0].starts, ends: tptr(camps[0].ends),
			exclusive: true, pct: ip(1100), max: i64(30000), min: i64(111100), usage: ip(1111), perCust: ip(1), campaign: &c1111, season: "11-11",
			codes: []string{"1111SALE"}},
		{name: "11.11 ส่งฟรี", label: "โค้ดส่งฟรี 11.11", desc: "ส่งฟรีเมื่อช้อปครบ ฿300 ตลอดแคมเปญ 11.11",
			kind: "free_shipping", layer: 4, starts: camps[0].starts, ends: tptr(camps[0].ends),
			min: i64(30000), campaign: &c1111, season: "11-11", codes: []string{"FREESHIP11"}},
		{name: "12.12 ลด 12%", label: "โค้ด SALE1212 ลด 12%", desc: "ลด 12% สูงสุด ฿500 เมื่อช้อปครบ ฿1,212 (1 สิทธิ์/บัญชี)",
			kind: "cart_percent", layer: 4, starts: camps[1].starts, ends: tptr(camps[1].ends),
			pct: ip(1200), max: i64(50000), min: i64(121200), usage: ip(1212), perCust: ip(1), campaign: &c1212, season: "12-12",
			codes: []string{"SALE1212"}},
		{name: "ปีใหม่ ลด 200", label: "โค้ดปีใหม่ ลด ฿200", desc: "ลด ฿200 เมื่อช้อปครบ ฿2,000 (1 สิทธิ์/บัญชี)",
			kind: "cart_amount", layer: 4, starts: camps[2].starts, ends: tptr(camps[2].ends),
			amount: i64(20000), min: i64(200000), perCust: ip(1), campaign: &cny, season: "new-year", codes: []string{"NEWYEAR"}},
		{name: "สงกรานต์ ลด 100", label: "โค้ดสงกรานต์ ลด ฿100", desc: "ลด ฿100 เมื่อช้อปครบ ฿500",
			kind: "cart_amount", layer: 4, starts: camps[3].starts, ends: tptr(camps[3].ends),
			amount: i64(10000), min: i64(50000), usage: ip(500), used: 500, campaign: &csk, season: "songkran", codes: []string{"SONGKRAN"}},
	}
	if bxgyCat != 0 {
		promos = append(promos, seedPromo{name: "ซื้อ 2 แถม 1", label: "ซื้อ 2 แถม 1", kind: "buy_x_get_y", layer: 2, starts: always,
			buy: ip(2), get: ip(1), gpc: ip(10000), targets: []int64{bxgyCat}})
	}
	for _, p := range promos {
		auto := p.layer != 4
		minSpend := int64(0)
		if p.min != nil {
			minSpend = *p.min
		}
		if p.groups == nil {
			p.groups = []int64{}
		}
		if p.tiers == nil {
			p.tiers = []string{}
		}
		var id int64
		if err := q.QueryRow(ctx, `INSERT INTO promotions (name, label, description, kind, layer, status, starts_at, ends_at, priority,
			exclusive, auto_apply, percent_bp, amount_satang, buy_qty, get_qty, get_percent_bp, min_spend_satang, max_discount_satang,
			usage_limit, per_customer_limit, used_count, customer_group_ids, tiers, campaign_id, season_tag)
			VALUES ($1, $2, $24, $3, $4, 'active', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
			RETURNING id`, p.name, p.label, p.kind, p.layer, p.starts, p.ends, p.priority, p.exclusive, auto, p.pct, p.amount,
			p.buy, p.get, p.gpc, minSpend, p.max, p.usage, p.perCust, p.used, p.groups, p.tiers, p.campaign, p.season, p.desc).Scan(&id); err != nil {
			return fmt.Errorf("seed: promotion %s: %w", p.name, err)
		}
		for _, c := range p.targets {
			if _, err := q.Exec(ctx, `INSERT INTO promotion_targets (promotion_id, target_type, category_id) VALUES ($1, 'category', $2)`, id, c); err != nil {
				return fmt.Errorf("seed: target: %w", err)
			}
		}
		for _, t := range p.tiersQty {
			if _, err := q.Exec(ctx, `INSERT INTO promotion_qty_tiers (promotion_id, min_qty, percent_bp) VALUES ($1, $2, $3)`, id, t[0], t[1]); err != nil {
				return fmt.Errorf("seed: qty tier: %w", err)
			}
		}
		for _, c := range p.codes {
			if _, err := q.Exec(ctx, `INSERT INTO coupon_codes (promotion_id, code) VALUES ($1, $2)`, id, c); err != nil {
				return fmt.Errorf("seed: code %s: %w", c, err)
			}
		}
	}

	// Flash sales: the 4 best-selling active variants, running now (30 % off)
	// and in the upcoming 12.12 sale (40 % off).
	rows, err := q.Query(ctx, `SELECT v.id, v.price_satang FROM product_variants v JOIN products p ON p.id = v.product_id
		WHERE v.is_active AND p.status = 'active' AND p.deleted_at IS NULL AND v.price_satang >= 100
		ORDER BY p.sold_count DESC, v.id LIMIT 4`)
	if err != nil {
		return fmt.Errorf("seed: flash variants: %w", err)
	}
	type variant struct {
		ID, Price int64
	}
	vs, err := pgx.CollectRows(rows, pgx.RowToStructByPos[variant])
	if err != nil {
		return fmt.Errorf("seed: flash variants: %w", err)
	}
	if len(vs) == 0 {
		return nil
	}
	sales := []struct {
		name, label  string
		starts, ends time.Time
		campaign     int64
		bp           int
	}{
		{"Flash Sale 11.11", "Flash Sale 11.11", now.Add(-time.Hour), now.Add(11 * time.Hour), c1111, 3000},
		{"Flash Sale 12.12", "Flash Sale 12.12", camps[1].starts.Add(3 * time.Hour), camps[1].starts.Add(15 * time.Hour), c1212, 4000},
	}
	for _, s := range sales {
		var sid int64
		if err := q.QueryRow(ctx, `INSERT INTO flash_sales (name, label, status, starts_at, ends_at, campaign_id)
			VALUES ($1, $2, 'active', $3, $4, $5) RETURNING id`, s.name, s.label, s.starts, s.ends, s.campaign).Scan(&sid); err != nil {
			return fmt.Errorf("seed: flash sale: %w", err)
		}
		for i, v := range vs {
			sale := pricing.PercentPrice(v.Price, s.bp)
			if sale <= 0 || sale >= v.Price {
				continue
			}
			if _, err := q.Exec(ctx, `INSERT INTO flash_sale_items (flash_sale_id, variant_id, sale_price_satang, qty_limit, per_customer_limit, sort_order)
				VALUES ($1, $2, $3, 50, 2, $4)`, sid, v.ID, sale, i); err != nil {
				return fmt.Errorf("seed: flash item: %w", err)
			}
		}
	}
	return nil
}
