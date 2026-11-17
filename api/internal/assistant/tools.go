package assistant

import (
	"context"
	_ "embed"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/shopship/shop/api/internal/catalog"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
	"github.com/shopship/shop/api/internal/promotions"
	"github.com/shopship/shop/api/internal/ratelimit"
	"github.com/shopship/shop/api/internal/shipping"
)

// Tools is the read-only toolbox both brains use. Every method is scoped to
// what the caller may see.
type Tools struct {
	d        *platform.Deps
	carrier  shipping.Carrier
	guestLim *ratelimit.Limiter
	contact  Contact
}

func (t *Tools) now() time.Time { return t.d.Now() }

// ---------- catalog (public view only) ----------

func cardOf(pc catalog.ProductCard) Card {
	c := Card{Slug: pc.Slug, Name: pc.Name, PriceSatang: pc.MinPriceSatang, PriceFrom: pc.MaxPriceSatang > pc.MinPriceSatang,
		InStock: pc.InStock}
	if pc.Flash != nil {
		c.PriceSatang, c.OnFlashSale, c.PriceFrom = pc.Flash.SalePriceSatang, true, false
		c.Lowest30dSatang = pc.Flash.Lowest30dSatang
	}
	if pc.Image != nil {
		c.ImageURL = pc.Image.URL
	}
	return c
}

