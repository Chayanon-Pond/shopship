package promotions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/httpx"
)

var slugRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ---------- flash sales ----------

type AdminFlashItem struct {
	ID               int64  `json:"id"`
	VariantID        int64  `json:"variant_id"`
	SKU              string `json:"sku"`
	ProductName      string `json:"product_name"`
	VariantName      string `json:"variant_name"`
	ListPriceSatang  int64  `json:"list_price_satang"`
	SalePriceSatang  int64  `json:"sale_price_satang"`
	QtyLimit         int    `json:"qty_limit"`
	SoldQty          int    `json:"sold_qty"`
	PerCustomerLimit *int   `json:"per_customer_limit"`
	SortOrder        int    `json:"sort_order"`
}

type AdminFlashSale struct {
	ID         int64            `json:"id"`
	Name       string           `json:"name"`
	Label      string           `json:"label"`
	Status     string           `json:"status"`
	StartsAt   time.Time        `json:"starts_at"`
	EndsAt     time.Time        `json:"ends_at"`
	CampaignID *int64           `json:"campaign_id"`
	Items      []AdminFlashItem `json:"items"`
}

type flashInput struct {
	Name       string      `json:"name"`
	Label      string      `json:"label"`
	Status     string      `json:"status"`
	StartsAt   *time.Time  `json:"starts_at"`
	EndsAt     *time.Time  `json:"ends_at"`
	CampaignID *int64      `json:"campaign_id"`
	Items      []flashItem `json:"items"` // create only (PUT /items replaces)
}

type flashItem struct {
	VariantID        int64 `json:"variant_id"`
	SalePriceSatang  int64 `json:"sale_price_satang"`
	QtyLimit         int   `json:"qty_limit"`
	PerCustomerLimit *int  `json:"per_customer_limit"`
	SortOrder        int   `json:"sort_order"`
}

func (in *flashInput) validate() map[string]string {
	f := map[string]string{}
	in.Name = strings.TrimSpace(in.Name)
	if in.Label = strings.TrimSpace(in.Label); in.Label == "" {
		in.Label = "Flash Sale"
	}
	if in.Status == "" {
		in.Status = "draft"
	}
	if l := len([]rune(in.Name)); l < 1 || l > 120 {
		f["name"] = "กรุณาระบุชื่อ (ไม่เกิน 120 ตัวอักษร)"
	}
	if len([]rune(in.Label)) > 120 {
		f["label"] = "ไม่เกิน 120 ตัวอักษร"
	}
	if !slices.Contains(statuses, in.Status) {
		f["status"] = "สถานะไม่ถูกต้อง"
	}
	if in.StartsAt == nil || in.EndsAt == nil || !in.EndsAt.After(*in.StartsAt) {
		f["ends_at"] = "กรุณาระบุช่วงเวลา (สิ้นสุดหลังเริ่ม)"
	}
	return f
}

