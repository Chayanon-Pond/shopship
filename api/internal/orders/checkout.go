package orders

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/account"
	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/cart"
	emailpkg "github.com/shopship/shop/api/internal/email"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/orders/state"
	"github.com/shopship/shop/api/internal/pricing"
	"github.com/shopship/shop/api/internal/promotions"
)

var bangkok = func() *time.Location {
	if l, err := time.LoadLocation("Asia/Bangkok"); err == nil {
		return l
	}
	return time.FixedZone("ICT", 7*3600)
}()

const orderNoAlphabet = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"

// NewOrderNo returns "SS" + YYMMDD (Bangkok) + 6 random chars.
func NewOrderNo(now time.Time) string {
	var b strings.Builder
	b.WriteString("SS")
	b.WriteString(now.In(bangkok).Format("060102"))
	for i := 0; i < 6; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(orderNoAlphabet))))
		b.WriteByte(orderNoAlphabet[n.Int64()])
	}
	return b.String()
}

type checkoutReq struct {
	AddressID     int64   `json:"address_id"`
	PaymentMethod string  `json:"payment_method"`
	QuoteHash     string  `json:"quote_hash"`
	CouponCode    *string `json:"coupon_code"`
	CustomerNote  string  `json:"customer_note"`
}

func (r checkoutReq) hash() string {
	b, _ := json.Marshal(r)
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// checkout outcomes that are not plain errors
type priceChanged struct{ quote pricing.Quote }

func (*priceChanged) Error() string { return "price changed" }

type outOfStock struct{ ids []int64 }

func (*outOfStock) Error() string { return "out of stock" }

type replay struct {
	orderNo string
	same    bool
}

func (*replay) Error() string { return "idempotent replay" }

var errEmptyCart = errors.New("empty cart")
var errNoAddress = errors.New("no address")

func (h *handler) createOrder(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	key := strings.TrimSpace(c.GetHeader(IdempotencyHeader))
	if len(key) < 8 || len(key) > 100 {
		httpx.BadRequest(c, "ต้องระบุ Idempotency-Key (8-100 ตัวอักษร)")
		return
	}
	var in checkoutReq
	if !httpx.BindJSON(c, &in) {
		return
	}
	in.CustomerNote = strings.TrimSpace(in.CustomerNote)
	f := map[string]string{}
	if in.AddressID <= 0 {
		f["address_id"] = "กรุณาเลือกที่อยู่จัดส่ง"
	}
	if in.PaymentMethod != "promptpay" && in.PaymentMethod != "card" {
		f["payment_method"] = "กรุณาเลือกวิธีชำระเงิน"
	}
	if in.QuoteHash == "" {
		f["quote_hash"] = "ไม่พบใบเสนอราคา กรุณารีเฟรชตะกร้า"
	}
	if utf8.RuneCountInString(in.CustomerNote) > 500 {
		f["customer_note"] = "หมายเหตุยาวเกินไป (ไม่เกิน 500 ตัวอักษร)"
	}
	if len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	ctx := c.Request.Context()
	bodyHash := in.hash()
	orderNo, err := h.checkout(ctx, c, u, key, bodyHash, in)
	var rp *replay
	var pc *priceChanged
	var oos *outOfStock
	var lim *promotions.LimitError
	status := http.StatusCreated
	switch {
	case errors.As(err, &rp):
		if !rp.same {
			httpx.Error(c, http.StatusConflict, httpx.CodeIdempotency, "Idempotency-Key นี้ถูกใช้กับคำสั่งซื้ออื่นแล้ว", nil)
			return
		}
		orderNo, status = rp.orderNo, http.StatusOK
	case errors.As(err, &pc):
		httpx.ErrorDetails(c, http.StatusConflict, httpx.CodePriceChanged, "ราคาหรือโปรโมชันมีการเปลี่ยนแปลง กรุณาตรวจสอบอีกครั้ง",
			gin.H{"quote": pc.quote})
		return
	case errors.As(err, &oos):
		httpx.ErrorDetails(c, http.StatusConflict, httpx.CodeOutOfStock, "สินค้าบางรายการมีจำนวนไม่พอ", gin.H{"variant_ids": oos.ids})
		return
	case errors.As(err, &lim):
		httpx.ErrorDetails(c, http.StatusConflict, httpx.CodeLimitReached, "สิทธิ์โปรโมชันนี้ถูกใช้ครบแล้ว", gin.H{"reason_code": lim.ReasonCode})
		return
	case errors.Is(err, errEmptyCart):
		httpx.Validation(c, map[string]string{"cart": "ตะกร้าสินค้าว่าง"})
		return
	case errors.Is(err, errNoAddress):
		httpx.Validation(c, map[string]string{"address_id": "ไม่พบที่อยู่จัดส่งนี้"})
		return
	case err != nil:
		httpx.Internal(c, h.d.Log, err)
		return
	}
	o, err := LoadOrder(ctx, h.d.DB, orderNo, u.ID, false)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, status, o)
}

