package promotions

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
	"github.com/shopship/shop/api/internal/pricing"
)

// ---------- shapes (docs/API.md §12.2) ----------

type QtyTierJSON struct {
	MinQty          int    `json:"min_qty"`
	UnitPriceSatang *int64 `json:"unit_price_satang"`
	PercentBP       *int   `json:"percent_bp"`
}

type TargetJSON struct {
	Type string `json:"type"`
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type CodeJSON struct {
	ID       int64  `json:"id"`
	Code     string `json:"code"`
	IsActive bool   `json:"is_active"`
}

type CampaignRef struct {
	ID   int64  `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type AdminPromotion struct {
	ID                int64         `json:"id"`
	Name              string        `json:"name"`
	Label             string        `json:"label"`
	Description       string        `json:"description"`
	Kind              string        `json:"kind"`
	Layer             int           `json:"layer"`
	Status            string        `json:"status"`
	StartsAt          time.Time     `json:"starts_at"`
	EndsAt            *time.Time    `json:"ends_at"`
	Priority          int           `json:"priority"`
	Exclusive         bool          `json:"exclusive"`
	AutoApply         bool          `json:"auto_apply"`
	PercentBP         *int          `json:"percent_bp"`
	AmountSatang      *int64        `json:"amount_satang"`
	BuyQty            *int          `json:"buy_qty"`
	GetQty            *int          `json:"get_qty"`
	GetPercentBP      *int          `json:"get_percent_bp"`
	MinSpendSatang    int64         `json:"min_spend_satang"`
	MaxDiscountSatang *int64        `json:"max_discount_satang"`
	UsageLimit        *int          `json:"usage_limit"`
	PerCustomerLimit  *int          `json:"per_customer_limit"`
	UsedCount         int           `json:"used_count"`
	CustomerGroupIDs  []int64       `json:"customer_group_ids"`
	Tiers             []string      `json:"tiers"`
	QtyTiers          []QtyTierJSON `json:"qty_tiers"`
	Targets           []TargetJSON  `json:"targets"`
	Codes             []CodeJSON    `json:"codes"`
	Campaign          *CampaignRef  `json:"campaign"`
	SeasonTag         string        `json:"season_tag"`
	CreatedAt         time.Time     `json:"created_at"`
	UpdatedAt         time.Time     `json:"updated_at"`
	State             string        `json:"state"`
}

// promoInput = the writable fields. Pre-filled from the stored row on PATCH;
// json decoding then overwrites only the fields present in the body.
type promoInput struct {
	Name              string        `json:"name"`
	Label             string        `json:"label"`
	Description       string        `json:"description"`
	Kind              string        `json:"kind"`
	Status            string        `json:"status"`
	StartsAt          *time.Time    `json:"starts_at"`
	EndsAt            *time.Time    `json:"ends_at"`
	Priority          int           `json:"priority"`
	Exclusive         bool          `json:"exclusive"`
	AutoApply         *bool         `json:"auto_apply"`
	PercentBP         *int          `json:"percent_bp"`
	AmountSatang      *int64        `json:"amount_satang"`
	BuyQty            *int          `json:"buy_qty"`
	GetQty            *int          `json:"get_qty"`
	GetPercentBP      *int          `json:"get_percent_bp"`
	MinSpendSatang    int64         `json:"min_spend_satang"`
	MaxDiscountSatang *int64        `json:"max_discount_satang"`
	UsageLimit        *int          `json:"usage_limit"`
	PerCustomerLimit  *int          `json:"per_customer_limit"`
	CustomerGroupIDs  []int64       `json:"customer_group_ids"`
	Tiers             []string      `json:"tiers"`
	QtyTiers          []QtyTierJSON `json:"qty_tiers"`
	Targets           []TargetJSON  `json:"targets"`
	CampaignID        *int64        `json:"campaign_id"`
	SeasonTag         string        `json:"season_tag"`
	Codes             []string      `json:"codes"` // create only
}

var (
	codeRe     = regexp.MustCompile(`^[A-Z0-9][A-Z0-9_-]{2,31}$`)
	validTiers = []string{"standard", "silver", "gold", "platinum"}
	l1Kinds    = []string{"quantity_break", "group_price", "tier_price"}
	allKinds   = []string{"quantity_break", "group_price", "tier_price", "buy_x_get_y", "cart_percent", "cart_amount", "free_shipping"}
	statuses   = []string{"draft", "active", "paused", "archived"}
)

// deriveLayer maps kind + "needs a code?" to the layer (DB CHECK matrix).
func deriveLayer(kind string, auto bool) int {
	switch {
	case slices.Contains(l1Kinds, kind):
		return 1
	case kind == "buy_x_get_y":
		return 2
	case !auto:
		return 4
	case kind == "free_shipping":
		return 5
	default:
		return 3
	}
}

func (in *promoInput) normalize() {
	in.Name, in.Label = strings.TrimSpace(in.Name), strings.TrimSpace(in.Label)
	if in.Status == "" {
		in.Status = "draft"
	}
	if in.AutoApply == nil {
		a := len(in.Codes) == 0
		in.AutoApply = &a
	}
	if in.CustomerGroupIDs == nil {
		in.CustomerGroupIDs = []int64{}
	}
	if in.Tiers == nil {
		in.Tiers = []string{}
	}
	for i, c := range in.Codes {
		in.Codes[i] = strings.ToUpper(strings.TrimSpace(c))
	}
}

// validate returns Thai field errors (empty = ok).
func (in *promoInput) validate() map[string]string {
	f := map[string]string{}
	if l := len([]rune(in.Name)); l < 1 || l > 120 {
		f["name"] = "กรุณาระบุชื่อ (ไม่เกิน 120 ตัวอักษร)"
	}
	if l := len([]rune(in.Label)); l < 1 || l > 120 {
		f["label"] = "กรุณาระบุข้อความที่ลูกค้าเห็น (ไม่เกิน 120 ตัวอักษร)"
	}
	if !slices.Contains(allKinds, in.Kind) {
		f["kind"] = "ประเภทโปรโมชันไม่ถูกต้อง"
		return f
	}
	if !slices.Contains(statuses, in.Status) {
		f["status"] = "สถานะไม่ถูกต้อง"
	}
	if in.StartsAt == nil || in.StartsAt.IsZero() {
		f["starts_at"] = "กรุณาระบุวันเริ่ม"
	} else if in.EndsAt != nil && !in.EndsAt.After(*in.StartsAt) {
		f["ends_at"] = "วันสิ้นสุดต้องอยู่หลังวันเริ่ม"
	}
	auto := *in.AutoApply
	if !auto && !slices.Contains([]string{"cart_percent", "cart_amount", "free_shipping"}, in.Kind) {
		f["auto_apply"] = "ประเภทนี้ใช้กับโค้ดส่วนลดไม่ได้"
	}
	layer := deriveLayer(in.Kind, auto)
	if in.Exclusive && layer != 4 {
		f["exclusive"] = "ใช้ได้เฉพาะโค้ดส่วนลด"
	}
	bp := func(p *int, key string, need bool) {
		if p == nil {
			if need {
				f[key] = "กรุณาระบุเปอร์เซ็นต์"
			}
			return
		}
		if *p < 1 || *p > 10000 {
			f[key] = "ต้องอยู่ระหว่าง 0.01% ถึง 100%"
		}
	}
	posInt := func(p *int, key string, need bool) {
		if p == nil {
			if need {
				f[key] = "กรุณาระบุ"
			}
			return
		}
		if *p < 1 {
			f[key] = "ต้องมากกว่า 0"
		}
	}
	switch in.Kind {
	case "group_price":
		bp(in.PercentBP, "percent_bp", true)
		if len(in.CustomerGroupIDs) == 0 {
			f["customer_group_ids"] = "กรุณาเลือกกลุ่มลูกค้า"
		}
	case "tier_price":
		bp(in.PercentBP, "percent_bp", true)
		if len(in.Tiers) == 0 {
			f["tiers"] = "กรุณาเลือกระดับสมาชิก"
		}
	case "cart_percent":
		bp(in.PercentBP, "percent_bp", true)
	case "cart_amount":
		if in.AmountSatang == nil || *in.AmountSatang <= 0 {
			f["amount_satang"] = "กรุณาระบุจำนวนเงินที่ลด"
		}
	case "buy_x_get_y":
		posInt(in.BuyQty, "buy_qty", true)
		posInt(in.GetQty, "get_qty", true)
		bp(in.GetPercentBP, "get_percent_bp", true)
	case "quantity_break":
		if len(in.QtyTiers) == 0 {
			f["qty_tiers"] = "กรุณาระบุขั้นราคาอย่างน้อย 1 ขั้น"
		}
		seen := map[int]bool{}
		for i, t := range in.QtyTiers {
			key := fmt.Sprintf("qty_tiers.%d", i)
			switch {
			case t.MinQty < 2:
				f[key] = "จำนวนขั้นต่ำต้องอย่างน้อย 2 ชิ้น"
			case seen[t.MinQty]:
				f[key] = "จำนวนขั้นต่ำซ้ำกัน"
			case (t.UnitPriceSatang == nil) == (t.PercentBP == nil):
				f[key] = "ระบุราคาต่อชิ้น หรือ เปอร์เซ็นต์ อย่างใดอย่างหนึ่ง"
			case t.UnitPriceSatang != nil && *t.UnitPriceSatang <= 0, t.PercentBP != nil && (*t.PercentBP < 1 || *t.PercentBP > 10000):
				f[key] = "ค่าไม่ถูกต้อง"
			}
			seen[t.MinQty] = true
		}
	}
	if in.Kind != "quantity_break" && len(in.QtyTiers) > 0 {
		f["qty_tiers"] = "ใช้ได้เฉพาะโปรราคาส่งตามจำนวน"
	}
	if in.MinSpendSatang < 0 {
		f["min_spend_satang"] = "ต้องไม่ติดลบ"
	}
	if in.MaxDiscountSatang != nil && *in.MaxDiscountSatang <= 0 {
		f["max_discount_satang"] = "ต้องมากกว่า 0"
	}
	posInt(in.UsageLimit, "usage_limit", false)
	posInt(in.PerCustomerLimit, "per_customer_limit", false)
	for _, t := range in.Tiers {
		if !slices.Contains(validTiers, t) {
			f["tiers"] = "ระดับสมาชิกไม่ถูกต้อง"
		}
	}
	for i, t := range in.Targets {
		if !slices.Contains([]string{"category", "product", "variant"}, t.Type) || t.ID <= 0 {
			f[fmt.Sprintf("targets.%d", i)] = "เป้าหมายไม่ถูกต้อง"
		}
	}
	for i, c := range in.Codes {
		if !codeRe.MatchString(c) {
			f[fmt.Sprintf("codes.%d", i)] = "โค้ดต้องเป็น A-Z, 0-9, - หรือ _ ยาว 3–32 ตัว"
		}
	}
	if len(in.Codes) > 0 && layer != 4 {
		f["codes"] = "โปรอัตโนมัติไม่ใช้โค้ด"
	}
	return f
}

// ---------- read ----------

const adminPromoCols = `p.id, p.name, p.label, p.description, p.kind, p.layer, p.status, p.starts_at, p.ends_at, p.priority,
	p.exclusive, p.auto_apply, p.percent_bp, p.amount_satang, p.buy_qty, p.get_qty, p.get_percent_bp, p.min_spend_satang,
	p.max_discount_satang, p.usage_limit, p.per_customer_limit, p.used_count, p.customer_group_ids, p.tiers,
	p.season_tag, p.created_at, p.updated_at, cp.id, cp.slug, cp.name`

const stateExpr = `CASE WHEN p.status <> 'active' THEN p.status
	WHEN p.starts_at > $1 THEN 'scheduled'
	WHEN p.ends_at IS NOT NULL AND p.ends_at <= $1 THEN 'ended' ELSE 'running' END`

func scanAdminPromo(r pgx.CollectableRow) (AdminPromotion, error) {
	var p AdminPromotion
	var layer int16
	var cid *int64
	var cslug, cname *string
	err := r.Scan(&p.ID, &p.Name, &p.Label, &p.Description, &p.Kind, &layer, &p.Status, &p.StartsAt, &p.EndsAt, &p.Priority,
		&p.Exclusive, &p.AutoApply, &p.PercentBP, &p.AmountSatang, &p.BuyQty, &p.GetQty, &p.GetPercentBP, &p.MinSpendSatang,
		&p.MaxDiscountSatang, &p.UsageLimit, &p.PerCustomerLimit, &p.UsedCount, &p.CustomerGroupIDs, &p.Tiers,
		&p.SeasonTag, &p.CreatedAt, &p.UpdatedAt, &cid, &cslug, &cname, &p.State)
	p.Layer = int(layer)
	if cid != nil {
		p.Campaign = &CampaignRef{ID: *cid, Slug: *cslug, Name: *cname}
	}
	p.StartsAt, p.CreatedAt, p.UpdatedAt = p.StartsAt.UTC(), p.CreatedAt.UTC(), p.UpdatedAt.UTC()
	if p.EndsAt != nil {
		e := p.EndsAt.UTC()
		p.EndsAt = &e
	}
	if p.CustomerGroupIDs == nil {
		p.CustomerGroupIDs = []int64{}
	}
	if p.Tiers == nil {
		p.Tiers = []string{}
	}
	p.QtyTiers, p.Targets, p.Codes = []QtyTierJSON{}, []TargetJSON{}, []CodeJSON{}
	return p, err
}

// loadAdminPromos runs a filtered query ($1 = now) and attaches details.
func loadAdminPromos(ctx context.Context, q Querier, now time.Time, where, order string, args ...any) ([]AdminPromotion, error) {
	rows, err := q.Query(ctx, `SELECT `+adminPromoCols+`, `+stateExpr+` FROM promotions p
		LEFT JOIN campaigns cp ON cp.id = p.campaign_id WHERE `+where+` ORDER BY `+order, append([]any{now}, args...)...)
	if err != nil {
		return nil, err
	}
	ps, err := pgx.CollectRows(rows, scanAdminPromo)
	if err != nil {
		return nil, err
	}
	if len(ps) == 0 {
		return []AdminPromotion{}, nil
	}
	idx := map[int64]int{}
	ids := make([]int64, len(ps))
	for i, p := range ps {
		idx[p.ID], ids[i] = i, p.ID
	}
	rows, err = q.Query(ctx, `SELECT promotion_id, min_qty, unit_price_satang, percent_bp FROM promotion_qty_tiers
		WHERE promotion_id = ANY($1) ORDER BY promotion_id, min_qty`, ids)
	if err != nil {
		return nil, err
	}
	var pid int64
	var t QtyTierJSON
	if _, err := pgx.ForEachRow(rows, []any{&pid, &t.MinQty, &t.UnitPriceSatang, &t.PercentBP}, func() error {
		ps[idx[pid]].QtyTiers = append(ps[idx[pid]].QtyTiers, t)
		return nil
	}); err != nil {
		return nil, err
	}
	rows, err = q.Query(ctx, `
		SELECT t.promotion_id, t.target_type, coalesce(t.category_id, t.product_id, t.variant_id),
		       coalesce(c.name, pr.name, vp.name || CASE WHEN v.name <> '' THEN ' / ' || v.name ELSE '' END, '')
		  FROM promotion_targets t
		  LEFT JOIN categories c ON c.id = t.category_id
		  LEFT JOIN products pr ON pr.id = t.product_id
		  LEFT JOIN product_variants v ON v.id = t.variant_id
		  LEFT JOIN products vp ON vp.id = v.product_id
		 WHERE t.promotion_id = ANY($1) ORDER BY t.id`, ids)
	if err != nil {
		return nil, err
	}
	var tg TargetJSON
	if _, err := pgx.ForEachRow(rows, []any{&pid, &tg.Type, &tg.ID, &tg.Name}, func() error {
		ps[idx[pid]].Targets = append(ps[idx[pid]].Targets, tg)
		return nil
	}); err != nil {
		return nil, err
	}
	rows, err = q.Query(ctx, `SELECT promotion_id, id, code, is_active FROM coupon_codes WHERE promotion_id = ANY($1) ORDER BY id`, ids)
	if err != nil {
		return nil, err
	}
	var cj CodeJSON
	if _, err := pgx.ForEachRow(rows, []any{&pid, &cj.ID, &cj.Code, &cj.IsActive}, func() error {
		ps[idx[pid]].Codes = append(ps[idx[pid]].Codes, cj)
		return nil
	}); err != nil {
		return nil, err
	}
	return ps, nil
}

func loadAdminPromo(ctx context.Context, q Querier, now time.Time, id int64) (AdminPromotion, error) {
	ps, err := loadAdminPromos(ctx, q, now, "p.id = $2", "p.id", id)
	if err != nil {
		return AdminPromotion{}, err
	}
	if len(ps) == 0 {
		return AdminPromotion{}, pgx.ErrNoRows
	}
	return ps[0], nil
}

func (h *handlers) listPromotions(c *gin.Context) {
	if !h.needDB(c) {
		return
	}
	page, per := httpx.Page(c, 50, 100)
	conds := []string{"true"}
	args := []any{}
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)+1) }
	if v := c.Query("kind"); v != "" {
		conds = append(conds, "p.kind = "+arg(v))
	}
	if v, err := strconv.Atoi(c.Query("layer")); err == nil {
		conds = append(conds, "p.layer = "+arg(v))
	}
	if v := c.Query("state"); v != "" {
		conds = append(conds, "("+stateExpr+") = "+arg(v))
	}
	if v, err := strconv.ParseInt(c.Query("campaign_id"), 10, 64); err == nil {
		conds = append(conds, "p.campaign_id = "+arg(v))
	}
	if v := strings.TrimSpace(c.Query("q")); v != "" {
		a := arg("%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(v) + "%")
		conds = append(conds, "(p.name ILIKE "+a+" OR p.label ILIKE "+a+
			" OR EXISTS (SELECT 1 FROM coupon_codes cc WHERE cc.promotion_id = p.id AND cc.code ILIKE "+a+"))")
	}
	order := map[string]string{"": "p.created_at DESC, p.id DESC", "newest": "p.created_at DESC, p.id DESC", "oldest": "p.created_at, p.id",
		"starts_at": "p.starts_at, p.id", "-starts_at": "p.starts_at DESC, p.id", "priority": "p.priority DESC, p.id", "name": "p.name, p.id"}[c.Query("sort")]
	if order == "" {
		order = "p.created_at DESC, p.id DESC"
	}
	where := strings.Join(conds, " AND ")
	ctx, now := c.Request.Context(), h.d.Now()
	var total int
	if err := h.d.DB.QueryRow(ctx, `SELECT count(*) FROM promotions p WHERE $1::timestamptz IS NOT NULL AND `+where, append([]any{now}, args...)...).Scan(&total); err != nil {
		h.dbError(c, err)
		return
	}
	ps, err := loadAdminPromos(ctx, h.d.DB, now, where, order+" LIMIT "+strconv.Itoa(per)+" OFFSET "+strconv.Itoa((page-1)*per), args...)
	if err != nil {
		h.dbError(c, err)
		return
	}
	httpx.List(c, ps, httpx.NewMeta(page, per, total))
}

func (h *handlers) getPromotion(c *gin.Context) {
	id, ok := pathID(c)
	if !ok || !h.needDB(c) {
		return
	}
	p, err := loadAdminPromo(c.Request.Context(), h.d.DB, h.d.Now(), id)
	if err != nil {
		h.dbError(c, err)
		return
	}
	httpx.Data(c, http.StatusOK, p)
}

// ---------- write ----------

func toInput(p AdminPromotion) promoInput {
	in := promoInput{Name: p.Name, Label: p.Label, Description: p.Description, Kind: p.Kind, Status: p.Status,
		EndsAt: p.EndsAt, Priority: p.Priority, Exclusive: p.Exclusive, PercentBP: p.PercentBP,
		AmountSatang: p.AmountSatang, BuyQty: p.BuyQty, GetQty: p.GetQty, GetPercentBP: p.GetPercentBP, MinSpendSatang: p.MinSpendSatang,
		MaxDiscountSatang: p.MaxDiscountSatang, UsageLimit: p.UsageLimit, PerCustomerLimit: p.PerCustomerLimit,
		CustomerGroupIDs: p.CustomerGroupIDs, Tiers: p.Tiers, QtyTiers: p.QtyTiers, Targets: p.Targets, SeasonTag: p.SeasonTag}
	st := p.StartsAt
	in.StartsAt = &st
	auto := p.AutoApply
	in.AutoApply = &auto
	if p.Campaign != nil {
		id := p.Campaign.ID
		in.CampaignID = &id
	}
	return in
}

// savePromo writes the row (insert when id == 0) plus targets and tiers.
func savePromo(ctx context.Context, tx pgx.Tx, id int64, in promoInput, actor *int64) (int64, error) {
	auto := *in.AutoApply
	layer := deriveLayer(in.Kind, auto)
	// parameters irrelevant to the kind are stored as NULL
	keep := func(kinds ...string) bool { return slices.Contains(kinds, in.Kind) }
	pct, amt := in.PercentBP, in.AmountSatang
	if !keep("group_price", "tier_price", "cart_percent") {
		pct = nil
	}
	if !keep("cart_amount") {
		amt = nil
	}
	buy, get, getPct := in.BuyQty, in.GetQty, in.GetPercentBP
	if !keep("buy_x_get_y") {
		buy, get, getPct = nil, nil, nil
	}
	args := []any{in.Name, in.Label, in.Description, in.Kind, layer, in.Status, *in.StartsAt, in.EndsAt, in.Priority,
		in.Exclusive, auto, pct, amt, buy, get, getPct, in.MinSpendSatang, in.MaxDiscountSatang, in.UsageLimit,
		in.PerCustomerLimit, in.CustomerGroupIDs, in.Tiers, in.CampaignID, in.SeasonTag}
	var err error
	if id == 0 {
		err = tx.QueryRow(ctx, `INSERT INTO promotions (name, label, description, kind, layer, status, starts_at, ends_at, priority,
			exclusive, auto_apply, percent_bp, amount_satang, buy_qty, get_qty, get_percent_bp, min_spend_satang, max_discount_satang,
			usage_limit, per_customer_limit, customer_group_ids, tiers, campaign_id, season_tag, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
			append(args, actor)...).Scan(&id)
	} else {
		_, err = tx.Exec(ctx, `UPDATE promotions SET name=$1, label=$2, description=$3, kind=$4, layer=$5, status=$6, starts_at=$7,
			ends_at=$8, priority=$9, exclusive=$10, auto_apply=$11, percent_bp=$12, amount_satang=$13, buy_qty=$14, get_qty=$15,
			get_percent_bp=$16, min_spend_satang=$17, max_discount_satang=$18, usage_limit=$19, per_customer_limit=$20,
			customer_group_ids=$21, tiers=$22, campaign_id=$23, season_tag=$24 WHERE id=$25`, append(args, id)...)
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM promotion_targets WHERE promotion_id = $1`, id)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM promotion_qty_tiers WHERE promotion_id = $1`, id)
		}
	}
	if err != nil {
		return 0, err
	}
	for _, t := range in.Targets {
		col := map[string]string{"category": "category_id", "product": "product_id", "variant": "variant_id"}[t.Type]
		if _, err := tx.Exec(ctx, `INSERT INTO promotion_targets (promotion_id, target_type, `+col+`) VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING`, id, t.Type, t.ID); err != nil {
			return 0, err
		}
	}
	if in.Kind == "quantity_break" {
		for _, t := range in.QtyTiers {
			if _, err := tx.Exec(ctx, `INSERT INTO promotion_qty_tiers (promotion_id, min_qty, unit_price_satang, percent_bp)
				VALUES ($1, $2, $3, $4)`, id, t.MinQty, t.UnitPriceSatang, t.PercentBP); err != nil {
				return 0, err
			}
		}
	}
	return id, nil
}

