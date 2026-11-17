package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
)

type public struct{ d *platform.Deps }

// Category is the public tree node.
type Category struct {
	ID           int64         `json:"id"`
	Slug         string        `json:"slug"`
	Name         string        `json:"name"`
	Description  string        `json:"description"`
	ImageURL     string        `json:"image_url"`
	Icon         string        `json:"icon"`
	ParentID     *int64        `json:"parent_id"`
	SortOrder    int           `json:"sort_order"`
	ProductCount int           `json:"product_count"`
	Children     []*Category   `json:"children"`
	Breadcrumbs  []CategoryRef `json:"breadcrumbs,omitempty"`
}

// loadTree returns active top-level categories with children and counts
// (a parent's count includes its children's products).
func loadTree(ctx context.Context, q httpx.Querier) ([]*Category, map[string]*Category, error) {
	rows, err := q.Query(ctx, `SELECT c.id, c.slug, c.name, c.description, c.image_url, c.icon, c.parent_id, c.sort_order,
			(SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.status = 'active' AND p.deleted_at IS NULL)::int
		FROM categories c WHERE c.is_active ORDER BY c.parent_id NULLS FIRST, c.sort_order, c.id`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	byID := map[int64]*Category{}
	bySlug := map[string]*Category{}
	var top []*Category
	var all []*Category
	for rows.Next() {
		c := &Category{Children: []*Category{}}
		if err := rows.Scan(&c.ID, &c.Slug, &c.Name, &c.Description, &c.ImageURL, &c.Icon, &c.ParentID, &c.SortOrder, &c.ProductCount); err != nil {
			return nil, nil, err
		}
		byID[c.ID] = c
		bySlug[c.Slug] = c
		all = append(all, c)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	for _, c := range all {
		if c.ParentID == nil {
			top = append(top, c)
		} else if p := byID[*c.ParentID]; p != nil {
			p.Children = append(p.Children, c)
			p.ProductCount += c.ProductCount
		} else {
			delete(bySlug, c.Slug) // child of an inactive parent: hidden
		}
	}
	if top == nil {
		top = []*Category{}
	}
	return top, bySlug, nil
}

func (h *public) categories(c *gin.Context) {
	top, _, err := loadTree(c.Request.Context(), h.d.DB)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.PublicCache(c)
	httpx.Data(c, http.StatusOK, top)
}

func (h *public) category(c *gin.Context) {
	top, bySlug, err := loadTree(c.Request.Context(), h.d.DB)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	cat := bySlug[c.Param("slug")]
	if cat == nil {
		httpx.NotFound(c)
		return
	}
	out := *cat
	out.Breadcrumbs = []CategoryRef{}
	if cat.ParentID != nil {
		for _, t := range top {
			if t.ID == *cat.ParentID {
				out.Breadcrumbs = append(out.Breadcrumbs, CategoryRef{ID: t.ID, Slug: t.Slug, Name: t.Name})
			}
		}
	}
	out.Breadcrumbs = append(out.Breadcrumbs, CategoryRef{ID: cat.ID, Slug: cat.Slug, Name: cat.Name})
	httpx.PublicCache(c)
	httpx.Data(c, http.StatusOK, out)
}

// listQuery is a parsed GET /products request.
type listQuery struct {
	q, category, tag, sort string
	minPrice, maxPrice     *int64
	ratingMin              *int64
	inStock, onSale        bool
	page, perPage          int
}

var sorts = map[string]bool{"relevance": true, "newest": true, "price_asc": true, "price_desc": true, "best_selling": true, "rating": true}

func parseList(c *gin.Context) (listQuery, bool) {
	var lq listQuery
	lq.q = strings.ToLower(strings.TrimSpace(c.Query("q")))
	if utf8.RuneCountInString(lq.q) > 100 {
		httpx.BadRequest(c, "คำค้นหายาวเกินไป")
		return lq, false
	}
	lq.category = strings.TrimSpace(c.Query("category"))
	lq.tag = strings.TrimSpace(c.Query("tag"))
	for _, p := range []struct {
		name string
		dst  **int64
	}{{"min_price", &lq.minPrice}, {"max_price", &lq.maxPrice}, {"rating_min", &lq.ratingMin}} {
		v, present, valid := httpx.QueryInt64(c, p.name)
		if !valid || v < 0 {
			httpx.BadRequest(c, "พารามิเตอร์ "+p.name+" ไม่ถูกต้อง")
			return lq, false
		}
		if present {
			vv := v
			*p.dst = &vv
		}
	}
	if lq.ratingMin != nil && (*lq.ratingMin < 1 || *lq.ratingMin > 5) {
		httpx.BadRequest(c, "พารามิเตอร์ rating_min ไม่ถูกต้อง")
		return lq, false
	}
	var valid bool
	if lq.inStock, _, valid = httpx.QueryBool(c, "in_stock"); !valid {
		httpx.BadRequest(c, "พารามิเตอร์ in_stock ไม่ถูกต้อง")
		return lq, false
	}
	if lq.onSale, _, valid = httpx.QueryBool(c, "on_sale"); !valid {
		httpx.BadRequest(c, "พารามิเตอร์ on_sale ไม่ถูกต้อง")
		return lq, false
	}
	lq.sort = c.Query("sort")
	if lq.sort == "" {
		lq.sort = "newest"
		if lq.q != "" {
			lq.sort = "relevance"
		}
	}
	if !sorts[lq.sort] {
		httpx.BadRequest(c, "พารามิเตอร์ sort ไม่ถูกต้อง")
		return lq, false
	}
	if lq.sort == "relevance" && lq.q == "" {
		lq.sort = "newest"
	}
	lq.page, lq.perPage = httpx.Page(c, 24, 48)
	return lq, true
}

type sqlArgs struct{ args []any }

func (a *sqlArgs) add(v any) string {
	a.args = append(a.args, v)
	return "$" + strconv.Itoa(len(a.args))
}

// searchProducts returns the page of product ids and the total.
func searchProducts(ctx context.Context, tx pgx.Tx, lq listQuery, now time.Time) ([]int64, int, error) {
	a := &sqlArgs{}
	where := []string{"p.deleted_at IS NULL", "p.status = 'active'"}
	if lq.category != "" {
		s := a.add(lq.category)
		where = append(where, `p.category_id IN (SELECT id FROM categories WHERE is_active AND (slug = `+s+
			` OR parent_id = (SELECT id FROM categories WHERE slug = `+s+` AND is_active)))`)
	}
	if lq.minPrice != nil {
		where = append(where, "p.min_price_satang >= "+a.add(*lq.minPrice))
	}
	if lq.maxPrice != nil {
		where = append(where, "p.min_price_satang <= "+a.add(*lq.maxPrice))
	}
	if lq.ratingMin != nil {
		where = append(where, "p.rating_avg >= "+a.add(*lq.ratingMin))
	}
	if lq.inStock {
		where = append(where, "EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.stock > 0)")
	}
	if lq.tag != "" {
		where = append(where, a.add(lq.tag)+" = ANY(p.tags)")
	}
	if lq.onSale {
		nowArg := a.add(now)
		where = append(where, `(EXISTS (SELECT 1 FROM flash_sale_items fi JOIN flash_sales fs ON fs.id = fi.flash_sale_id
				JOIN product_variants v ON v.id = fi.variant_id
				WHERE v.product_id = p.id AND fs.status = 'active' AND fs.starts_at <= `+nowArg+` AND fs.ends_at > `+nowArg+`)
			OR EXISTS (SELECT 1 FROM promotions pr JOIN promotion_targets t ON t.promotion_id = pr.id
				WHERE pr.status = 'active' AND pr.auto_apply AND pr.starts_at <= `+nowArg+` AND (pr.ends_at IS NULL OR pr.ends_at > `+nowArg+`)
				AND (t.product_id = p.id OR t.category_id IN (SELECT id FROM categories WHERE id = p.category_id
					UNION SELECT parent_id FROM categories WHERE id = p.category_id AND parent_id IS NOT NULL)
					OR t.variant_id IN (SELECT id FROM product_variants WHERE product_id = p.id))))`)
	}
	var qArg, patArg string
	if lq.q != "" {
		if _, err := tx.Exec(ctx, `SET LOCAL pg_trgm.word_similarity_threshold = 0.4`); err != nil {
			return nil, 0, err
		}
		qArg = a.add(lq.q)
		patArg = a.add(httpx.LikePattern(lq.q))
		where = append(where, "(p.search_text ILIKE "+patArg+" OR "+qArg+" <% p.search_text)")
	}
	w := strings.Join(where, " AND ")
	var total int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM products p WHERE "+w, a.args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	var order string
	switch lq.sort {
	case "relevance":
		order = "(p.search_text ILIKE " + patArg + ") DESC, word_similarity(" + qArg + ", p.search_text) DESC, p.sold_count DESC, p.id"
	case "newest":
		order = "p.published_at DESC NULLS LAST, p.id DESC"
	case "price_asc":
		order = "p.min_price_satang, p.id"
	case "price_desc":
		order = "p.min_price_satang DESC, p.id"
	case "best_selling":
		order = "p.sold_count DESC, p.id"
	case "rating":
		order = "p.rating_avg DESC, p.rating_count DESC, p.id"
	}
	sql := fmt.Sprintf("SELECT p.id FROM products p WHERE %s ORDER BY %s LIMIT %d OFFSET %d",
		w, order, lq.perPage, (lq.page-1)*lq.perPage)
	rows, err := tx.Query(ctx, sql, a.args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, 0, err
		}
		ids = append(ids, id)
	}
	return ids, total, rows.Err()
}

func (h *public) products(c *gin.Context) {
	lq, ok := parseList(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	now := h.d.Now()
	var cards []ProductCard
	var total int
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		ids, t, err := searchProducts(ctx, tx, lq, now)
		if err != nil {
			return err
		}
		total = t
		cards, err = LoadCards(ctx, tx, ids, now, true)
		return err
	})
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.PublicCache(c)
	httpx.List(c, cards, httpx.NewMeta(lq.page, lq.perPage, total))
}

