package admin

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/httpx"
)

type adminBanner struct {
	ID             int64      `json:"id"`
	Placement      string     `json:"placement"`
	Title          string     `json:"title"`
	Subtitle       string     `json:"subtitle"`
	CTALabel       string     `json:"cta_label"`
	LinkURL        string     `json:"link_url"`
	ImageURL       string     `json:"image_url"`
	ImageMobileURL string     `json:"image_mobile_url"`
	ImageAlt       string     `json:"image_alt"`
	CampaignID     *int64     `json:"campaign_id"`
	CategoryID     *int64     `json:"category_id"`
	StartsAt       *time.Time `json:"starts_at"`
	EndsAt         *time.Time `json:"ends_at"`
	IsActive       bool       `json:"is_active"`
	SortOrder      int        `json:"sort_order"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

const bannerCols = `id, placement, title, subtitle, cta_label, link_url, image_url, image_mobile_url, image_alt, campaign_id,
	category_id, starts_at, ends_at, is_active, sort_order, created_at, updated_at`

func scanBanner(row pgx.Row) (adminBanner, error) {
	var b adminBanner
	err := row.Scan(&b.ID, &b.Placement, &b.Title, &b.Subtitle, &b.CTALabel, &b.LinkURL, &b.ImageURL, &b.ImageMobileURL, &b.ImageAlt,
		&b.CampaignID, &b.CategoryID, &b.StartsAt, &b.EndsAt, &b.IsActive, &b.SortOrder, &b.CreatedAt, &b.UpdatedAt)
	b.CreatedAt, b.UpdatedAt = b.CreatedAt.UTC(), b.UpdatedAt.UTC()
	for _, p := range []**time.Time{&b.StartsAt, &b.EndsAt} {
		if *p != nil {
			t := (*p).UTC()
			*p = &t
		}
	}
	return b, err
}

var placements = map[string]bool{"home_hero": true, "home_strip": true, "category_top": true}
var linkRe = regexp.MustCompile(`^(/|https://)`)

func (h *handler) listBanners(c *gin.Context) {
	ctx := c.Request.Context()
	page, per := httpx.Page(c, 50, 100)
	a := &args{}
	where := "true"
	if p := c.Query("placement"); p != "" {
		if !placements[p] {
			httpx.BadRequest(c, "พารามิเตอร์ placement ไม่ถูกต้อง")
			return
		}
		where = "placement = " + a.add(p)
	}
	var total int
	if err := h.d.DB.QueryRow(ctx, "SELECT count(*) FROM banners WHERE "+where, a.v...).Scan(&total); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	a.add(per)
	a.add((page - 1) * per)
	n := len(a.v)
	rows, err := h.d.DB.Query(ctx, `SELECT `+bannerCols+` FROM banners WHERE `+where+
		` ORDER BY placement, sort_order, id LIMIT $`+itoa(n-1)+` OFFSET $`+itoa(n), a.v...)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	defer rows.Close()
	list := []adminBanner{}
	for rows.Next() {
		b, err := scanBanner(rows)
		if err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
		list = append(list, b)
	}
	httpx.List(c, list, httpx.NewMeta(page, per, total))
}

func itoa(n int) string { return strconv.Itoa(n) }

// bannerFields parses a (partial) banner body into column -> value.
func bannerFields(raw map[string]json.RawMessage, create bool) (map[string]any, map[string]string) {
	cols := map[string]any{}
	f := map[string]string{}
	str := func(name string, max int) {
		v, ok := raw[name]
		if !ok {
			return
		}
		var s string
		if json.Unmarshal(v, &s) != nil || utf8.RuneCountInString(s) > max {
			f[name] = "ค่าไม่ถูกต้องหรือยาวเกินไป"
			return
		}
		cols[name] = strings.TrimSpace(s)
	}
	str("title", 120)
	str("subtitle", 240)
	str("cta_label", 40)
	str("link_url", 500)
	str("image_url", 1000)
	str("image_mobile_url", 1000)
	str("image_alt", 300)
	str("placement", 20)
	if p, ok := cols["placement"].(string); ok && !placements[p] {
		f["placement"] = "ตำแหน่งแบนเนอร์ไม่ถูกต้อง"
	}
	if l, ok := cols["link_url"].(string); ok && l != "" && !linkRe.MatchString(l) {
		f["link_url"] = "ลิงก์ต้องขึ้นต้นด้วย / หรือ https://"
	}
	if create {
		if s, _ := cols["image_url"].(string); s == "" {
			f["image_url"] = "กรุณาใส่รูปแบนเนอร์"
		}
	} else if s, ok := cols["image_url"].(string); ok && s == "" {
		f["image_url"] = "กรุณาใส่รูปแบนเนอร์"
	}
	for _, name := range []string{"campaign_id", "category_id"} {
		v, ok := raw[name]
		if !ok {
			continue
		}
		if string(v) == "null" {
			cols[name] = nil
			continue
		}
		var n int64
		if json.Unmarshal(v, &n) != nil || n <= 0 {
			f[name] = "ค่าไม่ถูกต้อง"
			continue
		}
		cols[name] = n
	}
	for _, name := range []string{"starts_at", "ends_at"} {
		v, ok := raw[name]
		if !ok {
			continue
		}
		if string(v) == "null" {
			cols[name] = nil
			continue
		}
		var t time.Time
		if json.Unmarshal(v, &t) != nil {
			f[name] = "วันเวลาไม่ถูกต้อง"
			continue
		}
		cols[name] = t
	}
	if v, ok := raw["is_active"]; ok {
		var b bool
		if json.Unmarshal(v, &b) != nil {
			f["is_active"] = "ค่าไม่ถูกต้อง"
		} else {
			cols["is_active"] = b
		}
	}
	if v, ok := raw["sort_order"]; ok {
		var n int
		if json.Unmarshal(v, &n) != nil {
			f["sort_order"] = "ค่าไม่ถูกต้อง"
		} else {
			cols["sort_order"] = n
		}
	}
	return cols, f
}

func (h *handler) bannerErr(c *gin.Context, err error) {
	switch {
	case httpx.IsCheckViolation(err):
		httpx.Validation(c, map[string]string{"ends_at": "ช่วงเวลาหรือข้อมูลแบนเนอร์ไม่ถูกต้อง"})
	case httpx.IsFKViolation(err):
		httpx.Validation(c, map[string]string{"campaign_id": "ไม่พบแคมเปญหรือหมวดหมู่ที่อ้างอิง"})
	case httpx.IsNoRows(err):
		httpx.NotFound(c)
	default:
		httpx.Internal(c, h.d.Log, err)
	}
}

func (h *handler) createBanner(c *gin.Context) {
	var raw map[string]json.RawMessage
	if !httpx.BindJSON(c, &raw) {
		return
	}
	cols, f := bannerFields(raw, true)
	if len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	ctx := c.Request.Context()
	var names, ph []string
	var vals []any
	for k, v := range cols {
		names = append(names, k)
		vals = append(vals, v)
		ph = append(ph, "$"+itoa(len(vals)))
	}
	var b adminBanner
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var err error
		b, err = scanBanner(tx.QueryRow(ctx, `INSERT INTO banners (`+strings.Join(names, ", ")+`) VALUES (`+strings.Join(ph, ", ")+
			`) RETURNING `+bannerCols, vals...))
		if err != nil {
			return err
		}
		return auth.Audit(c, tx, "banner.create", "banner", b.ID, map[string]any{"placement": b.Placement, "title": b.Title})
	})
	if err != nil {
		h.bannerErr(c, err)
		return
	}
	httpx.Data(c, http.StatusCreated, b)
}

func (h *handler) patchBanner(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var raw map[string]json.RawMessage
	if !httpx.BindJSON(c, &raw) {
		return
	}
	cols, f := bannerFields(raw, false)
	if len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	ctx := c.Request.Context()
	sets := []string{"updated_at = now()"}
	vals := []any{id}
	fields := []string{}
	for k, v := range cols {
		vals = append(vals, v)
		sets = append(sets, k+" = $"+itoa(len(vals)))
		fields = append(fields, k)
	}
	var b adminBanner
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var err error
		b, err = scanBanner(tx.QueryRow(ctx, `UPDATE banners SET `+strings.Join(sets, ", ")+` WHERE id = $1 RETURNING `+bannerCols, vals...))
		if err != nil {
			return err
		}
		return auth.Audit(c, tx, "banner.update", "banner", id, map[string]any{"fields": fields})
	})
	if err != nil {
		h.bannerErr(c, err)
		return
	}
	httpx.Data(c, http.StatusOK, b)
}

func (h *handler) deleteBanner(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM banners WHERE id = $1`, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return auth.Audit(c, tx, "banner.delete", "banner", id, nil)
	})
	if err != nil {
		h.bannerErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
