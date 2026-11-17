package catalog

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// CSV product import/export format (docs/API.md §12.1, docs/DEMO.md): one row per VARIANT, rows grouped by
// product handle (= products.slug). Product columns may repeat on every row of the same handle (export does)
// or be filled on one row only; two different non-blank values for the same product are an error.

// CSVColumns is the canonical header (export + template order).
var CSVColumns = []string{
	"handle", "name_th", "name_en", "subtitle", "description", "category_slug", "brand", "status", "featured", "tags",
	"option1_name", "option1_value", "option2_name", "option2_value", "option3_name", "option3_value",
	"sku", "price_baht", "cost_baht", "stock", "low_stock_threshold", "weight_grams", "barcode", "variant_active",
	"image_urls", "seo_title", "seo_description",
}

var csvAliases = map[string]string{"slug": "handle", "name": "name_th", "price": "price_baht", "category": "category_slug"}

const (
	maxImportRows   = 5000
	maxImportIssues = 1000
	maxOptions      = 3
)

type csvRow struct {
	Line  int // spreadsheet row number (header = 1); a quoted multi-line cell is still one row
	cells map[string]string
}

// val is the trimmed cell ("" when the column is absent or blank).
func (r csvRow) val(col string) string { return r.cells[col] }

type parsedCSV struct {
	Encoding string // utf-8 | utf-8-bom | utf-16 | windows-874
	Columns  []string
	Unknown  []string
	Rows     []csvRow
}

// decodeCSV converts the upload to UTF-8. Excel on Thai Windows saves "CSV (Comma delimited)" as Windows-874
// (TIS-620 superset), "CSV UTF-8" with a BOM and "Unicode Text" as UTF-16LE with a BOM.
func decodeCSV(b []byte) (string, string) {
	switch {
	case bytes.HasPrefix(b, []byte{0xEF, 0xBB, 0xBF}):
		return string(b[3:]), "utf-8-bom"
	case bytes.HasPrefix(b, []byte{0xFF, 0xFE}):
		return decodeUTF16(b[2:], false), "utf-16"
	case bytes.HasPrefix(b, []byte{0xFE, 0xFF}):
		return decodeUTF16(b[2:], true), "utf-16"
	case utf8.Valid(b):
		return string(b), "utf-8"
	}
	return decodeWindows874(b), "windows-874"
}

func decodeUTF16(b []byte, bigEndian bool) string {
	u := make([]uint16, 0, len(b)/2)
	for i := 0; i+1 < len(b); i += 2 {
		if bigEndian {
			u = append(u, uint16(b[i])<<8|uint16(b[i+1]))
		} else {
			u = append(u, uint16(b[i+1])<<8|uint16(b[i]))
		}
	}
	return string(utf16.Decode(u))
}

// windows874High maps 0x80..0xA0 (0xA1..0xFB are Thai U+0E01..U+0E5B; undefined bytes become U+FFFD).
var windows874High = map[byte]rune{0x80: '€', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0xA0: ' '}

func decodeWindows874(b []byte) string {
	var sb strings.Builder
	sb.Grow(len(b) * 2)
	for _, c := range b {
		switch {
		case c < 0x80:
			sb.WriteByte(c)
		case c >= 0xA1 && c <= 0xDA, c >= 0xDF && c <= 0xFB:
			sb.WriteRune(rune(c) - 0xA1 + 0x0E01)
		default:
			if r, ok := windows874High[c]; ok {
				sb.WriteRune(r)
			} else {
				sb.WriteRune(utf8.RuneError)
			}
		}
	}
	return sb.String()
}

// sniffDelimiter picks , ; or TAB from the header line (Excel in some locales writes ; and "Unicode Text" TAB).
func sniffDelimiter(s string) rune {
	line := s
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		line = s[:i]
	}
	best, n := ',', strings.Count(line, ",")
	for _, d := range []rune{';', '\t'} {
		if c := strings.Count(line, string(d)); c > n {
			best, n = d, c
		}
	}
	return best
}

var errNoHeader = errors.New("no header")

const bomRune = string(rune(0xFEFF))

