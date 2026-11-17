// Package cart: guest + member carts (guest id in the shopship_cart cookie,
// merged on login), coupon on cart, and POST /cart/quote which loads the
// ruleset via internal/promotions and calls pricing.Price.
//
// Owner: Wave-1 "api-core". Routes are the frozen contract (docs/API.md).
package cart

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/catalog"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
	"github.com/shopship/shop/api/internal/pricing"
	"github.com/shopship/shop/api/internal/shipping"
)

// CartCookie holds the guest cart uuid (HttpOnly, SameSite=Lax, 60 days).
const CartCookie = "shopship_cart"

const cartCookieMaxAge = 60 * 24 * 3600

type handler struct {
	d       *platform.Deps
	carrier shipping.Carrier
}

func Register(rt platform.Routes, d *platform.Deps) {
	h := &handler{d: d, carrier: shipping.CarrierFor(d.Cfg)}
	auth.SetLoginHook(mergeOnLogin)
	g := rt.V1.Group("/cart", httpx.NeedDB(d.DB), func(c *gin.Context) { httpx.NoStore(c); c.Next() })
	g.GET("", h.get)
	g.POST("/items", h.addItem)
	g.PATCH("/items/:variant_id", h.patchItem)
	g.DELETE("/items/:variant_id", h.deleteItem)
	g.PUT("/coupon", h.putCoupon)
	g.DELETE("/coupon", h.deleteCoupon)
	g.POST("/quote", h.quote)
}

// mergeOnLogin is the auth login hook: guest cart cookie -> user's cart.
func mergeOnLogin(c *gin.Context, d *platform.Deps, userID int64) {
	cookie, err := c.Cookie(CartCookie)
	if err != nil || cookie == "" {
		return
	}
	defer auth.ClearCookie(c, d, CartCookie)
	if _, err := uuid.Parse(cookie); err != nil {
		return
	}
	ctx := c.Request.Context()
	err = httpx.InTx(ctx, d.DB, func(tx pgx.Tx) error { return Merge(ctx, tx, cookie, userID) })
	if err != nil {
		d.Log.Warn("guest cart merge failed", "err", err)
	}
}

