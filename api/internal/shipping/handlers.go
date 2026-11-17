package shipping

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/orders/state"
	"github.com/shopship/shop/api/internal/platform"
)

type handler struct {
	d       *platform.Deps
	carrier Carrier
}

var postalRe = regexp.MustCompile(`^[1-9][0-9]{4}$`)

// cartCookie mirrors cart.CartCookie (shipping cannot import cart).
const cartCookie = "shopship_cart"

// CartWeight sums qty × weight of the caller's active cart (member cart or
// guest cookie cart).
func CartWeight(ctx context.Context, q httpx.Querier, c *gin.Context) (int, error) {
	var w int
	if u, ok := auth.UserFrom(c); ok {
		err := q.QueryRow(ctx, `SELECT coalesce(sum(ci.qty * v.weight_grams), 0)::int FROM carts ct
			JOIN cart_items ci ON ci.cart_id = ct.id JOIN product_variants v ON v.id = ci.variant_id
			WHERE ct.user_id = $1 AND ct.status = 'active'`, u.ID).Scan(&w)
		return w, err
	}
	id, err := c.Cookie(cartCookie)
	if err != nil || id == "" {
		return 0, nil
	}
	err = q.QueryRow(ctx, `SELECT coalesce(sum(ci.qty * v.weight_grams), 0)::int FROM carts ct
		JOIN cart_items ci ON ci.cart_id = ct.id JOIN product_variants v ON v.id = ci.variant_id
		WHERE ct.id::text = $1 AND ct.status = 'active' AND ct.user_id IS NULL`, id).Scan(&w)
	return w, err
}