// attachVariants sets Card.VariantID for single-variant, in-stock products
// (so the widget can offer a one-tap "add to cart").
func (t *Tools) attachVariants(ctx context.Context, cards []Card) error {
	if len(cards) == 0 {
		return nil
	}
	slugs := make([]string, len(cards))
	for i, c := range cards {
		slugs[i] = c.Slug
	}
	rows, err := t.d.DB.Query(ctx, `SELECT p.slug, min(v.id), count(*)::int, bool_and(v.stock > 0)
		FROM products p JOIN product_variants v ON v.product_id = p.id AND v.is_active
		WHERE p.slug = ANY($1) GROUP BY p.slug`, slugs)
	if err != nil {
		return err
	}
	defer rows.Close()
	one := map[string]int64{}
	for rows.Next() {
		var slug string
		var id int64
		var n int
		var stock bool
		if err := rows.Scan(&slug, &id, &n, &stock); err != nil {
			return err
		}
		if n == 1 && stock {
			one[slug] = id
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for i := range cards {
		if id, ok := one[cards[i].Slug]; ok {
			v := id
			cards[i].VariantID = &v
		}
	}
	return nil
}

// Search runs the public catalog search.
func (t *Tools) Search(ctx context.Context, q string, limit int) ([]Card, error) {
	pcs, err := catalog.SearchCards(ctx, t.d.DB, q, limit, t.now())
	if err != nil {
		return nil, err
	}
	out := make([]Card, 0, len(pcs))
	for _, pc := range pcs {
		out = append(out, cardOf(pc))
	}
	return out, t.attachVariants(ctx, out)
}

// VariantInfo is a public variant (stock as a level only).
type VariantInfo struct {
	Name        string `json:"name"`
	PriceSatang int64  `json:"price_satang"`
	StockLevel  string `json:"stock_level"` // in_stock | low | out
}

// ProductInfo is the public product detail the bot may quote.
type ProductInfo struct {
	Card
	Subtitle    string        `json:"subtitle"`
	Brand       string        `json:"brand"`
	Category    string        `json:"category"`
	Description string        `json:"description"` // truncated, untrusted text
	Variants    []VariantInfo `json:"variants"`
	RatingAvg   float64       `json:"rating_avg"`
	RatingCount int           `json:"rating_count"`
	FlashEndsAt *time.Time    `json:"flash_ends_at,omitempty"`
	Badges      []string      `json:"badges"`
}

// Product returns the public detail by slug (nil when not public).
func (t *Tools) Product(ctx context.Context, slug string) (*ProductInfo, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" || len(slug) > 160 {
		return nil, nil
	}
	p, err := catalog.PublicProduct(ctx, t.d.DB, slug, t.now())
	if httpx.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	pi := &ProductInfo{Card: cardOf(p.ProductCard), Subtitle: p.Subtitle, Brand: p.Brand, Category: p.Category.Name,
		Description: clip(p.Description, 400), RatingAvg: p.RatingAvg, RatingCount: p.RatingCount, Badges: p.Badges,
		Variants: []VariantInfo{}}
	if p.Flash != nil {
		e := p.Flash.EndsAt.UTC()
		pi.FlashEndsAt = &e
	}
	for _, v := range p.Variants {
		pi.Variants = append(pi.Variants, VariantInfo{Name: v.Name, PriceSatang: v.PriceSatang, StockLevel: v.StockLevel})
	}
	cards := []Card{pi.Card}
	if err := t.attachVariants(ctx, cards); err != nil {
		return nil, err
	}
	pi.Card = cards[0]
	return pi, nil
}

// ---------- promotions (public, audience-free only) ----------

type AutoPromo struct {
	Kind           string     `json:"kind"` // buy_x_get_y | cart_amount | cart_percent | free_shipping
	Label          string     `json:"label"`
	Description    string     `json:"description"`
	MinSpendSatang int64      `json:"min_spend_satang"`
	EndsAt         *time.Time `json:"ends_at"`
}

type FlashNow struct {
	Label    string    `json:"label"`
	EndsAt   time.Time `json:"ends_at"`
	Products []Card    `json:"products"`
}

type Promos struct {
	Campaign   string                 `json:"campaign"`
	CampaignTo *time.Time             `json:"campaign_ends_at"`
	Codes      []promotions.PromoCode `json:"codes"`
	Flash      *FlashNow              `json:"flash_sale"`
	NextFlash  *time.Time             `json:"next_flash_sale_starts_at"`
	Auto       []AutoPromo            `json:"automatic"`
}

// Promotions lists what any shopper can get right now: advertised codes of
// the active campaign, the running flash sale, and automatic promotions with
// no group/tier audience (layer 1 member/trade prices are never listed).
func (t *Tools) Promotions(ctx context.Context) (Promos, error) {
	now := t.now()
	out := Promos{Codes: []promotions.PromoCode{}, Auto: []AutoPromo{}}
	cp, err := promotions.ActiveCampaign(ctx, t.d.DB, now)
	if err != nil {
		return out, err
	}
	if cp != nil {
		out.Campaign = cp.Name
		e := cp.EndsAt
		out.CampaignTo = &e
		for _, pc := range cp.PromoCodes {
			if pc.EndsAt == nil || pc.EndsAt.After(now) {
				out.Codes = append(out.Codes, pc)
			}
		}
	}
	cur, next, err := promotions.CurrentFlashSales(ctx, t.d.DB, now)
	if err != nil {
		return out, err
	}
	if cur != nil {
		f := &FlashNow{Label: cur.Label, EndsAt: cur.EndsAt.UTC(), Products: []Card{}}
		seen := map[string]bool{}
		for _, it := range cur.Items {
			if seen[it.Product.Slug] || len(f.Products) >= 4 {
				continue
			}
			seen[it.Product.Slug] = true
			c := Card{Slug: it.Product.Slug, Name: it.Product.Name, PriceSatang: it.SalePriceSatang, OnFlashSale: true,
				Lowest30dSatang: it.Lowest30dSatang, InStock: it.RemainingQty > 0}
			if it.Product.Image != nil {
				c.ImageURL = it.Product.Image.URL
			}
			f.Products = append(f.Products, c)
		}
		if err := t.attachVariants(ctx, f.Products); err != nil {
			return out, err
		}
		out.Flash = f
	}
	if next != nil {
		s := next.StartsAt.UTC()
		out.NextFlash = &s
	}
	rows, err := t.d.DB.Query(ctx, `SELECT kind, label, description, min_spend_satang, ends_at FROM promotions
		WHERE status = 'active' AND auto_apply AND layer IN (2, 3, 5)
		  AND starts_at <= $1 AND (ends_at IS NULL OR ends_at > $1)
		  AND (usage_limit IS NULL OR used_count < usage_limit)
		  AND cardinality(customer_group_ids) = 0 AND cardinality(tiers) = 0
		ORDER BY layer, priority DESC, id LIMIT 10`, now)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var a AutoPromo
		if err := rows.Scan(&a.Kind, &a.Label, &a.Description, &a.MinSpendSatang, &a.EndsAt); err != nil {
			return out, err
		}
		if a.EndsAt != nil {
			e := a.EndsAt.UTC()
			a.EndsAt = &e
		}
		out.Auto = append(out.Auto, a)
	}
	return out, rows.Err()
}

// FreeShippingMin returns the lowest active automatic free-shipping threshold (nil when none).
func (p Promos) FreeShippingMin() *int64 {
	var best *int64
	for _, a := range p.Auto {
		if a.Kind == "free_shipping" && (best == nil || a.MinSpendSatang < *best) {
			v := a.MinSpendSatang
			best = &v
		}
	}
	return best
}

// ---------- shipping ----------

var postalRe = regexp.MustCompile(`^[1-9][0-9]{4}$`)

