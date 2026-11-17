package promotions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/pricing"
)

// ---------- shapes (docs/API.md §2, §10) ----------

type Theme struct {
	Accent         string `json:"accent"`
	AccentContrast string `json:"accent_contrast"`
	Background     string `json:"background"`
	HeroImageURL   string `json:"hero_image_url"`
	BadgeText      string `json:"badge_text"`
}

type Banner struct {
	ID             int64  `json:"id"`
	Placement      string `json:"placement"`
	Title          string `json:"title"`
	Subtitle       string `json:"subtitle"`
	CTALabel       string `json:"cta_label"`
	LinkURL        string `json:"link_url"`
	ImageURL       string `json:"image_url"`
	ImageMobileURL string `json:"image_mobile_url"`
	ImageAlt       string `json:"image_alt"`
	CampaignID     *int64 `json:"campaign_id"`
}

type Campaign struct {
	ID        int64     `json:"id"`
	Slug      string    `json:"slug"`
	Name      string    `json:"name"`
	SeasonTag string    `json:"season_tag"`
	Theme     Theme     `json:"theme"`
	StartsAt  time.Time `json:"starts_at"`
	EndsAt    time.Time `json:"ends_at"`
	Banners   []Banner  `json:"banners"`
	// PromoCodes: advertised public codes of this campaign (additive, Wave 1; omitted when none).
	PromoCodes []PromoCode `json:"promo_codes,omitempty"`
}

// PromoCode is one advertised coupon code (docs/API.md §10).
type PromoCode struct {
	Code        string     `json:"code"`
	Label       string     `json:"label"`
	Description string     `json:"description"`
	EndsAt      *time.Time `json:"ends_at"`
}

// CampaignCodes lists the codes a campaign advertises. There is no
// "advertise" column; a code is public when derived as: a layer-4 promotion of
// this campaign, status active, not ended (running or upcoming), usage not
// exhausted, no group/tier audience, and exactly ONE active code (promotions
// with generated batches of codes are private single-use codes). Ordered
// priority desc, id asc.
func CampaignCodes(ctx context.Context, q Querier, campaignID int64, now time.Time) ([]PromoCode, error) {
	rows, err := q.Query(ctx, `
		SELECT min(cc.code), p.label, p.description, p.ends_at
		  FROM promotions p JOIN coupon_codes cc ON cc.promotion_id = p.id AND cc.is_active
		 WHERE p.campaign_id = $1 AND p.layer = 4 AND p.status = 'active'
		   AND (p.ends_at IS NULL OR p.ends_at > $2)
		   AND (p.usage_limit IS NULL OR p.used_count < p.usage_limit)
		   AND cardinality(p.customer_group_ids) = 0 AND cardinality(p.tiers) = 0
		 GROUP BY p.id
		HAVING count(*) = 1
		 ORDER BY p.priority DESC, p.id`, campaignID, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PromoCode, error) {
		var pc PromoCode
		err := r.Scan(&pc.Code, &pc.Label, &pc.Description, &pc.EndsAt)
		if pc.EndsAt != nil {
			e := pc.EndsAt.UTC()
			pc.EndsAt = &e
		}
		return pc, err
	})
}