// checkout is docs/API.md §8 in one READ COMMITTED transaction.
func (h *handler) checkout(ctx context.Context, c *gin.Context, u *auth.User, key, bodyHash string, in checkoutReq) (string, error) {
	var orderNo string
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		// 1. idempotency: serialize same user+key, then look it up
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, $2))`, key, u.ID); err != nil {
			return err
		}
		var existingNo, existingHash string
		err := tx.QueryRow(ctx, `SELECT order_no, idempotency_hash FROM orders WHERE user_id = $1 AND idempotency_key = $2`, u.ID, key).
			Scan(&existingNo, &existingHash)
		if err == nil {
			return &replay{orderNo: existingNo, same: existingHash == bodyHash}
		}
		if !httpx.IsNoRows(err) {
			return err
		}

		// 2. cart (locked), address, variants locked in id order
		var cartID string
		err = tx.QueryRow(ctx, `SELECT id::text FROM carts WHERE user_id = $1 AND status = 'active' FOR UPDATE`, u.ID).Scan(&cartID)
		if httpx.IsNoRows(err) {
			return errEmptyCart
		}
		if err != nil {
			return err
		}
		addr, err := account.GetAddress(ctx, tx, u.ID, in.AddressID)
		if httpx.IsNoRows(err) {
			return errNoAddress
		}
		if err != nil {
			return err
		}
		l, err := cart.Load(ctx, tx, cartID, true)
		if err != nil {
			return err
		}
		if len(l.Items) == 0 {
			return errEmptyCart
		}

		// 3. re-price inside the transaction
		now := h.d.Now()
		q, err := cart.Quote(ctx, tx, h.carrier, l, u, now, cart.QuoteOptions{PostalCode: addr.PostalCode, CouponOverride: in.CouponCode})
		if err != nil {
			return err
		}
		var bad []int64
		for _, ln := range q.Lines {
			if ln.Availability.Status != "ok" {
				bad = append(bad, ln.VariantID)
			}
		}
		if len(bad) > 0 {
			return &outOfStock{ids: bad}
		}
		if q.QuoteHash != in.QuoteHash {
			return &priceChanged{quote: q}
		}

		// 4. stock + flash guards
		for _, ln := range q.Lines {
			tag, err := tx.Exec(ctx, `UPDATE product_variants SET stock = stock - $2 WHERE id = $1 AND stock >= $2`, ln.VariantID, ln.Qty)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return &outOfStock{ids: []int64{ln.VariantID}}
			}
			if ln.PriceSource.FlashSaleItemID != nil {
				if err := promotions.ReserveFlash(ctx, tx, *ln.PriceSource.FlashSaleItemID, ln.Qty); err != nil {
					if errors.Is(err, promotions.ErrFlashSoldOut) {
						return &outOfStock{ids: []int64{ln.VariantID}}
					}
					return err
				}
			}
		}

		// 6. order, items, adjustments, reservations, history
		due := now.Add(h.reservationTTL())
		snap, _ := json.Marshal(q)
		var m map[string]any
		_ = json.Unmarshal(snap, &m)
		m["address_label"] = addr.Label
		snap, _ = json.Marshal(m)
		couponCode := ""
		if q.Coupon != nil && q.Coupon.Status == pricing.CouponApplied {
			couponCode = q.Coupon.Code
		}
		var email string
		if err := tx.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, u.ID).Scan(&email); err != nil {
			return err
		}
		var orderID int64
		for attempt := 0; ; attempt++ {
			orderNo = NewOrderNo(now)
			err = tx.QueryRow(ctx, `INSERT INTO orders (order_no, user_id, email, ship_name, ship_phone, ship_line1, ship_line2,
					ship_subdistrict, ship_district, ship_province, ship_postal_code, subtotal_satang, discount_satang,
					shipping_fee_satang, shipping_discount_satang, savings_satang, grand_total_satang, coupon_code, quote_hash,
					pricing_snapshot, customer_note, payment_method, idempotency_key, idempotency_hash, payment_due_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
				ON CONFLICT (order_no) DO NOTHING RETURNING id`,
				orderNo, u.ID, email, addr.RecipientName, addr.Phone, addr.Line1, addr.Line2, addr.Subdistrict, addr.District,
				addr.Province, addr.PostalCode, q.Totals.SubtotalSatang, q.Totals.DiscountSatang, q.Shipping.FeeSatang,
				q.Shipping.DiscountSatang, q.Totals.SavingsSatang, q.Totals.GrandTotalSatang, couponCode, q.QuoteHash, snap,
				in.CustomerNote, in.PaymentMethod, key, bodyHash, due).Scan(&orderID)
			if err == nil {
				break
			}
			if !httpx.IsNoRows(err) || attempt > 5 {
				return err
			}
		}
		byVariant := map[int64]cart.ItemInfo{}
		for _, it := range l.Items {
			byVariant[it.VariantID] = it
		}
		for _, ln := range q.Lines {
			it := byVariant[ln.VariantID]
			var lineDisc int64
			for _, a := range ln.Adjustments {
				lineDisc += a.AmountSatang
			}
			img := ""
			if it.Image != nil {
				img = it.Image.URL
			}
			var low *int64
			if ln.Lowest30dSatang != nil && *ln.Lowest30dSatang > 0 {
				low = ln.Lowest30dSatang
			}
			var itemID int64
			if err := tx.QueryRow(ctx, `INSERT INTO order_items (order_id, variant_id, product_id, flash_sale_item_id, sku, product_name,
					variant_name, image_url, qty, list_unit_price_satang, unit_price_satang, price_source_kind, price_source_label,
					line_discount_satang, line_total_satang, allocated_discount_satang, lowest_30d_satang)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
				orderID, ln.VariantID, it.ProductID, ln.PriceSource.FlashSaleItemID, it.SKU, it.ProductName, it.VariantName, img,
				ln.Qty, ln.ListUnitPriceSatang, ln.UnitPriceSatang, ln.PriceSource.Kind, ln.PriceSource.Label, lineDisc,
				ln.LineTotalSatang, ln.AllocatedDiscount, low).Scan(&itemID); err != nil {
				return err
			}
			for _, a := range ln.Adjustments {
				if a.AmountSatang <= 0 {
					continue
				}
				if _, err := tx.Exec(ctx, `INSERT INTO order_adjustments (order_id, order_item_id, promotion_id, layer, coupon_code, label, amount_satang)
					VALUES ($1, $2, $3, 2, $4, $5, $6)`, orderID, itemID, nilIfZero(a.PromotionID), a.CouponCode, a.Label, a.AmountSatang); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(ctx, `INSERT INTO stock_reservations (order_id, variant_id, flash_sale_item_id, qty, expires_at)
				VALUES ($1, $2, $3, $4, $5)`, orderID, ln.VariantID, ln.PriceSource.FlashSaleItemID, ln.Qty, due); err != nil {
				return err
			}
		}
		for _, a := range q.Adjustments {
			if a.AmountSatang <= 0 {
				continue
			}
			layer := a.Layer
			if layer < 3 || layer > 4 {
				layer = 3
			}
			if _, err := tx.Exec(ctx, `INSERT INTO order_adjustments (order_id, promotion_id, layer, coupon_code, label, amount_satang)
				VALUES ($1, $2, $3, $4, $5, $6)`, orderID, nilIfZero(a.PromotionID), layer, a.CouponCode, a.Label, a.AmountSatang); err != nil {
				return err
			}
		}
		if q.Shipping.DiscountSatang > 0 {
			label := q.Shipping.Label
			if label == "" {
				label = "ส่งฟรี"
			}
			var pid *int64
			if q.Shipping.PromotionID != nil {
				pid = q.Shipping.PromotionID
			}
			if _, err := tx.Exec(ctx, `INSERT INTO order_adjustments (order_id, promotion_id, layer, coupon_code, label, amount_satang)
				VALUES ($1, $2, 5, $3, $4, $5)`, orderID, pid, shippingCode(q, pid), label, q.Shipping.DiscountSatang); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, from_status, to_status, actor_user_id, note)
			VALUES ($1, '', $2, $3, '')`, orderID, state.PendingPayment, u.ID); err != nil {
			return err
		}
		if err := emailpkg.EnqueueOrder(ctx, tx, emailpkg.KindOrderPlaced, orderID, "", nil); err != nil {
			return err
		}

		// 5. promotion usage guards + redemptions
		if err := redeem(ctx, tx, q, orderID, u.ID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE carts SET status = 'converted' WHERE id = $1`, cartID)
		return err
	})
	return orderNo, err
}

// shippingCode is the coupon code when the free shipping came from a
// layer-4 free-shipping code (no cart adjustment carries the code then).
func shippingCode(q pricing.Quote, pid *int64) string {
	if pid == nil || q.Coupon == nil || q.Coupon.Status != pricing.CouponApplied {
		return ""
	}
	for _, a := range q.Adjustments {
		if a.CouponCode != "" {
			return ""
		}
	}
	return q.Coupon.Code
}

func nilIfZero(id int64) *int64 {
	if id == 0 {
		return nil
	}
	return &id
}

func (h *handler) reservationTTL() time.Duration {
	if h.d.Cfg.ReservationTTL > 0 {
		return h.d.Cfg.ReservationTTL
	}
	return 15 * time.Minute
}
