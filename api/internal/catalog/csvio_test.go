package catalog

import (
	"strings"
	"testing"
	"unicode/utf16"
)

func TestDecodeCSVEncodings(t *testing.T) {
	cases := []struct {
		name string
		in   []byte
		want string
		enc  string
	}{
		{"utf8", []byte("handle\nเสื้อ"), "handle\nเสื้อ", "utf-8"},
		{"utf8 bom", append([]byte{0xEF, 0xBB, 0xBF}, []byte("handle\nไทย")...), "handle\nไทย", "utf-8-bom"},
		{"windows-874", []byte{'h', ',', 0xE4, 0xB7, 0xC2, ' ', 0xDF, '1'}, "h,ไทย ฿1", "windows-874"},
	}
	le := []byte{0xFF, 0xFE}
	for _, u := range utf16.Encode([]rune("handle\tชื่อ")) {
		le = append(le, byte(u), byte(u>>8))
	}
	cases = append(cases, struct {
		name string
		in   []byte
		want string
		enc  string
	}{"utf16le", le, "handle\tชื่อ", "utf-16"})
	for _, c := range cases {
		got, enc := decodeCSV(c.in)
		if got != c.want || enc != c.enc {
			t.Errorf("%s: got %q/%s want %q/%s", c.name, got, enc, c.want, c.enc)
		}
	}
}

func TestParseCSVQuotingThaiAndRows(t *testing.T) {
	in := "\xEF\xBB\xBFHandle,Name_TH,description,price_baht,mystery\r\n" +
		"linen-shirt,\"เสื้อเชิ้ต, ลินิน\",\"บรรทัดแรก\nบรรทัด \"\"สอง\"\"\",\"1,290.50\",x\r\n" +
		",,,,\r\n" +
		"tote,'=SUM(A1),,99,\r\n"
	pc, err := parseCSV([]byte(in))
	if err != nil {
		t.Fatal(err)
	}
	if pc.Encoding != "utf-8-bom" || len(pc.Rows) != 2 || len(pc.Unknown) != 1 || pc.Unknown[0] != "mystery" {
		t.Fatalf("parsed %+v", pc)
	}
	r := pc.Rows[0]
	if r.Line != 2 || r.val("handle") != "linen-shirt" || r.val("name_th") != "เสื้อเชิ้ต, ลินิน" ||
		r.val("description") != "บรรทัดแรก\nบรรทัด \"สอง\"" || r.val("price_baht") != "1,290.50" {
		t.Fatalf("row 1 = %+v", r)
	}
	// the blank record is skipped but still counts as a spreadsheet row; formula guard is stripped
	if pc.Rows[1].Line != 4 || pc.Rows[1].val("name_th") != "=SUM(A1)" {
		t.Fatalf("row 2 = %+v", pc.Rows[1])
	}
}

func TestParseCSVDelimitersAndHeaderErrors(t *testing.T) {
	pc, err := parseCSV([]byte("handle;price_baht\na;1,5\n"))
	if err != nil || pc.Rows[0].val("price_baht") != "1,5" {
		t.Fatalf("semicolon: %v %+v", err, pc)
	}
	pc, err = parseCSV([]byte("slug\tprice\na\t10\n"))
	if err != nil || pc.Rows[0].val("handle") != "a" || pc.Rows[0].val("price_baht") != "10" {
		t.Fatalf("tab + aliases: %v %+v", err, pc)
	}
	if _, err := parseCSV([]byte("name_th,sku\nx,y\n")); err == nil || !strings.Contains(err.Error(), "handle") {
		t.Fatalf("missing handle: %v", err)
	}
	if _, err := parseCSV([]byte("handle,sku,SKU\n")); err == nil {
		t.Fatal("duplicate header must fail")
	}
	if _, err := parseCSV([]byte("\n\n")); err != errNoHeader {
		t.Fatalf("empty: %v", err)
	}
	big := "handle\n" + strings.Repeat("a\n", maxImportRows+1)
	if _, err := parseCSV([]byte(big)); err == nil {
		t.Fatal("row cap")
	}
}

func TestParseBaht(t *testing.T) {
	ok := map[string]int64{
		"199": 19900, "199.5": 19950, "1,234.50": 123450, "฿1,000": 100000, "19.995": 2000, "19.994": 1999,
		"0.005": 1, ".5": 50, "12.": 1200, " 590 บาท ": 59000, "1,000,000.00": 100000000, "0": 0, "007.10": 710,
	}
	for in, want := range ok {
		if got, msg := parseBaht(in); msg != "" || got != want {
			t.Errorf("parseBaht(%q) = %d %q, want %d", in, got, msg, want)
		}
	}
	for _, in := range []string{"", "1E+03", "-5", "12,5", "1,23.4", "abc", "1.2.3", "1000000001", "."} {
		if _, msg := parseBaht(in); msg == "" {
			t.Errorf("parseBaht(%q) should fail", in)
		}
	}
}