// parseCSV decodes and splits the file; it fails only when the file itself is unreadable.
func parseCSV(b []byte) (*parsedCSV, error) {
	text, enc := decodeCSV(b)
	text = strings.TrimPrefix(text, bomRune) // a BOM that survived a UTF-16 decode
	r := csv.NewReader(strings.NewReader(text))
	r.Comma = sniffDelimiter(text)
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	r.ReuseRecord = false
	out := &parsedCSV{Encoding: enc}
	var idx []string // column per position ("" = ignored)
	line := 0
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			var pe *csv.ParseError
			if errors.As(err, &pe) {
				return nil, fmt.Errorf("ไฟล์ CSV ผิดรูปแบบที่บรรทัด %d", pe.Line)
			}
			return nil, errors.New("อ่านไฟล์ CSV ไม่ได้")
		}
		line++
		if idx == nil {
			if blankRecord(rec) {
				line-- // leading empty lines are not the header
				continue
			}
			seen := map[string]bool{}
			for _, h := range rec {
				k := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(h, bomRune)))
				k = strings.ReplaceAll(k, " ", "_")
				if a, ok := csvAliases[k]; ok {
					k = a
				}
				if !isCSVColumn(k) {
					if k != "" {
						out.Unknown = append(out.Unknown, strings.TrimSpace(h))
					}
					k = ""
				} else if seen[k] {
					return nil, fmt.Errorf("หัวคอลัมน์ %s ซ้ำกัน", k)
				}
				seen[k] = k != ""
				idx = append(idx, k)
				if k != "" {
					out.Columns = append(out.Columns, k)
				}
			}
			if !seen["handle"] {
				return nil, errors.New("ไม่พบคอลัมน์ handle ในแถวหัวตาราง (ดาวน์โหลดไฟล์ตัวอย่างเพื่อดูรูปแบบ)")
			}
			continue
		}
		if blankRecord(rec) {
			continue
		}
		if len(out.Rows) >= maxImportRows {
			return nil, fmt.Errorf("นำเข้าได้ไม่เกิน %d แถวต่อไฟล์ กรุณาแบ่งไฟล์", maxImportRows)
		}
		row := csvRow{Line: line, cells: map[string]string{}}
		for i, v := range rec {
			if i < len(idx) && idx[i] != "" {
				row.cells[idx[i]] = unescapeCell(strings.TrimSpace(v))
			}
		}
		out.Rows = append(out.Rows, row)
	}
	if idx == nil {
		return nil, errNoHeader
	}
	return out, nil
}

func isCSVColumn(k string) bool {
	for _, c := range CSVColumns {
		if c == k {
			return true
		}
	}
	return false
}

func blankRecord(rec []string) bool {
	for _, v := range rec {
		if strings.TrimSpace(v) != "" {
			return false
		}
	}
	return true
}

// Formula injection guard: export prefixes cells starting with = + @ (or TAB/CR) with an apostrophe; import strips it.
func escapeCell(s string) string {
	if s != "" && strings.ContainsRune("=+@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}

func unescapeCell(s string) string {
	if len(s) > 1 && s[0] == '\'' && strings.ContainsRune("=+@", rune(s[1])) {
		return s[1:]
	}
	return s
}

// ---------- value parsers (Thai messages) ----------

var (
	digitsRe    = regexp.MustCompile(`^[0-9]+$`)
	thousandsRe = regexp.MustCompile(`^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]*)?$`)
	decimalRe   = regexp.MustCompile(`^([0-9]*)(?:\.([0-9]*))?$`)
)

// parseBaht turns "1,234.50" / "฿99" / "19.995" into satang, rounding half-up at the 3rd decimal (no floats).
func parseBaht(s string) (int64, string) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "฿")
	s = strings.TrimSuffix(strings.TrimSuffix(s, "บาท"), "THB")
	s = strings.ReplaceAll(strings.TrimSpace(s), " ", "")
	if s == "" {
		return 0, "กรุณากรอกราคา"
	}
	if strings.ContainsAny(s, "eE") {
		return 0, "รูปแบบตัวเลขไม่ถูกต้อง (ห้ามใช้รูปแบบ 1E+03 ให้ตั้งรูปแบบเซลล์เป็นตัวเลข)"
	}
	if strings.HasPrefix(s, "-") {
		return 0, "ราคาต้องไม่ติดลบ"
	}
	if strings.Contains(s, ",") {
		if !thousandsRe.MatchString(s) {
			return 0, "รูปแบบตัวเลขไม่ถูกต้อง (ใช้จุด . เป็นทศนิยม เช่น 1234.50)"
		}
		s = strings.ReplaceAll(s, ",", "")
	}
	m := decimalRe.FindStringSubmatch(s)
	if m == nil || (m[1] == "" && m[2] == "") {
		return 0, "ราคาต้องเป็นตัวเลข เช่น 199 หรือ 1234.50"
	}
	ip := strings.TrimLeft(m[1], "0")
	if len(ip) > 9 {
		return 0, "ราคาสูงเกินไป"
	}
	var baht int64
	if ip != "" {
		baht, _ = strconv.ParseInt(ip, 10, 64)
	}
	frac := m[2] + "000"
	satang := baht*100 + int64(frac[0]-'0')*10 + int64(frac[1]-'0')
	if frac[2] >= '5' {
		satang++
	}
	if satang > 100_000_000_00 {
		return 0, "ราคาสูงเกินไป"
	}
	return satang, ""
}

