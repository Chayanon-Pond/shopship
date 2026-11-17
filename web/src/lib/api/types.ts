/**
 * Hand-written TypeScript mirror of docs/API.md (FROZEN Wave-0 contract).
 * Money fields are integer satang (`*_satang`), percentages basis points (`*_bp`).
 * Owner: coordinator. Additive changes only, and update docs/API.md first.
 */

export type Satang = number;
export type ISODate = string;

// ---------- envelopes ----------
export type Meta = { page: number; per_page: number; total: number; total_pages: number };
export type DataEnvelope<T> = { data: T };
export type ListEnvelope<T> = { data: T[]; meta: Meta };
export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "csrf_failed"
  | "not_found"
  | "conflict"
  | "price_changed"
  | "out_of_stock"
  | "limit_reached"
  | "idempotency_conflict"
  | "invalid_state"
  | "payload_too_large"
  | "validation_failed"
  | "rate_limited"
  | "not_implemented"
  | "service_unavailable"
  | "internal";
export type ApiErrorBody = {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  details?: unknown;
};

// ---------- shared ----------
export type Image = { id: number; url: string; alt: string; width: number; height: number };
export type CategoryRef = { id: number; slug: string; name: string };
export type Category = {
  id: number;
  slug: string;
  name: string;
  description: string;
  image_url: string;
  icon: string;
  parent_id: number | null;
  sort_order: number;
  product_count: number;
  children: Category[];
  breadcrumbs?: CategoryRef[];
};
export type FlashBadge = {
  flash_sale_id: number;
  sale_price_satang: Satang;
  list_price_satang: Satang;
  ends_at: ISODate;
  remaining_qty: number;
  lowest_30d_satang: Satang | null;
};
export type ProductCard = {
  id: number;
  slug: string;
  name: string;
  /** Optional English name (additive, Wave 1). Omitted when empty. */
  name_en?: string;
  subtitle: string;
  brand: string;
  image: Image | null;
  min_price_satang: Satang;
  max_price_satang: Satang;
  flash: FlashBadge | null;
  rating_avg: number;
  rating_count: number;
  sold_count: number;
  in_stock: boolean;
  badges: string[];
};
export type StockLevel = "in_stock" | "low" | "out";
export type Variant = {
  id: number;
  sku: string;
  name: string;
  option_values: Record<string, string>;
  price_satang: Satang;
  in_stock: boolean;
  stock_level: StockLevel;
  image_id: number | null;
};
export type ReviewsSummary = {
  rating_avg: number;
  rating_count: number;
  histogram: Record<"1" | "2" | "3" | "4" | "5", number>;
  with_images_count: number;
};
export type Product = ProductCard & {
  description: string;
  category: CategoryRef;
  breadcrumbs: CategoryRef[];
  options: { name: string; values: string[] }[];
  variants: Variant[];
  images: Image[];
  reviews_summary: ReviewsSummary;
  tags: string[];
  seo: { title: string; description: string };
};
export type Review = {
  id: number;
  rating: number;
  title: string;
  body: string;
  author_name: string;
  variant_name: string;
  images: Image[];
  created_at: ISODate;
  reply: { body: string; replied_at: ISODate } | null;
};
export type ProductSort = "relevance" | "newest" | "price_asc" | "price_desc" | "best_selling" | "rating";
export type ProductQuery = {
  q?: string;
  category?: string;
  min_price?: Satang;
  max_price?: Satang;
  rating_min?: number;
  in_stock?: boolean;
  tag?: string;
  on_sale?: boolean;
  sort?: ProductSort;
  page?: number;
  per_page?: number;
};

// ---------- auth / account ----------
export type Role = "customer" | "staff" | "admin" | "owner";
export type Tier = "standard" | "silver" | "gold" | "platinum";
export type Perm =
  | "dashboard:read"
  | "catalog:read"
  | "catalog:write"
  | "inventory:write"
  | "orders:read"
  | "orders:fulfil"
  | "orders:manage"
  | "promotions:read"
  | "promotions:write"
  | "customers:read"
  | "customers:write"
  | "banners:write"
  | "reviews:moderate"
  | "audit:read"
  | "staff:manage";