// Variant is the public variant shape (exact stock never public).
type Variant struct {
	ID           int64             `json:"id"`
	SKU          string            `json:"sku"`
	Name         string            `json:"name"`
	OptionValues map[string]string `json:"option_values"`
	PriceSatang  int64             `json:"price_satang"`
	InStock      bool              `json:"in_stock"`
	StockLevel   string            `json:"stock_level"`
	ImageID      *int64            `json:"image_id"`
}

type Option struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

type ReviewsSummary struct {
	RatingAvg       float64        `json:"rating_avg"`
	RatingCount     int            `json:"rating_count"`
	Histogram       map[string]int `json:"histogram"`
	WithImagesCount int            `json:"with_images_count"`
}

type SEO struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

// Product is the public detail shape.
type Product struct {
	ProductCard
	Description    string         `json:"description"`
	Category       CategoryRef    `json:"category"`
	Breadcrumbs    []CategoryRef  `json:"breadcrumbs"`
	Options        []Option       `json:"options"`
	Variants       []Variant      `json:"variants"`
	Images         []Image        `json:"images"`
	ReviewsSummary ReviewsSummary `json:"reviews_summary"`
	Tags           []string       `json:"tags"`
	SEO            SEO            `json:"seo"`
}

// productBase holds the columns shared by public and admin detail.
type productBase struct {
	id                             int64
	description, seoTitle, seoDesc string
	subtitle, name                 string
	cat                            CategoryRef
	parent                         *CategoryRef
	options                        []byte
	tags                           []string
}

