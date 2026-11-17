package admin_test

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/shopship/shop/api/internal/admin/demo"
	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/promotions"
	"github.com/shopship/shop/api/internal/testdb"
	"github.com/shopship/shop/api/internal/testdb/apitest"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

type card struct {
	ID     int64  `json:"id"`
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	NameEN string `json:"name_en"`
}

func seeded(t *testing.T) *apitest.Env {
	t.Helper()
	e := apitest.New(t)
	demo.PromotionsSeeder = promotions.SeedDemo
	t.Cleanup(func() { demo.PromotionsSeeder = nil })
	opt := demo.Options{Now: time.Now(), Storage: e.Deps.Storage, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	done, err := demo.Seed(context.Background(), e.Pool, opt)
	if err != nil || !done {
		t.Fatalf("seed: %v %v", done, err)
	}
	if again, err := demo.Seed(context.Background(), e.Pool, opt); err != nil || again {
		t.Fatalf("second seed must be a no-op: %v %v", again, err)
	}
	return e
}

func TestSeedDemoCatalogAndSearch(t *testing.T) {
	e := seeded(t)
	var products, variants, top, reviews int
	e.Scalar(&products, `SELECT count(*) FROM products WHERE status = 'active'`)
	e.Scalar(&variants, `SELECT count(*) FROM product_variants`)
	e.Scalar(&top, `SELECT count(*) FROM categories WHERE parent_id IS NULL`)
	e.Scalar(&reviews, `SELECT count(*) FROM reviews`)
	if products < 55 || top != 8 || variants < products || reviews == 0 {
		t.Fatalf("products=%d variants=%d top=%d reviews=%d", products, variants, top, reviews)
	}
	c := e.Client()

	// demo passwords match (API login is rate limited per IP: 5 / 10 min)
	for _, u := range demo.Users {
		var hash string
		e.Scalar(&hash, `SELECT password_hash FROM users WHERE email = $1`, u.Email)
		if ok, _ := auth.VerifyPassword(u.Password, hash); !ok {
			t.Fatalf("demo password for %s does not verify", u.Email)
		}
	}
	e.Client().Login("gold@shopship.local", "Demo-Gold-2026").Must(t, 200)

	var list []card
	get := func(q string) []card {
		r := c.Do("GET", "/api/v1/products?"+q, nil).Must(t, 200)
		if !strings.Contains(r.Header.Get("Cache-Control"), "public") {
			t.Fatal("catalog not publicly cacheable")
		}
		var out []card
		r.Data(t, &out)
		return out
	}
	// Thai substring, Thai typo (ยืด -> ยึด), English name, SKU
	for _, q := range []string{"เสื้อยืด", "เสื้อยึด", "Classic Cotton", "cotteecla"} {
		list = get("q=" + url.QueryEscape(q))
		if len(list) == 0 {
			t.Fatalf("search %q found nothing", q)
		}
		if list[0].Slug != "cotton-tee-classic" && list[0].Slug != "oversize-tee-graphic" {
			t.Fatalf("search %q top hit = %s", q, list[0].Slug)
		}
	}
	if list[0].NameEN == "" {
		t.Fatal("name_en missing on card")
	}
	// filters + sorts
	fashion := get("category=fashion&per_page=48")
	tshirts := get("category=tshirts")
	if len(fashion) <= len(tshirts) || len(tshirts) != 2 {
		t.Fatalf("category filter: fashion=%d tshirts=%d", len(fashion), len(tshirts))
	}
	cheap := get("sort=price_asc&max_price=10000&in_stock=true")
	for _, p := range cheap {
		_ = p
	}
	c.Do("GET", "/api/v1/products?sort=bogus", nil).Must(t, 400)
	c.Do("GET", "/api/v1/products?min_price=abc", nil).Must(t, 400)

	var cats []struct {
		Slug     string `json:"slug"`
		Count    int    `json:"product_count"`
		Children []any  `json:"children"`
	}
	c.Do("GET", "/api/v1/categories", nil).Must(t, 200).Data(t, &cats)
	if len(cats) != 8 || cats[0].Count == 0 || len(cats[0].Children) == 0 {
		t.Fatalf("categories = %+v", cats)
	}
	var cat struct {
		Breadcrumbs []card `json:"breadcrumbs"`
	}
	c.Do("GET", "/api/v1/categories/tshirts", nil).Must(t, 200).Data(t, &cat)
	if len(cat.Breadcrumbs) != 2 {
		t.Fatalf("breadcrumbs = %+v", cat.Breadcrumbs)
	}

	var p struct {
		card
		Variants []struct {
			StockLevel string `json:"stock_level"`
		} `json:"variants"`
		Options        []any `json:"options"`
		ReviewsSummary struct {
			Histogram map[string]int `json:"histogram"`
		} `json:"reviews_summary"`
		Breadcrumbs []card `json:"breadcrumbs"`
	}
	c.Do("GET", "/api/v1/products/cotton-tee-classic", nil).Must(t, 200).Data(t, &p)
	if len(p.Variants) != 12 || len(p.Options) != 2 || len(p.ReviewsSummary.Histogram) != 5 || len(p.Breadcrumbs) != 2 {
		t.Fatalf("detail = %+v", p)
	}
	if strings.Contains(string(c.Do("GET", "/api/v1/products/cotton-tee-classic", nil).Body), `"stock":`) {
		t.Fatal("exact stock leaked publicly")
	}
	c.Do("GET", "/api/v1/products/nope", nil).Must(t, 404)
	c.Do("GET", "/api/v1/products/cotton-tee-classic/reviews?sort=rating_desc", nil).Must(t, 200)
	c.Do("GET", "/api/v1/products/cotton-tee-classic/related", nil).Must(t, 200)
	var sug struct {
		Products []any `json:"products"`
	}
	c.Do("GET", "/api/v1/search/suggest?q="+url.QueryEscape("หูฟัง"), nil).Must(t, 200).Data(t, &sug)
	if len(sug.Products) == 0 {
		t.Fatal("suggest found nothing")
	}

	// dashboard as owner
	owner := e.Client()
	owner.Login("owner@shopship.local", "Demo-Owner-2026").Must(t, 200)
	r := owner.Do("GET", "/api/v1/admin/dashboard", nil).Must(t, 200)
	if !strings.Contains(string(r.Body), `"sales_7d"`) {
		t.Fatalf("dashboard = %s", r.Body)
	}
	owner.Do("GET", "/api/v1/admin/users?q=wholesale", nil).Must(t, 200)
	owner.Do("GET", "/api/v1/admin/inventory?low_stock=true", nil).Must(t, 200)
	owner.Do("GET", "/api/v1/admin/audit-logs", nil).Must(t, 200)
}

func pngBytes(t *testing.T) []byte {
	img := image.NewRGBA(image.Rect(0, 0, 40, 30))
	img.Set(1, 1, color.RGBA{255, 0, 0, 255})
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestAdminCatalogCRUD(t *testing.T) {
	e := apitest.New(t)
	admin := e.SessionClient(e.UserNoPassword("admin@example.com", "admin"))
	var cat struct {
		ID int64 `json:"id"`
	}
	admin.Do("POST", "/api/v1/admin/categories", map[string]any{"slug": "home", "name": "บ้าน"}).Must(t, 201).Data(t, &cat)
	admin.Do("POST", "/api/v1/admin/categories", map[string]any{"slug": "home", "name": "ซ้ำ"}).Must(t, 409)

	body := map[string]any{"name": "แก้วเซรามิก", "name_en": "Ceramic Cup", "category_id": cat.ID, "status": "active",
		"tags": []string{"mug"}, "options": []map[string]any{{"name": "สี", "values": []string{"ขาว"}}},
		"variants": []map[string]any{{"sku": "CUP-W", "name": "ขาว", "option_values": map[string]string{"สี": "ขาว"}, "price_satang": 19900, "stock": 3}}}
	var ap struct {
		ID       int64  `json:"id"`
		Slug     string `json:"slug"`
		NameEN   string `json:"name_en"`
		Variants []struct {
			ID    int64 `json:"id"`
			Stock int   `json:"stock"`
		} `json:"variants"`
	}
	admin.Do("POST", "/api/v1/admin/products", body).Must(t, 201).Data(t, &ap)
	if ap.Slug != "ceramic-cup" || ap.NameEN != "Ceramic Cup" || len(ap.Variants) != 1 || ap.Variants[0].Stock != 3 {
		t.Fatalf("created = %+v", ap)
	}
	admin.Do("POST", "/api/v1/admin/products", body).Must(t, 409) // duplicate SKU
	admin.Do("POST", "/api/v1/admin/products", map[string]any{"name": ""}).Must(t, 422)
	pid := fmt.Sprint(ap.ID)
	admin.Do("PATCH", "/api/v1/admin/products/"+pid, map[string]any{"name_en": "Glazed Cup"}).Must(t, 200)
	var hits []card
	e.Client().Do("GET", "/api/v1/products?q=glazed", nil).Must(t, 200).Data(t, &hits)
	if len(hits) != 1 {
		t.Fatalf("name_en search after patch = %d", len(hits))
	}
	vid := fmt.Sprint(ap.Variants[0].ID)
	admin.Do("PATCH", "/api/v1/admin/variants/"+vid, map[string]any{"price_satang": 17900}).Must(t, 200)
	var hist []any
	admin.Do("GET", "/api/v1/admin/variants/"+vid+"/price-history", nil).Must(t, 200).Data(t, &hist)
	if len(hist) != 2 {
		t.Fatalf("price history = %d", len(hist))
	}
	admin.Do("POST", "/api/v1/admin/inventory/adjust", map[string]any{"variant_id": ap.Variants[0].ID, "delta": -5, "reason": "นับสต็อก"}).Must(t, 422)
	admin.Do("POST", "/api/v1/admin/inventory/adjust", map[string]any{"variant_id": ap.Variants[0].ID, "delta": 7, "reason": "รับของเข้า"}).Must(t, 200)

	// multipart image upload
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile("file", "cup.png")
	fw.Write(pngBytes(t))
	w.WriteField("alt", "แก้ว")
	w.Close()
	req, _ := http.NewRequest("POST", e.URL()+"/api/v1/admin/products/"+pid+"/images", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	var img struct {
		ID     int64  `json:"id"`
		URL    string `json:"url"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
	}
	admin.Raw(req).Must(t, 201).Data(t, &img)
	if img.Width != 40 || img.Height != 30 || !strings.Contains(img.URL, "/media/products/") {
		t.Fatalf("image = %+v", img)
	}
	admin.Do("PUT", "/api/v1/admin/products/"+pid+"/images/order", map[string]any{"image_ids": []int64{img.ID}}).Must(t, 200)
	admin.Do("PATCH", fmt.Sprintf("/api/v1/admin/images/%d", img.ID), map[string]any{"alt": "แก้วขาว"}).Must(t, 200)
	admin.Do("DELETE", fmt.Sprintf("/api/v1/admin/images/%d", img.ID), nil).Must(t, 204)

	admin.Do("DELETE", fmt.Sprintf("/api/v1/admin/categories/%d", cat.ID), nil).Must(t, 409) // has products
	admin.Do("DELETE", "/api/v1/admin/variants/"+vid, nil).Must(t, 204)
	admin.Do("DELETE", "/api/v1/admin/products/"+pid, nil).Must(t, 204)
	e.Client().Do("GET", "/api/v1/products/ceramic-cup", nil).Must(t, 404)

	// banners
	var bn struct {
		ID int64 `json:"id"`
	}
	admin.Do("POST", "/api/v1/admin/banners", map[string]any{"placement": "home_hero", "title": "ลดใหญ่", "image_url": "/mock/x.svg", "link_url": "javascript:x"}).Must(t, 422)
	admin.Do("POST", "/api/v1/admin/banners", map[string]any{"placement": "home_hero", "title": "ลดใหญ่", "image_url": "/mock/x.svg", "link_url": "/sale"}).Must(t, 201).Data(t, &bn)
	admin.Do("PATCH", fmt.Sprintf("/api/v1/admin/banners/%d", bn.ID), map[string]any{"is_active": false}).Must(t, 200)
	admin.Do("DELETE", fmt.Sprintf("/api/v1/admin/banners/%d", bn.ID), nil).Must(t, 204)

	var audits int
	e.Scalar(&audits, `SELECT count(*) FROM audit_logs`)
	if audits < 12 {
		t.Fatalf("audit rows = %d", audits)
	}
}

func TestAccountAddressesWishlist(t *testing.T) {
	e := apitest.New(t)
	pid, _ := e.Product("lamp", "โคมไฟ", 59000, 2)
	c := e.SessionClient(e.UserNoPassword("acc@example.com", "customer"))
	addr := map[string]any{"recipient_name": "ผู้รับ", "phone": "081 234 5678", "line1": "1", "subdistrict": "ก", "district": "ข", "province": "ค", "postal_code": "10110"}
	var a1, a2 struct {
		ID        int64  `json:"id"`
		Phone     string `json:"phone"`
		IsDefault bool   `json:"is_default"`
	}
	c.Do("POST", "/api/v1/me/addresses", addr).Must(t, 201).Data(t, &a1)
	c.Do("POST", "/api/v1/me/addresses", addr).Must(t, 201).Data(t, &a2)
	if !a1.IsDefault || a2.IsDefault || a1.Phone != "0812345678" {
		t.Fatalf("addresses %+v %+v", a1, a2)
	}
	bad := map[string]any{"recipient_name": "x", "phone": "12", "line1": "1", "subdistrict": "ก", "district": "ข", "province": "ค", "postal_code": "01234"}
	if r := c.Do("POST", "/api/v1/me/addresses", bad); r.Status != 422 || !strings.Contains(string(r.Body), "postal_code") {
		t.Fatalf("bad address = %d %s", r.Status, r.Body)
	}
	c.Do("POST", fmt.Sprintf("/api/v1/me/addresses/%d/default", a2.ID), nil).Must(t, 200)
	c.Do("DELETE", fmt.Sprintf("/api/v1/me/addresses/%d", a2.ID), nil).Must(t, 204)
	var list []struct {
		ID        int64 `json:"id"`
		IsDefault bool  `json:"is_default"`
	}
	c.Do("GET", "/api/v1/me/addresses", nil).Must(t, 200).Data(t, &list)
	if len(list) != 1 || !list[0].IsDefault {
		t.Fatalf("after delete default: %+v", list)
	}
	c.Do("PUT", fmt.Sprintf("/api/v1/me/wishlist/%d", pid), nil).Must(t, 204)
	c.Do("PUT", fmt.Sprintf("/api/v1/me/wishlist/%d", pid), nil).Must(t, 204)
	c.Do("PUT", "/api/v1/me/wishlist/999999", nil).Must(t, 404)
	var wl []card
	c.Do("GET", "/api/v1/me/wishlist", nil).Must(t, 200).Data(t, &wl)
	if len(wl) != 1 {
		t.Fatalf("wishlist = %d", len(wl))
	}
	c.Do("DELETE", fmt.Sprintf("/api/v1/me/wishlist/%d", pid), nil).Must(t, 204)
	e.Client().Do("GET", "/api/v1/me/addresses", nil).Must(t, 401)
}
