// Package orders: checkout (POST /orders re-prices in one tx, 409
// price_changed on quote_hash mismatch, idempotency key, stock/flash/coupon
// guards, 15-min reservations), customer order history, admin order list and
// status transitions, reservation expiry job.
//
// Owner: Wave-1 "api-core". Routes are the frozen contract (docs/API.md).
package orders

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/orders/state"
	"github.com/shopship/shop/api/internal/payments"
	"github.com/shopship/shop/api/internal/platform"
	"github.com/shopship/shop/api/internal/shipping"
)

// IdempotencyHeader is required on POST /orders.
const IdempotencyHeader = "Idempotency-Key"

type handler struct {
	d       *platform.Deps
	carrier shipping.Carrier
}

var orderStatuses = map[string]bool{state.PendingPayment: true, state.Paid: true, state.Packing: true, state.Shipped: true,
	state.Delivered: true, state.Completed: true, state.Cancelled: true, state.Refunded: true}

func Register(rt platform.Routes, d *platform.Deps) {
	h := &handler{d: d, carrier: shipping.CarrierFor(d.Cfg)}
	db := httpx.NeedDB(d.DB)
	g := rt.V1.Group("/orders", auth.RequireUser(), db, func(c *gin.Context) { httpx.NoStore(c); c.Next() })
	g.POST("", h.createOrder)
	g.GET("", h.list)
	g.GET("/:order_no", h.get)
	g.POST("/:order_no/cancel", h.cancel)

	a := rt.Admin.Group("", db)
	a.GET("/orders", auth.RequirePerm(auth.PermOrdersRead), h.adminList)
	a.GET("/orders/:order_no", auth.RequirePerm(auth.PermOrdersRead), h.adminGet)
	// fulfilment transitions need orders:fulfil; cancel/refund need orders:manage (checked in handler)
	a.POST("/orders/:order_no/status", auth.RequirePerm(auth.PermOrdersFulfil), h.adminStatus)
}

func (h *handler) list(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	page, per := httpx.Page(c, 24, 48)
	args := []any{u.ID}
	where := "o.user_id = $1"
	if s := c.Query("status"); s != "" {
		if !orderStatuses[s] {
			httpx.BadRequest(c, "พารามิเตอร์ status ไม่ถูกต้อง")
			return
		}
		args = append(args, s)
		where += " AND o.status = $2"
	}
	ctx := c.Request.Context()
	var total int
	if err := h.d.DB.QueryRow(ctx, "SELECT count(*) FROM orders o WHERE "+where, args...).Scan(&total); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	list, err := Summaries(ctx, h.d.DB, where, per, (page-1)*per, args...)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.List(c, list, httpx.NewMeta(page, per, total))
}

func (h *handler) get(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	o, err := LoadOrder(c.Request.Context(), h.d.DB, c.Param("order_no"), u.ID, false)
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, o)
}

func (h *handler) cancel(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	ctx := c.Request.Context()
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var id int64
		if err := tx.QueryRow(ctx, `SELECT id FROM orders WHERE order_no = $1 AND user_id = $2`, c.Param("order_no"), u.ID).Scan(&id); err != nil {
			return err
		}
		st, err := state.Lock(ctx, tx, id)
		if err != nil {
			return err
		}
		if st != state.PendingPayment {
			return state.ErrInvalidState
		}
		_, err = state.Transition(ctx, tx, id, state.Cancelled, &u.ID, "ลูกค้ายกเลิกคำสั่งซื้อ")
		return err
	})
	switch {
	case httpx.IsNoRows(err), errors.Is(err, state.ErrNotFound):
		httpx.NotFound(c)
		return
	case errors.Is(err, state.ErrInvalidState):
		httpx.Error(c, http.StatusConflict, httpx.CodeInvalidState, "ยกเลิกได้เฉพาะคำสั่งซื้อที่รอชำระเงิน", nil)
		return
	case err != nil:
		httpx.Internal(c, h.d.Log, err)
		return
	}
	h.get(c)
}

// ---------- admin ----------

type adminRow struct {
	OrderNo          string     `json:"order_no"`
	Status           string     `json:"status"`
	Customer         customer   `json:"customer"`
	ItemCount        int        `json:"item_count"`
	GrandTotalSatang int64      `json:"grand_total_satang"`
	PaymentMethod    string     `json:"payment_method"`
	CreatedAt        time.Time  `json:"created_at"`
	PaidAt           *time.Time `json:"paid_at"`
}

