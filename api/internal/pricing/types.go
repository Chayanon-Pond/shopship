// Package pricing is the pure pricing engine:
//
//	Price(cart, ruleset, ctx) -> Quote
//
// No I/O, no globals, no time.Now(): the caller (cart/orders via the
// promotions loader) loads the cart lines, the ruleset and the customer
// context, injects Now, and gets a deterministic Quote. All money is int64
// satang. The JSON tags on Quote ARE the public contract (docs/API.md
// "Quote") — do not rename them.
//
// Owner: Wave-1 "pricing" agent. The types in this file are frozen by Wave 0;
// additive fields are fine, renames/removals need the coordinator.
package pricing

import "time"

// ---------- input ----------

// Cart is what is being priced.
type Cart struct {
	Lines      []Line
	CouponCode string // as typed by the customer; engine upper-cases + trims
	// BaseShippingFee is the carrier fee before any free-shipping rule
	// (shipping adapter result; 0 when no address yet).
	BaseShippingFee int64
}

// Line is one cart row, already joined with catalog data by the loader.
type Line struct {
	VariantID        int64
	ProductID        int64
	CategoryID       int64
	ParentCategoryID int64 // 0 when the category is top level
	Qty              int
	ListUnitPrice    int64 // product_variants.price_satang
	Stock            int   // product_variants.stock (sellable now)
	Active           bool  // variant active AND product status = 'active'
	// PriceHistory: list-price points (price_history rows) from at least
	// 30 days before the earliest relevant promotion start up to now, plus
	// the last point before that window. Used for lowest_30d.
	PriceHistory []PricePoint
}

type PricePoint struct {
	Price int64
	At    time.Time
}

// Ruleset is every promotion that could apply, loaded by
// internal/promotions: all status='active' promotions whose window contains
// Now (any layer), all active flash-sale items in window, PLUS the promotion
// behind Cart.CouponCode whatever its status/window (so the engine can say
// "expired" instead of "not found").
type Ruleset struct {
	Promotions []Promotion
	FlashItems []FlashItem
}

type Kind string

const (
	KindQuantityBreak Kind = "quantity_break" // layer 1 (trade tiers)
	KindGroupPrice    Kind = "group_price"    // layer 1
	KindTierPrice     Kind = "tier_price"     // layer 1
	KindBuyXGetY      Kind = "buy_x_get_y"    // layer 2
	KindCartPercent   Kind = "cart_percent"   // layer 3 (auto) or 4 (code)
	KindCartAmount    Kind = "cart_amount"    // layer 3 (auto) or 4 (code)
	KindFreeShipping  Kind = "free_shipping"  // layer 4 (code) or 5 (auto)
)

type Promotion struct {
	ID                int64
	Name              string
	Label             string // customer-facing, used as the adjustment label
	Kind              Kind
	Layer             int
	Status            string // draft|active|paused|archived
	StartsAt          time.Time
	EndsAt            *time.Time
	Priority          int
	Exclusive         bool
	AutoApply         bool
	PercentBP         int   // 1000 = 10 %
	AmountSatang      int64 // cart_amount
	BuyQty, GetQty    int
	GetPercentBP      int // 10000 = free
	MinSpendSatang    int64
	MaxDiscountSatang int64 // 0 = no cap
	UsageLimit        int   // 0 = unlimited
	PerCustomerLimit  int   // 0 = unlimited
	UsedCount         int
	CustomerGroupIDs  []int64  // empty = any
	Tiers             []string // empty = any
	Targets           []Target // empty = whole store
	QtyTiers          []QtyTier
	Codes             []string // active coupon codes (upper-case)
}

type Target struct {
	Type string // category|product|variant
	ID   int64
}

type QtyTier struct {
	MinQty          int
	UnitPriceSatang int64 // exactly one of UnitPriceSatang / PercentBP is set
	PercentBP       int
}

type FlashItem struct {
	ID                int64 // flash_sale_items.id
	FlashSaleID       int64
	Label             string
	VariantID         int64
	SalePriceSatang   int64
	QtyLimit, SoldQty int
	PerCustomerLimit  int // 0 = unlimited
	StartsAt, EndsAt  time.Time
}

// Context is everything about "who and when".
type Context struct {
	Now      time.Time
	Customer *Customer // nil = guest
	// Usage already consumed by this customer (non-released redemptions /
	// flash purchases), loaded only when Customer != nil.
	PromotionUsage map[int64]int // promotion_id -> times used
	FlashUsage     map[int64]int // flash_sale_item_id -> qty bought
	QuoteTTL       time.Duration // default 10 min
}

type Customer struct {
	ID      int64
	GroupID int64 // 0 = none
	Tier    string
}

// ---------- output (JSON = public contract) ----------

