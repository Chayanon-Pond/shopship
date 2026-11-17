package catalog_test

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/shopship/shop/api/internal/catalog"
	"github.com/shopship/shop/api/internal/testdb"
	"github.com/shopship/shop/api/internal/testdb/apitest"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

func upload(t *testing.T, e *apitest.Env, c *apitest.Client, query string, body []byte) apitest.Resp {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "products.csv")
	_, _ = fw.Write(body)
	_ = mw.Close()
	req, _ := http.NewRequest(http.MethodPost, e.URL()+"/api/v1/admin/products/import"+query, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return c.Raw(req)
}

func report(t *testing.T, r apitest.Resp) catalog.ImportReport {
	t.Helper()
	var rep catalog.ImportReport
	if r.Status == http.StatusOK {
		r.Data(t, &rep)
		return rep
	}
	var env struct {
		Error struct {
			Details catalog.ImportReport `json:"details"`
		} `json:"error"`
	}
	r.JSON(t, &env)
	return env.Error.Details
}

func count(t *testing.T, e *apitest.Env, sql string, args ...any) int {
	t.Helper()
	var n int
	e.Scalar(&n, sql, args...)
	return n
}

const goodCSV = "\xEF\xBB\xBFhandle,name_th,name_en,category_slug,status,option1_name,option1_value,sku,price_baht,stock,weight_grams,image_urls,description\r\n" +
	"linen-shirt,\"เสื้อเชิ้ต, ลินิน\",Linen Shirt,test-cat,active,ไซซ์,M,,590.00,20,250,https://cdn.example.com/l1.jpg,\"ผ้าดี\nใส่สบาย\"\r\n" +
	"linen-shirt,,,,,ไซซ์,L,,\"1,290.505\",15,260,,\r\n" +
	"linen-shorts,กางเกงลินิน,Linen Shorts,test-cat,draft,ไซซ์,M,,450,5,200,,\r\n" +
	"existing,,,,,,,EXISTING,123.45,7,,,\r\n"