type Image struct {
	ID     int64  `json:"id"`
	URL    string `json:"url"`
	Alt    string `json:"alt"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type FlashBadge struct {
	FlashSaleID     int64     `json:"flash_sale_id"`
	SalePriceSatang int64     `json:"sale_price_satang"`
	ListPriceSatang int64     `json:"list_price_satang"`
	EndsAt          time.Time `json:"ends_at"`
	RemainingQty    int       `json:"remaining_qty"`
	Lowest30dSatang *int64    `json:"lowest_30d_satang"`
}

type ProductCard struct {
	ID             int64       `json:"id"`
	Slug           string      `json:"slug"`
	Name           string      `json:"name"`
	Subtitle       string      `json:"subtitle"`
	Brand          string      `json:"brand"`
	Image          *Image      `json:"image"`
	MinPriceSatang int64       `json:"min_price_satang"`
	MaxPriceSatang int64       `json:"max_price_satang"`
	Flash          *FlashBadge `json:"flash"`
	RatingAvg      float64     `json:"rating_avg"`
	RatingCount    int         `json:"rating_count"`
	SoldCount      int         `json:"sold_count"`
	InStock        bool        `json:"in_stock"`
	Badges         []string    `json:"badges"`
}

type FlashSaleItem struct {
	FlashSaleItemID  int64       `json:"flash_sale_item_id"`
	Product          ProductCard `json:"product"`
	VariantID        int64       `json:"variant_id"`
	VariantName      string      `json:"variant_name"`
	SalePriceSatang  int64       `json:"sale_price_satang"`
	ListPriceSatang  int64       `json:"list_price_satang"`
	Lowest30dSatang  *int64      `json:"lowest_30d_satang"`
	QtyLimit         int         `json:"qty_limit"`
	SoldQty          int         `json:"sold_qty"`
	RemainingQty     int         `json:"remaining_qty"`
	PerCustomerLimit *int        `json:"per_customer_limit"`
}

type FlashSale struct {
	ID       int64           `json:"id"`
	Label    string          `json:"label"`
	StartsAt time.Time       `json:"starts_at"`
	EndsAt   time.Time       `json:"ends_at"`
	Items    []FlashSaleItem `json:"items"`
}

type QtyBreak struct {
	MinQty          int   `json:"min_qty"`
	UnitPriceSatang int64 `json:"unit_price_satang"`
}

type Offer struct {
	VariantID       int64      `json:"variant_id"`
	ListPriceSatang int64      `json:"list_price_satang"`
	PriceSatang     int64      `json:"price_satang"`
	PriceSource     offerSrc   `json:"price_source"`
	Lowest30dSatang *int64     `json:"lowest_30d_satang"`
	QtyBreaks       []QtyBreak `json:"qty_breaks"`
	Badges          []string   `json:"badges"`
}

type offerSrc struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
}

// ---------- GET /campaigns/active ----------

// ActiveCampaign returns the highest-priority active campaign at now (nil if none).
func ActiveCampaign(ctx context.Context, q Querier, now time.Time) (*Campaign, error) {
	var cp Campaign
	var theme []byte
	err := q.QueryRow(ctx, `SELECT id, slug, name, season_tag, theme, starts_at, ends_at FROM campaigns
		WHERE is_active AND starts_at <= $1 AND ends_at > $1 ORDER BY priority DESC, id LIMIT 1`, now).
		Scan(&cp.ID, &cp.Slug, &cp.Name, &cp.SeasonTag, &theme, &cp.StartsAt, &cp.EndsAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(theme, &cp.Theme)
	cp.StartsAt, cp.EndsAt = cp.StartsAt.UTC(), cp.EndsAt.UTC()
	cp.Banners, err = loadBanners(ctx, q, now, "b.campaign_id = $2", cp.ID)
	if err != nil {
		return nil, err
	}
	if cp.PromoCodes, err = CampaignCodes(ctx, q, cp.ID, now); err != nil {
		return nil, err
	}
	return &cp, nil
}

func (h *handlers) campaignActive(c *gin.Context) {
	if !h.needDB(c) {
		return
	}
	cp, err := ActiveCampaign(c.Request.Context(), h.d.DB, h.d.Now())
	if err != nil {
		h.dbError(c, err)
		return
	}
	c.Header("Cache-Control", cachePublic)
	httpx.Data(c, http.StatusOK, cp)
}

// ---------- GET /banners ----------

func loadBanners(ctx context.Context, q Querier, now time.Time, cond string, args ...any) ([]Banner, error) {
	rows, err := q.Query(ctx, `
		SELECT b.id, b.placement, b.title, b.subtitle, b.cta_label, b.link_url, b.image_url, b.image_mobile_url, b.image_alt, b.campaign_id
		  FROM banners b LEFT JOIN campaigns cp ON cp.id = b.campaign_id
		 WHERE b.is_active AND (b.starts_at IS NULL OR b.starts_at <= $1) AND (b.ends_at IS NULL OR b.ends_at > $1)
		   AND (b.campaign_id IS NULL OR (cp.is_active AND cp.starts_at <= $1 AND cp.ends_at > $1))
		   AND `+cond+`
		 ORDER BY b.sort_order, b.id`, append([]any{now}, args...)...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Banner, error) {
		var b Banner
		err := r.Scan(&b.ID, &b.Placement, &b.Title, &b.Subtitle, &b.CTALabel, &b.LinkURL, &b.ImageURL, &b.ImageMobileURL, &b.ImageAlt, &b.CampaignID)
		return b, err
	})
	if out == nil {
		out = []Banner{}
	}
	return out, err
}

func (h *handlers) banners(c *gin.Context) {
	if !h.needDB(c) {
		return
	}
	placement := c.Query("placement")
	if placement != "" && placement != "home_hero" && placement != "home_strip" && placement != "category_top" {
		httpx.Error(c, http.StatusBadRequest, httpx.CodeBadRequest, "placement ไม่ถูกต้อง", nil)
		return
	}
	cond := "($2 = '' OR b.placement = $2)"
	args := []any{placement}
	if slug := c.Query("category"); slug != "" {
		cond += " AND b.category_id = (SELECT id FROM categories WHERE slug = $3)"
		args = append(args, slug)
	} else {
		cond += " AND b.category_id IS NULL"
	}
	out, err := loadBanners(c.Request.Context(), h.d.DB, h.d.Now(), cond, args...)
	if err != nil {
		h.dbError(c, err)
		return
	}
	c.Header("Cache-Control", cachePublic)
	httpx.Data(c, http.StatusOK, out)
}

// ---------- GET /flash-sales/current ----------

// CurrentFlashSales returns the running sale (soonest ending) and the next one.
func CurrentFlashSales(ctx context.Context, q Querier, now time.Time) (cur, next *FlashSale, err error) {
	load := func(cond string) (*FlashSale, error) {
		var fs FlashSale
		err := q.QueryRow(ctx, `SELECT id, label, starts_at, ends_at FROM flash_sales WHERE status = 'active' AND `+cond, now).
			Scan(&fs.ID, &fs.Label, &fs.StartsAt, &fs.EndsAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		fs.StartsAt, fs.EndsAt = fs.StartsAt.UTC(), fs.EndsAt.UTC()
		return &fs, nil
	}
	if cur, err = load("starts_at <= $1 AND ends_at > $1 ORDER BY ends_at, id LIMIT 1"); err != nil {
		return nil, nil, err
	}
	if next, err = load("starts_at > $1 ORDER BY starts_at, id LIMIT 1"); err != nil {
		return nil, nil, err
	}
	for _, fs := range []*FlashSale{cur, next} {
		if fs == nil {
			continue
		}
		if fs.Items, err = flashSaleItems(ctx, q, fs, now, fs == next); err != nil {
			return nil, nil, err
		}
	}
	return cur, next, nil
}

func flashSaleItems(ctx context.Context, q Querier, fs *FlashSale, now time.Time, upcoming bool) ([]FlashSaleItem, error) {
	rows, err := q.Query(ctx, `
		SELECT fi.id, v.product_id, v.id, v.name, fi.sale_price_satang, v.price_satang,
		       variant_lowest_price_30d(v.id, $2), fi.qty_limit, fi.sold_qty, fi.per_customer_limit
		  FROM flash_sale_items fi
		  JOIN product_variants v ON v.id = fi.variant_id
		  JOIN products p ON p.id = v.product_id
		 WHERE fi.flash_sale_id = $1 AND v.is_active AND p.status = 'active' AND p.deleted_at IS NULL
		 ORDER BY fi.sort_order, fi.id`, fs.ID, fs.StartsAt)
	if err != nil {
		return nil, err
	}
	var items []FlashSaleItem
	var pids []int64
	for rows.Next() {
		var it FlashSaleItem
		var pid int64
		if err := rows.Scan(&it.FlashSaleItemID, &pid, &it.VariantID, &it.VariantName, &it.SalePriceSatang, &it.ListPriceSatang,
			&it.Lowest30dSatang, &it.QtyLimit, &it.SoldQty, &it.PerCustomerLimit); err != nil {
			rows.Close()
			return nil, err
		}
		if upcoming {
			it.SoldQty = 0
		}
		it.RemainingQty = max(it.QtyLimit-it.SoldQty, 0)
		it.Product.ID = pid
		items = append(items, it)
		pids = append(pids, pid)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	cards, err := ProductCards(ctx, q, pids, now)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i].Product = cards[items[i].Product.ID]
	}
	if items == nil {
		items = []FlashSaleItem{}
	}
	return items, nil
}

func (h *handlers) flashSalesCurrent(c *gin.Context) {
	if !h.needDB(c) {
		return
	}
	cur, next, err := CurrentFlashSales(c.Request.Context(), h.d.DB, h.d.Now())
	if err != nil {
		h.dbError(c, err)
		return
	}
	c.Header("Cache-Control", cachePublic)
	httpx.Data(c, http.StatusOK, gin.H{"current": cur, "next": next})
}

// ---------- product cards / badges (exported for catalog) ----------

// ProductCards builds ProductCards (public list price, public flash badge,
// promotion badges) for the given product ids.
func ProductCards(ctx context.Context, q Querier, productIDs []int64, now time.Time) (map[int64]ProductCard, error) {
	out := map[int64]ProductCard{}
	ids := uniq(productIDs)
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `
		SELECT p.id, p.slug, p.name, p.subtitle, p.brand, p.min_price_satang, p.max_price_satang,
		       p.rating_avg::float8, p.rating_count, p.sold_count,
		       EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.stock > 0),
		       img.id, img.url, img.alt, img.width, img.height
		  FROM products p
		  LEFT JOIN LATERAL (SELECT id, url, alt, width, height FROM product_images
		                      WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) img ON true
		 WHERE p.id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var pc ProductCard
		var imgID *int64
		var url, alt *string
		var w, hgt *int
		if err := rows.Scan(&pc.ID, &pc.Slug, &pc.Name, &pc.Subtitle, &pc.Brand, &pc.MinPriceSatang, &pc.MaxPriceSatang,
			&pc.RatingAvg, &pc.RatingCount, &pc.SoldCount, &pc.InStock, &imgID, &url, &alt, &w, &hgt); err != nil {
			rows.Close()
			return nil, err
		}
		if imgID != nil {
			pc.Image = &Image{ID: *imgID, URL: *url, Alt: *alt, Width: *w, Height: *hgt}
		}
		pc.Badges = []string{}
		out[pc.ID] = pc
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	flash, err := FlashBadges(ctx, q, ids, now)
	if err != nil {
		return nil, err
	}
	badges, err := ProductBadges(ctx, q, ids, now)
	if err != nil {
		return nil, err
	}
	for id, pc := range out {
		if f, ok := flash[id]; ok {
			pc.Flash = &f
		}
		if b := badges[id]; len(b) > 0 {
			pc.Badges = b
		}
		out[id] = pc
	}
	return out, nil
}

