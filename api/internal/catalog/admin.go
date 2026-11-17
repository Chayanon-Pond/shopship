package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
)

type adminH struct{ d *platform.Deps }

var (
	slugRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	skuRe  = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)
)

var productStatuses = map[string]bool{"draft": true, "active": true, "hidden": true, "archived": true}

// Slugify makes an ASCII slug ("" when nothing usable remains, e.g. Thai only).
func Slugify(s string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			dash = false
		default:
			if !dash && b.Len() > 0 {
				b.WriteByte('-')
				dash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 100 {
		out = strings.Trim(out[:100], "-")
	}
	return out
}

// ---------- shapes ----------

type AdminProductRow struct {
	ID             int64       `json:"id"`
	Slug           string      `json:"slug"`
	Name           string      `json:"name"`
	NameEN         string      `json:"name_en"`
	Status         string      `json:"status"`
	Category       CategoryRef `json:"category"`
	ImageURL       string      `json:"image_url"`
	MinPriceSatang int64       `json:"min_price_satang"`
	MaxPriceSatang int64       `json:"max_price_satang"`
	TotalStock     int         `json:"total_stock"`
	VariantCount   int         `json:"variant_count"`
	UpdatedAt      time.Time   `json:"updated_at"`
}

type AdminVariant struct {
	ID                int64             `json:"id"`
	ProductID         int64             `json:"product_id"`
	SKU               string            `json:"sku"`
	Name              string            `json:"name"`
	OptionValues      map[string]string `json:"option_values"`
	PriceSatang       int64             `json:"price_satang"`
	CostSatang        *int64            `json:"cost_satang"`
	Stock             int               `json:"stock"`
	LowStockThreshold int               `json:"low_stock_threshold"`
	WeightGrams       int               `json:"weight_grams"`
	Barcode           string            `json:"barcode"`
	IsActive          bool              `json:"is_active"`
	SortOrder         int               `json:"sort_order"`
	StockLevel        string            `json:"stock_level"`
	InStock           bool              `json:"in_stock"`
	ImageID           *int64            `json:"image_id"`
	CreatedAt         time.Time         `json:"created_at"`
	UpdatedAt         time.Time         `json:"updated_at"`
}

type AdminProduct struct {
	Product
	NameEN         string         `json:"name_en"`
	CategoryID     int64          `json:"category_id"`
	Status         string         `json:"status"`
	Featured       bool           `json:"featured"`
	SEOTitle       string         `json:"seo_title"`
	SEODescription string         `json:"seo_description"`
	Variants       []AdminVariant `json:"variants"`
	PublishedAt    *time.Time     `json:"published_at"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

const variantCols = `v.id, v.product_id, v.sku, v.name, v.option_values, v.price_satang, v.cost_satang, v.stock,
	v.low_stock_threshold, v.weight_grams, v.barcode, v.is_active, v.sort_order,
	(SELECT i.id FROM product_images i WHERE i.variant_id = v.id ORDER BY i.sort_order, i.id LIMIT 1),
	v.created_at, v.updated_at`

func scanVariant(row pgx.Row) (AdminVariant, error) {
	var v AdminVariant
	var ov []byte
	err := row.Scan(&v.ID, &v.ProductID, &v.SKU, &v.Name, &ov, &v.PriceSatang, &v.CostSatang, &v.Stock, &v.LowStockThreshold,
		&v.WeightGrams, &v.Barcode, &v.IsActive, &v.SortOrder, &v.ImageID, &v.CreatedAt, &v.UpdatedAt)
	if err != nil {
		return v, err
	}
	v.OptionValues = map[string]string{}
	_ = json.Unmarshal(ov, &v.OptionValues)
	v.StockLevel = StockLevel(v.Stock, v.LowStockThreshold)
	v.InStock = v.Stock > 0
	v.CreatedAt, v.UpdatedAt = v.CreatedAt.UTC(), v.UpdatedAt.UTC()
	return v, nil
}

func loadAdminProduct(ctx context.Context, q httpx.Querier, id int64, now time.Time) (AdminProduct, error) {
	var ap AdminProduct
	p, err := loadProductDetail(ctx, q, id, now, false)
	if err != nil {
		return ap, err
	}
	ap.Product = p
	if err := q.QueryRow(ctx, `SELECT name_en, category_id, status, featured, seo_title, seo_description, published_at, created_at, updated_at
		FROM products WHERE id = $1`, id).Scan(&ap.NameEN, &ap.CategoryID, &ap.Status, &ap.Featured, &ap.SEOTitle, &ap.SEODescription,
		&ap.PublishedAt, &ap.CreatedAt, &ap.UpdatedAt); err != nil {
		return ap, err
	}
	ap.CreatedAt, ap.UpdatedAt = ap.CreatedAt.UTC(), ap.UpdatedAt.UTC()
	rows, err := q.Query(ctx, `SELECT `+variantCols+` FROM product_variants v WHERE v.product_id = $1 ORDER BY v.sort_order, v.id`, id)
	if err != nil {
		return ap, err
	}
	defer rows.Close()
	ap.Variants = []AdminVariant{}
	for rows.Next() {
		v, err := scanVariant(rows)
		if err != nil {
			return ap, err
		}
		ap.Variants = append(ap.Variants, v)
	}
	return ap, rows.Err()
}

// ---------- products ----------

func (h *adminH) listProducts(c *gin.Context) {
	ctx := c.Request.Context()
	page, per := httpx.Page(c, 24, 100)
	a := &sqlArgs{}
	where := []string{"p.deleted_at IS NULL"}
	if s := c.Query("status"); s != "" {
		if !productStatuses[s] {
			httpx.BadRequest(c, "พารามิเตอร์ status ไม่ถูกต้อง")
			return
		}
		where = append(where, "p.status = "+a.add(s))
	}
	if cid, present, valid := httpx.QueryInt64(c, "category_id"); !valid {
		httpx.BadRequest(c, "พารามิเตอร์ category_id ไม่ถูกต้อง")
		return
	} else if present {
		where = append(where, "(p.category_id = "+a.add(cid)+" OR p.category_id IN (SELECT id FROM categories WHERE parent_id = $"+fmt.Sprint(len(a.args))+"))")
	}
	if q := strings.ToLower(strings.TrimSpace(c.Query("q"))); q != "" {
		where = append(where, "(p.search_text ILIKE "+a.add(httpx.LikePattern(q))+" OR p.slug ILIKE $"+fmt.Sprint(len(a.args))+")")
	}
	if low, _, _ := httpx.QueryBool(c, "low_stock"); low {
		where = append(where, "EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.stock <= v.low_stock_threshold)")
	}
	order := "p.updated_at DESC, p.id DESC"
	switch c.Query("sort") {
	case "", "updated_desc":
	case "name":
		order = "p.name, p.id"
	case "created_desc":
		order = "p.created_at DESC, p.id DESC"
	case "price_asc":
		order = "p.min_price_satang, p.id"
	case "price_desc":
		order = "p.min_price_satang DESC, p.id"
	case "stock_asc":
		order = "total_stock, p.id"
	default:
		httpx.BadRequest(c, "พารามิเตอร์ sort ไม่ถูกต้อง")
		return
	}
	w := strings.Join(where, " AND ")
	var total int
	if err := h.d.DB.QueryRow(ctx, "SELECT count(*) FROM products p WHERE "+w, a.args...).Scan(&total); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	rows, err := h.d.DB.Query(ctx, fmt.Sprintf(`SELECT p.id, p.slug, p.name, p.name_en, p.status, c.id, c.slug, c.name,
			coalesce((SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY sort_order, id LIMIT 1), ''),
			p.min_price_satang, p.max_price_satang,
			coalesce((SELECT sum(stock) FROM product_variants v WHERE v.product_id = p.id AND v.is_active), 0)::int AS total_stock,
			(SELECT count(*) FROM product_variants v WHERE v.product_id = p.id)::int, p.updated_at
		FROM products p JOIN categories c ON c.id = p.category_id WHERE %s ORDER BY %s LIMIT %d OFFSET %d`, w, order, per, (page-1)*per), a.args...)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	defer rows.Close()
	list := []AdminProductRow{}
	for rows.Next() {
		var r AdminProductRow
		if err := rows.Scan(&r.ID, &r.Slug, &r.Name, &r.NameEN, &r.Status, &r.Category.ID, &r.Category.Slug, &r.Category.Name,
			&r.ImageURL, &r.MinPriceSatang, &r.MaxPriceSatang, &r.TotalStock, &r.VariantCount, &r.UpdatedAt); err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
		r.UpdatedAt = r.UpdatedAt.UTC()
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.List(c, list, httpx.NewMeta(page, per, total))
}

type variantInput struct {
	SKU               *string            `json:"sku"`
	Name              *string            `json:"name"`
	OptionValues      *map[string]string `json:"option_values"`
	PriceSatang       *int64             `json:"price_satang"`
	CostSatang        json.RawMessage    `json:"cost_satang"`
	Stock             *int               `json:"stock"`
	WeightGrams       *int               `json:"weight_grams"`
	Barcode           *string            `json:"barcode"`
	LowStockThreshold *int               `json:"low_stock_threshold"`
	IsActive          *bool              `json:"is_active"`
	SortOrder         *int               `json:"sort_order"`
}

// validate checks the fields present; create=true requires sku + price.
func (v *variantInput) validate(prefix string, create bool, fields map[string]string) {
	if v.SKU != nil {
		s := strings.TrimSpace(*v.SKU)
		v.SKU = &s
		if !skuRe.MatchString(s) {
			fields[prefix+"sku"] = "SKU ใช้ได้เฉพาะ A-Z 0-9 . _ - (1-64 ตัว)"
		}
	} else if create {
		fields[prefix+"sku"] = "กรุณากรอก SKU"
	}
	if v.PriceSatang != nil {
		if *v.PriceSatang <= 0 || *v.PriceSatang > 100_000_000_00 {
			fields[prefix+"price_satang"] = "ราคาต้องมากกว่า 0"
		}
	} else if create {
		fields[prefix+"price_satang"] = "กรุณากรอกราคา"
	}
	if v.Name != nil && utf8.RuneCountInString(*v.Name) > 200 {
		fields[prefix+"name"] = "ชื่อตัวเลือกยาวเกินไป"
	}
	if v.Stock != nil && *v.Stock < 0 {
		fields[prefix+"stock"] = "สต็อกต้องไม่ติดลบ"
	}
	if v.WeightGrams != nil && *v.WeightGrams < 0 {
		fields[prefix+"weight_grams"] = "น้ำหนักต้องไม่ติดลบ"
	}
	if v.LowStockThreshold != nil && *v.LowStockThreshold < 0 {
		fields[prefix+"low_stock_threshold"] = "ค่าต้องไม่ติดลบ"
	}
	if _, ok := parseNullableInt(v.CostSatang); !ok {
		fields[prefix+"cost_satang"] = "ต้นทุนไม่ถูกต้อง"
	} else if c, _ := parseNullableInt(v.CostSatang); c != nil && *c < 0 {
		fields[prefix+"cost_satang"] = "ต้นทุนต้องไม่ติดลบ"
	}
}

// parseNullableInt: absent/null -> nil, number -> value; ok=false when malformed.
func parseNullableInt(raw json.RawMessage) (*int64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, true
	}
	var n int64
	if err := json.Unmarshal(raw, &n); err != nil {
		return nil, false
	}
	return &n, true
}

func insertVariant(ctx context.Context, tx pgx.Tx, productID int64, v variantInput, sort int) (int64, error) {
	cost, _ := parseNullableInt(v.CostSatang)
	ov := map[string]string{}
	if v.OptionValues != nil {
		ov = *v.OptionValues
	}
	ovb, _ := json.Marshal(ov)
	str := func(p *string) string {
		if p == nil {
			return ""
		}
		return strings.TrimSpace(*p)
	}
	intOr := func(p *int, d int) int {
		if p == nil {
			return d
		}
		return *p
	}
	active := true
	if v.IsActive != nil {
		active = *v.IsActive
	}
	var id int64
	err := tx.QueryRow(ctx, `INSERT INTO product_variants (product_id, sku, name, option_values, price_satang, cost_satang, stock,
			low_stock_threshold, weight_grams, barcode, is_active, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
		productID, str(v.SKU), str(v.Name), ovb, *v.PriceSatang, cost, intOr(v.Stock, 0), intOr(v.LowStockThreshold, 5),
		intOr(v.WeightGrams, 0), str(v.Barcode), active, intOr(v.SortOrder, sort)).Scan(&id)
	return id, err
}

type productInput struct {
	Name           *string         `json:"name"`
	NameEN         *string         `json:"name_en"`
	Slug           *string         `json:"slug"`
	Subtitle       *string         `json:"subtitle"`
	Description    *string         `json:"description"`
	CategoryID     *int64          `json:"category_id"`
	Brand          *string         `json:"brand"`
	Status         *string         `json:"status"`
	Featured       *bool           `json:"featured"`
	Tags           *[]string       `json:"tags"`
	Options        *[]Option       `json:"options"`
	SEOTitle       *string         `json:"seo_title"`
	SEODescription *string         `json:"seo_description"`
	Variants       []variantInput  `json:"variants"`
	Extra          json.RawMessage `json:"-"`
}

func (in *productInput) validate(create bool) map[string]string {
	f := map[string]string{}
	trim := func(p *string) {
		if p != nil {
			*p = strings.TrimSpace(*p)
		}
	}
	trim(in.Name)
	trim(in.NameEN)
	trim(in.Slug)
	trim(in.Subtitle)
	trim(in.Brand)
	if in.Name != nil {
		if *in.Name == "" || utf8.RuneCountInString(*in.Name) > 200 {
			f["name"] = "กรุณากรอกชื่อสินค้า (ไม่เกิน 200 ตัวอักษร)"
		}
	} else if create {
		f["name"] = "กรุณากรอกชื่อสินค้า"
	}
	if in.NameEN != nil && utf8.RuneCountInString(*in.NameEN) > 200 {
		f["name_en"] = "ชื่อภาษาอังกฤษยาวเกินไป"
	}
	if in.Slug != nil && *in.Slug != "" && (!slugRe.MatchString(*in.Slug) || len(*in.Slug) > 120) {
		f["slug"] = "slug ใช้ได้เฉพาะ a-z 0-9 และขีด (-)"
	}
	if in.Subtitle != nil && utf8.RuneCountInString(*in.Subtitle) > 300 {
		f["subtitle"] = "คำโปรยยาวเกินไป"
	}
	if in.Brand != nil && utf8.RuneCountInString(*in.Brand) > 100 {
		f["brand"] = "ชื่อแบรนด์ยาวเกินไป"
	}
	if in.CategoryID == nil && create {
		f["category_id"] = "กรุณาเลือกหมวดหมู่"
	}
	if in.Status != nil && !productStatuses[*in.Status] {
		f["status"] = "สถานะไม่ถูกต้อง"
	}
	if in.Options != nil {
		for i, o := range *in.Options {
			if strings.TrimSpace(o.Name) == "" {
				f[fmt.Sprintf("options.%d.name", i)] = "กรุณากรอกชื่อตัวเลือก"
			}
		}
	}
	if create {
		if len(in.Variants) == 0 {
			f["variants"] = "ต้องมีอย่างน้อย 1 ตัวเลือกสินค้า"
		}
		for i := range in.Variants {
			in.Variants[i].validate(fmt.Sprintf("variants.%d.", i), true, f)
		}
	}
	return f
}

func cleanTags(tags []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t != "" && !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}

func (h *adminH) writeErr(c *gin.Context, err error) {
	switch {
	case httpx.IsUniqueViolation(err):
		httpx.Conflict(c, "ข้อมูลซ้ำกับที่มีอยู่แล้ว (slug หรือ SKU)")
	case httpx.IsFKViolation(err):
		httpx.Validation(c, map[string]string{"category_id": "ไม่พบข้อมูลที่อ้างอิง"})
	case httpx.IsCheckViolation(err):
		httpx.Validation(c, map[string]string{"_": "ข้อมูลไม่ผ่านเงื่อนไข"})
	case httpx.IsNoRows(err):
		httpx.NotFound(c)
	default:
		httpx.Internal(c, h.d.Log, err)
	}
}

func (h *adminH) createProduct(c *gin.Context) {
	var in productInput
	if !httpx.BindJSON(c, &in) {
		return
	}
	if f := in.validate(true); len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	ctx := c.Request.Context()
	slug := ""
	if in.Slug != nil {
		slug = *in.Slug
	}
	explicitSlug := slug != ""
	if slug == "" {
		if in.NameEN != nil {
			slug = Slugify(*in.NameEN)
		}
		if slug == "" {
			slug = Slugify(*in.Name)
		}
		if slug == "" {
			slug = "p-" + strings.ToLower(auth.RandomToken(4))
			slug = Slugify(slug)
		}
	}
	str := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	status := "draft"
	if in.Status != nil {
		status = *in.Status
	}
	tags := []string{}
	if in.Tags != nil {
		tags = cleanTags(*in.Tags)
	}
	opts := []Option{}
	if in.Options != nil {
		opts = *in.Options
	}
	optsB, _ := json.Marshal(opts)
	featured := in.Featured != nil && *in.Featured
	var id int64
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		for attempt := 0; ; attempt++ {
			s := slug
			if attempt > 0 {
				s = fmt.Sprintf("%s-%d", slug, attempt+1)
			}
			var exists bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM products WHERE slug = $1 AND deleted_at IS NULL)`, s).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				slug = s
				break
			}
			if explicitSlug {
				return &pgconnUnique{}
			}
		}
		err := tx.QueryRow(ctx, `INSERT INTO products (slug, name, name_en, subtitle, description, category_id, brand, status, featured,
				tags, options, seo_title, seo_description, published_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $8 = 'active' THEN now() END) RETURNING id`,
			slug, *in.Name, str(in.NameEN), str(in.Subtitle), str(in.Description), *in.CategoryID, str(in.Brand), status, featured,
			tags, optsB, str(in.SEOTitle), str(in.SEODescription)).Scan(&id)
		if err != nil {
			return err
		}
		for i, v := range in.Variants {
			if _, err := insertVariant(ctx, tx, id, v, i); err != nil {
				return err
			}
		}
		return auth.Audit(c, tx, "product.create", "product", id, map[string]any{"slug": slug, "variants": len(in.Variants)})
	})
	if err != nil {
		var pu *pgconnUnique
		if errors.As(err, &pu) {
			httpx.Conflict(c, "slug นี้ถูกใช้แล้ว")
			return
		}
		h.writeErr(c, err)
		return
	}
	ap, err := loadAdminProduct(ctx, h.d.DB, id, h.d.Now())
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusCreated, ap)
}

type pgconnUnique struct{}

func (*pgconnUnique) Error() string { return "slug taken" }

func (h *adminH) getProduct(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	ap, err := loadAdminProduct(c.Request.Context(), h.d.DB, id, h.d.Now())
	if err != nil {
		h.writeErr(c, err)
		return
	}
	httpx.Data(c, http.StatusOK, ap)
}

func (h *adminH) patchProduct(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in productInput
	if !httpx.BindJSON(c, &in) {
		return
	}
	if f := in.validate(false); len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	if in.Slug != nil && *in.Slug == "" {
		httpx.Validation(c, map[string]string{"slug": "กรุณากรอก slug"})
		return
	}
	ctx := c.Request.Context()
	var tags []string
	if in.Tags != nil {
		tags = cleanTags(*in.Tags)
	}
	var optsB []byte
	if in.Options != nil {
		optsB, _ = json.Marshal(*in.Options)
	}
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE products SET
				name = coalesce($2, name), name_en = coalesce($3, name_en), slug = coalesce($4, slug),
				subtitle = coalesce($5, subtitle), description = coalesce($6, description), category_id = coalesce($7, category_id),
				brand = coalesce($8, brand), status = coalesce($9, status), featured = coalesce($10, featured),
				tags = coalesce($11, tags), options = coalesce($12, options), seo_title = coalesce($13, seo_title),
				seo_description = coalesce($14, seo_description),
				published_at = CASE WHEN coalesce($9, status) = 'active' AND published_at IS NULL THEN now() ELSE published_at END
			WHERE id = $1 AND deleted_at IS NULL`,
			id, in.Name, in.NameEN, in.Slug, in.Subtitle, in.Description, in.CategoryID, in.Brand, in.Status, in.Featured,
			tags, optsB, in.SEOTitle, in.SEODescription)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return auth.Audit(c, tx, "product.update", "product", id, map[string]any{"fields": presentFields(in)})
	})
	if err != nil {
		h.writeErr(c, err)
		return
	}
	ap, err := loadAdminProduct(ctx, h.d.DB, id, h.d.Now())
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, ap)
}