type ShipEstimate struct {
	PostalCode        string `json:"postal_code"`
	FeeSatang         int64  `json:"fee_satang"`
	EtaDays           [2]int `json:"eta_days"`
	Remote            bool   `json:"remote"`
	WeightGrams       int    `json:"weight_grams"`
	FreeShippingMinSt *int64 `json:"free_shipping_min_spend_satang"`
}

var errBadPostal = errors.New("assistant: invalid postal code")

// Shipping estimates the fee for a parcel (default 1 kg) to a postal code.
func (t *Tools) Shipping(ctx context.Context, postal string, weightGrams int) (ShipEstimate, error) {
	postal = strings.TrimSpace(postal)
	if !postalRe.MatchString(postal) {
		return ShipEstimate{}, errBadPostal
	}
	if weightGrams <= 0 || weightGrams > 50000 {
		weightGrams = 1000
	}
	r, err := t.carrier.Quote(ctx, shipping.QuoteInput{PostalCode: postal, WeightGrams: weightGrams})
	if err != nil {
		return ShipEstimate{}, err
	}
	out := ShipEstimate{PostalCode: postal, FeeSatang: r.FeeSatang, EtaDays: r.EtaDays, Remote: shipping.IsRemote(postal), WeightGrams: weightGrams}
	p, err := t.Promotions(ctx)
	if err != nil {
		return out, err
	}
	out.FreeShippingMinSt = p.FreeShippingMin()
	return out, nil
}

// ---------- orders (caller-scoped) ----------

var orderNoRe = regexp.MustCompile(`^SS[0-9]{6}[A-Z0-9]{4,8}$`)
var orderNoFind = regexp.MustCompile(`(?i)\bSS[0-9]{6}[A-Z0-9]{4,8}\b`)
var emailFind = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)

type OrderInfo struct {
	OrderNo          string     `json:"order_no"`
	Status           string     `json:"status"`
	StatusText       string     `json:"status_text"`
	CreatedAt        time.Time  `json:"created_at"`
	ItemCount        int        `json:"item_count"`
	GrandTotalSatang int64      `json:"grand_total_satang"`
	PaymentDueAt     *time.Time `json:"payment_due_at,omitempty"`
	TrackingNo       string     `json:"tracking_no,omitempty"`
	ShipmentStatus   string     `json:"shipment_status,omitempty"`
	Href             string     `json:"-"`
}

// OrderLookup.Result: ok | need_login_or_email | invalid_order_no | not_found | rate_limited
type OrderLookup struct {
	Result string      `json:"result"`
	Orders []OrderInfo `json:"orders"`
}

var statusTH = map[string]string{
	"pending_payment": "รอชำระเงิน", "paid": "ชำระเงินแล้ว รอแพ็กสินค้า", "packing": "กำลังแพ็กสินค้า",
	"shipped": "จัดส่งแล้ว", "delivered": "ส่งถึงแล้ว", "completed": "สำเร็จ", "cancelled": "ยกเลิกแล้ว", "refunded": "คืนเงินแล้ว",
}

var shipmentTH = map[string]string{
	"created": "รอขนส่งเข้ารับ", "picked_up": "ขนส่งรับพัสดุแล้ว", "in_transit": "อยู่ระหว่างขนส่ง",
	"out_for_delivery": "กำลังนำส่ง", "delivered": "ส่งถึงแล้ว", "returned": "ตีกลับ", "cancelled": "ยกเลิกการจัดส่ง",
}