type customer struct {
	ID    int64  `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Phone string `json:"phone,omitempty"`
}

// parseDate accepts YYYY-MM-DD (Bangkok day) or RFC 3339.
func parseDate(s string, endOfDay bool) (time.Time, bool) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	t, err := time.ParseInLocation("2006-01-02", s, bangkok)
	if err != nil {
		return time.Time{}, false
	}
	if endOfDay {
		t = t.AddDate(0, 0, 1)
	}
	return t, true
}

func (h *handler) adminList(c *gin.Context) {
	ctx := c.Request.Context()
	page, per := httpx.Page(c, 24, 100)
	var args []any
	add := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	where := []string{"true"}
	if s := c.Query("status"); s != "" {
		if !orderStatuses[s] {
			httpx.BadRequest(c, "พารามิเตอร์ status ไม่ถูกต้อง")
			return
		}
		where = append(where, "o.status = "+add(s))
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		p := add(httpx.LikePattern(strings.ToLower(q)))
		where = append(where, "(lower(o.order_no) LIKE "+p+" OR o.email LIKE "+p+" OR o.ship_phone LIKE "+p+" OR lower(o.ship_name) LIKE "+p+")")
	}
	if s := c.Query("from"); s != "" {
		t, ok := parseDate(s, false)
		if !ok {
			httpx.BadRequest(c, "พารามิเตอร์ from ไม่ถูกต้อง")
			return
		}
		where = append(where, "o.created_at >= "+add(t))
	}
	if s := c.Query("to"); s != "" {
		t, ok := parseDate(s, true)
		if !ok {
			httpx.BadRequest(c, "พารามิเตอร์ to ไม่ถูกต้อง")
			return
		}
		where = append(where, "o.created_at < "+add(t))
	}
	w := strings.Join(where, " AND ")
	var total int
	if err := h.d.DB.QueryRow(ctx, "SELECT count(*) FROM orders o WHERE "+w, args...).Scan(&total); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	order := "o.created_at DESC, o.id DESC"
	if c.Query("sort") == "created_asc" {
		order = "o.created_at, o.id"
	}
	rows, err := h.d.DB.Query(ctx, fmt.Sprintf(`SELECT o.order_no, o.status, u.id, u.email, u.name,
			coalesce((SELECT sum(qty) FROM order_items WHERE order_id = o.id), 0)::int, o.grand_total_satang, o.payment_method,
			o.created_at, o.paid_at
		FROM orders o JOIN users u ON u.id = o.user_id WHERE %s ORDER BY %s LIMIT %d OFFSET %d`, w, order, per, (page-1)*per), args...)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	defer rows.Close()
	list := []adminRow{}
	for rows.Next() {
		var r adminRow
		if err := rows.Scan(&r.OrderNo, &r.Status, &r.Customer.ID, &r.Customer.Email, &r.Customer.Name, &r.ItemCount,
			&r.GrandTotalSatang, &r.PaymentMethod, &r.CreatedAt, &r.PaidAt); err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
		r.CreatedAt = r.CreatedAt.UTC()
		r.PaidAt = utcPtr(r.PaidAt)
		list = append(list, r)
	}
	httpx.List(c, list, httpx.NewMeta(page, per, total))
}

type adminPayment struct {
	ChargeID     string     `json:"charge_id"`
	Provider     string     `json:"provider"`
	Method       string     `json:"method"`
	Status       string     `json:"status"`
	AmountSatang int64      `json:"amount_satang"`
	FailureCode  string     `json:"failure_code"`
	CreatedAt    time.Time  `json:"created_at"`
	PaidAt       *time.Time `json:"paid_at"`
}

type historyRow struct {
	FromStatus string    `json:"from_status"`
	ToStatus   string    `json:"to_status"`
	ActorEmail *string   `json:"actor_email"`
	Note       string    `json:"note"`
	CreatedAt  time.Time `json:"created_at"`
}

type adminShipment struct {
	ID         int64  `json:"id"`
	Carrier    string `json:"carrier"`
	TrackingNo string `json:"tracking_no"`
	Status     string `json:"status"`
	LabelURL   string `json:"label_url"`
	FeeSatang  int64  `json:"fee_satang"`
}

type AdminOrder struct {
	Order
	Shipment      *adminShipment `json:"shipment"`
	Customer      customer       `json:"customer"`
	Payments      []adminPayment `json:"payments"`
	StatusHistory []historyRow   `json:"status_history"`
}

func (h *handler) loadAdmin(ctx context.Context, orderNo string) (AdminOrder, error) {
	var ao AdminOrder
	o, err := LoadOrder(ctx, h.d.DB, orderNo, 0, true)
	if err != nil {
		return ao, err
	}
	ao.Order = o
	if err := h.d.DB.QueryRow(ctx, `SELECT id, email, name, phone FROM users WHERE id = $1`, o.UserID).
		Scan(&ao.Customer.ID, &ao.Customer.Email, &ao.Customer.Name, &ao.Customer.Phone); err != nil {
		return ao, err
	}
	if o.Shipment != nil {
		s := &adminShipment{}
		if err := h.d.DB.QueryRow(ctx, `SELECT id, carrier, tracking_no, status, label_url, fee_satang FROM shipments WHERE id = $1`, o.Shipment.ID).
			Scan(&s.ID, &s.Carrier, &s.TrackingNo, &s.Status, &s.LabelURL, &s.FeeSatang); err != nil {
			return ao, err
		}
		ao.Shipment = s
	}
	rows, err := h.d.DB.Query(ctx, `SELECT provider_charge_id, provider, method, status, amount_satang, failure_code, created_at, paid_at
		FROM payments WHERE order_id = $1 ORDER BY id DESC`, o.ID)
	if err != nil {
		return ao, err
	}
	ao.Payments = []adminPayment{}
	for rows.Next() {
		var p adminPayment
		if err := rows.Scan(&p.ChargeID, &p.Provider, &p.Method, &p.Status, &p.AmountSatang, &p.FailureCode, &p.CreatedAt, &p.PaidAt); err != nil {
			rows.Close()
			return ao, err
		}
		p.CreatedAt, p.PaidAt = p.CreatedAt.UTC(), utcPtr(p.PaidAt)
		ao.Payments = append(ao.Payments, p)
	}
	rows.Close()
	rows, err = h.d.DB.Query(ctx, `SELECT h.from_status, h.to_status, u.email, h.note, h.created_at FROM order_status_history h
		LEFT JOIN users u ON u.id = h.actor_user_id WHERE h.order_id = $1 ORDER BY h.created_at, h.id`, o.ID)
	if err != nil {
		return ao, err
	}
	defer rows.Close()
	ao.StatusHistory = []historyRow{}
	for rows.Next() {
		var r historyRow
		if err := rows.Scan(&r.FromStatus, &r.ToStatus, &r.ActorEmail, &r.Note, &r.CreatedAt); err != nil {
			return ao, err
		}
		r.CreatedAt = r.CreatedAt.UTC()
		ao.StatusHistory = append(ao.StatusHistory, r)
	}
	return ao, rows.Err()
}

func (h *handler) adminGet(c *gin.Context) {
	ao, err := h.loadAdmin(c.Request.Context(), c.Param("order_no"))
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, ao)
}

func (h *handler) adminStatus(c *gin.Context) {
	var in struct {
		To   string `json:"to"`
		Note string `json:"note"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	in.Note = strings.TrimSpace(in.Note)
	if !orderStatuses[in.To] || in.To == state.PendingPayment {
		httpx.Validation(c, map[string]string{"to": "สถานะไม่ถูกต้อง"})
		return
	}
	u, _ := auth.UserFrom(c)
	if (in.To == state.Cancelled || in.To == state.Refunded) && !auth.Can(u.Role, auth.PermOrdersManage) {
		httpx.Error(c, http.StatusForbidden, httpx.CodeForbidden, "ไม่มีสิทธิ์ยกเลิกหรือคืนเงิน", nil)
		return
	}
	if in.To == state.Paid {
		// payment is confirmed by the provider only
		httpx.Error(c, http.StatusConflict, httpx.CodeInvalidState, "สถานะชำระเงินอัปเดตจากระบบชำระเงินเท่านั้น", nil)
		return
	}
	ctx := c.Request.Context()
	orderNo := c.Param("order_no")
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var id int64
		if err := tx.QueryRow(ctx, `SELECT id FROM orders WHERE order_no = $1`, orderNo).Scan(&id); err != nil {
			return err
		}
		from, err := state.Transition(ctx, tx, id, in.To, &u.ID, in.Note)
		if err != nil {
			return err
		}
		refund := in.To == state.Refunded || (in.To == state.Cancelled && from != state.PendingPayment)
		if refund {
			if err := payments.RefundOrder(ctx, h.d, tx, id); err != nil {
				return err
			}
		}
		return auth.Audit(c, tx, "order.status_change", "order", orderNo, map[string]any{"from": from, "to": in.To, "note": in.Note, "refunded": refund})
	})
	switch {
	case httpx.IsNoRows(err), errors.Is(err, state.ErrNotFound):
		httpx.NotFound(c)
		return
	case errors.Is(err, state.ErrInvalidState):
		httpx.Error(c, http.StatusConflict, httpx.CodeInvalidState, "เปลี่ยนสถานะคำสั่งซื้อแบบนี้ไม่ได้", nil)
		return
	case err != nil:
		httpx.Internal(c, h.d.Log, err)
		return
	}
	h.adminGet(c)
}

// ---------- reservation expiry ----------

// ExpireNow cancels overdue pending_payment orders once (releases stock,
// flash allocation and promotion usage). Returns how many were expired.
func ExpireNow(ctx context.Context, d *platform.Deps) (int, error) {
	if d.DB == nil {
		return 0, nil
	}
	return state.ExpireDue(ctx, d.DB.Begin, d.Now(), 500)
}

// RunReservationExpiry runs ExpireNow every interval until ctx is done.
// Started by `server serve` (cmd/server/main.go).
func RunReservationExpiry(ctx context.Context, d *platform.Deps, interval time.Duration) {
	if d.DB == nil {
		return
	}
	if interval <= 0 {
		interval = time.Minute
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		if n, err := ExpireNow(ctx, d); err != nil {
			if ctx.Err() == nil {
				d.Log.Error("reservation expiry failed", "err", err)
			}
		} else if n > 0 {
			d.Log.Info("expired unpaid orders", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