func TestParseCountAndBool(t *testing.T) {
	if n, msg := parseCount("1,000", 1e6); msg != "" || n != 1000 {
		t.Fatal(n, msg)
	}
	for _, in := range []string{"-1", "1.5", "x", "2000000"} {
		if _, msg := parseCount(in, 1_000_000); msg == "" {
			t.Errorf("parseCount(%q) should fail", in)
		}
	}
	for in, want := range map[string]bool{"TRUE": true, "ใช่": true, "0": false, "ไม่": false} {
		if got, ok := parseBoolCell(in); !ok || got != want {
			t.Errorf("bool %q", in)
		}
	}
	if st, ok := parseStatus("เผยแพร่"); !ok || st != "active" {
		t.Fatal(st)
	}
}

func TestSuggestSKUUnique(t *testing.T) {
	a := SuggestSKU("linen-shirt", []string{"M"}, nil)
	b := SuggestSKU("linen-shorts", []string{"M"}, nil)
	if a == b || !strings.HasPrefix(a, "LINENS-") {
		t.Fatalf("prefix collision not resolved: %s %s", a, b)
	}
	white := SuggestSKU("tee", []string{"ขาว", "M"}, nil)
	black := SuggestSKU("tee", []string{"ดำ", "M"}, nil)
	if white == black {
		t.Fatalf("Thai values collide: %s", white)
	}
	for _, s := range []string{a, b, white, black, SuggestSKU("เสื้อ", nil, nil), SuggestSKU(strings.Repeat("x", 120), []string{strings.Repeat("y", 90), "z"}, nil)} {
		if !skuRe.MatchString(s) {
			t.Fatalf("invalid sku %q", s)
		}
	}
	taken := map[string]bool{strings.ToLower(a): true, strings.ToLower(a) + "-2": true}
	if got := SuggestSKU("linen-shirt", []string{"M"}, func(k string) bool { return taken[k] }); got != a+"-3" {
		t.Fatalf("taken loop: %s", got)
	}
}

func TestCellEscapeRoundTrip(t *testing.T) {
	for _, s := range []string{"=1+1", "+66", "@x", "- list", "ปกติ", ""} {
		if got := unescapeCell(escapeCell(s)); got != s {
			t.Errorf("%q -> %q", s, got)
		}
	}
	if escapeCell("=HYPERLINK()") != "'=HYPERLINK()" {
		t.Fatal("formula not neutralised")
	}
}

// ---------- planner ----------

func testSnapshot() *snapshot {
	cost := int64(10000)
	return &snapshot{
		Categories: map[string]int64{"shirts": 1, "bags": 2},
		Products: map[string]*snapProduct{
			"old-tee": {ID: 10, Slug: "old-tee", Name: "เสื้อยืด", NameEN: "Tee", CategoryID: 1, Status: "active", Tags: []string{},
				Options: []Option{{Name: "ไซซ์", Values: []string{"S", "M"}}}, ImageURLs: map[string]bool{"https://cdn.test/a.jpg": true}, ImageCount: 1,
				Variants: []*snapVariant{
					{ID: 100, SKU: "TEE-S", Name: "S", OptionValues: map[string]string{"ไซซ์": "S"}, Price: 19900, Cost: &cost, Stock: 5, Low: 5, Weight: 200, Active: true, Sort: 0},
					{ID: 101, SKU: "TEE-M", Name: "M", OptionValues: map[string]string{"ไซซ์": "M"}, Price: 19900, Stock: 3, Low: 5, Weight: 200, Active: true, Sort: 1},
				}},
		},
		SKUs: map[string]skuOwner{
			"tee-s":   {VariantID: 100, ProductID: 10, Slug: "old-tee"},
			"tee-m":   {VariantID: 101, ProductID: 10, Slug: "old-tee"},
			"other-1": {VariantID: 200, ProductID: 20, Slug: "other"},
			"gone-1":  {VariantID: 300, ProductID: 30, Slug: "gone", Deleted: true},
		},
	}
}

func mustParse(t *testing.T, s string) *parsedCSV {
	t.Helper()
	pc, err := parseCSV([]byte(s))
	if err != nil {
		t.Fatal(err)
	}
	return pc
}