type Quote struct {
	Lines       []QuoteLine  `json:"lines"`
	Adjustments []Adjustment `json:"adjustments"` // cart-level (layers 3-4), one per applied rule
	Shipping    Shipping     `json:"shipping"`
	Totals      Totals       `json:"totals"`
	Coupon      *CouponState `json:"coupon"` // null when no code was entered
	Hints       []Hint       `json:"hints"`
	QuoteHash   string       `json:"quote_hash"`
	ExpiresAt   time.Time    `json:"expires_at"`
}

type QuoteLine struct {
	VariantID           int64        `json:"variant_id"`
	Qty                 int          `json:"qty"`
	ListUnitPriceSatang int64        `json:"list_unit_price_satang"`
	UnitPriceSatang     int64        `json:"unit_price_satang"` // after layer 1
	PriceSource         PriceSource  `json:"price_source"`
	Adjustments         []Adjustment `json:"adjustments"`               // layer 2 (at most one)
	LineTotalSatang     int64        `json:"line_total_satang"`         // qty*unit - line adjustments
	AllocatedDiscount   int64        `json:"allocated_discount_satang"` // share of cart-level discounts (largest remainder)
	Lowest30dSatang     *int64       `json:"lowest_30d_satang"`         // strike-through reference; null unless price_source is a promotion
	Availability        Availability `json:"availability"`
}

type PriceSource struct {
	Kind            string `json:"kind"` // list|flash_sale|quantity_break|group_price|tier_price
	Label           string `json:"label"`
	PromotionID     *int64 `json:"promotion_id,omitempty"`
	FlashSaleItemID *int64 `json:"flash_sale_item_id,omitempty"`
}

type Adjustment struct {
	PromotionID  int64  `json:"promotion_id"`
	Layer        int    `json:"layer"`
	Label        string `json:"label"`
	AmountSatang int64  `json:"amount_satang"` // positive = money off
	CouponCode   string `json:"coupon_code,omitempty"`
}

type Availability struct {
	Status       string `json:"status"` // ok|insufficient_stock|out_of_stock|unavailable
	AvailableQty int    `json:"available_qty"`
}

type Shipping struct {
	FeeSatang      int64  `json:"fee_satang"`
	DiscountSatang int64  `json:"discount_satang"`
	PromotionID    *int64 `json:"promotion_id,omitempty"`
	Label          string `json:"label,omitempty"`
}

type Totals struct {
	ListSubtotalSatang int64 `json:"list_subtotal_satang"` // Σ qty*list price
	SubtotalSatang     int64 `json:"subtotal_satang"`      // Σ line_total (after layers 1-2)
	DiscountSatang     int64 `json:"discount_satang"`      // Σ cart-level adjustments (layers 3-4)
	ShippingSatang     int64 `json:"shipping_satang"`      // fee - shipping discount
	SavingsSatang      int64 `json:"savings_satang"`       // list_subtotal - subtotal + discount + shipping discount
	GrandTotalSatang   int64 `json:"grand_total_satang"`   // subtotal - discount + shipping
}

// Coupon statuses and reason codes (docs/API.md "Coupon reasons").
const (
	CouponApplied    = "applied"
	CouponNotApplied = "not_applied" // valid code, but not used for this cart
	CouponInvalid    = "invalid"

	ReasonNotFound            = "not_found"
	ReasonInactive            = "inactive"
	ReasonNotStarted          = "not_started"
	ReasonExpired             = "expired"
	ReasonUsageLimit          = "usage_limit_reached"
	ReasonPerCustomerLimit    = "per_customer_limit_reached"
	ReasonLoginRequired       = "login_required"
	ReasonAudience            = "not_eligible_audience"
	ReasonMinSpend            = "min_spend_not_met"
	ReasonNoEligibleItems     = "no_eligible_items"
	ReasonExclusiveLost       = "exclusive_not_better" // exclusive code worse than the automatic promotion
	ReasonShippingAlreadyFree = "shipping_already_free"
)

type CouponState struct {
	Code       string `json:"code"`
	Status     string `json:"status"`
	ReasonCode string `json:"reason_code"` // "" when applied
	Message    string `json:"message"`     // Thai, ready to show
}

type Hint struct {
	Kind         string `json:"kind"` // free_shipping_gap|cart_promo_gap|buy_x_get_y_gap|login_for_member_price|quantity_break_gap
	Message      string `json:"message"`
	AmountSatang int64  `json:"amount_satang,omitempty"`
	PromotionID  int64  `json:"promotion_id,omitempty"`
	// quantity_break_gap only (additive, Wave 1)
	VariantID       int64 `json:"variant_id,omitempty"`        // the cart line the hint is about
	QtyNeeded       int   `json:"qty_needed,omitempty"`        // units to add to reach the next tier
	UnitPriceSatang int64 `json:"unit_price_satang,omitempty"` // unit price at that tier
	PercentBP       int   `json:"percent_bp,omitempty"`        // percent tiers only
}