// FlashBadges: the public flash price per product (cheapest running flash
// item among its active variants), same for everyone.
func FlashBadges(ctx context.Context, q Querier, productIDs []int64, now time.Time) (map[int64]FlashBadge, error) {
	rows, err := q.Query(ctx, `
		SELECT DISTINCT ON (v.product_id) v.product_id, fs.id, fi.sale_price_satang, v.price_satang, fs.ends_at,
		       greatest(fi.qty_limit - fi.sold_qty, 0), variant_lowest_price_30d(v.id, fs.starts_at)
		  FROM flash_sale_items fi
		  JOIN flash_sales fs ON fs.id = fi.flash_sale_id
		  JOIN product_variants v ON v.id = fi.variant_id
		 WHERE fs.status = 'active' AND fs.starts_at <= $2 AND fs.ends_at > $2 AND v.is_active
		   AND v.product_id = ANY($1) AND fi.sold_qty < fi.qty_limit
		 ORDER BY v.product_id, fi.sale_price_satang, fi.id`, productIDs, now)
	if err != nil {
		return nil, err
	}
	out := map[int64]FlashBadge{}
	for rows.Next() {
		var pid int64
		var f FlashBadge
		if err := rows.Scan(&pid, &f.FlashSaleID, &f.SalePriceSatang, &f.ListPriceSatang, &f.EndsAt, &f.RemainingQty, &f.Lowest30dSatang); err != nil {
			rows.Close()
			return nil, err
		}
		f.EndsAt = f.EndsAt.UTC()
		out[pid] = f
	}
	return out, rows.Err()
}