export type Me = {
  id: number;
  email: string;
  name: string;
  phone: string;
  role: Role;
  tier: Tier;
  group: { id: number; code: string; name: string } | null;
  marketing_consent: boolean;
  email_verified: boolean;
  created_at: ISODate;
  perms: Perm[];
  csrf_token: string;
};
export type Address = {
  id: number;
  label: string;
  recipient_name: string;
  phone: string;
  line1: string;
  line2: string;
  subdistrict: string;
  district: string;
  province: string;
  postal_code: string;
  country: "TH";
  is_default: boolean;
};
export type AddressInput = Omit<Address, "id" | "country" | "is_default"> & { is_default?: boolean };

// ---------- cart / quote ----------
export type PriceSourceKind = "list" | "flash_sale" | "quantity_break" | "group_price" | "tier_price";
export type PriceSource = { kind: PriceSourceKind; label: string; promotion_id?: number; flash_sale_item_id?: number };
export type Adjustment = { promotion_id: number; layer: number; label: string; amount_satang: Satang; coupon_code?: string };
export type Availability = { status: "ok" | "insufficient_stock" | "out_of_stock" | "unavailable"; available_qty: number };
export type QuoteLine = {
  variant_id: number;
  qty: number;
  list_unit_price_satang: Satang;
  unit_price_satang: Satang;
  price_source: PriceSource;
  adjustments: Adjustment[];
  line_total_satang: Satang;
  allocated_discount_satang: Satang;
  lowest_30d_satang: Satang | null;
  availability: Availability;
};
export type CouponReason =
  | ""
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "usage_limit_reached"
  | "per_customer_limit_reached"
  | "login_required"
  | "not_eligible_audience"
  | "min_spend_not_met"
  | "no_eligible_items"
  | "exclusive_not_better"
  | "shipping_already_free";
export type CouponState = { code: string; status: "applied" | "not_applied" | "invalid"; reason_code: CouponReason; message: string };
export type Hint = {
  kind: "free_shipping_gap" | "cart_promo_gap" | "buy_x_get_y_gap" | "login_for_member_price" | "quantity_break_gap";
  message: string;
  amount_satang?: Satang;
  promotion_id?: number;
  /** quantity_break_gap only (additive, Wave 1): the cart line (variant) the hint is about. */
  variant_id?: number;
  /** quantity_break_gap only (additive, Wave 1): units to add to reach the next tier. */
  qty_needed?: number;
  /** quantity_break_gap only: unit price once the tier is reached. */
  unit_price_satang?: Satang;
  /** quantity_break_gap only, percent tiers: discount in basis points. */
  percent_bp?: number;
};
export type Quote = {
  lines: QuoteLine[];
  adjustments: Adjustment[];
  shipping: { fee_satang: Satang; discount_satang: Satang; promotion_id?: number; label?: string };
  totals: {
    list_subtotal_satang: Satang;
    subtotal_satang: Satang;
    discount_satang: Satang;
    shipping_satang: Satang;
    savings_satang: Satang;
    grand_total_satang: Satang;
  };
  coupon: CouponState | null;
  hints: Hint[];
  quote_hash: string;
  expires_at: ISODate;
};
export type CartItem = {
  variant_id: number;
  qty: number;
  product: { id: number; slug: string; name: string; image: Image | null };
  variant: { sku: string; name: string; option_values: Record<string, string> };
  list_unit_price_satang: Satang;
  stock_level: StockLevel;
  max_qty: number;
};
export type Cart = { items: CartItem[]; coupon_code: string | null; item_count: number; quote: Quote };
export type QuoteRequest = { postal_code?: string; address_id?: number; coupon_code?: string };