func TestImportFlow(t *testing.T) {
	e := apitest.New(t)
	pid, vid := e.Product("existing", "สินค้าเดิม", 10000, 1)
	admin := e.SessionClient(e.UserNoPassword("admin@test.local", "admin"))
	staff := e.SessionClient(e.UserNoPassword("staff@test.local", "staff"))
	products := func() int { return count(t, e, `SELECT count(*) FROM products`) }

	// permission + CSRF
	upload(t, e, staff, "?dry_run=true", []byte(goodCSV)).Must(t, http.StatusForbidden)
	noCSRF := *admin
	noCSRF.CSRF = ""
	if r := upload(t, e, &noCSRF, "", []byte(goodCSV)); r.Status != http.StatusForbidden || r.Code() != "csrf_failed" {
		t.Fatalf("csrf: %d %s", r.Status, r.Body)
	}
	staff.Do(http.MethodGet, "/api/v1/admin/products/export.csv", nil).Must(t, http.StatusOK) // catalog:read
	e.Client().Do(http.MethodGet, "/api/v1/admin/products/export.csv", nil).Must(t, http.StatusUnauthorized)

	// dry run (also the default) writes nothing
	before := products()
	for _, q := range []string{"?dry_run=true", ""} {
		rep := report(t, upload(t, e, admin, q, []byte(goodCSV)).Must(t, http.StatusOK))
		if !rep.DryRun || rep.Applied || len(rep.Errors) != 0 || rep.Summary.ProductsCreate != 2 || rep.Summary.ProductsUpdate != 1 ||
			rep.Summary.VariantsCreate != 3 || rep.Summary.VariantsUpdate != 1 || rep.Encoding != "utf-8-bom" {
			t.Fatalf("dry run report %+v", rep)
		}
	}
	if products() != before {
		t.Fatal("dry run wrote products")
	}

	// real run
	rep := report(t, upload(t, e, admin, "?dry_run=false", []byte(goodCSV)).Must(t, http.StatusOK))
	if !rep.Applied || rep.DryRun {
		t.Fatalf("not applied %+v", rep)
	}
	if products() != before+2 {
		t.Fatalf("products %d", products())
	}
	var price int64
	e.Scalar(&price, `SELECT v.price_satang FROM product_variants v JOIN products p ON p.id = v.product_id
		WHERE p.slug = 'linen-shirt' AND v.option_values->>'ไซซ์' = 'L'`)
	if price != 129051 { // 1,290.505 half-up
		t.Fatalf("price %d", price)
	}
	var skuShirt, skuShorts string
	e.Scalar(&skuShirt, `SELECT v.sku FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = 'linen-shirt' AND v.name = 'M'`)
	e.Scalar(&skuShorts, `SELECT v.sku FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = 'linen-shorts' AND v.name = 'M'`)
	if skuShirt == skuShorts {
		t.Fatalf("auto SKU collision %s", skuShirt)
	}
	if n := count(t, e, `SELECT count(*) FROM product_images WHERE storage_key = '' AND url = 'https://cdn.example.com/l1.jpg'`); n != 1 {
		t.Fatalf("external image %d", n)
	}
	var name string
	e.Scalar(&name, `SELECT name || '|' || description FROM products WHERE slug = 'linen-shirt'`)
	if name != "เสื้อเชิ้ต, ลินิน|ผ้าดี\nใส่สบาย" {
		t.Fatalf("name/desc %q", name)
	}
	var stock int
	e.Scalar(&stock, `SELECT stock FROM product_variants WHERE id = $1`, vid)
	if stock != 7 {
		t.Fatalf("existing stock %d", stock)
	}
	if n := count(t, e, `SELECT count(*) FROM audit_logs WHERE action = 'product.import'`); n != 1 {
		t.Fatalf("audit %d", n)
	}
	if n := count(t, e, `SELECT count(*) FROM products WHERE slug = 'linen-shirt' AND published_at IS NOT NULL`); n != 1 {
		t.Fatal("active product not published")
	}

	// importing the same file again: nothing to do
	rep = report(t, upload(t, e, admin, "?dry_run=false", []byte(goodCSV)).Must(t, http.StatusOK))
	if rep.Summary.VariantsCreate != 0 || rep.Summary.VariantsUpdate != 0 || rep.Summary.VariantsSkip != 4 || rep.Summary.ProductsUpdate != 0 {
		t.Fatalf("re-import %+v", rep.Summary)
	}

	// export -> re-import round trip is all skip
	ex := admin.Do(http.MethodGet, "/api/v1/admin/products/export.csv", nil).Must(t, http.StatusOK)
	if !bytes.HasPrefix(ex.Body, []byte{0xEF, 0xBB, 0xBF}) || !strings.Contains(ex.Header.Get("Content-Disposition"), "attachment") ||
		!strings.Contains(string(ex.Body), "\"เสื้อเชิ้ต, ลินิน\"") {
		t.Fatalf("export: %s %q", ex.Header, ex.Body[:min(len(ex.Body), 300)])
	}
	rep = report(t, upload(t, e, admin, "?dry_run=true", ex.Body).Must(t, http.StatusOK))
	if len(rep.Errors) != 0 || rep.Summary.VariantsSkip != 4 || rep.Summary.ProductsSkip != 3 || rep.Summary.ImagesAdd != 0 {
		t.Fatalf("round trip %+v %+v", rep.Summary, rep.Errors)
	}

	// all or nothing: one bad row => 422, nothing written (the valid new product is not created either)
	bad := "handle,name_th,category_slug,price_baht,stock\nbrand-new,ใหม่,test-cat,100,1\nexisting,,,,-3\n"
	r := upload(t, e, admin, "?dry_run=false", []byte(bad))
	if r.Status != http.StatusUnprocessableEntity || r.Code() != "validation_failed" {
		t.Fatalf("bad import: %d %s", r.Status, r.Body)
	}
	rep = report(t, r)
	if rep.Applied || len(rep.Errors) != 1 || rep.Errors[0].Row != 3 || rep.Errors[0].Column != "stock" {
		t.Fatalf("bad report %+v", rep.Errors)
	}
	if n := count(t, e, `SELECT count(*) FROM products WHERE slug = 'brand-new'`); n != 0 {
		t.Fatal("partial write")
	}
	if n := count(t, e, `SELECT count(*) FROM audit_logs WHERE action = 'product.import'`); n != 2 {
		t.Fatalf("audit after failure %d", n)
	}

	// upload validation
	if r := upload(t, e, admin, "?dry_run=false", []byte("PK\x03\x04xlsx")); r.Status != http.StatusUnprocessableEntity {
		t.Fatalf("xlsx: %d", r.Status)
	}
	if r := upload(t, e, admin, "?dry_run=maybe", []byte(goodCSV)); r.Status != http.StatusBadRequest {
		t.Fatalf("dry_run param: %d", r.Status)
	}

	// template downloads and validates cleanly
	tpl := admin.Do(http.MethodGet, "/api/v1/admin/products/import/template.csv", nil).Must(t, http.StatusOK)
	rep = report(t, upload(t, e, admin, "?dry_run=true", tpl.Body).Must(t, http.StatusOK))
	if len(rep.Errors) != 0 || rep.Summary.Products != 2 || rep.Summary.ProductsCreate != 1 { // linen-shirt exists by now
		t.Fatalf("template %+v", rep.Errors)
	}

	// existing product routes still resolve next to the static import/export paths
	var ap struct {
		ID int64 `json:"id"`
	}
	admin.Do(http.MethodGet, "/api/v1/admin/products/"+itoa(pid), nil).Must(t, http.StatusOK).Data(t, &ap)
	if ap.ID != pid {
		t.Fatal("product route")
	}
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

// The documented sample (docs/fixtures/products-import-sample.csv, used in docs/DEMO.md) must stay importable.
func TestImportDocsSample(t *testing.T) {
	sample, err := os.ReadFile("../../../docs/fixtures/products-import-sample.csv")
	if err != nil {
		t.Fatal(err)
	}
	e := apitest.New(t)
	for _, slug := range []string{"tshirts", "shirts", "bags", "drinks"} {
		e.Exec(`INSERT INTO categories (slug, name) VALUES ($1, $1)`, slug)
	}
	admin := e.SessionClient(e.UserNoPassword("owner@test.local", "owner"))
	rep := report(t, upload(t, e, admin, "?dry_run=false", sample).Must(t, http.StatusOK))
	s := rep.Summary
	if !rep.Applied || s.ProductsCreate != 4 || s.VariantsCreate != 8 || s.ImagesAdd != 2 || len(rep.Warnings) != 0 {
		t.Fatalf("sample: %+v %+v", s, rep.Warnings)
	}
	var tea int64
	e.Scalar(&tea, `SELECT v.price_satang FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = 'thai-tea-mix'`)
	if tea != 9000 { // 89.995 rounds half-up
		t.Fatalf("tea %d", tea)
	}
	var skus int
	e.Scalar(&skus, `SELECT count(DISTINCT v.sku) FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = 'cotton-tee-everyday'`)
	if skus != 4 {
		t.Fatalf("auto skus %d", skus)
	}
}