func presentFields(in productInput) []string {
	var out []string
	add := func(ok bool, n string) {
		if ok {
			out = append(out, n)
		}
	}
	add(in.Name != nil, "name")
	add(in.NameEN != nil, "name_en")
	add(in.Slug != nil, "slug")
	add(in.Subtitle != nil, "subtitle")
	add(in.Description != nil, "description")
	add(in.CategoryID != nil, "category_id")
	add(in.Brand != nil, "brand")
	add(in.Status != nil, "status")
	add(in.Featured != nil, "featured")
	add(in.Tags != nil, "tags")
	add(in.Options != nil, "options")
	add(in.SEOTitle != nil, "seo_title")
	add(in.SEODescription != nil, "seo_description")
	return out
}

func (h *adminH) deleteProduct(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE products SET deleted_at = now(), status = 'archived' WHERE id = $1 AND deleted_at IS NULL`, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		if _, err := tx.Exec(ctx, `DELETE FROM cart_items WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = $1)
			AND cart_id IN (SELECT id FROM carts WHERE status = 'active')`, id); err != nil {
			return err
		}
		return auth.Audit(c, tx, "product.delete", "product", id, nil)
	})
	if err != nil {
		h.writeErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---------- variants ----------

func (h *adminH) createVariant(c *gin.Context) {
	pid, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in variantInput
	if !httpx.BindJSON(c, &in) {
		return
	}
	f := map[string]string{}
	in.validate("", true, f)
	if len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	ctx := c.Request.Context()
	var vid int64
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM product_variants WHERE product_id = $1`, pid).Scan(&n); err != nil {
			return err
		}
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM products WHERE id = $1 AND deleted_at IS NULL)`, pid).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return pgx.ErrNoRows
		}
		var err error
		if vid, err = insertVariant(ctx, tx, pid, in, n); err != nil {
			return err
		}
		return auth.Audit(c, tx, "variant.create", "variant", vid, map[string]any{"product_id": pid, "sku": *in.SKU})
	})
	if err != nil {
		h.writeErr(c, err)
		return
	}
	v, err := scanVariant(h.d.DB.QueryRow(ctx, `SELECT `+variantCols+` FROM product_variants v WHERE v.id = $1`, vid))
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusCreated, v)
}

func (h *adminH) patchVariant(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in variantInput
	if !httpx.BindJSON(c, &in) {
		return
	}
	f := map[string]string{}
	in.validate("", false, f)
	if len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	ctx := c.Request.Context()
	var ovb []byte
	if in.OptionValues != nil {
		ovb, _ = json.Marshal(*in.OptionValues)
	}
	costSet := len(in.CostSatang) > 0
	cost, _ := parseNullableInt(in.CostSatang)
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var oldPrice int64
		if err := tx.QueryRow(ctx, `SELECT price_satang FROM product_variants WHERE id = $1 FOR UPDATE`, id).Scan(&oldPrice); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE product_variants SET sku = coalesce($2, sku), name = coalesce($3, name),
				option_values = coalesce($4, option_values), price_satang = coalesce($5, price_satang),
				cost_satang = CASE WHEN $6::boolean THEN $7::bigint ELSE cost_satang END, stock = coalesce($8, stock),
				weight_grams = coalesce($9, weight_grams), barcode = coalesce($10, barcode),
				low_stock_threshold = coalesce($11, low_stock_threshold), is_active = coalesce($12, is_active),
				sort_order = coalesce($13, sort_order)
			WHERE id = $1`, id, in.SKU, in.Name, ovb, in.PriceSatang, costSet, cost, in.Stock, in.WeightGrams, in.Barcode,
			in.LowStockThreshold, in.IsActive, in.SortOrder)
		if err != nil {
			return err
		}
		meta := map[string]any{}
		if in.PriceSatang != nil && *in.PriceSatang != oldPrice {
			meta["price_from"], meta["price_to"] = oldPrice, *in.PriceSatang
		}
		if in.Stock != nil {
			meta["stock"] = *in.Stock
		}
		return auth.Audit(c, tx, "variant.update", "variant", id, meta)
	})
	if err != nil {
		h.writeErr(c, err)
		return
	}
	v, err := scanVariant(h.d.DB.QueryRow(ctx, `SELECT `+variantCols+` FROM product_variants v WHERE v.id = $1`, id))
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, v)
}

