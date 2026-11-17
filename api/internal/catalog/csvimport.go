package catalog

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/httpx"
)

// ---------- report shapes (docs/API.md §12.1 "CSV import") ----------

type ImportIssue struct {
	Row     int    `json:"row"`
	Column  string `json:"column"`
	Message string `json:"message"`
}

type ImportRow struct {
	Row           int      `json:"row"`
	Handle        string   `json:"handle"`
	Name          string   `json:"name"`
	Variant       string   `json:"variant"`
	SKU           string   `json:"sku"`
	SKUGenerated  bool     `json:"sku_generated"`
	PriceSatang   *int64   `json:"price_satang"`
	Stock         *int     `json:"stock"`
	Action        string   `json:"action"`         // create | update | skip | error (the variant)
	ProductAction string   `json:"product_action"` // create | update | skip | error
	Changes       []string `json:"changes"`
}

type ImportSummary struct {
	Rows           int `json:"rows"`
	Products       int `json:"products"`
	ProductsCreate int `json:"products_create"`
	ProductsUpdate int `json:"products_update"`
	ProductsSkip   int `json:"products_skip"`
	VariantsCreate int `json:"variants_create"`
	VariantsUpdate int `json:"variants_update"`
	VariantsSkip   int `json:"variants_skip"`
	ImagesAdd      int `json:"images_add"`
	ErrorRows      int `json:"error_rows"`
}

type ImportReport struct {
	DryRun    bool          `json:"dry_run"`
	Applied   bool          `json:"applied"`
	Encoding  string        `json:"encoding"`
	Summary   ImportSummary `json:"summary"`
	Errors    []ImportIssue `json:"errors"`
	Warnings  []ImportIssue `json:"warnings"`
	Rows      []ImportRow   `json:"rows"`
	Truncated bool          `json:"truncated"`
}

func (r *ImportReport) err(row int, col, msg string) {
	if len(r.Errors) >= maxImportIssues {
		r.Truncated = true
		return
	}
	r.Errors = append(r.Errors, ImportIssue{Row: row, Column: col, Message: msg})
}

func (r *ImportReport) warn(row int, col, msg string) {
	if len(r.Warnings) < maxImportIssues {
		r.Warnings = append(r.Warnings, ImportIssue{Row: row, Column: col, Message: msg})
	}
}

// ---------- catalog snapshot ----------

type snapVariant struct {
	ID           int64
	SKU, Name    string
	OptionValues map[string]string
	Price        int64
	Cost         *int64
	Stock, Low   int
	Weight       int
	Barcode      string
	Active       bool
	Sort         int
}

type snapProduct struct {
	ID                                        int64
	Slug, Name, NameEN, Subtitle, Description string
	Brand, Status, SEOTitle, SEODescription   string
	CategoryID                                int64
	Featured                                  bool
	Tags                                      []string
	Options                                   []Option
	Variants                                  []*snapVariant
	ImageURLs                                 map[string]bool
	ImageCount                                int
}

type skuOwner struct {
	VariantID, ProductID int64
	Slug                 string
	Deleted              bool
}

type snapshot struct {
	Categories map[string]int64
	Products   map[string]*snapProduct
	SKUs       map[string]skuOwner // lower(sku), every variant incl. soft-deleted products (the unique index is global)
}