func loadFlashSales(ctx context.Context, q Querier, where string, args ...any) ([]AdminFlashSale, error) {
	rows, err := q.Query(ctx, `SELECT id, name, label, status, starts_at, ends_at, campaign_id FROM flash_sales WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (AdminFlashSale, error) {
		var s AdminFlashSale
		err := r.Scan(&s.ID, &s.Name, &s.Label, &s.Status, &s.StartsAt, &s.EndsAt, &s.CampaignID)
		s.StartsAt, s.EndsAt, s.Items = s.StartsAt.UTC(), s.EndsAt.UTC(), []AdminFlashItem{}
		return s, err
	})
	if err != nil || len(out) == 0 {
		if out == nil {
			out = []AdminFlashSale{}
		}
		return out, err
	}
	idx := map[int64]int{}
	ids := make([]int64, len(out))
	for i, s := range out {
		idx[s.ID], ids[i] = i, s.ID
	}
	rows, err = q.Query(ctx, `SELECT fi.flash_sale_id, fi.id, fi.variant_id, v.sku, p.name, v.name, v.price_satang,
		fi.sale_price_satang, fi.qty_limit, fi.sold_qty, fi.per_customer_limit, fi.sort_order
		FROM flash_sale_items fi JOIN product_variants v ON v.id = fi.variant_id JOIN products p ON p.id = v.product_id
		WHERE fi.flash_sale_id = ANY($1) ORDER BY fi.sort_order, fi.id`, ids)
	if err != nil {
		return nil, err
	}
	var sid int64
	var it AdminFlashItem
	_, err = pgx.ForEachRow(rows, []any{&sid, &it.ID, &it.VariantID, &it.SKU, &it.ProductName, &it.VariantName, &it.ListPriceSatang,
		&it.SalePriceSatang, &it.QtyLimit, &it.SoldQty, &it.PerCustomerLimit, &it.SortOrder}, func() error {
		out[idx[sid]].Items = append(out[idx[sid]].Items, it)
		return nil
	})
	return out, err
}

func (h *handlers) listFlashSales(c *gin.Context) {
	if !h.needDB(c) {
		return
	}
	page, per := httpx.Page(c, 50, 100)
	ctx := c.Request.Context()
	var total int
	if err := h.d.DB.QueryRow(ctx, `SELECT count(*) FROM flash_sales`).Scan(&total); err != nil {
		h.dbError(c, err)
		return
	}
	out, err := loadFlashSales(ctx, h.d.DB, `true ORDER BY starts_at DESC, id DESC LIMIT $1 OFFSET $2`, per, (page-1)*per)
	if err != nil {
		h.dbError(c, err)
		return
	}
	httpx.List(c, out, httpx.NewMeta(page, per, total))
}

func (h *handlers) respondFlash(c *gin.Context, status int, id int64) {
	out, err := loadFlashSales(c.Request.Context(), h.d.DB, "id = $1", id)
	if err != nil {
		h.dbError(c, err)
		return
	}
	if len(out) == 0 {
		notFound(c)
		return
	}
	httpx.Data(c, status, out[0])
}

func (h *handlers) getFlashSale(c *gin.Context) {
	id, ok := pathID(c)
	if !ok || !h.needDB(c) {
		return
	}
	h.respondFlash(c, http.StatusOK, id)
}

var errOverlap = errors.New("flash overlap")

type fieldErr map[string]string

func (f fieldErr) Error() string { return "validation" }

// checkOverlap: a variant must not be in two overlapping active flash sales.
func checkOverlap(ctx context.Context, tx pgx.Tx, saleID int64) error {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM flash_sale_items a
		JOIN flash_sales sa ON sa.id = a.flash_sale_id
		JOIN flash_sale_items b ON b.variant_id = a.variant_id AND b.flash_sale_id <> a.flash_sale_id
		JOIN flash_sales sb ON sb.id = b.flash_sale_id
		WHERE sa.id = $1 AND sa.status = 'active' AND sb.status = 'active'
		  AND sa.starts_at < sb.ends_at AND sb.starts_at < sa.ends_at`, saleID).Scan(&n)
	if err != nil {
		return err
	}
	if n > 0 {
		return errOverlap
	}
	return nil
}