// parseCount parses a non-negative integer ("1,000" ok).
func parseCount(s string, max int) (int, string) {
	s = strings.ReplaceAll(strings.TrimSpace(s), " ", "")
	if strings.Contains(s, ",") {
		if !thousandsRe.MatchString(s) || strings.Contains(s, ".") {
			return 0, "ต้องเป็นจำนวนเต็ม"
		}
		s = strings.ReplaceAll(s, ",", "")
	}
	if strings.HasPrefix(s, "-") {
		return 0, "ต้องไม่ติดลบ"
	}
	if !digitsRe.MatchString(s) {
		return 0, "ต้องเป็นจำนวนเต็ม"
	}
	n, err := strconv.Atoi(s)
	if err != nil || n > max {
		return 0, fmt.Sprintf("ต้องไม่เกิน %s", strconv.Itoa(max))
	}
	return n, ""
}

func parseBoolCell(s string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "true", "1", "yes", "y", "ใช่", "เปิด":
		return true, true
	case "false", "0", "no", "n", "ไม่", "ไม่ใช่", "ปิด":
		return false, true
	}
	return false, false
}

var thaiStatus = map[string]string{"เผยแพร่": "active", "ซ่อน": "hidden", "ฉบับร่าง": "draft", "แบบร่าง": "draft", "เก็บถาวร": "archived"}

func parseStatus(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if v, ok := thaiStatus[s]; ok {
		return v, true
	}
	s = strings.ToLower(s)
	return s, productStatuses[s]
}

// splitList splits a pipe-separated cell, trimming and dropping blanks.
func splitList(s string) []string {
	out := []string{}
	for _, p := range strings.Split(s, "|") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// ---------- SKU generation ----------

// skuFrag keeps up to n ASCII letters/digits, upper-cased.
func skuFrag(s string, n int) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(s) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			if b.Len() == n {
				break
			}
		}
	}
	return b.String()
}

// shortHash is a 3-char base36 FNV-1a digest: distinguishes values that share a prefix or have no ASCII (Thai).
func shortHash(s string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	v := strconv.FormatUint(uint64(h.Sum32()%46656), 36) // 36^3
	return strings.ToUpper(strings.Repeat("0", 3-len(v)) + v)
}

// SuggestSKU builds BASE-HASH[-VAL...]: BASE = first 6 ASCII chars of the handle, HASH = digest of the whole
// handle (so "linen-shirt" and "linen-shorts" differ), VAL = ASCII fragment of each option value or a digest
// when it has none (Thai colours). taken (lower-cased) is checked and -2, -3 … appended until unique.
func SuggestSKU(handle string, values []string, taken func(lower string) bool) string {
	base := skuFrag(handle, 6)
	if base == "" {
		base = "SKU"
	}
	parts := []string{base, shortHash(handle)}
	for _, v := range values {
		f := skuFrag(v, 4)
		if f == "" {
			f = shortHash(v)
		} else if !isASCII(v) {
			f += shortHash(v)[:1] // "M" vs "M ดำ"
		}
		parts = append(parts, f)
	}
	sku := strings.Join(parts, "-")
	if len(sku) > 56 {
		sku = strings.TrimRight(sku[:56], "-")
	}
	cand := sku
	for i := 2; taken != nil && taken(strings.ToLower(cand)); i++ {
		cand = fmt.Sprintf("%s-%d", sku, i)
	}
	return cand
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= utf8.RuneSelf {
			return false
		}
	}
	return true
}

// ---------- export writer ----------

// csvWriter writes UTF-8 with BOM + CRLF so Excel opens Thai text correctly.
func newCSVWriter(w io.Writer) (*csv.Writer, error) {
	if _, err := w.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return nil, err
	}
	cw := csv.NewWriter(w)
	cw.UseCRLF = true
	return cw, nil
}

// formatBaht renders satang as "1234.50" (no separators, round-trips through parseBaht).
func formatBahtCell(s int64) string {
	return fmt.Sprintf("%d.%02d", s/100, s%100)
}