func (h *adminH) deleteVariant(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var referenced bool
		err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM order_items WHERE variant_id = $1)
			OR EXISTS (SELECT 1 FROM flash_sale_items WHERE variant_id = $1)
			OR EXISTS (SELECT 1 FROM stock_reservations WHERE variant_id = $1)
			OR NOT EXISTS (SELECT 1 FROM product_variants WHERE id = $1)`, id).Scan(&referenced)
		if err != nil {
			return err
		}
		var tag interface{ RowsAffected() int64 }
		if referenced {
			tag, err = tx.Exec(ctx, `UPDATE product_variants SET is_active = false WHERE id = $1`, id)
		} else {
			tag, err = tx.Exec(ctx, `DELETE FROM product_variants WHERE id = $1`, id)
		}
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return auth.Audit(c, tx, "variant.delete", "variant", id, map[string]any{"deactivated": referenced})
	})
	if err != nil {
		h.writeErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *adminH) priceHistory(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	rows, err := h.d.DB.Query(c.Request.Context(), `SELECT price_satang, changed_at FROM price_history WHERE variant_id = $1
		ORDER BY changed_at DESC, id DESC LIMIT 500`, id)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	defer rows.Close()
	type pt struct {
		PriceSatang int64     `json:"price_satang"`
		ChangedAt   time.Time `json:"changed_at"`
	}
	out := []pt{}
	for rows.Next() {
		var p pt
		if err := rows.Scan(&p.PriceSatang, &p.ChangedAt); err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
		p.ChangedAt = p.ChangedAt.UTC()
		out = append(out, p)
	}
	httpx.Data(c, http.StatusOK, out)
}

// ---------- categories ----------

type AdminCategory struct {
	ID             int64     `json:"id"`
	ParentID       *int64    `json:"parent_id"`
	Slug           string    `json:"slug"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	ImageURL       string    `json:"image_url"`
	Icon           string    `json:"icon"`
	SortOrder      int       `json:"sort_order"`
	IsActive       bool      `json:"is_active"`
	SEOTitle       string    `json:"seo_title"`
	SEODescription string    `json:"seo_description"`
	ProductCount   int       `json:"product_count"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

const categoryCols = `c.id, c.parent_id, c.slug, c.name, c.description, c.image_url, c.icon, c.sort_order, c.is_active,
	c.seo_title, c.seo_description,
	(SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL)::int, c.created_at, c.updated_at`

func scanCategory(row pgx.Row) (AdminCategory, error) {
	var a AdminCategory
	err := row.Scan(&a.ID, &a.ParentID, &a.Slug, &a.Name, &a.Description, &a.ImageURL, &a.Icon, &a.SortOrder, &a.IsActive,
		&a.SEOTitle, &a.SEODescription, &a.ProductCount, &a.CreatedAt, &a.UpdatedAt)
	a.CreatedAt, a.UpdatedAt = a.CreatedAt.UTC(), a.UpdatedAt.UTC()
	return a, err
}

func (h *adminH) listCategories(c *gin.Context) {
	ctx := c.Request.Context()
	a := &sqlArgs{}
	where := "true"
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		where = "(c.name ILIKE " + a.add(httpx.LikePattern(q)) + " OR c.slug ILIKE $1)"
	}
	rows, err := h.d.DB.Query(ctx, `SELECT `+categoryCols+` FROM categories c WHERE `+where+
		` ORDER BY coalesce(c.parent_id, c.id), c.parent_id NULLS FIRST, c.sort_order, c.id`, a.args...)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	defer rows.Close()
	list := []AdminCategory{}
	for rows.Next() {
		ac, err := scanCategory(rows)
		if err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
		list = append(list, ac)
	}
	httpx.List(c, list, httpx.NewMeta(1, max(len(list), 1), len(list)))
}

type categoryInput struct {
	Slug           *string         `json:"slug"`
	Name           *string         `json:"name"`
	ParentID       json.RawMessage `json:"parent_id"`
	Description    *string         `json:"description"`
	ImageURL       *string         `json:"image_url"`
	Icon           *string         `json:"icon"`
	SortOrder      *int            `json:"sort_order"`
	IsActive       *bool           `json:"is_active"`
	SEOTitle       *string         `json:"seo_title"`
	SEODescription *string         `json:"seo_description"`
}

func (in *categoryInput) validate(create bool) map[string]string {
	f := map[string]string{}
	if in.Slug != nil {
		s := strings.TrimSpace(*in.Slug)
		in.Slug = &s
		if !slugRe.MatchString(s) || len(s) > 80 {
			f["slug"] = "slug ใช้ได้เฉพาะ a-z 0-9 และขีด (-)"
		}
	} else if create {
		f["slug"] = "กรุณากรอก slug"
	}
	if in.Name != nil {
		n := strings.TrimSpace(*in.Name)
		in.Name = &n
		if n == "" || utf8.RuneCountInString(n) > 100 {
			f["name"] = "กรุณากรอกชื่อหมวดหมู่"
		}
	} else if create {
		f["name"] = "กรุณากรอกชื่อหมวดหมู่"
	}
	if _, ok := parseNullableInt(in.ParentID); !ok {
		f["parent_id"] = "หมวดหลักไม่ถูกต้อง"
	}
	return f
}

func (h *adminH) catErr(c *gin.Context, err error) {
	switch {
	case httpx.IsUniqueViolation(err):
		httpx.Conflict(c, "slug นี้ถูกใช้แล้ว")
	case httpx.IsCheckViolation(err):
		httpx.Validation(c, map[string]string{"parent_id": "หมวดหมู่ซ้อนได้ไม่เกิน 2 ชั้น"})
	case httpx.IsFKViolation(err):
		httpx.Validation(c, map[string]string{"parent_id": "ไม่พบหมวดหลัก"})
	case httpx.IsNoRows(err):
		httpx.NotFound(c)
	default:
		httpx.Internal(c, h.d.Log, err)
	}
}

func (h *adminH) createCategory(c *gin.Context) {
	var in categoryInput
	if !httpx.BindJSON(c, &in) {
		return
	}
	if f := in.validate(true); len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	parent, _ := parseNullableInt(in.ParentID)
	s := func(p *string) string {
		if p == nil {
			return ""
		}
		return strings.TrimSpace(*p)
	}
	sort := 0
	if in.SortOrder != nil {
		sort = *in.SortOrder
	}
	active := in.IsActive == nil || *in.IsActive
	ctx := c.Request.Context()
	var id int64
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO categories (slug, name, parent_id, description, image_url, icon, sort_order, is_active, seo_title, seo_description)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, *in.Slug, *in.Name, parent, s(in.Description), s(in.ImageURL),
			s(in.Icon), sort, active, s(in.SEOTitle), s(in.SEODescription)).Scan(&id); err != nil {
			return err
		}
		return auth.Audit(c, tx, "category.create", "category", id, map[string]any{"slug": *in.Slug})
	})
	if err != nil {
		h.catErr(c, err)
		return
	}
	ac, err := scanCategory(h.d.DB.QueryRow(ctx, `SELECT `+categoryCols+` FROM categories c WHERE c.id = $1`, id))
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusCreated, ac)
}

func (h *adminH) patchCategory(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in categoryInput
	if !httpx.BindJSON(c, &in) {
		return
	}
	if f := in.validate(false); len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	parentSet := len(in.ParentID) > 0
	parent, _ := parseNullableInt(in.ParentID)
	if parent != nil && *parent == id {
		httpx.Validation(c, map[string]string{"parent_id": "เลือกตัวเองเป็นหมวดหลักไม่ได้"})
		return
	}
	ctx := c.Request.Context()
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE categories SET slug = coalesce($2, slug), name = coalesce($3, name),
				parent_id = CASE WHEN $4::boolean THEN $5::bigint ELSE parent_id END, description = coalesce($6, description),
				image_url = coalesce($7, image_url), icon = coalesce($8, icon), sort_order = coalesce($9, sort_order),
				is_active = coalesce($10, is_active), seo_title = coalesce($11, seo_title), seo_description = coalesce($12, seo_description)
			WHERE id = $1`, id, in.Slug, in.Name, parentSet, parent, in.Description, in.ImageURL, in.Icon, in.SortOrder, in.IsActive,
			in.SEOTitle, in.SEODescription)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return auth.Audit(c, tx, "category.update", "category", id, nil)
	})
	if err != nil {
		h.catErr(c, err)
		return
	}
	ac, err := scanCategory(h.d.DB.QueryRow(ctx, `SELECT `+categoryCols+` FROM categories c WHERE c.id = $1`, id))
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, ac)
}