func TestPlanCreateUpdateSkip(t *testing.T) {
	pc := mustParse(t, "handle,name_th,category_slug,option1_name,option1_value,sku,price_baht,stock,image_urls\n"+
		"new-bag,กระเป๋า,bags,สี,ขาว,,250,10,https://cdn.test/b.jpg|/relative.jpg\n"+
		"new-bag,,,สี,ดำ,,250.50,2,\n"+
		"old-tee,,,ไซซ์,S,TEE-S,199,5,https://cdn.test/a.jpg\n"+ // unchanged -> skip
		"old-tee,,,ไซซ์,M,,209,3,\n"+ // matched by option, price changed -> update
		"old-tee,,,ไซซ์,L,,219,1,\n") // new size -> create
	rep, plans := planImport(pc, testSnapshot())
	if len(rep.Errors) != 0 {
		t.Fatalf("errors: %+v", rep.Errors)
	}
	s := rep.Summary
	if s.ProductsCreate != 1 || s.ProductsUpdate != 1 || s.VariantsCreate != 3 || s.VariantsUpdate != 1 || s.VariantsSkip != 1 || s.ImagesAdd != 1 {
		t.Fatalf("summary %+v", s)
	}
	if len(rep.Warnings) != 1 || rep.Warnings[0].Column != "image_urls" {
		t.Fatalf("warnings %+v", rep.Warnings)
	}
	bag := plans[0]
	if bag.P.Name != "กระเป๋า" || bag.P.Status != "draft" || len(bag.Variants) != 2 || bag.Variants[1].V.Price != 25050 {
		t.Fatalf("bag %+v", bag.P)
	}
	if bag.Variants[0].V.SKU == bag.Variants[1].V.SKU || !bag.Variants[0].Generated {
		t.Fatalf("generated skus %s %s", bag.Variants[0].V.SKU, bag.Variants[1].V.SKU)
	}
	tee := plans[1]
	if got := tee.P.Options[0].Values; strings.Join(got, ",") != "S,M,L" {
		t.Fatalf("options merged %v", got)
	}
	if tee.Variants[2].V.Sort != 2 || tee.Variants[2].V.Name != "L" || tee.Variants[1].Existing.ID != 101 {
		t.Fatalf("tee variants %+v", tee.Variants)
	}
	if rep.Rows[2].Action != "skip" || rep.Rows[3].Action != "update" || rep.Rows[4].Action != "create" || rep.Rows[3].Changes[0] != "price_baht" {
		t.Fatalf("rows %+v", rep.Rows)
	}
}

func TestPlanValidationErrors(t *testing.T) {
	pc := mustParse(t, "handle,name_th,category_slug,option1_name,option1_value,sku,price_baht,stock,status\n"+
		"Bad Handle,x,bags,,,,10,1,\n"+ // 2 handle
		"p1,,nope,,,,10,1,\n"+ // 3 name missing + unknown category
		"p2,ชื่อ,bags,,,OTHER-1,,1,\n"+ // 4 sku of other product + missing price
		"p3,ชื่อ,bags,,,gone-1,10,-1,weird\n"+ // 5 deleted-product sku, negative stock, bad status
		"p4,ชื่อ,bags,สี,ขาว,DUP,10,1,\n"+ // 6
		"p4,ชื่ออื่น,bags,สี,ขาว,dup,1E+2,1,\n"+ // 7 conflicting name, same option, dup sku, sci notation
		"p5,ชื่อ,bags,ไซซ์,,,10,1,\n"+ // 8 option name without value
		"old-tee,,,ไซซ์,S,TEE-X,10,,\n") // 9 option exists with another SKU
	rep, _ := planImport(pc, testSnapshot())
	want := map[[2]any]bool{
		{2, "handle"}: true, {3, "name_th"}: true, {3, "category_slug"}: true, {4, "sku"}: true, {4, "price_baht"}: true,
		{5, "sku"}: true, {5, "stock"}: true, {5, "status"}: true, {7, "name_th"}: true, {7, "option1_value"}: true,
		{7, "sku"}: true, {7, "price_baht"}: true, {8, "option1_value"}: true, {9, "sku"}: true,
	}
	got := map[[2]any]bool{}
	for _, e := range rep.Errors {
		got[[2]any{e.Row, e.Column}] = true
		if e.Message == "" {
			t.Fatalf("empty message %+v", e)
		}
	}
	for k := range want {
		if !got[k] {
			t.Errorf("missing error %v; got %+v", k, rep.Errors)
		}
	}
	for i := 1; i < len(rep.Errors); i++ {
		if rep.Errors[i].Row < rep.Errors[i-1].Row {
			t.Fatal("errors not sorted by row")
		}
	}
	if rep.Summary.ErrorRows != 7 { // row 6 itself is valid (its product is not)
		t.Fatalf("error rows %d (%+v)", rep.Summary.ErrorRows, rep.Rows)
	}
}

func TestPlanMultiRowNeedsOptions(t *testing.T) {
	pc := mustParse(t, "handle,name_th,category_slug,option1_name,option1_value,price_baht\n"+
		"p,ชื่อ,bags,,,10\np,,,,,20\nq,ชื่อ,bags,สี,ขาว,10\nq,,,ไซซ์,M,10\n")
	rep, _ := planImport(pc, testSnapshot())
	if len(rep.Errors) < 3 {
		t.Fatalf("want option errors, got %+v", rep.Errors)
	}
}

func TestPlanEmptyFile(t *testing.T) {
	rep, _ := planImport(mustParse(t, "handle,name_th\n"), testSnapshot())
	if len(rep.Errors) != 1 {
		t.Fatalf("%+v", rep.Errors)
	}
}

func TestTemplateIsValid(t *testing.T) {
	var b strings.Builder
	w, _ := newCSVWriter(&b)
	for _, r := range importTemplateRows("shirts") {
		_ = w.Write(r)
	}
	w.Flush()
	rep, plans := planImport(mustParse(t, b.String()), testSnapshot())
	if len(rep.Errors) != 0 || len(plans) != 2 || rep.Summary.VariantsCreate != 4 || plans[0].Variants[2].V.Price != 129050 {
		t.Fatalf("template: %+v %+v", rep.Errors, rep.Summary)
	}
}