// replaceItems upserts items by variant; removing an item that has sales is refused.
func replaceItems(ctx context.Context, tx pgx.Tx, saleID int64, items []flashItem) error {
	f := fieldErr{}
	seen := map[int64]bool{}
	for i, it := range items {
		key := fmt.Sprintf("items.%d", i)
		if seen[it.VariantID] {
			f[key] = "สินค้าซ้ำ"
			continue
		}
		seen[it.VariantID] = true
		var list int64
		var sold int
		err := tx.QueryRow(ctx, `SELECT v.price_satang, coalesce((SELECT sold_qty FROM flash_sale_items WHERE flash_sale_id = $2 AND variant_id = v.id), 0)
			FROM product_variants v WHERE v.id = $1`, it.VariantID, saleID).Scan(&list, &sold)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			f[key] = "ไม่พบสินค้า"
		case err != nil:
			return err
		case it.SalePriceSatang <= 0 || it.SalePriceSatang >= list:
			f[key] = "ราคาแฟลชต้องต่ำกว่าราคาปกติ"
		case it.QtyLimit < 1:
			f[key] = "จำนวนจำกัดต้องอย่างน้อย 1"
		case it.QtyLimit < sold:
			f[key] = fmt.Sprintf("ลดจำนวนจำกัดต่ำกว่าที่ขายไปแล้ว (%d) ไม่ได้", sold)
		case it.PerCustomerLimit != nil && *it.PerCustomerLimit < 1:
			f[key] = "จำกัดต่อคนต้องอย่างน้อย 1"
		}
	}
	if len(f) > 0 {
		return f
	}
	ids := make([]int64, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.VariantID)
	}
	var withSales int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM flash_sale_items WHERE flash_sale_id = $1 AND NOT (variant_id = ANY($2)) AND sold_qty > 0`,
		saleID, ids).Scan(&withSales); err != nil {
		return err
	}
	if withSales > 0 {
		return fieldErr{"items": "ลบสินค้าที่มียอดขายแล้วออกจากแฟลชเซลไม่ได้"}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM flash_sale_items WHERE flash_sale_id = $1 AND NOT (variant_id = ANY($2))`, saleID, ids); err != nil {
		return err
	}
	for _, it := range items {
		if _, err := tx.Exec(ctx, `INSERT INTO flash_sale_items (flash_sale_id, variant_id, sale_price_satang, qty_limit, per_customer_limit, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (flash_sale_id, variant_id) DO UPDATE SET sale_price_satang = EXCLUDED.sale_price_satang,
			  qty_limit = EXCLUDED.qty_limit, per_customer_limit = EXCLUDED.per_customer_limit, sort_order = EXCLUDED.sort_order`,
			saleID, it.VariantID, it.SalePriceSatang, it.QtyLimit, it.PerCustomerLimit, it.SortOrder); err != nil {
			return err
		}
	}
	return nil
}

// flashTxError maps the helper errors of a flash-sale transaction.
func (h *handlers) flashTxError(c *gin.Context, err error) {
	var fe fieldErr
	switch {
	case errors.As(err, &fe):
		invalid(c, fe)
	case errors.Is(err, errOverlap):
		httpx.Error(c, http.StatusConflict, httpx.CodeConflict, "สินค้านี้อยู่ในแฟลชเซลอื่นที่ช่วงเวลาทับกัน", nil)
	default:
		h.dbError(c, err)
	}
}

func (h *handlers) createFlashSale(c *gin.Context) {
	if !h.needDB(c) {
		return
	}
	var in flashInput
	if !decode(c, &in) {
		return
	}
	if f := in.validate(); len(f) > 0 {
		invalid(c, f)
		return
	}
	ctx := c.Request.Context()
	var id int64
	err := h.inTx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO flash_sales (name, label, status, starts_at, ends_at, campaign_id, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, in.Name, in.Label, in.Status, *in.StartsAt, *in.EndsAt, in.CampaignID, actorID(c)).
			Scan(&id); err != nil {
			return err
		}
		if len(in.Items) > 0 {
			if err := replaceItems(ctx, tx, id, in.Items); err != nil {
				return err
			}
		}
		if err := checkOverlap(ctx, tx, id); err != nil {
			return err
		}
		return audit(ctx, tx, c, "flash_sale.create", "flash_sale", id, gin.H{"name": in.Name})
	})
	if err != nil {
		h.flashTxError(c, err)
		return
	}
	h.respondFlash(c, http.StatusCreated, id)
}