func actorID(c *gin.Context) *int64 {
	if cu := customerFrom(c); cu != nil {
		return &cu.ID
	}
	return nil
}

func (h *handlers) createPromotion(c *gin.Context) {
	if !h.needDB(c) {
		return
	}
	var in promoInput
	if !decode(c, &in) {
		return
	}
	in.normalize()
	if f := in.validate(); len(f) > 0 {
		invalid(c, f)
		return
	}
	ctx := c.Request.Context()
	var id int64
	err := h.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		if id, err = savePromo(ctx, tx, 0, in, actorID(c)); err != nil {
			return err
		}
		for _, code := range in.Codes {
			if _, err := tx.Exec(ctx, `INSERT INTO coupon_codes (promotion_id, code) VALUES ($1, $2)`, id, code); err != nil {
				return err
			}
		}
		return audit(ctx, tx, c, "promotion.create", "promotion", id, gin.H{"name": in.Name, "kind": in.Kind})
	})
	if err != nil {
		h.dbError(c, err)
		return
	}
	p, err := loadAdminPromo(ctx, h.d.DB, h.d.Now(), id)
	if err != nil {
		h.dbError(c, err)
		return
	}
	httpx.Data(c, http.StatusCreated, p)
}

func (h *handlers) patchPromotion(c *gin.Context) {
	id, ok := pathID(c)
	if !ok || !h.needDB(c) {
		return
	}
	ctx, now := c.Request.Context(), h.d.Now()
	cur, err := loadAdminPromo(ctx, h.d.DB, now, id)
	if err != nil {
		h.dbError(c, err)
		return
	}
	in := toInput(cur)
	if !decode(c, &in) {
		return
	}
	if len(in.Codes) > 0 {
		invalid(c, map[string]string{"codes": "เพิ่มโค้ดผ่าน POST /admin/promotions/:id/codes"})
		return
	}
	in.normalize()
	if f := in.validate(); len(f) > 0 {
		invalid(c, f)
		return
	}
	err = h.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := savePromo(ctx, tx, id, in, nil); err != nil {
			return err
		}
		return audit(ctx, tx, c, "promotion.update", "promotion", id, gin.H{"name": in.Name, "status": in.Status})
	})
	if err != nil {
		h.dbError(c, err)
		return
	}
	p, err := loadAdminPromo(ctx, h.d.DB, now, id)
	if err != nil {
		h.dbError(c, err)
		return
	}
	httpx.Data(c, http.StatusOK, p)
}