// Orders looks up orders for the caller only. Signed in: own orders (latest 3
// when orderNo is empty). Guest: orderNo + email must both match, rate-limited
// per IP; a miss never says which of the two was wrong.
func (t *Tools) Orders(ctx context.Context, caller Caller, orderNo, email string) (OrderLookup, error) {
	orderNo = strings.ToUpper(strings.TrimSpace(orderNo))
	email = strings.ToLower(strings.TrimSpace(email))
	out := OrderLookup{Orders: []OrderInfo{}}
	if orderNo != "" && !orderNoRe.MatchString(orderNo) {
		out.Result = "invalid_order_no"
		return out, nil
	}
	where, args := "", []any{}
	switch {
	case caller.UserID > 0 && orderNo == "":
		where, args = "o.user_id = $1", []any{caller.UserID}
	case caller.UserID > 0:
		where, args = "o.user_id = $1 AND o.order_no = $2", []any{caller.UserID, orderNo}
	case orderNo == "" || email == "" || len(email) > 254:
		out.Result = "need_login_or_email"
		return out, nil
	default:
		if !t.guestLim.Allow("ip:" + caller.IP) {
			out.Result = "rate_limited"
			return out, nil
		}
		where, args = "o.order_no = $1 AND lower(o.email) = $2", []any{orderNo, email}
	}
	rows, err := t.d.DB.Query(ctx, `SELECT o.order_no, o.status, o.created_at, o.grand_total_satang, o.payment_due_at,
			coalesce((SELECT sum(qty) FROM order_items WHERE order_id = o.id), 0)::int,
			coalesce(s.tracking_no, ''), coalesce(s.status, '')
		FROM orders o
		LEFT JOIN LATERAL (SELECT tracking_no, status FROM shipments WHERE order_id = o.id ORDER BY id DESC LIMIT 1) s ON true
		WHERE `+where+` ORDER BY o.created_at DESC, o.id DESC LIMIT 3`, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var o OrderInfo
		var due time.Time
		if err := rows.Scan(&o.OrderNo, &o.Status, &o.CreatedAt, &o.GrandTotalSatang, &due, &o.ItemCount, &o.TrackingNo, &o.ShipmentStatus); err != nil {
			return out, err
		}
		o.CreatedAt = o.CreatedAt.UTC()
		if o.Status == "pending_payment" {
			d := due.UTC()
			o.PaymentDueAt = &d
		}
		o.StatusText = statusTH[o.Status]
		if o.ShipmentStatus != "" {
			o.ShipmentStatus = shipmentTH[o.ShipmentStatus]
		}
		if caller.UserID > 0 {
			o.Href = "/account/orders/" + o.OrderNo
		}
		out.Orders = append(out.Orders, o)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	out.Result = "ok"
	if len(out.Orders) == 0 {
		out.Result = "not_found"
	}
	return out, nil
}

// ---------- store policy FAQ ----------

//go:embed faq_th.md
var faqSource string

type faqEntry struct {
	Topic    string
	Keywords []string
	Answer   string
}

var faq = parseFAQ(faqSource)

func parseFAQ(src string) []faqEntry {
	var out []faqEntry
	var cur *faqEntry
	var body []string
	flush := func() {
		if cur != nil {
			cur.Answer = strings.TrimSpace(strings.Join(body, "\n"))
			out = append(out, *cur)
		}
		body = nil
	}
	for _, line := range strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n") {
		if strings.HasPrefix(line, "## ") {
			flush()
			head := strings.TrimPrefix(line, "## ")
			topic, kw, _ := strings.Cut(head, "|")
			e := faqEntry{Topic: strings.TrimSpace(topic)}
			for _, k := range strings.Split(kw, ",") {
				if k = strings.ToLower(strings.TrimSpace(k)); k != "" {
					e.Keywords = append(e.Keywords, k)
				}
			}
			cur = &e
			continue
		}
		if cur == nil || strings.HasPrefix(line, "# ") || line == "#" {
			continue
		}
		body = append(body, line)
	}
	flush()
	return out
}

// FAQTopics lists the policy topics.
func FAQTopics() []string {
	out := make([]string, len(faq))
	for i, e := range faq {
		out[i] = e.Topic
	}
	return out
}

// Policy returns the FAQ answer for a topic ("" when unknown). The contact
// topic gets the configured channels appended.
func (t *Tools) Policy(topic string) string {
	for _, e := range faq {
		if e.Topic == topic {
			if topic == "contact" {
				return e.Answer + "\n" + t.contactLines()
			}
			return e.Answer
		}
	}
	return ""
}

func (t *Tools) contactLines() string {
	var b []string
	if t.contact.LineURL != "" {
		b = append(b, "• LINE: "+t.contact.LineURL)
	}
	if t.contact.Email != "" {
		b = append(b, "• อีเมล: "+t.contact.Email)
	}
	if t.contact.Phone != "" {
		b = append(b, "• โทร: "+t.contact.Phone)
	}
	return strings.Join(b, "\n")
}

// policyPages are the legal pages (web/src/app/(site)/legal/) behind each FAQ topic.
var policyPages = map[string]string{
	"returns": "/legal/returns", "cancel": "/legal/returns", "shipping": "/legal/shipping",
	"privacy": "/legal/privacy", "payment": "/legal/terms",
}

// PolicyAction links to the full policy page for a topic (ok=false when none).
func PolicyAction(topic string) (Action, bool) {
	href, ok := policyPages[topic]
	return Action{Kind: "link", Label: "อ่านนโยบายฉบับเต็ม", Href: href}, ok
}

// ContactAction is the hand-off button.
func (t *Tools) ContactAction() Action {
	if t.contact.LineURL != "" {
		return Action{Kind: "link", Label: "คุยกับทีมงานทาง LINE", Href: t.contact.LineURL}
	}
	return Action{Kind: "link", Label: "อีเมลถึงทีมงาน", Href: "mailto:" + t.contact.Email}
}

func clip(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}