func loadProductDetail(ctx context.Context, q httpx.Querier, id int64, now time.Time, public bool) (Product, error) {
	var p Product
	var b productBase
	var pid *int64
	var pslug, pname *string
	err := q.QueryRow(ctx, `SELECT p.id, p.name, p.subtitle, p.description, p.seo_title, p.seo_description, p.options, p.tags,
			c.id, c.slug, c.name, pc.id, pc.slug, pc.name
		FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
		WHERE p.id = $1`, id).Scan(&b.id, &b.name, &b.subtitle, &b.description, &b.seoTitle, &b.seoDesc, &b.options, &b.tags,
		&b.cat.ID, &b.cat.Slug, &b.cat.Name, &pid, &pslug, &pname)
	if err != nil {
		return p, err
	}
	cards, err := LoadCards(ctx, q, []int64{id}, now, public)
	if err != nil {
		return p, err
	}
	if len(cards) == 0 {
		return p, pgx.ErrNoRows
	}
	p.ProductCard = cards[0]
	p.Description = b.description
	p.Category = b.cat
	p.Breadcrumbs = []CategoryRef{}
	if pid != nil {
		p.Breadcrumbs = append(p.Breadcrumbs, CategoryRef{ID: *pid, Slug: *pslug, Name: *pname})
	}
	p.Breadcrumbs = append(p.Breadcrumbs, b.cat)
	p.Options = []Option{}
	_ = json.Unmarshal(b.options, &p.Options)
	for i := range p.Options {
		if p.Options[i].Values == nil {
			p.Options[i].Values = []string{}
		}
	}
	p.Tags = b.tags
	if p.Tags == nil {
		p.Tags = []string{}
	}
	p.SEO = SEO{Title: b.seoTitle, Description: b.seoDesc}
	if p.SEO.Title == "" {
		p.SEO.Title = b.name + " | ShopShip"
	}
	if p.SEO.Description == "" {
		p.SEO.Description = b.subtitle
		if p.SEO.Description == "" {
			p.SEO.Description = truncate(stripMarkdown(b.description), 160)
		}
	}

	// images
	p.Images = []Image{}
	rows, err := q.Query(ctx, `SELECT id, url, alt, width, height FROM product_images WHERE product_id = $1 ORDER BY sort_order, id`, id)
	if err != nil {
		return p, err
	}
	for rows.Next() {
		var im Image
		if err := rows.Scan(&im.ID, &im.URL, &im.Alt, &im.Width, &im.Height); err != nil {
			rows.Close()
			return p, err
		}
		p.Images = append(p.Images, im)
	}
	rows.Close()

	// variants (active only)
	p.Variants = []Variant{}
	rows, err = q.Query(ctx, `SELECT v.id, v.sku, v.name, v.option_values, v.price_satang, v.stock, v.low_stock_threshold,
			(SELECT i.id FROM product_images i WHERE i.variant_id = v.id ORDER BY i.sort_order, i.id LIMIT 1)
		FROM product_variants v WHERE v.product_id = $1 AND v.is_active ORDER BY v.sort_order, v.id`, id)
	if err != nil {
		return p, err
	}
	for rows.Next() {
		var v Variant
		var ov []byte
		var stock, low int
		if err := rows.Scan(&v.ID, &v.SKU, &v.Name, &ov, &v.PriceSatang, &stock, &low, &v.ImageID); err != nil {
			rows.Close()
			return p, err
		}
		v.OptionValues = map[string]string{}
		_ = json.Unmarshal(ov, &v.OptionValues)
		v.InStock = stock > 0
		v.StockLevel = StockLevel(stock, low)
		p.Variants = append(p.Variants, v)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return p, err
	}

	// reviews summary
	p.ReviewsSummary = ReviewsSummary{RatingAvg: p.RatingAvg, RatingCount: p.RatingCount,
		Histogram: map[string]int{"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}}
	rows, err = q.Query(ctx, `SELECT rating, count(*)::int FROM reviews WHERE product_id = $1 AND status = 'published' GROUP BY rating`, id)
	if err != nil {
		return p, err
	}
	for rows.Next() {
		var r, n int
		if err := rows.Scan(&r, &n); err != nil {
			rows.Close()
			return p, err
		}
		p.ReviewsSummary.Histogram[strconv.Itoa(r)] = n
	}
	rows.Close()
	err = q.QueryRow(ctx, `SELECT count(*)::int FROM reviews r WHERE r.product_id = $1 AND r.status = 'published'
		AND EXISTS (SELECT 1 FROM review_images ri WHERE ri.review_id = r.id)`, id).Scan(&p.ReviewsSummary.WithImagesCount)
	return p, err
}

func truncate(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= n {
		return string(r)
	}
	return strings.TrimSpace(string(r[:n-1])) + "…"
}

func stripMarkdown(s string) string {
	s = strings.NewReplacer("#", "", "*", "", "_", "", "`", "", "\n- ", " ", "\n", " ").Replace(s)
	return strings.Join(strings.Fields(s), " ")
}

// productIDBySlug resolves a public (active) product.
func productIDBySlug(ctx context.Context, q httpx.Querier, slug string) (int64, error) {
	var id int64
	err := q.QueryRow(ctx, `SELECT id FROM products WHERE slug = $1 AND status = 'active' AND deleted_at IS NULL`, slug).Scan(&id)
	return id, err
}

func (h *public) product(c *gin.Context) {
	ctx := c.Request.Context()
	id, err := productIDBySlug(ctx, h.d.DB, c.Param("slug"))
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	p, err := loadProductDetail(ctx, h.d.DB, id, h.d.Now(), true)
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.PublicCache(c)
	httpx.Data(c, http.StatusOK, p)
}

type Review struct {
	ID         int64        `json:"id"`
	Rating     int          `json:"rating"`
	Title      string       `json:"title"`
	Body       string       `json:"body"`
	AuthorName string       `json:"author_name"`
	VariantNm  string       `json:"variant_name"`
	Images     []Image      `json:"images"`
	CreatedAt  time.Time    `json:"created_at"`
	Reply      *ReviewReply `json:"reply"`
}

type ReviewReply struct {
	Body      string    `json:"body"`
	RepliedAt time.Time `json:"replied_at"`
}

func (h *public) reviews(c *gin.Context) {
	ctx := c.Request.Context()
	id, err := productIDBySlug(ctx, h.d.DB, c.Param("slug"))
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	a := &sqlArgs{}
	where := []string{"r.product_id = " + a.add(id), "r.status = 'published'"}
	if rating, present, valid := httpx.QueryInt64(c, "rating"); !valid || (present && (rating < 1 || rating > 5)) {
		httpx.BadRequest(c, "พารามิเตอร์ rating ไม่ถูกต้อง")
		return
	} else if present {
		where = append(where, "r.rating = "+a.add(rating))
	}
	withImages, _, valid := httpx.QueryBool(c, "with_images")
	if !valid {
		httpx.BadRequest(c, "พารามิเตอร์ with_images ไม่ถูกต้อง")
		return
	}
	if withImages {
		where = append(where, "EXISTS (SELECT 1 FROM review_images ri WHERE ri.review_id = r.id)")
	}
	order := "r.created_at DESC, r.id DESC"
	switch c.Query("sort") {
	case "", "newest":
	case "rating_desc":
		order = "r.rating DESC, r.created_at DESC, r.id DESC"
	case "rating_asc":
		order = "r.rating, r.created_at DESC, r.id DESC"
	default:
		httpx.BadRequest(c, "พารามิเตอร์ sort ไม่ถูกต้อง")
		return
	}
	page, per := httpx.Page(c, 10, 48)
	w := strings.Join(where, " AND ")
	var total int
	if err := h.d.DB.QueryRow(ctx, "SELECT count(*) FROM reviews r WHERE "+w, a.args...).Scan(&total); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	list, err := loadReviews(ctx, h.d.DB, fmt.Sprintf(`WHERE %s ORDER BY %s LIMIT %d OFFSET %d`, w, order, per, (page-1)*per), a.args...)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.PublicCache(c)
	httpx.List(c, list, httpx.NewMeta(page, per, total))
}

func loadReviews(ctx context.Context, q httpx.Querier, tail string, args ...any) ([]Review, error) {
	rows, err := q.Query(ctx, `SELECT r.id, r.rating, r.title, r.body, r.author_name, coalesce(v.name, ''), r.created_at,
			r.reply_body, r.replied_at
		FROM reviews r LEFT JOIN product_variants v ON v.id = r.variant_id `+tail, args...)
	if err != nil {
		return nil, err
	}
	list := []Review{}
	var ids []int64
	idx := map[int64]int{}
	for rows.Next() {
		var r Review
		var reply string
		var repliedAt *time.Time
		if err := rows.Scan(&r.ID, &r.Rating, &r.Title, &r.Body, &r.AuthorName, &r.VariantNm, &r.CreatedAt, &reply, &repliedAt); err != nil {
			rows.Close()
			return nil, err
		}
		r.CreatedAt = r.CreatedAt.UTC()
		r.Images = []Image{}
		if reply != "" {
			ra := r.CreatedAt
			if repliedAt != nil {
				ra = repliedAt.UTC()
			}
			r.Reply = &ReviewReply{Body: reply, RepliedAt: ra}
		}
		idx[r.ID] = len(list)
		ids = append(ids, r.ID)
		list = append(list, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return list, nil
	}
	rows, err = q.Query(ctx, `SELECT id, review_id, url, width, height FROM review_images WHERE review_id = ANY($1) ORDER BY sort_order, id`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var im Image
		var rid int64
		if err := rows.Scan(&im.ID, &rid, &im.URL, &im.Width, &im.Height); err != nil {
			return nil, err
		}
		im.Alt = "รูปจากผู้ซื้อ"
		list[idx[rid]].Images = append(list[idx[rid]].Images, im)
	}
	return list, rows.Err()
}

func (h *public) related(c *gin.Context) {
	ctx := c.Request.Context()
	var id, cat int64
	err := h.d.DB.QueryRow(ctx, `SELECT id, category_id FROM products WHERE slug = $1 AND status = 'active' AND deleted_at IS NULL`,
		c.Param("slug")).Scan(&id, &cat)
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	rows, err := h.d.DB.Query(ctx, `SELECT id FROM products WHERE category_id = $1 AND id <> $2 AND status = 'active' AND deleted_at IS NULL
		ORDER BY sold_count DESC, id LIMIT 12`, cat, id)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	cards, err := LoadCards(ctx, h.d.DB, ids, h.d.Now(), true)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.PublicCache(c)
	httpx.Data(c, http.StatusOK, cards)
}

func (h *public) suggest(c *gin.Context) {
	q := strings.ToLower(strings.TrimSpace(c.Query("q")))
	type prod struct {
		Slug     string `json:"slug"`
		Name     string `json:"name"`
		ImageURL string `json:"image_url"`
	}
	products := []prod{}
	cats := []CategoryRef{}
	if q == "" || utf8.RuneCountInString(q) > 100 {
		httpx.PublicCache(c)
		httpx.Data(c, http.StatusOK, gin.H{"products": products, "categories": cats})
		return
	}
	ctx := c.Request.Context()
	pat := httpx.LikePattern(q)
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SET LOCAL pg_trgm.word_similarity_threshold = 0.4`); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT p.slug, p.name, coalesce((SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY sort_order, id LIMIT 1), '')
			FROM products p WHERE p.status = 'active' AND p.deleted_at IS NULL AND (p.search_text ILIKE $2 OR $1 <% p.search_text)
			ORDER BY (p.search_text ILIKE $2) DESC, word_similarity($1, p.search_text) DESC, p.sold_count DESC, p.id LIMIT 8`, q, pat)
		if err != nil {
			return err
		}
		for rows.Next() {
			var p prod
			if err := rows.Scan(&p.Slug, &p.Name, &p.ImageURL); err != nil {
				rows.Close()
				return err
			}
			products = append(products, p)
		}
		rows.Close()
		rows, err = tx.Query(ctx, `SELECT id, slug, name FROM categories WHERE is_active AND (lower(name) ILIKE $1 OR slug ILIKE $1)
			ORDER BY sort_order, id LIMIT 8`, pat)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var cr CategoryRef
			if err := rows.Scan(&cr.ID, &cr.Slug, &cr.Name); err != nil {
				return err
			}
			cats = append(cats, cr)
		}
		return rows.Err()
	})
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.PublicCache(c)
	httpx.Data(c, http.StatusOK, gin.H{"products": products, "categories": cats})
}