// ---------- shipping / orders / payments ----------
export type ShippingRate = { carrier: string; fee_satang: Satang; eta_days: [number, number] };
export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "packing"
  | "shipped"
  | "delivered"
  | "completed"
  | "cancelled"
  | "refunded";
export type PaymentMethod = "promptpay" | "card";
export type OrderSummary = {
  order_no: string;
  status: OrderStatus;
  item_count: number;
  grand_total_satang: Satang;
  created_at: ISODate;
  first_item_image: Image | null;
};
export type OrderItem = {
  variant_id: number;
  product_slug: string;
  sku: string;
  product_name: string;
  variant_name: string;
  image_url: string;
  qty: number;
  list_unit_price_satang: Satang;
  unit_price_satang: Satang;
  price_source: { kind: PriceSourceKind; label: string };
  line_discount_satang: Satang;
  line_total_satang: Satang;
  allocated_discount_satang: Satang;
  lowest_30d_satang: Satang | null;
};
export type Order = {
  order_no: string;
  status: OrderStatus;
  items: OrderItem[];
  adjustments: Adjustment[];
  totals: {
    list_subtotal_satang: Satang;
    subtotal_satang: Satang;
    discount_satang: Satang;
    shipping_fee_satang: Satang;
    shipping_discount_satang: Satang;
    savings_satang: Satang;
    grand_total_satang: Satang;
  };
  coupon_code: string | null;
  payment_method: PaymentMethod;
  shipping_address: Omit<Address, "id">;
  email: string;
  customer_note: string;
  payment: { status: ChargeStatus; method: PaymentMethod; charge_id: string; expires_at: ISODate | null } | null;
  shipment: { carrier: string; tracking_no: string; status: string; label_url?: string } | null;
  timeline: { status: OrderStatus; at: ISODate; note: string }[];
  payment_due_at: ISODate;
  paid_at: ISODate | null;
  cancelled_at: ISODate | null;
  created_at: ISODate;
};
export type CreateOrderRequest = {
  address_id: number;
  payment_method: PaymentMethod;
  quote_hash: string;
  coupon_code?: string;
  customer_note?: string;
};
export type ChargeStatus = "pending" | "requires_action" | "successful" | "failed" | "expired" | "refunded";
export type Charge = {
  charge_id: string;
  order_no: string;
  method: PaymentMethod;
  status: ChargeStatus;
  amount_satang: Satang;
  promptpay: { qr_payload: string; qr_image_url: string | null; expires_at: ISODate } | null;
  authorize_uri: string | null;
  failure_code: string | null;
  failure_message: string | null;
};
export type Tracking = {
  carrier: string;
  tracking_no: string;
  status: string;
  events: { status: string; description: string; location: string; occurred_at: ISODate }[];
};

// ---------- promotions (public) ----------
export type Banner = {
  id: number;
  placement: "home_hero" | "home_strip" | "category_top";
  title: string;
  subtitle: string;
  cta_label: string;
  link_url: string;
  image_url: string;
  image_mobile_url: string;
  image_alt: string;
  campaign_id: number | null;
};
export type CampaignTheme = {
  accent: string;
  accent_contrast: string;
  background: string;
  hero_image_url: string;
  badge_text: string;
};
export type Campaign = {
  id: number;
  slug: string;
  name: string;
  season_tag: string;
  theme: CampaignTheme;
  starts_at: ISODate;
  ends_at: ISODate;
  banners: Banner[];
  /** Advertised public codes of the campaign (additive, Wave 1); omitted when none. */
  promo_codes?: PromoCode[];
};
export type PromoCode = { code: string; label: string; description: string; ends_at: ISODate | null };
export type FlashSaleItem = {
  flash_sale_item_id: number;
  product: ProductCard;
  variant_id: number;
  variant_name: string;
  sale_price_satang: Satang;
  list_price_satang: Satang;
  lowest_30d_satang: Satang | null;
  qty_limit: number;
  sold_qty: number;
  remaining_qty: number;
  per_customer_limit: number | null;
};
export type FlashSale = { id: number; label: string; starts_at: ISODate; ends_at: ISODate; items: FlashSaleItem[] };
export type FlashSaleCurrent = { current: FlashSale | null; next: FlashSale | null };
export type Offer = {
  variant_id: number;
  list_price_satang: Satang;
  price_satang: Satang;
  price_source: { kind: PriceSourceKind; label: string };
  lowest_30d_satang: Satang | null;
  qty_breaks: { min_qty: number; unit_price_satang: Satang }[];
  badges: string[];
};