func (h *handler) quote(c *gin.Context) {
	httpx.NoStore(c)
	var in struct {
		PostalCode  string `json:"postal_code"`
		WeightGrams *int   `json:"weight_grams"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	pc := strings.TrimSpace(in.PostalCode)
	if !postalRe.MatchString(pc) {
		httpx.Validation(c, map[string]string{"postal_code": "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก"})
		return
	}
	var w int
	if in.WeightGrams != nil {
		if *in.WeightGrams < 0 || *in.WeightGrams > 100000 {
			httpx.Validation(c, map[string]string{"weight_grams": "น้ำหนักไม่ถูกต้อง"})
			return
		}
		w = *in.WeightGrams
	} else {
		var err error
		if w, err = CartWeight(c.Request.Context(), h.d.DB, c); err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
	}
	r, err := h.carrier.Quote(c.Request.Context(), QuoteInput{PostalCode: pc, WeightGrams: w})
	if err != nil {
		httpx.Error(c, http.StatusServiceUnavailable, httpx.CodeUnavailable, "ระบบขนส่งไม่พร้อมให้บริการ", nil)
		return
	}
	httpx.Data(c, http.StatusOK, gin.H{"carrier": r.Carrier, "fee_satang": r.FeeSatang, "eta_days": r.EtaDays})
}

type trackingEvent struct {
	Status      string    `json:"status"`
	Description string    `json:"description"`
	Location    string    `json:"location"`
	OccurredAt  time.Time `json:"occurred_at"`
}

type tracking struct {
	Carrier    string          `json:"carrier"`
	TrackingNo string          `json:"tracking_no"`
	Status     string          `json:"status"`
	Events     []trackingEvent `json:"events"`
}

func loadTracking(ctx context.Context, q httpx.Querier, shipmentID int64) (tracking, error) {
	var t tracking
	if err := q.QueryRow(ctx, `SELECT carrier, tracking_no, status FROM shipments WHERE id = $1`, shipmentID).
		Scan(&t.Carrier, &t.TrackingNo, &t.Status); err != nil {
		return t, err
	}
	rows, err := q.Query(ctx, `SELECT status, description, location, occurred_at FROM shipment_events
		WHERE shipment_id = $1 ORDER BY occurred_at DESC, id DESC`, shipmentID)
	if err != nil {
		return t, err
	}
	defer rows.Close()
	t.Events = []trackingEvent{}
	for rows.Next() {
		var e trackingEvent
		if err := rows.Scan(&e.Status, &e.Description, &e.Location, &e.OccurredAt); err != nil {
			return t, err
		}
		e.OccurredAt = e.OccurredAt.UTC()
		t.Events = append(t.Events, e)
	}
	return t, rows.Err()
}

func (h *handler) tracking(c *gin.Context) {
	httpx.NoStore(c)
	u, _ := auth.UserFrom(c)
	ctx := c.Request.Context()
	var sid int64
	err := h.d.DB.QueryRow(ctx, `SELECT s.id FROM shipments s JOIN orders o ON o.id = s.order_id
		WHERE o.order_no = $1 AND o.user_id = $2 ORDER BY s.id DESC LIMIT 1`, c.Param("order_no"), u.ID).Scan(&sid)
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	t, err := loadTracking(ctx, h.d.DB, sid)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, t)
}

func (h *handler) createShipment(c *gin.Context) {
	var in struct {
		WeightGrams *int `json:"weight_grams"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	if in.WeightGrams != nil && (*in.WeightGrams < 0 || *in.WeightGrams > 100000) {
		httpx.Validation(c, map[string]string{"weight_grams": "น้ำหนักไม่ถูกต้อง"})
		return
	}
	u, _ := auth.UserFrom(c)
	ctx := c.Request.Context()
	type out struct {
		ID         int64  `json:"id"`
		Carrier    string `json:"carrier"`
		TrackingNo string `json:"tracking_no"`
		Status     string `json:"status"`
		LabelURL   string `json:"label_url"`
		FeeSatang  int64  `json:"fee_satang"`
	}
	var res out
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var orderID int64
		var orderNo, name, phone, l1, l2, sub, dist, prov, pc string
		err := tx.QueryRow(ctx, `SELECT id, order_no, ship_name, ship_phone, ship_line1, ship_line2, ship_subdistrict,
				ship_district, ship_province, ship_postal_code FROM orders WHERE order_no = $1`, c.Param("order_no")).
			Scan(&orderID, &orderNo, &name, &phone, &l1, &l2, &sub, &dist, &prov, &pc)
		if err != nil {
			if httpx.IsNoRows(err) {
				return state.ErrNotFound
			}
			return err
		}
		st, err := state.Lock(ctx, tx, orderID)
		if err != nil {
			return err
		}
		if st != state.Packing {
			return state.ErrInvalidState
		}
		w := 0
		if in.WeightGrams != nil {
			w = *in.WeightGrams
		} else if err := tx.QueryRow(ctx, `SELECT coalesce(sum(oi.qty * coalesce(v.weight_grams, 0)), 0)::int
				FROM order_items oi LEFT JOIN product_variants v ON v.id = oi.variant_id WHERE oi.order_id = $1`, orderID).Scan(&w); err != nil {
			return err
		}
		addr := strings.Join(nonEmpty(l1, l2, sub, dist, prov, pc), " ")
		sh, err := h.carrier.CreateShipment(ctx, ShipmentInput{OrderNo: orderNo, WeightGrams: w, Recipient: name,
			Phone: phone, Address: addr, PostalCode: pc})
		if err != nil {
			return err
		}
		res = out{Carrier: h.carrier.Name(), TrackingNo: sh.TrackingNo, Status: "created", FeeSatang: sh.FeeSatang}
		if err := tx.QueryRow(ctx, `INSERT INTO shipments (order_id, carrier, tracking_no, status, fee_satang, weight_grams, created_by)
			VALUES ($1, $2, $3, 'created', $4, $5, $6) RETURNING id`, orderID, res.Carrier, res.TrackingNo, res.FeeSatang, w, u.ID).Scan(&res.ID); err != nil {
			return err
		}
		res.LabelURL = sh.LabelURL
		if res.LabelURL == "" {
			res.LabelURL = fmt.Sprintf("/api/v1/admin/shipments/%d/label", res.ID)
		}
		if _, err := tx.Exec(ctx, `UPDATE shipments SET label_url = $2 WHERE id = $1`, res.ID, res.LabelURL); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO shipment_events (shipment_id, status, description, location, occurred_at)
			VALUES ($1, 'created', 'สร้างรายการจัดส่งแล้ว', 'ShopShip', $2)`, res.ID, h.d.Now().UTC()); err != nil {
			return err
		}
		if _, err := state.Transition(ctx, tx, orderID, state.Shipped, &u.ID, "เลขพัสดุ "+res.TrackingNo); err != nil {
			return err
		}
		return auth.Audit(c, tx, "shipment.create", "order", orderNo, map[string]any{"tracking_no": res.TrackingNo, "weight_grams": w})
	})
	switch {
	case errors.Is(err, state.ErrNotFound):
		httpx.NotFound(c)
	case errors.Is(err, state.ErrInvalidState):
		httpx.Error(c, http.StatusConflict, httpx.CodeInvalidState, "สร้างรายการจัดส่งได้เฉพาะคำสั่งซื้อที่อยู่ระหว่างแพ็กสินค้า", nil)
	case errors.Is(err, ErrUnavailable):
		httpx.Error(c, http.StatusServiceUnavailable, httpx.CodeUnavailable, "ระบบขนส่งไม่พร้อมให้บริการ", nil)
	case err != nil:
		httpx.Internal(c, h.d.Log, err)
	default:
		httpx.Data(c, http.StatusCreated, res)
	}
}

func nonEmpty(ss ...string) []string {
	var out []string
	for _, s := range ss {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// label renders a printable HTML shipping label (mock; a carrier PDF later).
func (h *handler) label(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var carrier, tn, orderNo, name, phone, l1, l2, sub, dist, prov, pc string
	var w int
	err := h.d.DB.QueryRow(c.Request.Context(), `SELECT s.carrier, s.tracking_no, s.weight_grams, o.order_no, o.ship_name, o.ship_phone,
			o.ship_line1, o.ship_line2, o.ship_subdistrict, o.ship_district, o.ship_province, o.ship_postal_code
		FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.id = $1`, id).
		Scan(&carrier, &tn, &w, &orderNo, &name, &phone, &l1, &l2, &sub, &dist, &prov, &pc)
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	e := html.EscapeString
	addr := e(strings.Join(nonEmpty(l1, l2), " ")) + "<br>" + e(strings.Join(nonEmpty(sub, dist, prov), " ")) + " <b>" + e(pc) + "</b>"
	page := `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>Label ` + e(tn) + `</title>
<style>body{font-family:sans-serif;margin:0;padding:16px}.l{width:100mm;border:2px solid #000;padding:12px}
.tn{font:700 22px monospace;letter-spacing:2px;border:1px dashed #000;padding:8px;text-align:center;margin:8px 0}
small{color:#555}@media print{body{padding:0}}</style></head><body><div class="l">
<div><b>` + e(strings.ToUpper(carrier)) + `</b> <small>(MOCK — ไม่ใช่ฉลากจริง)</small></div>
<div class="tn">` + e(tn) + `</div>
<div><small>ผู้รับ</small><br><b>` + e(name) + `</b> ` + e(phone) + `<br>` + addr + `</div>
<hr><div><small>ผู้ส่ง</small><br>ShopShip</div>
<div><small>คำสั่งซื้อ</small> ` + e(orderNo) + ` · <small>น้ำหนัก</small> ` + fmt.Sprint(w) + ` g</div>
</div></body></html>`
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(page))
}

// Mock tracking script.
var mockSteps = []struct{ status, desc, loc string }{
	{"created", "สร้างรายการจัดส่งแล้ว", "ShopShip"},
	{"picked_up", "พนักงานเข้ารับพัสดุแล้ว", "สาขาบางนา"},
	{"in_transit", "พัสดุอยู่ระหว่างขนส่ง", "ศูนย์คัดแยกวังน้อย"},
	{"out_for_delivery", "พนักงานกำลังนำส่งพัสดุ", "สาขาปลายทาง"},
	{"delivered", "ผู้รับได้รับพัสดุเรียบร้อยแล้ว", "ปลายทาง"},
}

var shipmentRank = map[string]int{"created": 0, "picked_up": 1, "in_transit": 2, "out_for_delivery": 3, "delivered": 4}

func (h *handler) mockAdvance(c *gin.Context) {
	if h.carrier.Name() != "flash_mock" {
		httpx.NotFound(c)
		return
	}
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	var cur, tn string
	if err := h.d.DB.QueryRow(ctx, `SELECT status, tracking_no FROM shipments WHERE id = $1`, id).Scan(&cur, &tn); err != nil {
		if httpx.IsNoRows(err) {
			httpx.NotFound(c)
			return
		}
		httpx.Internal(c, h.d.Log, err)
		return
	}
	r, known := shipmentRank[cur]
	if !known || r >= len(mockSteps)-1 {
		httpx.Error(c, http.StatusConflict, httpx.CodeInvalidState, "พัสดุนี้จัดส่งถึงปลายทางแล้ว", nil)
		return
	}
	next := mockSteps[r+1]
	ev := CarrierEvent{TrackingNo: tn, Status: next.status, Description: next.desc, Location: next.loc, OccurredAt: h.d.Now().UTC()}
	if err := ApplyEvent(ctx, h.d, h.carrier.Name(), ev); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	_ = auth.Audit(c, h.d.DB, "shipment.mock_advance", "shipment", id, map[string]any{"status": next.status})
	t, err := loadTracking(ctx, h.d.DB, id)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, t)
}

// CarrierEvent is the mock carrier webhook body.
type CarrierEvent struct {
	TrackingNo  string    `json:"tracking_no"`
	Status      string    `json:"status"`
	Description string    `json:"description"`
	Location    string    `json:"location"`
	OccurredAt  time.Time `json:"occurred_at"`
}

var validShipmentStatus = map[string]bool{"created": true, "picked_up": true, "in_transit": true,
	"out_for_delivery": true, "delivered": true, "returned": true, "cancelled": true}

// ApplyEvent stores a carrier event (deduped on shipment+status+occurred_at),
// moves the shipment forward and marks the order delivered on "delivered".
func ApplyEvent(ctx context.Context, d *platform.Deps, carrier string, ev CarrierEvent) error {
	return httpx.InTx(ctx, d.DB, func(tx pgx.Tx) error {
		var sid, orderID int64
		var cur string
		err := tx.QueryRow(ctx, `SELECT id, order_id, status FROM shipments WHERE carrier = $1 AND tracking_no = $2 FOR UPDATE`,
			carrier, ev.TrackingNo).Scan(&sid, &orderID, &cur)
		if err != nil {
			return err
		}
		raw, _ := json.Marshal(ev)
		tag, err := tx.Exec(ctx, `INSERT INTO shipment_events (shipment_id, status, description, location, occurred_at, raw)
			VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (shipment_id, status, occurred_at) DO NOTHING`,
			sid, ev.Status, ev.Description, ev.Location, ev.OccurredAt, raw)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil // duplicate
		}
		nr, nk := shipmentRank[ev.Status]
		cr, ck := shipmentRank[cur]
		if (nk && ck && nr > cr) || ev.Status == "returned" || ev.Status == "cancelled" {
			if _, err := tx.Exec(ctx, `UPDATE shipments SET status = $2 WHERE id = $1`, sid, ev.Status); err != nil {
				return err
			}
		}
		if ev.Status == "delivered" {
			st, err := state.Lock(ctx, tx, orderID)
			if err != nil {
				return err
			}
			if st == state.Shipped {
				if _, err := state.Transition(ctx, tx, orderID, state.Delivered, nil, "ขนส่งแจ้งส่งถึงแล้ว"); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func (h *handler) webhook(c *gin.Context) {
	if c.Param("carrier") != h.carrier.Name() {
		httpx.NotFound(c)
		return
	}
	secret := h.d.Cfg.WebhookSecret
	got := c.GetHeader("X-Webhook-Secret")
	if secret == "" || subtle.ConstantTimeCompare([]byte(secret), []byte(got)) != 1 {
		httpx.Error(c, http.StatusUnauthorized, httpx.CodeUnauthorized, "invalid webhook secret", nil)
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		httpx.BadRequest(c, "")
		return
	}
	var ev CarrierEvent
	if err := json.Unmarshal(body, &ev); err != nil || ev.TrackingNo == "" || !validShipmentStatus[ev.Status] || ev.OccurredAt.IsZero() {
		httpx.BadRequest(c, "invalid event")
		return
	}
	if err := ApplyEvent(c.Request.Context(), h.d, h.carrier.Name(), ev); err != nil {
		if httpx.IsNoRows(err) {
			httpx.NotFound(c)
			return
		}
		httpx.Internal(c, h.d.Log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"received": true}})
}
