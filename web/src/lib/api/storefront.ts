/**
 * Storefront endpoint wrappers. Owner: Wave-1 "storefront" agent.
 *
 * Caching rule (Next 16 cacheComponents): PUBLIC reads are wrapped in 'use cache'
 * functions in `app/(site)/_lib/data.ts`; personal data (me, cart, quote, offers,
 * orders, addresses, wishlist) is only ever called from client components (no-store).
 *
 * With NEXT_PUBLIC_USE_MOCKS=true every call first goes through the stateful
 * storefront mock (`mocks/storefront.ts`: cart, coupon, session, addresses,
 * catalog filters) and falls back to the fixture handler. Same contract either way.
 */
import { ApiError, USE_MOCKS, request, setCsrfToken, type Query } from "./client";
import type {
  Address,
  AddressInput,
  Banner,
  Campaign,
  Cart,
  Category,
  CategoryRef,
  Charge,
  CreateOrderRequest,
  FlashSaleCurrent,
  ListEnvelope,
  Me,
  Offer,
  Order,
  OrderStatus,
  OrderSummary,
  PaymentMethod,
  Product,
  ProductCard,
  ProductQuery,
  Quote,
  QuoteRequest,
  Review,
  ShippingRate,
  Tracking,
} from "./types";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QuoteBody = QuoteRequest;
export type Suggestions = { products: { slug: string; name: string; image_url: string }[]; categories: CategoryRef[] };

async function call<T>(
  method: Method,
  path: string,
  opts: { query?: Query; body?: unknown; headers?: Record<string, string>; noStore?: boolean } = {},
): Promise<T> {
  if (USE_MOCKS) {
    const { storefrontMock } = await import("@/mocks/storefront");
    const hit = await storefrontMock(method, path, opts.query, opts.body, opts.headers);
    if (hit !== undefined) return structuredClone(hit) as T;
  }
  return request<T>(path, {
    method,
    query: opts.query,
    body: opts.body,
    headers: opts.headers,
    noStore: opts.noStore ?? method !== "GET",
  });
}
const data = async <T>(method: Method, path: string, opts?: Parameters<typeof call>[2]) =>
  (await call<{ data: T } | undefined>(method, path, opts))?.data as T;

const seg = encodeURIComponent;

// ---------------- public (cacheable) ----------------
export const getCategories = () => data<Category[]>("GET", "/categories");
export const getCategory = (slug: string) => data<Category>("GET", `/categories/${seg(slug)}`);
export const getProducts = (q: ProductQuery = {}) =>
  call<ListEnvelope<ProductCard>>("GET", "/products", { query: q as Query });
export const getProduct = (slug: string) => data<Product>("GET", `/products/${seg(slug)}`);
export const getRelated = (slug: string) => data<ProductCard[]>("GET", `/products/${seg(slug)}/related`);
export const getReviews = (
  slug: string,
  query: { page?: number; rating?: number; with_images?: boolean; sort?: "newest" | "rating_desc" | "rating_asc" } = {},
) => call<ListEnvelope<Review>>("GET", `/products/${seg(slug)}/reviews`, { query });
export const searchSuggest = (q: string) => data<Suggestions>("GET", "/search/suggest", { query: { q } });
export const getActiveCampaign = () => data<Campaign | null>("GET", "/campaigns/active");
export const getBanners = (placement: Banner["placement"], category?: string) =>
  data<Banner[]>("GET", "/banners", { query: { placement, category } });
export const getFlashSales = () => data<FlashSaleCurrent>("GET", "/flash-sales/current");