// DELETE = archive when it has redemptions (or is referenced by orders), else delete.
func (h *handlers) deletePromotion(c *gin.Context) {
	id, ok := pathID(c)
	if !ok || !h.needDB(c) {
		return
	}
	ctx := c.Request.Context()
	err := h.inTx(ctx, func(tx pgx.Tx) error {
		var used bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM promotion_redemptions WHERE promotion_id = $1)
			OR EXISTS (SELECT 1 FROM order_adjustments WHERE promotion_id = $1)`, id).Scan(&used); err != nil {
			return err
		}
		action := "promotion.delete"
		var tag interface{ RowsAffected() int64 }
		var err error
		if used {
			action = "promotion.archive"
			tag, err = tx.Exec(ctx, `UPDATE promotions SET status = 'archived' WHERE id = $1`, id)
		} else {
			tag, err = tx.Exec(ctx, `DELETE FROM promotions WHERE id = $1`, id)
		}
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return audit(ctx, tx, c, action, "promotion", id, nil)
	})
	if err != nil {
		h.dbError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---------- codes ----------

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I

func randomCode(prefix string, n int) (string, error) {
	var b strings.Builder
	b.WriteString(prefix)
	for i := 0; i < n; i++ {
		k, err := rand.Int(rand.Reader, big.NewInt(int64(len(codeAlphabet))))
		if err != nil {
			return "", err
		}
		b.WriteByte(codeAlphabet[k.Int64()])
	}
	return b.String(), nil
}

func (h *handlers) addCodes(c *gin.Context) {
	id, ok := pathID(c)
	if !ok || !h.needDB(c) {
		return
	}
	var body struct {
		Codes    []string `json:"codes"`
		Generate *struct {
			Count  int    `json:"count"`
			Prefix string `json:"prefix"`
			Length int    `json:"length"`
		} `json:"generate"`
	}
	if !decode(c, &body) {
		return
	}
	ctx := c.Request.Context()
	var layer int16
	if err := h.d.DB.QueryRow(ctx, `SELECT layer FROM promotions WHERE id = $1`, id).Scan(&layer); err != nil {
		h.dbError(c, err)
		return
	}
	if layer != 4 {
		invalid(c, map[string]string{"codes": "โปรอัตโนมัติไม่ใช้โค้ด"})
		return
	}
	var codes []string
	gen := body.Generate != nil
	if gen {
		g := body.Generate
		g.Prefix = strings.ToUpper(strings.TrimSpace(g.Prefix))
		if g.Length == 0 {
			g.Length = 8
		}
		if g.Count < 1 || g.Count > 500 || g.Length < 4 || len(g.Prefix)+g.Length > 32 || (g.Prefix != "" && !codeRe.MatchString(g.Prefix+"XXX")) {
			invalid(c, map[string]string{"generate": "จำนวน 1–500, ความยาว 4 ขึ้นไป, prefix + ความยาว ไม่เกิน 32"})
			return
		}
	} else {
		for i, s := range body.Codes {
			s = strings.ToUpper(strings.TrimSpace(s))
			if !codeRe.MatchString(s) {
				invalid(c, map[string]string{fmt.Sprintf("codes.%d", i): "โค้ดต้องเป็น A-Z, 0-9, - หรือ _ ยาว 3–32 ตัว"})
				return
			}
			if !slices.Contains(codes, s) {
				codes = append(codes, s)
			}
		}
		if len(codes) == 0 {
			invalid(c, map[string]string{"codes": "กรุณาระบุโค้ด"})
			return
		}
	}
	out := []CodeJSON{}
	err := h.inTx(ctx, func(tx pgx.Tx) error {
		if gen {
			g := body.Generate
			for made, tries := 0, 0; made < g.Count; tries++ {
				if tries > g.Count*20 {
					return errors.New("promotions: could not generate unique codes")
				}
				code, err := randomCode(g.Prefix, g.Length)
				if err != nil {
					return err
				}
				var cj CodeJSON
				err = tx.QueryRow(ctx, `INSERT INTO coupon_codes (promotion_id, code) VALUES ($1, $2)
					ON CONFLICT (code) DO NOTHING RETURNING id, code, is_active`, id, code).Scan(&cj.ID, &cj.Code, &cj.IsActive)
				if errors.Is(err, pgx.ErrNoRows) {
					continue
				}
				if err != nil {
					return err
				}
				out = append(out, cj)
				made++
			}
		} else {
			for _, code := range codes {
				var cj CodeJSON
				if err := tx.QueryRow(ctx, `INSERT INTO coupon_codes (promotion_id, code) VALUES ($1, $2) RETURNING id, code, is_active`,
					id, code).Scan(&cj.ID, &cj.Code, &cj.IsActive); err != nil {
					return err
				}
				out = append(out, cj)
			}
		}
		return audit(ctx, tx, c, "coupon_code.create", "promotion", id, gin.H{"count": len(out)})
	})
	if err != nil {
		h.dbError(c, err)
		return
	}
	httpx.Data(c, http.StatusOK, out)
}

func (h *handlers) deactivateCode(c *gin.Context) {
	id, ok := pathID(c)
	if !ok || !h.needDB(c) {
		return
	}
	ctx := c.Request.Context()
	err := h.inTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE coupon_codes SET is_active = false WHERE id = $1`, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return audit(ctx, tx, c, "coupon_code.deactivate", "coupon_code", id, nil)
	})
	if err != nil {
		h.dbError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *handlers) redemptions(c *gin.Context) {
	id, ok := pathID(c)
	if !ok || !h.needDB(c) {
		return
	}
	page, per := httpx.Page(c, 50, 100)
	ctx := c.Request.Context()
	var total int
	if err := h.d.DB.QueryRow(ctx, `SELECT count(*) FROM promotion_redemptions WHERE promotion_id = $1`, id).Scan(&total); err != nil {
		h.dbError(c, err)
		return
	}
	type row struct {
		OrderNo   string    `json:"order_no"`
		UserEmail string    `json:"user_email"`
		Amount    int64     `json:"amount_satang"`
		Status    string    `json:"status"`
		CreatedAt time.Time `json:"created_at"`
	}
	rows, err := h.d.DB.Query(ctx, `SELECT o.order_no, u.email, r.amount_satang, r.status, r.created_at
		FROM promotion_redemptions r JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.user_id
		WHERE r.promotion_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT $2 OFFSET $3`, id, per, (page-1)*per)
	if err != nil {
		h.dbError(c, err)
		return
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
		var x row
		err := r.Scan(&x.OrderNo, &x.UserEmail, &x.Amount, &x.Status, &x.CreatedAt)
		x.CreatedAt = x.CreatedAt.UTC()
		return x, err
	})
	if err != nil {
		h.dbError(c, err)
		return
	}
	if out == nil {
		out = []row{}
	}
	httpx.List(c, out, httpx.NewMeta(page, per, total))
}