func (h *adminH) deleteCategory(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	inUse := false
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM products WHERE category_id = $1)
			OR EXISTS (SELECT 1 FROM categories WHERE parent_id = $1)`, id).Scan(&inUse); err != nil {
			return err
		}
		if inUse {
			return nil
		}
		tag, err := tx.Exec(ctx, `DELETE FROM categories WHERE id = $1`, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return auth.Audit(c, tx, "category.delete", "category", id, nil)
	})
	if err != nil {
		h.catErr(c, err)
		return
	}
	if inUse {
		httpx.Conflict(c, "ลบไม่ได้ หมวดหมู่นี้ยังมีสินค้าหรือหมวดย่อย")
		return
	}
	c.Status(http.StatusNoContent)
}

// ---------- inventory ----------

func (h *adminH) inventory(c *gin.Context) {
	ctx := c.Request.Context()
	page, per := httpx.Page(c, 50, 100)
	a := &sqlArgs{}
	where := []string{"p.deleted_at IS NULL"}
	if low, _, _ := httpx.QueryBool(c, "low_stock"); low {
		where = append(where, "v.is_active AND v.stock <= v.low_stock_threshold")
	}
	if q := strings.ToLower(strings.TrimSpace(c.Query("q"))); q != "" {
		where = append(where, "(lower(v.sku) LIKE "+a.add(httpx.LikePattern(q))+" OR p.search_text ILIKE $1)")
	}
	w := strings.Join(where, " AND ")
	var total int
	if err := h.d.DB.QueryRow(ctx, "SELECT count(*) FROM product_variants v JOIN products p ON p.id = v.product_id WHERE "+w, a.args...).Scan(&total); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	rows, err := h.d.DB.Query(ctx, fmt.Sprintf(`SELECT v.id, p.id, p.name, v.sku, v.name, v.stock, v.low_stock_threshold,
			coalesce((SELECT sum(qty) FROM stock_reservations r WHERE r.variant_id = v.id AND r.status = 'held'), 0)::int, v.is_active
		FROM product_variants v JOIN products p ON p.id = v.product_id WHERE %s
		ORDER BY (v.stock <= v.low_stock_threshold) DESC, v.stock, v.id LIMIT %d OFFSET %d`, w, per, (page-1)*per), a.args...)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	defer rows.Close()
	type row struct {
		VariantID         int64  `json:"variant_id"`
		ProductID         int64  `json:"product_id"`
		ProductName       string `json:"product_name"`
		SKU               string `json:"sku"`
		VariantName       string `json:"variant_name"`
		Stock             int    `json:"stock"`
		LowStockThreshold int    `json:"low_stock_threshold"`
		ReservedQty       int    `json:"reserved_qty"`
		IsActive          bool   `json:"is_active"`
	}
	list := []row{}
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.VariantID, &r.ProductID, &r.ProductName, &r.SKU, &r.VariantName, &r.Stock, &r.LowStockThreshold,
			&r.ReservedQty, &r.IsActive); err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
		list = append(list, r)
	}
	httpx.List(c, list, httpx.NewMeta(page, per, total))
}

func (h *adminH) adjust(c *gin.Context) {
	var in struct {
		VariantID int64  `json:"variant_id"`
		Delta     int    `json:"delta"`
		Reason    string `json:"reason"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	f := map[string]string{}
	if in.VariantID <= 0 {
		f["variant_id"] = "กรุณาเลือกสินค้า"
	}
	if in.Delta == 0 || in.Delta > 1_000_000 || in.Delta < -1_000_000 {
		f["delta"] = "จำนวนที่ปรับต้องไม่เป็น 0"
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if in.Reason == "" || utf8.RuneCountInString(in.Reason) > 300 {
		f["reason"] = "กรุณาระบุเหตุผล"
	}
	if len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	ctx := c.Request.Context()
	var stock int
	insufficient := false
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `UPDATE product_variants SET stock = stock + $2 WHERE id = $1 AND stock + $2 >= 0 RETURNING stock`,
			in.VariantID, in.Delta).Scan(&stock)
		if httpx.IsNoRows(err) {
			var exists bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM product_variants WHERE id = $1)`, in.VariantID).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return pgx.ErrNoRows
			}
			insufficient = true
			return nil
		}
		if err != nil {
			return err
		}
		return auth.Audit(c, tx, "inventory.adjust", "variant", in.VariantID, map[string]any{"delta": in.Delta, "reason": in.Reason, "stock": stock})
	})
	if err != nil {
		h.writeErr(c, err)
		return
	}
	if insufficient {
		httpx.Validation(c, map[string]string{"delta": "สต็อกคงเหลือไม่พอสำหรับการลด"})
		return
	}
	httpx.Data(c, http.StatusOK, gin.H{"variant_id": in.VariantID, "stock": stock})
}

// ---------- reviews ----------

type AdminReview struct {
	Review
	Status    string      `json:"status"`
	Product   CategoryRef `json:"product"`
	UserID    *int64      `json:"user_id"`
	ReplyBody string      `json:"reply_body"`
}

func (h *adminH) listReviews(c *gin.Context) {
	ctx := c.Request.Context()
	page, per := httpx.Page(c, 24, 100)
	a := &sqlArgs{}
	where := []string{"true"}
	if s := c.Query("status"); s != "" {
		if s != "published" && s != "hidden" {
			httpx.BadRequest(c, "พารามิเตอร์ status ไม่ถูกต้อง")
			return
		}
		where = append(where, "r.status = "+a.add(s))
	}
	if pid, present, valid := httpx.QueryInt64(c, "product_id"); !valid {
		httpx.BadRequest(c, "")
		return
	} else if present {
		where = append(where, "r.product_id = "+a.add(pid))
	}
	if rt, present, valid := httpx.QueryInt64(c, "rating"); !valid {
		httpx.BadRequest(c, "")
		return
	} else if present {
		where = append(where, "r.rating = "+a.add(rt))
	}
	w := strings.Join(where, " AND ")
	var total int
	if err := h.d.DB.QueryRow(ctx, "SELECT count(*) FROM reviews r WHERE "+w, a.args...).Scan(&total); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	list, err := h.adminReviews(ctx, fmt.Sprintf("WHERE %s ORDER BY r.created_at DESC, r.id DESC LIMIT %d OFFSET %d", w, per, (page-1)*per), a.args...)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.List(c, list, httpx.NewMeta(page, per, total))
}

func (h *adminH) adminReviews(ctx context.Context, tail string, args ...any) ([]AdminReview, error) {
	base, err := loadReviews(ctx, h.d.DB, tail, args...)
	if err != nil {
		return nil, err
	}
	out := make([]AdminReview, 0, len(base))
	for _, r := range base {
		ar := AdminReview{Review: r}
		if err := h.d.DB.QueryRow(ctx, `SELECT r.status, p.id, p.slug, p.name, r.user_id, r.reply_body FROM reviews r
			JOIN products p ON p.id = r.product_id WHERE r.id = $1`, r.ID).
			Scan(&ar.Status, &ar.Product.ID, &ar.Product.Slug, &ar.Product.Name, &ar.UserID, &ar.ReplyBody); err != nil {
			return nil, err
		}
		out = append(out, ar)
	}
	return out, nil
}

func (h *adminH) patchReview(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in struct {
		Status    *string `json:"status"`
		ReplyBody *string `json:"reply_body"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	if in.Status != nil && *in.Status != "published" && *in.Status != "hidden" {
		httpx.Validation(c, map[string]string{"status": "สถานะไม่ถูกต้อง"})
		return
	}
	if in.ReplyBody != nil && utf8.RuneCountInString(*in.ReplyBody) > 4000 {
		httpx.Validation(c, map[string]string{"reply_body": "คำตอบยาวเกินไป"})
		return
	}
	u, _ := auth.UserFrom(c)
	ctx := c.Request.Context()
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE reviews SET status = coalesce($2, status),
				reply_body = coalesce($3, reply_body),
				replied_at = CASE WHEN $3::text IS NULL THEN replied_at WHEN $3 = '' THEN NULL ELSE now() END,
				replied_by = CASE WHEN $3::text IS NULL THEN replied_by WHEN $3 = '' THEN NULL ELSE $4 END
			WHERE id = $1`, id, in.Status, in.ReplyBody, u.ID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return auth.Audit(c, tx, "review.moderate", "review", id, map[string]any{"status": in.Status, "replied": in.ReplyBody != nil})
	})
	if err != nil {
		h.writeErr(c, err)
		return
	}
	list, err := h.adminReviews(ctx, "WHERE r.id = $1", id)
	if err != nil || len(list) == 0 {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, list[0])
}