// ProductBadges: customer-facing labels of automatic promotions that
// anyone can get on the product (layer-2 buy-X-get-Y, and quantity breaks as
// "ราคาส่งเมื่อซื้อ N ชิ้นขึ้นไป"), ordered priority desc, id asc.
func ProductBadges(ctx context.Context, q Querier, productIDs []int64, now time.Time) (map[int64][]string, error) {
	out := map[int64][]string{}
	if len(productIDs) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `
		WITH prod AS (
		    SELECT p.id, p.category_id, c.parent_id FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ANY($1)
		), promo AS (
		    SELECT pr.id, pr.kind, pr.label, pr.priority,
		           (SELECT min(min_qty) FROM promotion_qty_tiers t WHERE t.promotion_id = pr.id) AS min_qty
		      FROM promotions pr
		     WHERE pr.status = 'active' AND pr.auto_apply AND pr.starts_at <= $2 AND (pr.ends_at IS NULL OR pr.ends_at > $2)
		       AND (pr.usage_limit IS NULL OR pr.used_count < pr.usage_limit)
		       AND pr.kind IN ('buy_x_get_y', 'quantity_break') AND pr.per_customer_limit IS NULL
		       AND cardinality(pr.tiers) = 0 AND cardinality(pr.customer_group_ids) = 0
		)
		SELECT prod.id, promo.kind, promo.label, coalesce(promo.min_qty, 0)
		  FROM prod CROSS JOIN promo
		 WHERE NOT EXISTS (SELECT 1 FROM promotion_targets t WHERE t.promotion_id = promo.id)
		    OR EXISTS (SELECT 1 FROM promotion_targets t WHERE t.promotion_id = promo.id AND (
		           (t.target_type = 'product' AND t.product_id = prod.id)
		        OR (t.target_type = 'category' AND t.category_id IN (prod.category_id, prod.parent_id))
		        OR (t.target_type = 'variant' AND t.variant_id IN (SELECT id FROM product_variants WHERE product_id = prod.id))))
		 ORDER BY prod.id, promo.priority DESC, promo.id`, productIDs, now)
	if err != nil {
		return nil, err
	}
	var pid int64
	var kind, label string
	var minQty int
	_, err = pgx.ForEachRow(rows, []any{&pid, &kind, &label, &minQty}, func() error {
		b := label
		if kind == string(pricing.KindQuantityBreak) {
			b = "ราคาส่งเมื่อซื้อ " + strconv.Itoa(minQty) + " ชิ้นขึ้นไป"
		}
		if !slices.Contains(out[pid], b) {
			out[pid] = append(out[pid], b)
		}
		return nil
	})
	return out, err
}