func (h *handlers) patchFlashSale(c *gin.Context) {
	id, ok := pathID(c)
	if !ok || !h.needDB(c) {
		return
	}
	ctx := c.Request.Context()
	cur, err := loadFlashSales(ctx, h.d.DB, "id = $1", id)
	if err != nil {
		h.dbError(c, err)
		return
	}
	if len(cur) == 0 {
		notFound(c)
		return
	}
	s := cur[0]
	in := flashInput{Name: s.Name, Label: s.Label, Status: s.Status, StartsAt: &s.StartsAt, EndsAt: &s.EndsAt, CampaignID: s.CampaignID}
	if !decode(c, &in) {
		return
	}
	if f := in.validate(); len(f) > 0 {
		invalid(c, f)
		return
	}
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE flash_sales SET name=$1, label=$2, status=$3, starts_at=$4, ends_at=$5, campaign_id=$6 WHERE id=$7`,
			in.Name, in.Label, in.Status, *in.StartsAt, *in.EndsAt, in.CampaignID, id); err != nil {
			return err
		}
		if in.Items != nil {
			if err := replaceItems(ctx, tx, id, in.Items); err != nil {
				return err
			}
		}
		if err := checkOverlap(ctx, tx, id); err != nil {
			return err
		}
		return audit(ctx, tx, c, "flash_sale.update", "flash_sale", id, gin.H{"status": in.Status})
	})
	if err != nil {
		h.flashTxError(c, err)
		return
	}
	h.respondFlash(c, http.StatusOK, id)
}

func (h *handlers) putFlashItems(c *gin.Context) {
	id, ok := pathID(c)
	if !ok || !h.needDB(c) {
		return
	}
	var items []flashItem
	if !decode(c, &items) {
		return
	}
	ctx := c.Request.Context()
	err := h.inTx(ctx, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM flash_sales WHERE id = $1 FOR UPDATE)`, id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return pgx.ErrNoRows
		}
		if err := replaceItems(ctx, tx, id, items); err != nil {
			return err
		}
		if err := checkOverlap(ctx, tx, id); err != nil {
			return err
		}
		return audit(ctx, tx, c, "flash_sale.items_replace", "flash_sale", id, gin.H{"count": len(items)})
	})
	if err != nil {
		h.flashTxError(c, err)
		return
	}
	h.respondFlash(c, http.StatusOK, id)
}

