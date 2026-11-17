package cart

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/catalog"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/pricing"
	"github.com/shopship/shop/api/internal/shipping"
)

// ItemInfo is the catalog side of a cart row (for the Cart response and
// order item snapshots).
type ItemInfo struct {
	VariantID         int64
	ProductID         int64
	ProductSlug       string
	ProductName       string
	SKU               string
	VariantName       string
	OptionValues      map[string]string
	ListPrice         int64
	Stock             int
	LowStockThreshold int
	WeightGrams       int
	Qty               int
	Active            bool
	Image             *catalog.Image
}

// Loaded is a cart joined with catalog data, ready to price.
type Loaded struct {
	ID         string // uuid
	CouponCode string
	Items      []ItemInfo
	Pricing    pricing.Cart
}

// Customer converts the session user into the pricing customer (nil = guest).
func Customer(u *auth.User) *pricing.Customer {
	if u == nil {
		return nil
	}
	return &pricing.Customer{ID: u.ID, GroupID: u.GroupID, Tier: u.Tier}
}

// CartIDFor returns the caller's active cart id ("" when none).
func CartIDFor(ctx context.Context, q httpx.Querier, c *gin.Context) (string, error) {
	var id string
	if u, ok := auth.UserFrom(c); ok {
		err := q.QueryRow(ctx, `SELECT id::text FROM carts WHERE user_id = $1 AND status = 'active'`, u.ID).Scan(&id)
		if httpx.IsNoRows(err) {
			return "", nil
		}
		return id, err
	}
	cookie, err := c.Cookie(CartCookie)
	if err != nil || cookie == "" {
		return "", nil
	}
	if _, err := uuid.Parse(cookie); err != nil {
		return "", nil
	}
	err = q.QueryRow(ctx, `SELECT id::text FROM carts WHERE id = $1 AND status = 'active' AND user_id IS NULL`, cookie).Scan(&id)
	if httpx.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

// Load reads the cart rows (ordered by insertion). lock=true locks the
// variant rows FOR UPDATE in id order (checkout step 2).
func Load(ctx context.Context, q httpx.Querier, cartID string, lock bool) (Loaded, error) {
	l := Loaded{ID: cartID, Items: []ItemInfo{}}
	if cartID == "" {
		return l, nil
	}
	if err := q.QueryRow(ctx, `SELECT coupon_code FROM carts WHERE id = $1`, cartID).Scan(&l.CouponCode); err != nil {
		return l, err
	}
	if lock {
		rows, err := q.Query(ctx, `SELECT id FROM product_variants WHERE id IN (SELECT variant_id FROM cart_items WHERE cart_id = $1)
			ORDER BY id FOR UPDATE`, cartID)
		if err != nil {
			return l, err
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return l, err
		}
	}
	rows, err := q.Query(ctx, `SELECT v.id, p.id, p.slug, p.name, v.sku, v.name, v.option_values, v.price_satang, v.stock,
			v.low_stock_threshold, v.weight_grams, ci.qty,
			(v.is_active AND p.status = 'active' AND p.deleted_at IS NULL),
			p.category_id, coalesce(cat.parent_id, 0),
			img.id, img.url, img.alt, img.width, img.height
		FROM cart_items ci
		JOIN product_variants v ON v.id = ci.variant_id
		JOIN products p ON p.id = v.product_id
		JOIN categories cat ON cat.id = p.category_id
		LEFT JOIN LATERAL (SELECT i.id, i.url, i.alt, i.width, i.height FROM product_images i
			WHERE i.product_id = p.id ORDER BY (i.variant_id = v.id) DESC NULLS LAST, i.sort_order, i.id LIMIT 1) img ON true
		WHERE ci.cart_id = $1 ORDER BY ci.id`, cartID)
	if err != nil {
		return l, err
	}
	var ids []int64
	for rows.Next() {
		var it ItemInfo
		var ov []byte
		var catID, parentID int64
		var iid *int64
		var iurl, ialt *string
		var iw, ih *int
		if err := rows.Scan(&it.VariantID, &it.ProductID, &it.ProductSlug, &it.ProductName, &it.SKU, &it.VariantName, &ov, &it.ListPrice,
			&it.Stock, &it.LowStockThreshold, &it.WeightGrams, &it.Qty, &it.Active, &catID, &parentID,
			&iid, &iurl, &ialt, &iw, &ih); err != nil {
			rows.Close()
			return l, err
		}
		it.OptionValues = map[string]string{}
		_ = json.Unmarshal(ov, &it.OptionValues)
		if iid != nil {
			it.Image = &catalog.Image{ID: *iid, URL: *iurl, Alt: *ialt, Width: *iw, Height: *ih}
		}
		l.Items = append(l.Items, it)
		l.Pricing.Lines = append(l.Pricing.Lines, pricing.Line{
			VariantID: it.VariantID, ProductID: it.ProductID, CategoryID: catID, ParentCategoryID: parentID,
			Qty: it.Qty, ListUnitPrice: it.ListPrice, Stock: it.Stock, Active: it.Active,
		})
		ids = append(ids, it.VariantID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return l, err
	}
	if len(ids) > 0 {
		hist, err := priceHistory(ctx, q, ids)
		if err != nil {
			return l, err
		}
		for i := range l.Pricing.Lines {
			l.Pricing.Lines[i].PriceHistory = hist[l.Pricing.Lines[i].VariantID]
		}
	}
	l.Pricing.CouponCode = l.CouponCode
	return l, nil
}

func priceHistory(ctx context.Context, q httpx.Querier, ids []int64) (map[int64][]pricing.PricePoint, error) {
	rows, err := q.Query(ctx, `SELECT variant_id, price_satang, changed_at FROM price_history WHERE variant_id = ANY($1)
		ORDER BY variant_id, changed_at, id`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64][]pricing.PricePoint{}
	for rows.Next() {
		var vid int64
		var p pricing.PricePoint
		if err := rows.Scan(&vid, &p.Price, &p.At); err != nil {
			return nil, err
		}
		out[vid] = append(out[vid], p)
	}
	return out, rows.Err()
}

// Weight is Σ qty × weight of the loaded cart.
func (l Loaded) Weight() int {
	w := 0
	for _, it := range l.Items {
		w += it.Qty * it.WeightGrams
	}
	return w
}

// QuoteOptions controls a quote.
type QuoteOptions struct {
	PostalCode     string  // "" = no shipping fee yet
	CouponOverride *string // overrides the stored coupon for this quote only
}

// Quote prices a loaded cart: shipping fee from the carrier, ruleset from the
// promotions loader, then the pure engine.
func Quote(ctx context.Context, q httpx.Querier, carrier shipping.Carrier, l Loaded, u *auth.User, now time.Time, opt QuoteOptions) (pricing.Quote, error) {
	pc := l.Pricing
	pc.Lines = append([]pricing.Line(nil), l.Pricing.Lines...)
	if opt.CouponOverride != nil {
		pc.CouponCode = *opt.CouponOverride
	}
	pc.CouponCode = strings.ToUpper(strings.TrimSpace(pc.CouponCode))
	if opt.PostalCode != "" && len(pc.Lines) > 0 && carrier != nil {
		r, err := carrier.Quote(ctx, shipping.QuoteInput{PostalCode: opt.PostalCode, WeightGrams: l.Weight()})
		if err != nil {
			return pricing.Quote{}, err
		}
		pc.BaseShippingFee = r.FeeSatang
	}
	rs, pctx, err := loadRuleset(ctx, q, pc, Customer(u), now)
	if err != nil {
		return pricing.Quote{}, err
	}
	pctx.Now = now
	if pctx.Customer == nil {
		pctx.Customer = Customer(u)
	}
	return pricing.Price(pc, rs, pctx)
}

// ---------- mutations ----------

// ErrOutOfStock carries the variants that cannot be fulfilled.
type ErrOutOfStock struct{ VariantIDs []int64 }

func (e *ErrOutOfStock) Error() string { return "out of stock" }

var errNotSellable = errors.New("variant not sellable")

// ensureCart returns the caller's active cart id, creating one when needed.
// created=true means a new guest cart whose cookie must be set.
func ensureCart(ctx context.Context, tx pgx.Tx, c *gin.Context) (id string, created bool, err error) {
	id, err = CartIDFor(ctx, tx, c)
	if err != nil || id != "" {
		return id, false, err
	}
	if u, ok := auth.UserFrom(c); ok {
		_, err = tx.Exec(ctx, `INSERT INTO carts (user_id) VALUES ($1)
			ON CONFLICT (user_id) WHERE status = 'active' AND user_id IS NOT NULL DO NOTHING`, u.ID)
		if err != nil {
			return "", false, err
		}
		err = tx.QueryRow(ctx, `SELECT id::text FROM carts WHERE user_id = $1 AND status = 'active'`, u.ID).Scan(&id)
		return id, false, err
	}
	err = tx.QueryRow(ctx, `INSERT INTO carts DEFAULT VALUES RETURNING id::text`).Scan(&id)
	return id, true, err
}

// Merge moves the guest cart into the user's active cart (qty summed, capped
// at stock and 999; guest coupon kept when the user cart has none) and marks
// the guest cart merged.
func Merge(ctx context.Context, tx pgx.Tx, guestID string, userID int64) error {
	var ok bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM carts WHERE id = $1 AND status = 'active' AND user_id IS NULL)`, guestID).Scan(&ok); err != nil || !ok {
		return err
	}
	var userCart string
	err := tx.QueryRow(ctx, `SELECT id::text FROM carts WHERE user_id = $1 AND status = 'active' FOR UPDATE`, userID).Scan(&userCart)
	if httpx.IsNoRows(err) {
		_, err = tx.Exec(ctx, `UPDATE carts SET user_id = $2 WHERE id = $1`, guestID, userID)
		return err
	}
	if err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT ci.variant_id, ci.qty, v.stock FROM cart_items ci JOIN product_variants v ON v.id = ci.variant_id
		WHERE ci.cart_id = $1`, guestID)
	if err != nil {
		return err
	}
	type it struct {
		v          int64
		qty, stock int
	}
	var items []it
	for rows.Next() {
		var x it
		if err := rows.Scan(&x.v, &x.qty, &x.stock); err != nil {
			rows.Close()
			return err
		}
		items = append(items, x)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	sort.Slice(items, func(i, j int) bool { return items[i].v < items[j].v })
	for _, x := range items {
		if _, err := tx.Exec(ctx, `INSERT INTO cart_items (cart_id, variant_id, qty) VALUES ($1, $2, least($3, greatest($4, 1), 999))
			ON CONFLICT (cart_id, variant_id) DO UPDATE SET qty = least(cart_items.qty + EXCLUDED.qty, greatest($4, cart_items.qty, 1), 999)`,
			userCart, x.v, x.qty, x.stock); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE carts u SET coupon_code = g.coupon_code FROM carts g
		WHERE u.id = $1 AND g.id = $2 AND u.coupon_code = '' AND g.coupon_code <> ''`, userCart, guestID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE carts SET status = 'merged' WHERE id = $1`, guestID)
	return err
}