// ---------- GET /offers ----------

func customerFrom(c *gin.Context) *pricing.Customer {
	u, ok := auth.UserFrom(c)
	if !ok {
		return nil
	}
	return &pricing.Customer{ID: u.ID, GroupID: u.GroupID, Tier: u.Tier}
}

// Offers prices each variant at qty 1 for this customer (member/trade/flash)
// and lists the quantity breaks they can unlock.
func Offers(ctx context.Context, q Querier, variantIDs []int64, customer *pricing.Customer, now time.Time) ([]Offer, error) {
	items := make([]Item, 0, len(variantIDs))
	for _, id := range variantIDs {
		items = append(items, Item{VariantID: id, Qty: 1})
	}
	lines, err := LoadLines(ctx, q, items)
	if err != nil {
		return nil, err
	}
	rs, pctx, err := LoadRuleset(ctx, q, pricing.Cart{Lines: lines}, customer, now)
	if err != nil {
		return nil, err
	}
	if err := AttachPriceHistory(ctx, q, lines, rs); err != nil {
		return nil, err
	}
	badges, err := variantBadges(ctx, q, lines, now)
	if err != nil {
		return nil, err
	}
	out := []Offer{}
	for _, l := range lines {
		if l.ProductID == 0 { // unknown variant
			continue
		}
		qt, err := pricing.Price(pricing.Cart{Lines: []pricing.Line{l}}, rs, pctx)
		if err != nil {
			return nil, err
		}
		ql := qt.Lines[0]
		o := Offer{VariantID: l.VariantID, ListPriceSatang: l.ListUnitPrice, PriceSatang: ql.UnitPriceSatang,
			PriceSource: offerSrc{ql.PriceSource.Kind, ql.PriceSource.Label}, Lowest30dSatang: ql.Lowest30dSatang,
			QtyBreaks: qtyBreaks(l, rs, customer, now, ql.UnitPriceSatang), Badges: badges[l.ProductID]}
		if o.Badges == nil {
			o.Badges = []string{}
		}
		out = append(out, o)
	}
	return out, nil
}