// DELETE: archive when anything was sold, else delete.
func (h *handlers) deleteFlashSale(c *gin.Context) {
	id, ok := pathID(c)
	if !ok || !h.needDB(c) {
		return
	}
	ctx := c.Request.Context()
	err := h.inTx(ctx, func(tx pgx.Tx) error {
		var sold bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM flash_sale_items fi WHERE fi.flash_sale_id = $1
			AND (fi.sold_qty > 0 OR EXISTS (SELECT 1 FROM stock_reservations r WHERE r.flash_sale_item_id = fi.id)))`, id).Scan(&sold); err != nil {
			return err
		}
		q, action := `DELETE FROM flash_sales WHERE id = $1`, "flash_sale.delete"
		if sold {
			q, action = `UPDATE flash_sales SET status = 'archived' WHERE id = $1`, "flash_sale.archive"
		}
		tag, err := tx.Exec(ctx, q, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return audit(ctx, tx, c, action, "flash_sale", id, nil)
	})
	if err != nil {
		h.dbError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---------- campaigns ----------

type AdminCampaign struct {
	ID        int64     `json:"id"`
	Slug      string    `json:"slug"`
	Name      string    `json:"name"`
	SeasonTag string    `json:"season_tag"`
	Theme     Theme     `json:"theme"`
	StartsAt  time.Time `json:"starts_at"`
	EndsAt    time.Time `json:"ends_at"`
	Priority  int       `json:"priority"`
	IsActive  bool      `json:"is_active"`
	State     string    `json:"state"` // scheduled|running|ended|inactive (computed)
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type campaignInput struct {
	Slug      string     `json:"slug"`
	Name      string     `json:"name"`
	SeasonTag string     `json:"season_tag"`
	Theme     Theme      `json:"theme"`
	StartsAt  *time.Time `json:"starts_at"`
	EndsAt    *time.Time `json:"ends_at"`
	Priority  int        `json:"priority"`
	IsActive  *bool      `json:"is_active"`
}

var hexColor = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func (in *campaignInput) validate() map[string]string {
	f := map[string]string{}
	in.Slug, in.Name = strings.TrimSpace(in.Slug), strings.TrimSpace(in.Name)
	if in.IsActive == nil {
		t := true
		in.IsActive = &t
	}
	if !slugRe.MatchString(in.Slug) {
		f["slug"] = "slug ใช้ a-z, 0-9 และ - เท่านั้น"
	}
	if l := len([]rune(in.Name)); l < 1 || l > 120 {
		f["name"] = "กรุณาระบุชื่อ (ไม่เกิน 120 ตัวอักษร)"
	}
	if len([]rune(in.SeasonTag)) > 40 {
		f["season_tag"] = "ไม่เกิน 40 ตัวอักษร"
	}
	if in.StartsAt == nil || in.EndsAt == nil || !in.EndsAt.After(*in.StartsAt) {
		f["ends_at"] = "กรุณาระบุช่วงเวลา (สิ้นสุดหลังเริ่ม)"
	}
	for k, v := range map[string]string{"theme.accent": in.Theme.Accent, "theme.accent_contrast": in.Theme.AccentContrast, "theme.background": in.Theme.Background} {
		if v != "" && !hexColor.MatchString(v) {
			f[k] = "สีต้องเป็นรูปแบบ #RRGGBB"
		}
	}
	return f
}

func loadCampaigns(ctx context.Context, q Querier, now time.Time, where string, args ...any) ([]AdminCampaign, error) {
	rows, err := q.Query(ctx, `SELECT id, slug, name, season_tag, theme, starts_at, ends_at, priority, is_active,
		CASE WHEN NOT is_active THEN 'inactive' WHEN starts_at > $1 THEN 'scheduled' WHEN ends_at <= $1 THEN 'ended' ELSE 'running' END,
		created_at, updated_at FROM campaigns WHERE `+where, append([]any{now}, args...)...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (AdminCampaign, error) {
		var cp AdminCampaign
		var theme []byte
		err := r.Scan(&cp.ID, &cp.Slug, &cp.Name, &cp.SeasonTag, &theme, &cp.StartsAt, &cp.EndsAt, &cp.Priority, &cp.IsActive, &cp.State,
			&cp.CreatedAt, &cp.UpdatedAt)
		_ = json.Unmarshal(theme, &cp.Theme)
		cp.StartsAt, cp.EndsAt, cp.CreatedAt, cp.UpdatedAt = cp.StartsAt.UTC(), cp.EndsAt.UTC(), cp.CreatedAt.UTC(), cp.UpdatedAt.UTC()
		return cp, err
	})
	if out == nil {
		out = []AdminCampaign{}
	}
	return out, err
}

func (h *handlers) listCampaigns(c *gin.Context) {
	if !h.needDB(c) {
		return
	}
	page, per := httpx.Page(c, 50, 100)
	ctx := c.Request.Context()
	var total int
	if err := h.d.DB.QueryRow(ctx, `SELECT count(*) FROM campaigns`).Scan(&total); err != nil {
		h.dbError(c, err)
		return
	}
	out, err := loadCampaigns(ctx, h.d.DB, h.d.Now(), `true ORDER BY starts_at DESC, id DESC LIMIT $2 OFFSET $3`, per, (page-1)*per)
	if err != nil {
		h.dbError(c, err)
		return
	}
	httpx.List(c, out, httpx.NewMeta(page, per, total))
}

func (h *handlers) saveCampaign(c *gin.Context, id int64) {
	ctx := c.Request.Context()
	var in campaignInput
	if id != 0 {
		cur, err := loadCampaigns(ctx, h.d.DB, h.d.Now(), "id = $2", id)
		if err != nil {
			h.dbError(c, err)
			return
		}
		if len(cur) == 0 {
			notFound(c)
			return
		}
		cp := cur[0]
		in = campaignInput{Slug: cp.Slug, Name: cp.Name, SeasonTag: cp.SeasonTag, Theme: cp.Theme, StartsAt: &cp.StartsAt, EndsAt: &cp.EndsAt,
			Priority: cp.Priority, IsActive: &cp.IsActive}
	}
	if !decode(c, &in) {
		return
	}
	if f := in.validate(); len(f) > 0 {
		invalid(c, f)
		return
	}
	theme, _ := json.Marshal(in.Theme)
	status := http.StatusOK
	err := h.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		action := "campaign.update"
		if id == 0 {
			action, status = "campaign.create", http.StatusCreated
			err = tx.QueryRow(ctx, `INSERT INTO campaigns (slug, name, season_tag, theme, starts_at, ends_at, priority, is_active)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, in.Slug, in.Name, in.SeasonTag, theme, *in.StartsAt, *in.EndsAt, in.Priority, *in.IsActive).
				Scan(&id)
		} else {
			_, err = tx.Exec(ctx, `UPDATE campaigns SET slug=$1, name=$2, season_tag=$3, theme=$4, starts_at=$5, ends_at=$6, priority=$7, is_active=$8
				WHERE id=$9`, in.Slug, in.Name, in.SeasonTag, theme, *in.StartsAt, *in.EndsAt, in.Priority, *in.IsActive, id)
		}
		if err != nil {
			return err
		}
		return audit(ctx, tx, c, action, "campaign", id, gin.H{"slug": in.Slug})
	})
	if err != nil {
		h.dbError(c, err)
		return
	}
	out, err := loadCampaigns(ctx, h.d.DB, h.d.Now(), "id = $2", id)
	if err != nil || len(out) == 0 {
		h.dbError(c, errors.Join(err, pgx.ErrNoRows))
		return
	}
	httpx.Data(c, status, out[0])
}