// ---------- admin ----------
export type PromotionKind =
  | "quantity_break"
  | "group_price"
  | "tier_price"
  | "buy_x_get_y"
  | "cart_percent"
  | "cart_amount"
  | "free_shipping";
export type PromotionStatus = "draft" | "active" | "paused" | "archived";
export type AdminPromotion = {
  id: number;
  name: string;
  label: string;
  description: string;
  kind: PromotionKind;
  layer: 1 | 2 | 3 | 4 | 5;
  status: PromotionStatus;
  starts_at: ISODate;
  ends_at: ISODate | null;
  priority: number;
  exclusive: boolean;
  auto_apply: boolean;
  percent_bp: number | null;
  amount_satang: Satang | null;
  buy_qty: number | null;
  get_qty: number | null;
  get_percent_bp: number | null;
  min_spend_satang: Satang;
  max_discount_satang: Satang | null;
  usage_limit: number | null;
  per_customer_limit: number | null;
  used_count: number;
  customer_group_ids: number[];
  tiers: Tier[];
  qty_tiers: { min_qty: number; unit_price_satang: Satang | null; percent_bp: number | null }[];
  targets: { type: "category" | "product" | "variant"; id: number; name: string }[];
  codes: { id: number; code: string; is_active: boolean }[];
  campaign: { id: number; slug: string; name: string } | null;
  season_tag: string;
  created_at: ISODate;
  updated_at: ISODate;
  state: "scheduled" | "running" | "ended" | "draft" | "paused" | "archived";
};
export type AdminOrderRow = {
  order_no: string;
  status: OrderStatus;
  customer: { id: number; email: string; name: string };
  item_count: number;
  grand_total_satang: Satang;
  payment_method: PaymentMethod;
  created_at: ISODate;
  paid_at: ISODate | null;
};
export type AdminProductRow = {
  id: number;
  slug: string;
  name: string;
  /** English name (additive, Wave 1); "" when unset. */
  name_en: string;
  status: "draft" | "active" | "hidden" | "archived";
  category: CategoryRef;
  image_url: string;
  min_price_satang: Satang;
  max_price_satang: Satang;
  total_stock: number;
  variant_count: number;
  updated_at: ISODate;
};
export type Dashboard = {
  today: { sales_satang: Satang; orders: number; paid_orders: number };
  month: { sales_satang: Satang; orders: number };
  pending: { to_pack: number; pending_payment: number };
  low_stock: { variant_id: number; sku: string; product_name: string; stock: number }[];
  sales_7d: { date: string; sales_satang: Satang; orders: number }[];
  top_products: { product_id: number; name: string; qty: number; sales_satang: Satang }[];
};

/* ---- Shop assistant (API.md §14, additive Wave 3) ---- */
export type AssistantRole = "user" | "assistant";
export type AssistantMessage = { role: AssistantRole; content: string };
export type AssistantChatRequest = { messages: AssistantMessage[]; context?: { product_slug?: string } };
export type AssistantCard = {
  slug: string;
  name: string;
  price_satang: Satang;
  price_from: boolean;
  lowest_30d_satang: Satang | null;
  on_flash_sale: boolean;
  image_url: string;
  in_stock: boolean;
  variant_id: number | null;
};
export type AssistantAction = { kind: "link"; label: string; href: string };
export type AssistantChatResponse = {
  reply: string;
  suggestions: string[];
  products: AssistantCard[];
  actions: AssistantAction[];
  source: "rules" | "llm";
};
