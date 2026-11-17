package admin

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type dashboard struct {
	Today struct {
		SalesSatang int64 `json:"sales_satang"`
		Orders      int   `json:"orders"`
		PaidOrders  int   `json:"paid_orders"`
	} `json:"today"`
	Month struct {
		SalesSatang int64 `json:"sales_satang"`
		Orders      int   `json:"orders"`
	} `json:"month"`
	Pending struct {
		ToPack         int `json:"to_pack"`
		PendingPayment int `json:"pending_payment"`
	} `json:"pending"`
	LowStock    []lowStock   `json:"low_stock"`
	Sales7d     []dayStat    `json:"sales_7d"`
	TopProducts []topProduct `json:"top_products"`
}

type lowStock struct {
	VariantID   int64  `json:"variant_id"`
	SKU         string `json:"sku"`
	ProductName string `json:"product_name"`
	Stock       int    `json:"stock"`
}

type dayStat struct {
	Date        string `json:"date"`
	SalesSatang int64  `json:"sales_satang"`
	Orders      int    `json:"orders"`
}

type topProduct struct {
	ProductID   int64  `json:"product_id"`
	Name        string `json:"name"`
	Qty         int    `json:"qty"`
	SalesSatang int64  `json:"sales_satang"`
}

// dashboard: sales = paid+ statuses, bucketed by Bangkok calendar day of
// created_at.
func (h *handler) dashboard(c *gin.Context) {
	ctx := c.Request.Context()
	now := h.d.Now().In(bangkok)
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, bangkok)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, bangkok)
	weekStart := dayStart.AddDate(0, 0, -6)
	var out dashboard
	db := h.d.DB
	if err := db.QueryRow(ctx, `SELECT
			coalesce(sum(grand_total_satang) FILTER (WHERE status IN `+paidStatuses+`), 0)::bigint,
			count(*)::int, count(*) FILTER (WHERE status IN `+paidStatuses+`)::int
		FROM orders WHERE created_at >= $1`, dayStart).Scan(&out.Today.SalesSatang, &out.Today.Orders, &out.Today.PaidOrders); err != nil {
		h.fail(c, err)
		return
	}
	if err := db.QueryRow(ctx, `SELECT coalesce(sum(grand_total_satang) FILTER (WHERE status IN `+paidStatuses+`), 0)::bigint, count(*)::int
		FROM orders WHERE created_at >= $1`, monthStart).Scan(&out.Month.SalesSatang, &out.Month.Orders); err != nil {
		h.fail(c, err)
		return
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status IN ('paid', 'packing'))::int,
			count(*) FILTER (WHERE status = 'pending_payment')::int FROM orders WHERE status IN ('paid', 'packing', 'pending_payment')`).
		Scan(&out.Pending.ToPack, &out.Pending.PendingPayment); err != nil {
		h.fail(c, err)
		return
	}
	rows, err := db.Query(ctx, `SELECT v.id, v.sku, p.name, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
		WHERE v.is_active AND p.deleted_at IS NULL AND p.status = 'active' AND v.stock <= v.low_stock_threshold
		ORDER BY v.stock, v.id LIMIT 10`)
	if err != nil {
		h.fail(c, err)
		return
	}
	out.LowStock = []lowStock{}
	for rows.Next() {
		var l lowStock
		if err := rows.Scan(&l.VariantID, &l.SKU, &l.ProductName, &l.Stock); err != nil {
			rows.Close()
			h.fail(c, err)
			return
		}
		out.LowStock = append(out.LowStock, l)
	}
	rows.Close()

	days := map[string]*dayStat{}
	out.Sales7d = make([]dayStat, 7)
	for i := 0; i < 7; i++ {
		d := weekStart.AddDate(0, 0, i).Format("2006-01-02")
		out.Sales7d[i] = dayStat{Date: d}
		days[d] = &out.Sales7d[i]
	}
	rows, err = db.Query(ctx, `SELECT to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD'),
			coalesce(sum(grand_total_satang), 0)::bigint, count(*)::int
		FROM orders WHERE created_at >= $1 AND status IN `+paidStatuses+` GROUP BY 1`, weekStart)
	if err != nil {
		h.fail(c, err)
		return
	}
	for rows.Next() {
		var d string
		var s int64
		var n int
		if err := rows.Scan(&d, &s, &n); err != nil {
			rows.Close()
			h.fail(c, err)
			return
		}
		if ds := days[d]; ds != nil {
			ds.SalesSatang, ds.Orders = s, n
		}
	}
	rows.Close()

	rows, err = db.Query(ctx, `SELECT oi.product_id, max(oi.product_name), sum(oi.qty)::int,
			sum(oi.line_total_satang - oi.allocated_discount_satang)::bigint
		FROM order_items oi JOIN orders o ON o.id = oi.order_id
		WHERE o.status IN `+paidStatuses+` AND o.created_at >= $1 AND oi.product_id IS NOT NULL
		GROUP BY oi.product_id ORDER BY 3 DESC, 4 DESC, 1 LIMIT 5`, dayStart.AddDate(0, 0, -29))
	if err != nil {
		h.fail(c, err)
		return
	}
	defer rows.Close()
	out.TopProducts = []topProduct{}
	for rows.Next() {
		var t topProduct
		if err := rows.Scan(&t.ProductID, &t.Name, &t.Qty, &t.SalesSatang); err != nil {
			h.fail(c, err)
			return
		}
		out.TopProducts = append(out.TopProducts, t)
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *handler) fail(c *gin.Context, err error) {
	h.d.Log.Error("dashboard", "err", err)
	c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "internal", "message": "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"}})
}