func (h *handlers) createCampaign(c *gin.Context) {
	if h.needDB(c) {
		h.saveCampaign(c, 0)
	}
}

func (h *handlers) patchCampaign(c *gin.Context) {
	if id, ok := pathID(c); ok && h.needDB(c) {
		h.saveCampaign(c, id)
	}
}

// DELETE: promotions/flash sales/banners keep existing (campaign_id SET NULL).
func (h *handlers) deleteCampaign(c *gin.Context) {
	id, ok := pathID(c)
	if !ok || !h.needDB(c) {
		return
	}
	ctx := c.Request.Context()
	err := h.inTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM campaigns WHERE id = $1`, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return audit(ctx, tx, c, "campaign.delete", "campaign", id, nil)
	})
	if err != nil {
		h.dbError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---------- customer groups ----------

type CustomerGroup struct {
	ID          int64  `json:"id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
	MemberCount int    `json:"member_count"`
}

func loadGroups(ctx context.Context, q Querier, where string, args ...any) ([]CustomerGroup, error) {
	rows, err := q.Query(ctx, `SELECT g.id, g.code, g.name, g.description,
		(SELECT count(*) FROM users u WHERE u.group_id = g.id AND u.deleted_at IS NULL)::int
		FROM customer_groups g WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (CustomerGroup, error) {
		var g CustomerGroup
		return g, r.Scan(&g.ID, &g.Code, &g.Name, &g.Description, &g.MemberCount)
	})
	if out == nil {
		out = []CustomerGroup{}
	}
	return out, err
}

func (h *handlers) listGroups(c *gin.Context) {
	if !h.needDB(c) {
		return
	}
	page, per := httpx.Page(c, 50, 100)
	ctx := c.Request.Context()
	var total int
	if err := h.d.DB.QueryRow(ctx, `SELECT count(*) FROM customer_groups`).Scan(&total); err != nil {
		h.dbError(c, err)
		return
	}
	out, err := loadGroups(ctx, h.d.DB, `true ORDER BY g.name, g.id LIMIT $1 OFFSET $2`, per, (page-1)*per)
	if err != nil {
		h.dbError(c, err)
		return
	}
	httpx.List(c, out, httpx.NewMeta(page, per, total))
}

func (h *handlers) saveGroup(c *gin.Context, id int64) {
	ctx := c.Request.Context()
	var in struct {
		Code        string `json:"code"`
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if id != 0 {
		cur, err := loadGroups(ctx, h.d.DB, "g.id = $1", id)
		if err != nil {
			h.dbError(c, err)
			return
		}
		if len(cur) == 0 {
			notFound(c)
			return
		}
		in.Code, in.Name, in.Description = cur[0].Code, cur[0].Name, cur[0].Description
	}
	if !decode(c, &in) {
		return
	}
	in.Code, in.Name = strings.TrimSpace(in.Code), strings.TrimSpace(in.Name)
	f := map[string]string{}
	if !slugRe.MatchString(in.Code) {
		f["code"] = "รหัสใช้ a-z, 0-9 และ - เท่านั้น"
	}
	if l := len([]rune(in.Name)); l < 1 || l > 100 {
		f["name"] = "กรุณาระบุชื่อ (ไม่เกิน 100 ตัวอักษร)"
	}
	if len(f) > 0 {
		invalid(c, f)
		return
	}
	status := http.StatusOK
	err := h.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		action := "customer_group.update"
		if id == 0 {
			action, status = "customer_group.create", http.StatusCreated
			err = tx.QueryRow(ctx, `INSERT INTO customer_groups (code, name, description) VALUES ($1, $2, $3) RETURNING id`,
				in.Code, in.Name, in.Description).Scan(&id)
		} else {
			_, err = tx.Exec(ctx, `UPDATE customer_groups SET code=$1, name=$2, description=$3 WHERE id=$4`, in.Code, in.Name, in.Description, id)
		}
		if err != nil {
			return err
		}
		return audit(ctx, tx, c, action, "customer_group", id, gin.H{"code": in.Code})
	})
	if err != nil {
		h.dbError(c, err)
		return
	}
	out, err := loadGroups(ctx, h.d.DB, "g.id = $1", id)
	if err != nil || len(out) == 0 {
		h.dbError(c, errors.Join(err, pgx.ErrNoRows))
		return
	}
	httpx.Data(c, status, out[0])
}

func (h *handlers) createGroup(c *gin.Context) {
	if h.needDB(c) {
		h.saveGroup(c, 0)
	}
}

func (h *handlers) patchGroup(c *gin.Context) {
	if id, ok := pathID(c); ok && h.needDB(c) {
		h.saveGroup(c, id)
	}
}

// DELETE: members' group_id becomes NULL (FK ON DELETE SET NULL). Promotions
// that referenced the group keep the id in customer_group_ids (no FK on arrays),
// so it is stripped here to keep audiences meaningful.
func (h *handlers) deleteGroup(c *gin.Context) {
	id, ok := pathID(c)
	if !ok || !h.needDB(c) {
		return
	}
	ctx := c.Request.Context()
	err := h.inTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM customer_groups WHERE id = $1`, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		// group_price requires a non-empty audience (CHECK): archive those whose only group it was.
		if _, err := tx.Exec(ctx, `UPDATE promotions SET customer_group_ids = array_remove(customer_group_ids, $1::bigint)
			WHERE $1::bigint = ANY(customer_group_ids) AND NOT (kind = 'group_price' AND customer_group_ids = ARRAY[$1::bigint])`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE promotions SET status = 'archived' WHERE kind = 'group_price' AND customer_group_ids = ARRAY[$1::bigint]`, id); err != nil {
			return err
		}
		return audit(ctx, tx, c, "customer_group.delete", "customer_group", id, nil)
	})
	if err != nil {
		h.dbError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