// ---------------- session ----------------
function keepCsrf(me: Me | undefined) {
  if (me?.csrf_token) setCsrfToken(me.csrf_token);
  return me as Me;
}
/** Current user, or null for guests (401). */
export async function getMe(): Promise<Me | null> {
  try {
    // ?optional=true: guests get 200 {data: null} (no 401 noise in the console); a 401 is still handled below
    const me = await data<Me | null>("GET", "/auth/me", { query: { optional: true }, noStore: true });
    return me ? keepCsrf(me) : null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}
export const login = async (email: string, password: string) =>
  keepCsrf(await data<Me>("POST", "/auth/login", { body: { email, password } }));
export const register = async (b: { email: string; password: string; name: string; phone?: string; marketing_consent: boolean }) =>
  keepCsrf(await data<Me>("POST", "/auth/register", { body: b }));
export const logout = async () => {
  await call<void>("POST", "/auth/logout");
  setCsrfToken(null);
};
export const updateMe = (b: { name?: string; phone?: string; marketing_consent?: boolean }) =>
  data<Me>("PATCH", "/auth/me", { body: b });
export const changePassword = (current_password: string, new_password: string) =>
  call<void>("POST", "/auth/password/change", { body: { current_password, new_password } });
export const forgotPassword = (email: string) => call<void>("POST", "/auth/password/forgot", { body: { email } });
export const resetPassword = (token: string, new_password: string) =>
  call<void>("POST", "/auth/password/reset", { body: { token, new_password } });

// ---------------- personal (client-side, no-store) ----------------
export const getOffers = (variantIds: number[]) =>
  data<Offer[]>("GET", "/offers", { query: { variant_ids: variantIds.join(",") }, noStore: true });

export const getCart = () => data<Cart>("GET", "/cart", { noStore: true });
export const addToCart = (variant_id: number, qty: number) => data<Cart>("POST", "/cart/items", { body: { variant_id, qty } });
export const setCartQty = (variantId: number, qty: number) =>
  data<Cart>("PATCH", `/cart/items/${variantId}`, { body: { qty } });
export const removeFromCart = (variantId: number) => data<Cart>("DELETE", `/cart/items/${variantId}`);
export const applyCoupon = (code: string) => data<Cart>("PUT", "/cart/coupon", { body: { code } });
export const removeCoupon = () => data<Cart>("DELETE", "/cart/coupon");
export const quoteCart = (body: QuoteRequest = {}) => data<Quote>("POST", "/cart/quote", { body });

export const getAddresses = () => data<Address[]>("GET", "/me/addresses", { noStore: true });
export const createAddress = (a: AddressInput) => data<Address>("POST", "/me/addresses", { body: a });
export const updateAddress = (id: number, a: Partial<AddressInput>) => data<Address>("PATCH", `/me/addresses/${id}`, { body: a });
export const deleteAddress = (id: number) => call<void>("DELETE", `/me/addresses/${id}`);
export const setDefaultAddress = (id: number) => data<Address>("POST", `/me/addresses/${id}/default`);

export const getWishlist = (page = 1) =>
  call<ListEnvelope<ProductCard>>("GET", "/me/wishlist", { query: { page, per_page: 48 }, noStore: true });
export const addWishlist = (productId: number) => call<void>("PUT", `/me/wishlist/${productId}`);
export const removeWishlist = (productId: number) => call<void>("DELETE", `/me/wishlist/${productId}`);

export const shippingQuote = (postal_code: string) =>
  data<ShippingRate>("POST", "/shipping/quote", { body: { postal_code } });

/** idempotencyKey: crypto.randomUUID() created once per checkout attempt and reused on retry. */
export const createOrder = (body: CreateOrderRequest, idempotencyKey: string) =>
  data<Order>("POST", "/orders", { body, headers: { "Idempotency-Key": idempotencyKey } });
export const getOrders = (page = 1, status?: OrderStatus) =>
  call<ListEnvelope<OrderSummary>>("GET", "/orders", { query: { page, status }, noStore: true });
export const getOrder = (orderNo: string) => data<Order>("GET", `/orders/${seg(orderNo)}`, { noStore: true });
export const cancelOrder = (orderNo: string) => data<Order>("POST", `/orders/${seg(orderNo)}/cancel`);
export const getTracking = (orderNo: string) => data<Tracking>("GET", `/orders/${seg(orderNo)}/tracking`, { noStore: true });

export const createCharge = (order_no: string, method: PaymentMethod, card_token?: string, return_uri?: string) =>
  data<Charge>("POST", "/payments/charges", { body: { order_no, method, card_token, return_uri } });
export const getCharge = (chargeId: string) => data<Charge>("GET", `/payments/charges/${seg(chargeId)}`, { noStore: true });
/** Mock payment provider only (404 in production): simulates the payer. */
export const mockCompleteCharge = (chargeId: string, outcome: "successful" | "failed") =>
  data<Charge>("POST", `/payments/mock/charges/${seg(chargeId)}/complete`, { body: { outcome } });