// ---------- preview ----------

// Preview prices a hypothetical cart with draft rules included.
func Preview(ctx context.Context, q Querier, in QuoteInput) (pricing.Quote, error) {
	return quote(ctx, q, in, loadOpts{drafts: true})
}

func (h *handlers) preview(c *gin.Context) {
	if !h.needDB(c) {
		return
	}
	var body struct {
		Lines []struct {
			VariantID int64 `json:"variant_id"`
			Qty       int   `json:"qty"`
		} `json:"lines"`
		CouponCode string     `json:"coupon_code"`
		UserID     *int64     `json:"user_id"`
		PostalCode string     `json:"postal_code"`
		Now        *time.Time `json:"now"`
	}
	if !decode(c, &body) {
		return
	}
	f := map[string]string{}
	if len(body.Lines) == 0 || len(body.Lines) > 100 {
		f["lines"] = "กรุณาระบุสินค้า 1–100 รายการ"
	}
	in := QuoteInput{CouponCode: body.CouponCode, Now: h.d.Now()}
	for i, l := range body.Lines {
		if l.VariantID <= 0 || l.Qty < 1 || l.Qty > 999 {
			f[fmt.Sprintf("lines.%d", i)] = "สินค้าหรือจำนวนไม่ถูกต้อง"
		}
		in.Items = append(in.Items, Item{VariantID: l.VariantID, Qty: l.Qty})
	}
	if len(f) > 0 {
		invalid(c, f)
		return
	}
	if body.Now != nil {
		in.Now = *body.Now
	}
	ctx := c.Request.Context()
	if pc := strings.TrimSpace(body.PostalCode); pc != "" {
		// same fee as the real cart quote (carrier: flat rate + weight surcharge / remote areas)
		fee, err := previewShippingFee(ctx, h.d, in.Items, pc)
		if err != nil {
			h.dbError(c, err)
			return
		}
		in.BaseShippingFee = fee
	}
	if body.UserID != nil {
		cu, err := LoadCustomer(ctx, h.d.DB, *body.UserID)
		if err != nil {
			h.dbError(c, err)
			return
		}
		if cu == nil {
			invalid(c, map[string]string{"user_id": "ไม่พบผู้ใช้"})
			return
		}
		in.Customer = cu
	}
	qt, err := Preview(ctx, h.d.DB, in)
	if err != nil {
		h.dbError(c, err)
		return
	}
	httpx.Data(c, http.StatusOK, qt)
}

// ShippingFee is the carrier quote used by the preview simulator so it matches POST /cart/quote. Set by the router
// (shipping imports promotions, so promotions cannot import shipping). nil = flat rate from config.
var ShippingFee func(ctx context.Context, postalCode string, weightGrams int) (int64, error)

func previewShippingFee(ctx context.Context, d *platform.Deps, items []Item, postal string) (int64, error) {
	if ShippingFee == nil {
		return d.Cfg.ShippingFlatRateSatang, nil
	}
	ids := make([]int64, 0, len(items))
	qty := map[int64]int{}
	for _, it := range items {
		ids = append(ids, it.VariantID)
		qty[it.VariantID] += it.Qty
	}
	rows, err := d.DB.Query(ctx, `SELECT id, weight_grams FROM product_variants WHERE id = ANY($1)`, ids)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	w := 0
	for rows.Next() {
		var id int64
		var g int
		if err := rows.Scan(&id, &g); err != nil {
			return 0, err
		}
		w += g * qty[id]
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	return ShippingFee(ctx, postal, w)
}