func variantBadges(ctx context.Context, q Querier, lines []pricing.Line, now time.Time) (map[int64][]string, error) {
	pids := make([]int64, 0, len(lines))
	for _, l := range lines {
		if l.ProductID != 0 {
			pids = append(pids, l.ProductID)
		}
	}
	return ProductBadges(ctx, q, uniq(pids), now)
}

// qtyBreaks: tiers of quantity-break promotions this customer could unlock
// (guests see the ones without a group audience), cheaper than price1.
func qtyBreaks(l pricing.Line, rs pricing.Ruleset, c *pricing.Customer, now time.Time, price1 int64) []QtyBreak {
	best := map[int]int64{}
	for _, p := range rs.Promotions {
		if p.Kind != pricing.KindQuantityBreak || p.Status != "active" || now.Before(p.StartsAt) || (p.EndsAt != nil && !now.Before(*p.EndsAt)) {
			continue
		}
		if !targetsLine(p, l) {
			continue
		}
		if len(p.CustomerGroupIDs) > 0 && (c == nil || !slices.Contains(p.CustomerGroupIDs, c.GroupID)) {
			continue
		}
		if len(p.Tiers) > 0 && (c == nil || !slices.Contains(p.Tiers, c.Tier)) {
			continue
		}
		for _, t := range p.QtyTiers {
			price := t.UnitPriceSatang
			if price <= 0 {
				price = pricing.PercentPrice(l.ListUnitPrice, t.PercentBP)
			}
			if price >= price1 {
				continue
			}
			if cur, ok := best[t.MinQty]; !ok || price < cur {
				best[t.MinQty] = price
			}
		}
	}
	out := []QtyBreak{}
	for q, p := range best {
		out = append(out, QtyBreak{MinQty: q, UnitPriceSatang: p})
	}
	slices.SortFunc(out, func(a, b QtyBreak) int { return a.MinQty - b.MinQty })
	return out
}

func (h *handlers) offers(c *gin.Context) {
	c.Header("Cache-Control", cacheNone)
	if !h.needDB(c) {
		return
	}
	raw := strings.TrimSpace(c.Query("variant_ids"))
	if raw == "" {
		httpx.Error(c, http.StatusBadRequest, httpx.CodeBadRequest, "ต้องระบุ variant_ids", nil)
		return
	}
	parts := strings.Split(raw, ",")
	if len(parts) > 100 {
		httpx.Error(c, http.StatusBadRequest, httpx.CodeBadRequest, "ระบุได้ไม่เกิน 100 รายการ", nil)
		return
	}
	var ids []int64
	for _, p := range parts {
		id, err := strconv.ParseInt(strings.TrimSpace(p), 10, 64)
		if err != nil || id <= 0 {
			httpx.Error(c, http.StatusBadRequest, httpx.CodeBadRequest, "variant_ids ไม่ถูกต้อง", nil)
			return
		}
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	out, err := Offers(c.Request.Context(), h.d.DB, ids, customerFrom(c), h.d.Now())
	if err != nil {
		h.dbError(c, err)
		return
	}
	httpx.Data(c, http.StatusOK, out)
}