func loadSnapshot(ctx context.Context, q httpx.Querier, handles []string) (*snapshot, error) {
	s := &snapshot{Categories: map[string]int64{}, Products: map[string]*snapProduct{}, SKUs: map[string]skuOwner{}}
	rows, err := q.Query(ctx, `SELECT slug, id FROM categories`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var slug string
		var id int64
		if err := rows.Scan(&slug, &id); err != nil {
			rows.Close()
			return nil, err
		}
		s.Categories[slug] = id
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	byID := map[int64]*snapProduct{}
	rows, err = q.Query(ctx, `SELECT id, slug, name, name_en, subtitle, description, category_id, brand, status, featured, tags, options,
			seo_title, seo_description
		FROM products WHERE deleted_at IS NULL AND slug = ANY($1) ORDER BY id FOR UPDATE`, handles)
	if err != nil {
		return nil, err
	}
	ids := []int64{}
	for rows.Next() {
		p := &snapProduct{ImageURLs: map[string]bool{}}
		var opts []byte
		if err := rows.Scan(&p.ID, &p.Slug, &p.Name, &p.NameEN, &p.Subtitle, &p.Description, &p.CategoryID, &p.Brand, &p.Status,
			&p.Featured, &p.Tags, &opts, &p.SEOTitle, &p.SEODescription); err != nil {
			rows.Close()
			return nil, err
		}
		_ = json.Unmarshal(opts, &p.Options)
		if p.Tags == nil {
			p.Tags = []string{}
		}
		s.Products[p.Slug] = p
		byID[p.ID] = p
		ids = append(ids, p.ID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = q.Query(ctx, `SELECT id, product_id, sku, name, option_values, price_satang, cost_satang, stock, low_stock_threshold,
			weight_grams, barcode, is_active, sort_order
		FROM product_variants WHERE product_id = ANY($1) ORDER BY id FOR UPDATE`, ids)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		v := &snapVariant{OptionValues: map[string]string{}}
		var pid int64
		var ov []byte
		if err := rows.Scan(&v.ID, &pid, &v.SKU, &v.Name, &ov, &v.Price, &v.Cost, &v.Stock, &v.Low, &v.Weight, &v.Barcode,
			&v.Active, &v.Sort); err != nil {
			rows.Close()
			return nil, err
		}
		_ = json.Unmarshal(ov, &v.OptionValues)
		byID[pid].Variants = append(byID[pid].Variants, v)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, p := range byID {
		sort.SliceStable(p.Variants, func(i, j int) bool { return p.Variants[i].Sort < p.Variants[j].Sort })
	}

	rows, err = q.Query(ctx, `SELECT product_id, url FROM product_images WHERE product_id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var pid int64
		var u string
		if err := rows.Scan(&pid, &u); err != nil {
			rows.Close()
			return nil, err
		}
		byID[pid].ImageURLs[u] = true
		byID[pid].ImageCount++
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = q.Query(ctx, `SELECT lower(v.sku), v.id, v.product_id, p.slug, p.deleted_at IS NOT NULL
		FROM product_variants v JOIN products p ON p.id = v.product_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		var o skuOwner
		if err := rows.Scan(&k, &o.VariantID, &o.ProductID, &o.Slug, &o.Deleted); err != nil {
			return nil, err
		}
		s.SKUs[k] = o
	}
	return s, rows.Err()
}

// ---------- plan ----------

type plannedVariant struct {
	Row       int
	Existing  *snapVariant
	V         snapVariant
	Changes   []string
	Generated bool
	optKey    string
}

type plannedProduct struct {
	Handle    string
	Existing  *snapProduct
	P         snapProduct
	Changes   []string
	Variants  []*plannedVariant
	NewImages []string
	FirstRow  int
}

var productCols = []string{"name_th", "name_en", "subtitle", "description", "category_slug", "brand", "status", "featured", "tags",
	"seo_title", "seo_description"}

func optKey(ov map[string]string) string {
	keys := make([]string, 0, len(ov))
	for k := range ov {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k + "\x00" + ov[k] + "\x01")
	}
	return b.String()
}

func runeLen(s string) int { return utf8.RuneCountInString(s) }

// planImport validates every row against the snapshot and computes the final state of each product/variant.
// It never touches the database; errors land in the report (the plan is only usable when there are none).
func planImport(pc *parsedCSV, s *snapshot) (*ImportReport, []*plannedProduct) {
	rep := &ImportReport{Encoding: pc.Encoding, Errors: []ImportIssue{}, Warnings: []ImportIssue{}, Rows: []ImportRow{}}
	if pc.Encoding == "windows-874" {
		rep.warn(0, "", "ไฟล์ไม่ได้บันทึกเป็น UTF-8 ระบบอ่านเป็นภาษาไทย Windows-874 ให้แล้ว กรุณาตรวจตัวอักษรในตารางตัวอย่าง")
	}
	for _, u := range pc.Unknown {
		rep.warn(1, u, "ไม่รู้จักคอลัมน์นี้ ระบบจะข้ามไป")
	}
	rep.Summary.Rows = len(pc.Rows)
	if len(pc.Rows) == 0 {
		rep.err(0, "", "ไม่มีข้อมูลสินค้าในไฟล์ (มีแต่หัวตาราง)")
		return rep, nil
	}

	// group rows by handle, first appearance order
	type group struct {
		handle string
		rows   []*csvRow
	}
	var groups []*group
	byHandle := map[string]*group{}
	rowErr := map[int]bool{}
	fail := func(row int, col, msg string) {
		rowErr[row] = true
		rep.err(row, col, msg)
	}
	for i := range pc.Rows {
		r := &pc.Rows[i]
		h := strings.ToLower(r.val("handle"))
		if h == "" {
			fail(r.Line, "handle", "กรุณากรอก handle (รหัสสินค้าสำหรับ URL เช่น linen-shirt)")
			continue
		}
		if !slugRe.MatchString(h) || len(h) > 120 {
			fail(r.Line, "handle", "handle ใช้ได้เฉพาะ a-z 0-9 และขีด (-) ไม่เกิน 120 ตัว")
			continue
		}
		g := byHandle[h]
		if g == nil {
			g = &group{handle: h}
			byHandle[h] = g
			groups = append(groups, g)
		}
		g.rows = append(g.rows, r)
	}

	explicit := map[string]int{} // lower(sku) -> row (batch)
	var plans []*plannedProduct
	rowInfo := map[int]*ImportRow{}
	var needSKU []*plannedVariant
	planOf := map[*plannedVariant]*plannedProduct{}

	for _, g := range groups {
		ex := s.Products[g.handle]
		pp := &plannedProduct{Handle: g.handle, Existing: ex, FirstRow: g.rows[0].Line}
		if ex != nil {
			pp.P = *ex
			pp.P.Tags = slices.Clone(ex.Tags)
			pp.P.Options = cloneOptions(ex.Options)
		} else {
			pp.P = snapProduct{Slug: g.handle, Status: "draft", Tags: []string{}, Options: []Option{}}
		}

		// product-level columns: one value per product
		vals := map[string]string{}
		from := map[string]int{}
		for _, r := range g.rows {
			for _, col := range productCols {
				v := r.val(col)
				if v == "" {
					continue
				}
				if prev, ok := vals[col]; ok && prev != v {
					fail(r.Line, col, fmt.Sprintf("ค่าไม่ตรงกับแถว %d ของสินค้า %s เดียวกัน", from[col], g.handle))
					continue
				}
				vals[col], from[col] = v, r.Line
			}
		}
		at := func(col string) int {
			if n, ok := from[col]; ok {
				return n
			}
			return g.rows[0].Line
		}
		if v, ok := vals["name_th"]; ok {
			if runeLen(v) > 200 {
				fail(at("name_th"), "name_th", "ชื่อสินค้ายาวเกิน 200 ตัวอักษร")
			}
			pp.P.Name = v
		} else if ex == nil {
			fail(at("name_th"), "name_th", "สินค้าใหม่ต้องมีชื่อสินค้า (name_th)")
		}
		if v, ok := vals["name_en"]; ok {
			if runeLen(v) > 200 {
				fail(at("name_en"), "name_en", "ชื่อภาษาอังกฤษยาวเกิน 200 ตัวอักษร")
			}
			pp.P.NameEN = v
		}
		if v, ok := vals["subtitle"]; ok {
			if runeLen(v) > 300 {
				fail(at("subtitle"), "subtitle", "คำโปรยยาวเกิน 300 ตัวอักษร")
			}
			pp.P.Subtitle = v
		}
		if v, ok := vals["description"]; ok {
			if runeLen(v) > 50000 {
				fail(at("description"), "description", "รายละเอียดยาวเกินไป")
			}
			pp.P.Description = v
		}
		if v, ok := vals["category_slug"]; ok {
			if id, found := s.Categories[strings.ToLower(v)]; found {
				pp.P.CategoryID = id
			} else {
				fail(at("category_slug"), "category_slug", fmt.Sprintf("ไม่พบหมวดหมู่ %q (ใช้ slug ของหมวดหมู่ เช่น t-shirts)", v))
			}
		} else if ex == nil {
			fail(at("category_slug"), "category_slug", "สินค้าใหม่ต้องระบุหมวดหมู่ (category_slug)")
		}
		if v, ok := vals["brand"]; ok {
			if runeLen(v) > 100 {
				fail(at("brand"), "brand", "ชื่อแบรนด์ยาวเกิน 100 ตัวอักษร")
			}
			pp.P.Brand = v
		}
		if v, ok := vals["status"]; ok {
			if st, valid := parseStatus(v); valid {
				pp.P.Status = st
			} else {
				fail(at("status"), "status", "สถานะต้องเป็น draft, active, hidden หรือ archived")
			}
		}
		if v, ok := vals["featured"]; ok {
			if b, valid := parseBoolCell(v); valid {
				pp.P.Featured = b
			} else {
				fail(at("featured"), "featured", "ต้องเป็น true หรือ false")
			}
		}
		if v, ok := vals["tags"]; ok {
			pp.P.Tags = cleanTags(splitList(v))
		}
		if v, ok := vals["seo_title"]; ok {
			pp.P.SEOTitle = v
		}
		if v, ok := vals["seo_description"]; ok {
			pp.P.SEODescription = v
		}

		// options per row
		type rowOpts struct {
			names []string
			ov    map[string]string
		}
		ropts := make([]rowOpts, len(g.rows))
		var canon []string
		canonRow := 0
		for i, r := range g.rows {
			ro := rowOpts{ov: map[string]string{}}
			for k := 1; k <= maxOptions; k++ {
				nc, vc := fmt.Sprintf("option%d_name", k), fmt.Sprintf("option%d_value", k)
				n, v := r.val(nc), r.val(vc)
				switch {
				case n == "" && v == "":
					continue
				case n == "":
					fail(r.Line, nc, "มีค่าตัวเลือกแต่ไม่มีชื่อตัวเลือก (เช่น สี, ไซซ์)")
					continue
				case v == "":
					fail(r.Line, vc, fmt.Sprintf("กรุณากรอกค่าของตัวเลือก %s", n))
					continue
				case runeLen(n) > 50:
					fail(r.Line, nc, "ชื่อตัวเลือกยาวเกิน 50 ตัวอักษร")
				case runeLen(v) > 100:
					fail(r.Line, vc, "ค่าตัวเลือกยาวเกิน 100 ตัวอักษร")
				}
				if _, dup := ro.ov[n]; dup {
					fail(r.Line, nc, fmt.Sprintf("ชื่อตัวเลือก %s ซ้ำในแถวเดียวกัน", n))
					continue
				}
				ro.names = append(ro.names, n)
				ro.ov[n] = v
			}
			ropts[i] = ro
			if canon == nil && len(ro.names) > 0 {
				canon, canonRow = ro.names, r.Line
			}
		}
		for i, r := range g.rows {
			ro := ropts[i]
			if len(g.rows) > 1 && len(ro.names) == 0 && !rowErr[r.Line] {
				fail(r.Line, "option1_name", "สินค้าที่มีหลายแถวต้องระบุตัวเลือก (เช่น option1_name=ไซซ์, option1_value=M) ทุกแถว")
			} else if len(ro.names) > 0 && !slices.Equal(ro.names, canon) {
				fail(r.Line, "option1_name", fmt.Sprintf("ชื่อตัวเลือกต้องเหมือนแถว %d (%s)", canonRow, strings.Join(canon, ", ")))
			}
		}

		// variants
		byOpt := map[string]*snapVariant{}
		var exByID map[int64]*snapVariant
		nextSort := 0
		if ex != nil {
			exByID = map[int64]*snapVariant{}
			for _, v := range ex.Variants {
				exByID[v.ID] = v
				if _, ok := byOpt[optKey(v.OptionValues)]; !ok {
					byOpt[optKey(v.OptionValues)] = v
				}
				nextSort = max(nextSort, v.Sort+1)
			}
		}
		usedVariant := map[int64]int{}
		usedOpt := map[string]int{}
		for i, r := range g.rows {
			ro := ropts[i]
			pv := &plannedVariant{Row: r.Line}
			planOf[pv] = pp
			info := &ImportRow{Row: r.Line, Handle: g.handle, Changes: []string{}}
			rowInfo[r.Line] = info

			key := optKey(ro.ov)
			if prev, dup := usedOpt[key]; dup && len(ro.names) > 0 {
				fail(r.Line, "option1_value", fmt.Sprintf("ตัวเลือกนี้ซ้ำกับแถว %d", prev))
			} else if dup {
				fail(r.Line, "handle", fmt.Sprintf("สินค้าไม่มีตัวเลือกแต่ handle ซ้ำกับแถว %d", prev))
			}
			usedOpt[key] = r.Line
			pv.optKey = key

			sku := r.val("sku")
			if sku != "" {
				if !skuRe.MatchString(sku) {
					fail(r.Line, "sku", "SKU ใช้ได้เฉพาะ A-Z a-z 0-9 . _ - (1-64 ตัว)")
				} else if prev, dup := explicit[strings.ToLower(sku)]; dup {
					fail(r.Line, "sku", fmt.Sprintf("SKU %s ซ้ำกับแถว %d", sku, prev))
				} else {
					explicit[strings.ToLower(sku)] = r.Line
					if o, taken := s.SKUs[strings.ToLower(sku)]; taken {
						switch {
						case o.Deleted:
							fail(r.Line, "sku", fmt.Sprintf("SKU %s ถูกใช้โดยสินค้าที่ลบไปแล้ว (%s) กรุณาใช้ SKU อื่น", sku, o.Slug))
						case ex == nil || o.ProductID != ex.ID:
							fail(r.Line, "sku", fmt.Sprintf("SKU %s เป็นของสินค้าอื่น (%s)", sku, o.Slug))
						default:
							pv.Existing = exByID[o.VariantID]
						}
					} else if ex != nil && len(ro.names) > 0 {
						if v := byOpt[key]; v != nil {
							fail(r.Line, "sku", fmt.Sprintf("ตัวเลือกนี้มีอยู่แล้วด้วย SKU %s ใช้ SKU เดิมหรือเว้นว่าง", v.SKU))
						}
					}
				}
			} else if ex != nil {
				if len(ro.names) > 0 {
					pv.Existing = byOpt[key]
				} else if len(g.rows) == 1 && len(ex.Variants) == 1 {
					pv.Existing = ex.Variants[0]
				}
			}
			if pv.Existing != nil {
				if prev, dup := usedVariant[pv.Existing.ID]; dup {
					fail(r.Line, "sku", fmt.Sprintf("ตัวเลือกสินค้าเดียวกับแถว %d", prev))
				}
				usedVariant[pv.Existing.ID] = r.Line
			}

			// variant values
			if pv.Existing != nil {
				pv.V = *pv.Existing
				pv.V.OptionValues = cloneMap(pv.Existing.OptionValues)
			} else {
				pv.V = snapVariant{SKU: sku, OptionValues: map[string]string{}, Low: 5, Active: true, Sort: nextSort}
				nextSort++
			}
			if len(ro.names) > 0 && (pv.Existing == nil || optKey(pv.V.OptionValues) != key) {
				pv.V.OptionValues = ro.ov
				parts := make([]string, len(ro.names))
				for j, n := range ro.names {
					parts[j] = ro.ov[n]
				}
				pv.V.Name = strings.Join(parts, " / ")
			}
			if v := r.val("price_baht"); v != "" {
				if sat, msg := parseBaht(v); msg != "" {
					fail(r.Line, "price_baht", msg)
				} else if sat <= 0 {
					fail(r.Line, "price_baht", "ราคาต้องมากกว่า 0")
				} else {
					pv.V.Price = sat
				}
			} else if pv.Existing == nil {
				fail(r.Line, "price_baht", "ตัวเลือกใหม่ต้องมีราคา (price_baht)")
			}
			if v := r.val("cost_baht"); v != "" {
				if sat, msg := parseBaht(v); msg != "" {
					fail(r.Line, "cost_baht", strings.ReplaceAll(msg, "ราคา", "ต้นทุน"))
				} else {
					pv.V.Cost = &sat
				}
			}
			for _, f := range []struct {
				col string
				dst *int
				max int
			}{{"stock", &pv.V.Stock, 10_000_000}, {"low_stock_threshold", &pv.V.Low, 1_000_000}, {"weight_grams", &pv.V.Weight, 1_000_000}} {
				if v := r.val(f.col); v != "" {
					if n, msg := parseCount(v, f.max); msg != "" {
						fail(r.Line, f.col, msg)
					} else {
						*f.dst = n
					}
				}
			}
			if v := r.val("barcode"); v != "" {
				if len(v) > 64 {
					fail(r.Line, "barcode", "บาร์โค้ดยาวเกิน 64 ตัว")
				}
				pv.V.Barcode = v
			}
			if v := r.val("variant_active"); v != "" {
				if b, valid := parseBoolCell(v); valid {
					pv.V.Active = b
				} else {
					fail(r.Line, "variant_active", "ต้องเป็น true หรือ false")
				}
			}

			// images (product level, external URLs stored as-is; not downloaded)
			for _, u := range splitList(r.val("image_urls")) {
				switch {
				case pp.P.ImageURLs[u] || slices.Contains(pp.NewImages, u):
				case !isHTTPURL(u):
					rep.warn(r.Line, "image_urls", fmt.Sprintf("ข้ามรูป %q: ต้องเป็นลิงก์ http(s) เต็ม", trimForMsg(u)))
				case pp.P.ImageCount+len(pp.NewImages) >= 30:
					rep.warn(r.Line, "image_urls", "ข้ามรูปที่เกิน 30 รูปต่อสินค้า")
				default:
					pp.NewImages = append(pp.NewImages, u)
				}
			}

			if pv.Existing == nil && sku == "" && !rowErr[r.Line] {
				needSKU = append(needSKU, pv)
			}
			pp.Variants = append(pp.Variants, pv)
		}
		pp.P.Options = mergeOptions(pp.P.Options, canon, pp.Variants)
		plans = append(plans, pp)
	}

	// auto SKUs after every explicit one is known, so a generated SKU never steals one used later in the file
	taken := func(k string) bool {
		_, db := s.SKUs[k]
		_, batch := explicit[k]
		return db || batch
	}
	for _, pv := range needSKU {
		vals := []string{}
		pp := planOf[pv]
		for _, o := range pp.P.Options {
			if v, ok := pv.V.OptionValues[o.Name]; ok {
				vals = append(vals, v)
			}
		}
		pv.V.SKU = SuggestSKU(pp.Handle, vals, taken)
		pv.Generated = true
		explicit[strings.ToLower(pv.V.SKU)] = pv.Row
	}

	// diff + summary
	for _, pp := range plans {
		pp.Changes = productChanges(pp)
		pa := "skip"
		switch {
		case pp.Existing == nil:
			pa = "create"
		case len(pp.Changes) > 0:
			pa = "update"
		}
		groupErr := false
		for _, pv := range pp.Variants {
			groupErr = groupErr || rowErr[pv.Row]
			pv.Changes = variantChanges(pv)
			if pa == "skip" && (pv.Existing == nil || len(pv.Changes) > 0) {
				pa = "update" // a product counts as updated when any of its variants is added or changed
			}
		}
		if groupErr {
			pa = "error"
		}
		rep.Summary.Products++
		switch pa {
		case "create":
			rep.Summary.ProductsCreate++
		case "update":
			rep.Summary.ProductsUpdate++
		case "skip":
			rep.Summary.ProductsSkip++
		}
		if !groupErr {
			rep.Summary.ImagesAdd += len(pp.NewImages)
		}
		for _, pv := range pp.Variants {
			info := rowInfo[pv.Row]
			info.Name, info.Variant, info.SKU, info.SKUGenerated = pp.P.Name, pv.V.Name, pv.V.SKU, pv.Generated
			price, stock := pv.V.Price, pv.V.Stock
			if price > 0 {
				info.PriceSatang = &price
			}
			info.Stock = &stock
			info.ProductAction = pa
			switch {
			case rowErr[pv.Row]:
				info.Action = "error"
				rep.Summary.ErrorRows++
			case pv.Existing == nil:
				info.Action = "create"
				rep.Summary.VariantsCreate++
			case len(pv.Changes) > 0:
				info.Action = "update"
				rep.Summary.VariantsUpdate++
			default:
				info.Action = "skip"
				rep.Summary.VariantsSkip++
			}
			info.Changes = pv.Changes
			if pv.Row == pp.FirstRow && pa == "update" {
				info.Changes = append(slices.Clone(pp.Changes), pv.Changes...)
			}
		}
	}
	// rows rejected before grouping (bad handle) still appear in the preview
	for _, r := range pc.Rows {
		if _, ok := rowInfo[r.Line]; !ok {
			rowInfo[r.Line] = &ImportRow{Row: r.Line, Handle: r.val("handle"), Name: r.val("name_th"), SKU: r.val("sku"),
				Action: "error", ProductAction: "error", Changes: []string{}}
			rep.Summary.ErrorRows++
		}
	}
	for _, r := range pc.Rows {
		rep.Rows = append(rep.Rows, *rowInfo[r.Line])
	}
	sort.SliceStable(rep.Errors, func(i, j int) bool { return rep.Errors[i].Row < rep.Errors[j].Row })
	return rep, plans
}

func cloneMap(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func cloneOptions(in []Option) []Option {
	out := make([]Option, len(in))
	for i, o := range in {
		out[i] = Option{Name: o.Name, Values: slices.Clone(o.Values)}
	}
	return out
}

// mergeOptions keeps existing options (values in their order) and appends names/values first seen in the file.
func mergeOptions(existing []Option, canon []string, vars []*plannedVariant) []Option {
	out := cloneOptions(existing)
	idx := map[string]int{}
	for i, o := range out {
		idx[o.Name] = i
	}
	for _, n := range canon {
		if _, ok := idx[n]; !ok {
			idx[n] = len(out)
			out = append(out, Option{Name: n, Values: []string{}})
		}
	}
	for _, pv := range vars {
		for _, n := range canon {
			v, ok := pv.V.OptionValues[n]
			if !ok {
				continue
			}
			o := &out[idx[n]]
			if !slices.Contains(o.Values, v) {
				o.Values = append(o.Values, v)
			}
		}
	}
	return out
}

func productChanges(pp *plannedProduct) []string {
	ch := []string{}
	ex := pp.Existing
	if ex == nil {
		return ch
	}
	p := pp.P
	add := func(changed bool, name string) {
		if changed {
			ch = append(ch, name)
		}
	}
	add(p.Name != ex.Name, "name_th")
	add(p.NameEN != ex.NameEN, "name_en")
	add(p.Subtitle != ex.Subtitle, "subtitle")
	add(p.Description != ex.Description, "description")
	add(p.CategoryID != ex.CategoryID, "category_slug")
	add(p.Brand != ex.Brand, "brand")
	add(p.Status != ex.Status, "status")
	add(p.Featured != ex.Featured, "featured")
	add(!slices.Equal(p.Tags, ex.Tags), "tags")
	add(p.SEOTitle != ex.SEOTitle, "seo_title")
	add(p.SEODescription != ex.SEODescription, "seo_description")
	add(!optionsEqual(p.Options, ex.Options), "options")
	add(len(pp.NewImages) > 0, "image_urls")
	return ch
}

func optionsEqual(a, b []Option) bool {
	return slices.EqualFunc(a, b, func(x, y Option) bool { return x.Name == y.Name && slices.Equal(x.Values, y.Values) })
}

func variantChanges(pv *plannedVariant) []string {
	ch := []string{}
	ex := pv.Existing
	if ex == nil {
		return ch
	}
	v := pv.V
	add := func(changed bool, name string) {
		if changed {
			ch = append(ch, name)
		}
	}
	add(optKey(v.OptionValues) != optKey(ex.OptionValues), "options")
	add(v.Price != ex.Price, "price_baht")
	add(!eqPtr(v.Cost, ex.Cost), "cost_baht")
	add(v.Stock != ex.Stock, "stock")
	add(v.Low != ex.Low, "low_stock_threshold")
	add(v.Weight != ex.Weight, "weight_grams")
	add(v.Barcode != ex.Barcode, "barcode")
	add(v.Active != ex.Active, "variant_active")
	return ch
}

func eqPtr(a, b *int64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func isHTTPURL(s string) bool {
	if len(s) > 2000 {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func trimForMsg(s string) string {
	if runeLen(s) > 60 {
		return string([]rune(s)[:60]) + "…"
	}
	return s
}

// ---------- apply ----------

type rowError struct {
	Row int
	Err error
}

func (e *rowError) Error() string { return fmt.Sprintf("row %d: %v", e.Row, e.Err) }

func applyImport(ctx context.Context, tx pgx.Tx, plans []*plannedProduct) (created, updated []int64, err error) {
	for _, pp := range plans {
		p := pp.P
		optsB, _ := json.Marshal(p.Options)
		id := int64(0)
		if pp.Existing == nil {
			err := tx.QueryRow(ctx, `INSERT INTO products (slug, name, name_en, subtitle, description, category_id, brand, status, featured,
					tags, options, seo_title, seo_description, published_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $8 = 'active' THEN now() END) RETURNING id`,
				pp.Handle, p.Name, p.NameEN, p.Subtitle, p.Description, p.CategoryID, p.Brand, p.Status, p.Featured, p.Tags, optsB,
				p.SEOTitle, p.SEODescription).Scan(&id)
			if err != nil {
				return nil, nil, &rowError{pp.FirstRow, err}
			}
			created = append(created, id)
		} else {
			id = pp.Existing.ID
			if len(pp.Changes) > 0 {
				if _, err := tx.Exec(ctx, `UPDATE products SET name = $2, name_en = $3, subtitle = $4, description = $5, category_id = $6,
						brand = $7, status = $8, featured = $9, tags = $10, options = $11, seo_title = $12, seo_description = $13,
						published_at = CASE WHEN $8 = 'active' AND published_at IS NULL THEN now() ELSE published_at END
					WHERE id = $1`, id, p.Name, p.NameEN, p.Subtitle, p.Description, p.CategoryID, p.Brand, p.Status, p.Featured,
					p.Tags, optsB, p.SEOTitle, p.SEODescription); err != nil {
					return nil, nil, &rowError{pp.FirstRow, err}
				}
				updated = append(updated, id)
			}
		}
		for _, pv := range pp.Variants {
			v := pv.V
			ovb, _ := json.Marshal(v.OptionValues)
			if pv.Existing == nil {
				_, err := tx.Exec(ctx, `INSERT INTO product_variants (product_id, sku, name, option_values, price_satang, cost_satang, stock,
						low_stock_threshold, weight_grams, barcode, is_active, sort_order)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
					id, v.SKU, v.Name, ovb, v.Price, v.Cost, v.Stock, v.Low, v.Weight, v.Barcode, v.Active, v.Sort)
				if err != nil {
					return nil, nil, &rowError{pv.Row, err}
				}
			} else if len(pv.Changes) > 0 {
				_, err := tx.Exec(ctx, `UPDATE product_variants SET name = $2, option_values = $3, price_satang = $4, cost_satang = $5,
						stock = $6, low_stock_threshold = $7, weight_grams = $8, barcode = $9, is_active = $10
					WHERE id = $1`, v.ID, v.Name, ovb, v.Price, v.Cost, v.Stock, v.Low, v.Weight, v.Barcode, v.Active)
				if err != nil {
					return nil, nil, &rowError{pv.Row, err}
				}
			}
		}
		for i, u := range pp.NewImages {
			// external URL: no storage_key (deleteImage skips storage for an empty key)
			if _, err := tx.Exec(ctx, `INSERT INTO product_images (product_id, storage_key, url, alt, sort_order)
				VALUES ($1, '', $2, $3, (SELECT coalesce(max(sort_order) + 1, 0) FROM product_images WHERE product_id = $1))`,
				id, u, trimAlt(p.Name)); err != nil {
				return nil, nil, &rowError{pp.FirstRow, fmt.Errorf("image %d: %w", i, err)}
			}
		}
	}
	return created, updated, nil
}

func trimAlt(s string) string {
	if runeLen(s) > 300 {
		return string([]rune(s)[:300])
	}
	return s
}

func dbIssueMessage(err error) string {
	switch {
	case httpx.IsUniqueViolation(err):
		return "ข้อมูลซ้ำกับที่มีอยู่แล้ว (handle หรือ SKU) อาจมีผู้แก้ไขสินค้าพร้อมกัน กรุณาตรวจสอบใหม่"
	case httpx.IsCheckViolation(err):
		return "ข้อมูลไม่ผ่านเงื่อนไขของระบบ"
	case httpx.IsFKViolation(err):
		return "ไม่พบข้อมูลที่อ้างอิง (หมวดหมู่)"
	}
	return ""
}

// ---------- handlers ----------

const importLockKey = "shopship.catalog_import"

// importProducts: POST /admin/products/import?dry_run=true|false (multipart "file"). Dry run (the default) runs
// the whole import in a transaction and rolls it back, so database checks are validated too. A real run is
// one transaction: any error => nothing is written (422 with the report in error.details).
func (h *adminH) importProducts(c *gin.Context) {
	dry := true
	if v, present, valid := httpx.QueryBool(c, "dry_run"); !valid {
		httpx.BadRequest(c, "พารามิเตอร์ dry_run ต้องเป็น true หรือ false")
		return
	} else if present {
		dry = v
	}
	data, name, fields := readCSVUpload(c)
	if fields != nil {
		httpx.Validation(c, fields)
		return
	}
	pc, err := parseCSV(data)
	if err != nil {
		msg := err.Error()
		if errors.Is(err, errNoHeader) {
			msg = "ไฟล์ว่าง ไม่พบหัวตาราง"
		}
		httpx.Validation(c, map[string]string{"file": msg})
		return
	}
	handles := []string{}
	for _, r := range pc.Rows {
		if hd := strings.ToLower(r.val("handle")); hd != "" {
			handles = append(handles, hd)
		}
	}
	sum := sha256.Sum256(data)
	ctx := c.Request.Context()
	var rep *ImportReport
	errRollback := errors.New("rollback")
	err = httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, importLockKey); err != nil {
			return err
		}
		snap, err := loadSnapshot(ctx, tx, handles)
		if err != nil {
			return err
		}
		var plans []*plannedProduct
		rep, plans = planImport(pc, snap)
		rep.DryRun = dry
		if len(rep.Errors) > 0 {
			return errRollback
		}
		created, updated, err := applyImport(ctx, tx, plans)
		if err != nil {
			var re *rowError
			if errors.As(err, &re) {
				if msg := dbIssueMessage(re.Err); msg != "" {
					rep.err(re.Row, "", msg)
					markRowError(rep, re.Row)
					return errRollback
				}
			}
			return err
		}
		if dry {
			return errRollback
		}
		if err := auth.Audit(c, tx, "product.import", "product", nil, map[string]any{
			"file": name, "sha256": hex.EncodeToString(sum[:]), "rows": rep.Summary.Rows, "summary": rep.Summary,
			"created_ids": capIDs(created), "updated_ids": capIDs(updated),
		}); err != nil {
			return err
		}
		rep.Applied = true
		return nil
	})
	if err != nil && !errors.Is(err, errRollback) {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if !dry && !rep.Applied {
		httpx.ErrorDetails(c, http.StatusUnprocessableEntity, httpx.CodeValidation,
			fmt.Sprintf("นำเข้าไม่สำเร็จ พบข้อผิดพลาด %d รายการ ยังไม่มีการบันทึกข้อมูลใด ๆ", len(rep.Errors)), rep)
		return
	}
	httpx.Data(c, http.StatusOK, rep)
}

func markRowError(rep *ImportReport, row int) {
	for i := range rep.Rows {
		if rep.Rows[i].Row == row && rep.Rows[i].Action != "error" {
			rep.Rows[i].Action = "error"
			rep.Summary.ErrorRows++
		}
	}
}

func capIDs(ids []int64) []int64 {
	if len(ids) > 500 {
		return ids[:500]
	}
	if ids == nil {
		return []int64{}
	}
	return ids
}

func readCSVUpload(c *gin.Context) ([]byte, string, map[string]string) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxUploadBytes+(1<<20))
	fh, err := c.FormFile("file")
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) || strings.Contains(err.Error(), "too large") {
			return nil, "", map[string]string{"file": "ไฟล์ใหญ่เกิน 8 MB"}
		}
		return nil, "", map[string]string{"file": "กรุณาเลือกไฟล์ CSV"}
	}
	if fh.Size > MaxUploadBytes {
		return nil, "", map[string]string{"file": "ไฟล์ใหญ่เกิน 8 MB"}
	}
	f, err := fh.Open()
	if err != nil {
		return nil, "", map[string]string{"file": "อ่านไฟล์ไม่ได้"}
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxUploadBytes+1))
	if err != nil || len(data) > MaxUploadBytes {
		return nil, "", map[string]string{"file": "ไฟล์ใหญ่เกิน 8 MB"}
	}
	if bytes.HasPrefix(data, []byte("PK\x03\x04")) {
		return nil, "", map[string]string{"file": "ไฟล์นี้เป็น Excel (.xlsx) กรุณาบันทึกเป็น \"CSV UTF-8 (Comma delimited)\" ก่อนอัปโหลด"}
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, "", map[string]string{"file": "ไฟล์ว่าง"}
	}
	name := fh.Filename
	if runeLen(name) > 200 {
		name = string([]rune(name)[:200])
	}
	return data, name, nil
}

func bangkokDate(t time.Time) string {
	return t.In(time.FixedZone("ICT", 7*3600)).Format("20060102")
}

func sendCSV(c *gin.Context, filename string, records [][]string) {
	var buf bytes.Buffer
	w, _ := newCSVWriter(&buf)
	for _, r := range records {
		for i := range r {
			r[i] = escapeCell(r[i])
		}
		_ = w.Write(r)
	}
	w.Flush()
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Data(http.StatusOK, "text/csv; charset=utf-8", buf.Bytes())
}

// exportProducts: GET /admin/products/export.csv[?status=] — every non-deleted product, one row per variant,
// in the import format (re-importing an unchanged export is all "skip").
func (h *adminH) exportProducts(c *gin.Context) {
	ctx := c.Request.Context()
	status := c.Query("status")
	if status != "" && !productStatuses[status] {
		httpx.BadRequest(c, "พารามิเตอร์ status ไม่ถูกต้อง")
		return
	}
	rows, err := h.d.DB.Query(ctx, `SELECT p.id, p.slug, p.name, p.name_en, p.subtitle, p.description, c.slug, p.brand, p.status, p.featured,
			p.tags, p.options, p.seo_title, p.seo_description,
			coalesce((SELECT string_agg(i.url, '|' ORDER BY i.sort_order, i.id) FROM product_images i WHERE i.product_id = p.id), ''),
			v.sku, v.option_values, v.price_satang, v.cost_satang, v.stock, v.low_stock_threshold, v.weight_grams, v.barcode, v.is_active
		FROM products p JOIN categories c ON c.id = p.category_id JOIN product_variants v ON v.product_id = p.id
		WHERE p.deleted_at IS NULL AND ($1 = '' OR p.status = $1)
		ORDER BY p.id, v.sort_order, v.id`, status)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	defer rows.Close()
	out := [][]string{slices.Clone(CSVColumns)}
	lastID := int64(0)
	for rows.Next() {
		var (
			pid                                                                  int64
			slug, name, nameEN, sub, desc, cat, brand, st, seoT, seoD, imgs, sku string
			featured, active                                                     bool
			tags                                                                 []string
			optsB, ovB                                                           []byte
			price                                                                int64
			cost                                                                 *int64
			stock, low, weight                                                   int
			barcode                                                              string
		)
		if err := rows.Scan(&pid, &slug, &name, &nameEN, &sub, &desc, &cat, &brand, &st, &featured, &tags, &optsB, &seoT, &seoD, &imgs,
			&sku, &ovB, &price, &cost, &stock, &low, &weight, &barcode, &active); err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
		var opts []Option
		_ = json.Unmarshal(optsB, &opts)
		ov := map[string]string{}
		_ = json.Unmarshal(ovB, &ov)
		names := []string{}
		for _, o := range opts {
			if _, ok := ov[o.Name]; ok {
				names = append(names, o.Name)
			}
		}
		extra := []string{}
		for k := range ov {
			if !slices.Contains(names, k) {
				extra = append(extra, k)
			}
		}
		sort.Strings(extra)
		names = append(names, extra...)
		optCells := make([]string, 2*maxOptions)
		for i, n := range names {
			if i < maxOptions {
				optCells[2*i], optCells[2*i+1] = n, ov[n]
			}
		}
		costCell := ""
		if cost != nil {
			costCell = formatBahtCell(*cost)
		}
		if pid == lastID {
			imgs = "" // images once per product
		}
		lastID = pid
		rec := []string{slug, name, nameEN, sub, desc, cat, brand, st, fmt.Sprint(featured), strings.Join(tags, "|")}
		rec = append(rec, optCells...)
		rec = append(rec, sku, formatBahtCell(price), costCell, fmt.Sprint(stock), fmt.Sprint(low), fmt.Sprint(weight), barcode,
			fmt.Sprint(active), imgs, seoT, seoD)
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	sendCSV(c, "shopship-products-"+bangkokDate(h.d.Now())+".csv", out)
}

// importTemplate: GET /admin/products/import/template.csv — header + example rows (Thai, options, auto SKU).
func (h *adminH) importTemplate(c *gin.Context) {
	cat := "t-shirts"
	_ = h.d.DB.QueryRow(c.Request.Context(), `SELECT slug FROM categories WHERE is_active
		ORDER BY parent_id IS NULL, sort_order, id LIMIT 1`).Scan(&cat)
	sendCSV(c, "shopship-products-template.csv", importTemplateRows(cat))
}

func importTemplateRows(cat string) [][]string {
	row := func(kv map[string]string) []string {
		r := make([]string, len(CSVColumns))
		for i, col := range CSVColumns {
			r[i] = kv[col]
		}
		return r
	}
	desc := "ผ้าลินินแท้ 100% ใส่สบาย ระบายอากาศดี\nซักเครื่องได้"
	return [][]string{
		slices.Clone(CSVColumns),
		row(map[string]string{"handle": "linen-shirt", "name_th": "เสื้อเชิ้ตลินิน, คอจีน", "name_en": "Linen Shirt", "subtitle": "ใส่สบายทุกวัน",
			"description": desc, "category_slug": cat, "brand": "ShopShip", "status": "draft", "featured": "false", "tags": "ลินิน|เสื้อเชิ้ต",
			"option1_name": "สี", "option1_value": "ขาว", "option2_name": "ไซซ์", "option2_value": "M", "sku": "LINEN-WHT-M",
			"price_baht": "590.00", "cost_baht": "250", "stock": "20", "low_stock_threshold": "5", "weight_grams": "250",
			"image_urls": "https://example.com/linen-white-1.jpg|https://example.com/linen-white-2.jpg"}),
		row(map[string]string{"handle": "linen-shirt", "option1_name": "สี", "option1_value": "ขาว", "option2_name": "ไซซ์", "option2_value": "L",
			"price_baht": "590", "stock": "15", "weight_grams": "260"}),
		row(map[string]string{"handle": "linen-shirt", "option1_name": "สี", "option1_value": "ดำ", "option2_name": "ไซซ์", "option2_value": "M",
			"price_baht": "1,290.50", "stock": "8", "weight_grams": "250"}),
		row(map[string]string{"handle": "canvas-tote", "name_th": "กระเป๋าผ้าแคนวาส", "name_en": "Canvas Tote", "category_slug": cat,
			"status": "active", "price_baht": "249", "stock": "100", "weight_grams": "180"}),
	}
}