func setCartCookie(c *gin.Context, d *platform.Deps, id string) {
	http.SetCookie(c.Writer, &http.Cookie{Name: CartCookie, Value: id, Path: "/", Domain: d.Cfg.CookieDomain,
		MaxAge: cartCookieMaxAge, HttpOnly: true, Secure: d.Cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
}

// ---------- response ----------

type itemProduct struct {
	ID    int64          `json:"id"`
	Slug  string         `json:"slug"`
	Name  string         `json:"name"`
	Image *catalog.Image `json:"image"`
}

type itemVariant struct {
	SKU          string            `json:"sku"`
	Name         string            `json:"name"`
	OptionValues map[string]string `json:"option_values"`
}

type Item struct {
	VariantID           int64       `json:"variant_id"`
	Qty                 int         `json:"qty"`
	Product             itemProduct `json:"product"`
	Variant             itemVariant `json:"variant"`
	ListUnitPriceSatang int64       `json:"list_unit_price_satang"`
	StockLevel          string      `json:"stock_level"`
	MaxQty              int         `json:"max_qty"`
}

type Cart struct {
	Items      []Item        `json:"items"`
	CouponCode *string       `json:"coupon_code"`
	ItemCount  int           `json:"item_count"`
	Quote      pricing.Quote `json:"quote"`
}

func (h *handler) build(ctx context.Context, q httpx.Querier, c *gin.Context, cartID string) (Cart, error) {
	l, err := Load(ctx, q, cartID, false)
	if err != nil {
		return Cart{}, err
	}
	u, _ := auth.UserFrom(c)
	qt, err := Quote(ctx, q, h.carrier, l, u, h.d.Now(), QuoteOptions{})
	if err != nil {
		return Cart{}, err
	}
	out := Cart{Items: []Item{}, Quote: qt}
	if l.CouponCode != "" {
		cc := l.CouponCode
		out.CouponCode = &cc
	}
	for _, it := range l.Items {
		mq := it.Stock
		if mq > 999 {
			mq = 999
		}
		if !it.Active || mq < 0 {
			mq = 0
		}
		lvl := catalog.StockLevel(it.Stock, it.LowStockThreshold)
		if !it.Active {
			lvl = "out"
		}
		out.Items = append(out.Items, Item{
			VariantID: it.VariantID, Qty: it.Qty,
			Product:             itemProduct{ID: it.ProductID, Slug: it.ProductSlug, Name: it.ProductName, Image: it.Image},
			Variant:             itemVariant{SKU: it.SKU, Name: it.VariantName, OptionValues: it.OptionValues},
			ListUnitPriceSatang: it.ListPrice, StockLevel: lvl, MaxQty: mq,
		})
		out.ItemCount += it.Qty
	}
	return out, nil
}

func (h *handler) respond(c *gin.Context, cartID string) {
	ctx := c.Request.Context()
	out, err := h.build(ctx, h.d.DB, c, cartID)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, out)
}

func (h *handler) get(c *gin.Context) {
	id, err := CartIDFor(c.Request.Context(), h.d.DB, c)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	h.respond(c, id)
}

// mutate runs fn on the caller's cart (created when create=true) in a tx.
func (h *handler) mutate(c *gin.Context, create bool, fn func(ctx context.Context, tx pgx.Tx, cartID string) error) {
	ctx := c.Request.Context()
	var cartID string
	var created bool
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var err error
		if create {
			cartID, created, err = ensureCart(ctx, tx, c)
		} else {
			cartID, err = CartIDFor(ctx, tx, c)
		}
		if err != nil {
			return err
		}
		if cartID == "" {
			return pgx.ErrNoRows
		}
		if _, err := tx.Exec(ctx, `SELECT 1 FROM carts WHERE id = $1 FOR UPDATE`, cartID); err != nil {
			return err
		}
		if err := fn(ctx, tx, cartID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE carts SET updated_at = now() WHERE id = $1`, cartID)
		return err
	})
	var oos *ErrOutOfStock
	switch {
	case errors.As(err, &oos):
		httpx.ErrorDetails(c, http.StatusConflict, httpx.CodeOutOfStock, "สินค้ามีจำนวนไม่พอ", gin.H{"variant_ids": oos.VariantIDs})
		return
	case errors.Is(err, errNotSellable):
		httpx.NotFound(c)
		return
	case httpx.IsNoRows(err):
		httpx.NotFound(c)
		return
	case err != nil:
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if created {
		setCartCookie(c, h.d, cartID)
	}
	h.respond(c, cartID)
}

func validQty(q int) bool { return q >= 1 && q <= 999 }

func (h *handler) addItem(c *gin.Context) {
	var in struct {
		VariantID int64 `json:"variant_id"`
		Qty       int   `json:"qty"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	if in.Qty == 0 {
		in.Qty = 1
	}
	f := map[string]string{}
	if in.VariantID <= 0 {
		f["variant_id"] = "กรุณาเลือกสินค้า"
	}
	if !validQty(in.Qty) {
		f["qty"] = "จำนวนต้องอยู่ระหว่าง 1 ถึง 999"
	}
	if len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	// Check sellability before creating a guest cart.
	var stock int
	err := h.d.DB.QueryRow(c.Request.Context(), `SELECT v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
		WHERE v.id = $1 AND v.is_active AND p.status = 'active' AND p.deleted_at IS NULL`, in.VariantID).Scan(&stock)
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	h.mutate(c, true, func(ctx context.Context, tx pgx.Tx, cartID string) error {
		var cur int
		err := tx.QueryRow(ctx, `SELECT qty FROM cart_items WHERE cart_id = $1 AND variant_id = $2`, cartID, in.VariantID).Scan(&cur)
		if err != nil && !httpx.IsNoRows(err) {
			return err
		}
		total := cur + in.Qty
		if total > stock {
			return &ErrOutOfStock{VariantIDs: []int64{in.VariantID}}
		}
		if total > 999 {
			total = 999
		}
		_, err = tx.Exec(ctx, `INSERT INTO cart_items (cart_id, variant_id, qty) VALUES ($1, $2, $3)
			ON CONFLICT (cart_id, variant_id) DO UPDATE SET qty = EXCLUDED.qty`, cartID, in.VariantID, total)
		return err
	})
}

func (h *handler) patchItem(c *gin.Context) {
	vid, ok := httpx.ParamID(c, "variant_id")
	if !ok {
		return
	}
	var in struct {
		Qty int `json:"qty"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	if !validQty(in.Qty) {
		httpx.Validation(c, map[string]string{"qty": "จำนวนต้องอยู่ระหว่าง 1 ถึง 999"})
		return
	}
	h.mutate(c, false, func(ctx context.Context, tx pgx.Tx, cartID string) error {
		var stock int
		err := tx.QueryRow(ctx, `SELECT v.stock FROM cart_items ci JOIN product_variants v ON v.id = ci.variant_id
			WHERE ci.cart_id = $1 AND ci.variant_id = $2`, cartID, vid).Scan(&stock)
		if err != nil {
			return err
		}
		if in.Qty > stock {
			return &ErrOutOfStock{VariantIDs: []int64{vid}}
		}
		_, err = tx.Exec(ctx, `UPDATE cart_items SET qty = $3 WHERE cart_id = $1 AND variant_id = $2`, cartID, vid, in.Qty)
		return err
	})
}

func (h *handler) deleteItem(c *gin.Context) {
	vid, ok := httpx.ParamID(c, "variant_id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	id, err := CartIDFor(ctx, h.d.DB, c)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if id != "" {
		if _, err := h.d.DB.Exec(ctx, `DELETE FROM cart_items WHERE cart_id = $1 AND variant_id = $2`, id, vid); err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
	}
	h.respond(c, id)
}

var codeRe = regexp.MustCompile(`^[A-Z0-9][A-Z0-9_-]{0,31}$`)

func (h *handler) putCoupon(c *gin.Context) {
	var in struct {
		Code string `json:"code"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(in.Code))
	if code == "" || len(code) > 32 || !codeRe.MatchString(code) {
		httpx.Validation(c, map[string]string{"code": "รูปแบบโค้ดไม่ถูกต้อง"})
		return
	}
	h.mutate(c, true, func(ctx context.Context, tx pgx.Tx, cartID string) error {
		_, err := tx.Exec(ctx, `UPDATE carts SET coupon_code = $2 WHERE id = $1`, cartID, code)
		return err
	})
}

func (h *handler) deleteCoupon(c *gin.Context) {
	ctx := c.Request.Context()
	id, err := CartIDFor(ctx, h.d.DB, c)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if id != "" {
		if _, err := h.d.DB.Exec(ctx, `UPDATE carts SET coupon_code = '' WHERE id = $1`, id); err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
	}
	h.respond(c, id)
}

var postalRe = regexp.MustCompile(`^[1-9][0-9]{4}$`)

// ResolvePostal returns the postal code from either a postal_code or one of
// the user's addresses. fields is non-nil on validation failure.
func ResolvePostal(ctx context.Context, q httpx.Querier, u *auth.User, postal string, addressID *int64) (string, map[string]string, error) {
	if addressID != nil {
		if u == nil {
			return "", map[string]string{"address_id": "กรุณาเข้าสู่ระบบ"}, nil
		}
		var pc string
		err := q.QueryRow(ctx, `SELECT postal_code FROM addresses WHERE id = $1 AND user_id = $2`, *addressID, u.ID).Scan(&pc)
		if httpx.IsNoRows(err) {
			return "", map[string]string{"address_id": "ไม่พบที่อยู่นี้"}, nil
		}
		return pc, nil, err
	}
	postal = strings.TrimSpace(postal)
	if postal != "" && !postalRe.MatchString(postal) {
		return "", map[string]string{"postal_code": "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก"}, nil
	}
	return postal, nil, nil
}

func (h *handler) quote(c *gin.Context) {
	var in struct {
		PostalCode string  `json:"postal_code"`
		AddressID  *int64  `json:"address_id"`
		CouponCode *string `json:"coupon_code"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	ctx := c.Request.Context()
	u, _ := auth.UserFrom(c)
	postal, f, err := ResolvePostal(ctx, h.d.DB, u, in.PostalCode, in.AddressID)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if f != nil {
		httpx.Validation(c, f)
		return
	}
	id, err := CartIDFor(ctx, h.d.DB, c)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	l, err := Load(ctx, h.d.DB, id, false)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	qt, err := Quote(ctx, h.d.DB, h.carrier, l, u, h.d.Now(), QuoteOptions{PostalCode: postal, CouponOverride: in.CouponCode})
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, qt)
}
