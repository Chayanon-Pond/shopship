/**
 * Back-office endpoint wrappers (/api/v1/admin/*). Owner: Wave-1 "admin" agent.
 * Everything here is personal: client-side, no-store.
 *
 * Shapes not mirrored in types.ts (frozen file) are declared here from docs/API.md §12.
 * Where API.md leaves a shape implicit (admin reviews row, campaign row) the
 * assumption is documented on the type.
 */
import { ApiError, USE_MOCKS, getCsrfToken, getData, request, send, setCsrfToken } from "./client";
import type {
  Address,
  AdminOrderRow,
  AdminProductRow,
  AdminPromotion,
  Banner,
  CampaignTheme,
  CategoryRef,
  Dashboard,
  Image,
  ListEnvelope,
  Me,
  Order,
  OrderStatus,
  OrderSummary,
  PaymentMethod,
  Product,
  Quote,
  Review,
  Role,
  Satang,
  Tier,
  Tracking,
} from "./types";

export type {
  AdminOrderRow,
  AdminProductRow,
  AdminPromotion,
  Dashboard,
  Me,
  Order,
  OrderStatus,
  Quote,
  Role,
  Tier,
};

// ---------- extra admin shapes (API.md §12) ----------
export type ProductStatus = AdminProductRow["status"];
export type AdminVariant = {
  id: number;
  sku: string;
  name: string;
  option_values: Record<string, string>;
  price_satang: Satang;
  cost_satang: Satang | null;
  stock: number;
  weight_grams: number;
  barcode: string;
  low_stock_threshold: number;
  is_active: boolean;
  image_id: number | null;
  in_stock?: boolean;
  stock_level?: string;
};
export type AdminProduct = Omit<Product, "variants"> & {
  name_en: string;
  status: ProductStatus;
  featured: boolean;
  variants: AdminVariant[];
  images: Image[];
  created_at: string;
  updated_at: string;
};
export type VariantInput = {
  sku: string;
  name: string;
  option_values: Record<string, string>;
  price_satang: Satang;
  cost_satang?: Satang | null;
  stock?: number;
  weight_grams: number;
  barcode: string;
  low_stock_threshold: number;
};
export type ProductInput = {
  name: string;
  name_en: string;
  slug?: string;
  subtitle: string;
  description: string;
  category_id: number;
  brand: string;
  status: ProductStatus;
  featured: boolean;
  tags: string[];
  options: { name: string; values: string[] }[];
  seo_title: string;
  seo_description: string;
  variants?: VariantInput[];
};
export type AdminCategory = {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
  description: string;
  image_url: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  seo_title: string;
  seo_description: string;
  product_count?: number;
};
export type CategoryInput = Omit<AdminCategory, "id" | "product_count">;
export type InventoryRow = {
  variant_id: number;
  product_id: number;
  product_name: string;
  sku: string;
  variant_name: string;
  stock: number;
  low_stock_threshold: number;
  reserved_qty: number;
};
/** Admin review row. Assumption: public Review + status + product ref (API.md lists only the query params). */
export type AdminReview = Review & { status: "published" | "hidden"; product: { id: number; slug: string; name: string } };

export type PromotionInput = Partial<
  Omit<AdminPromotion, "id" | "layer" | "used_count" | "codes" | "campaign" | "created_at" | "updated_at" | "state" | "targets">
> & {
  targets?: { type: "category" | "product" | "variant"; id: number }[];
  campaign_id?: number | null;
  codes?: string[];
};
export type CouponCode = { id: number; code: string; is_active: boolean };
export type Redemption = { order_no: string; user_email: string; amount_satang: Satang; status: string; created_at: string };
export type PreviewRequest = {
  lines: { variant_id: number; qty: number }[];
  coupon_code?: string;
  user_id?: number;
  postal_code?: string;
  now?: string;
};
export type FlashItem = {
  id: number;
  variant_id: number;
  sku: string;
  product_name: string;
  variant_name: string;
  list_price_satang: Satang;
  sale_price_satang: Satang;
  qty_limit: number;
  sold_qty: number;
  per_customer_limit: number | null;
  sort_order: number;
};
export type AdminFlashSale = {
  id: number;
  name: string;
  label: string;
  status: "draft" | "active" | "paused" | "archived";
  starts_at: string;
  ends_at: string;
  campaign_id: number | null;
  items: FlashItem[];
};
export type FlashSaleInput = Omit<AdminFlashSale, "id" | "items">;
export type FlashItemInput = { variant_id: number; sale_price_satang: Satang; qty_limit: number; per_customer_limit?: number | null; sort_order: number };
/** Admin campaign row = POST body + id (API.md §12.2). */
export type AdminCampaign = {
  id: number;
  slug: string;
  name: string;
  season_tag: string;
  theme: CampaignTheme;
  starts_at: string;
  ends_at: string;
  priority: number;
  is_active: boolean;
};
export type CampaignInput = Omit<AdminCampaign, "id">;
export type CustomerGroup = { id: number; code: string; name: string; description: string; member_count: number };
export type AdminUser = {
  id: number;
  email: string;
  name: string;
  phone: string;
  role: Role;
  tier: Tier;
  group: { id: number; code: string; name: string } | null;
  is_active: boolean;
  order_count: number;
  total_spent_satang: Satang;
  created_at: string;
  last_login_at: string | null;
};
export type AdminUserDetail = AdminUser & { addresses: Address[]; recent_orders: OrderSummary[] };
export type AdminOrder = Omit<Order, "shipment"> & {
  /** `id` is additive (admin only) so the console can call /admin/shipments/:id/*. */
  shipment: (NonNullable<Order["shipment"]> & { id?: number }) | null;
  customer: { id: number; email: string; name: string };
  payments: { charge_id: string; method: PaymentMethod; status: string; amount_satang: Satang; created_at: string }[];
  status_history: { from_status: OrderStatus | null; to_status: OrderStatus; actor_email: string | null; note: string; created_at: string }[];
};
export type Shipment = { id: number; carrier: string; tracking_no: string; status: string; label_url: string; fee_satang: Satang };
export type AdminBanner = Banner & {
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  sort_order: number;
  category_id: number | null;
};
export type BannerInput = Omit<AdminBanner, "id">;
export type AuditLog = {
  id: number;
  actor: { id: number; email: string } | null;
  action: string;
  target_type: string;
  target_id: string;
  metadata: unknown;
  ip: string;
  created_at: string;
};
export type Upload = { storage_key: string; url: string; width: number; height: number };

type Q = Record<string, string | number | boolean | undefined | null>;
const list = <T>(path: string, query: Q = {}) => request<ListEnvelope<T>>(path, { query, noStore: true });
const one = <T>(path: string, query?: Q) => getData<T>(path, { query, noStore: true });

// ---------- session (mock short-circuit approved by coordinator) ----------
const MOCK_SESSION_KEY = "shopship_admin_mock_session";
async function mockMe(): Promise<Me> {
  const { mockSessionMe } = await import("@/lib/admin/mock-db");
  let email: string | null = null;
  try {
    // mock-only convenience for scripted screenshots: ?mock_login=owner@shopship.local
    const fromUrl = new URLSearchParams(window.location.search).get("mock_login");
    if (fromUrl) sessionStorage.setItem(MOCK_SESSION_KEY, fromUrl);
    email = sessionStorage.getItem(MOCK_SESSION_KEY);
  } catch {
    /* storage blocked */
  }
  if (!email) throw new ApiError(401, { code: "unauthorized", message: "กรุณาเข้าสู่ระบบ" });
  return mockSessionMe(email);
}

export async function getAdminMe(): Promise<Me> {
  const me = USE_MOCKS ? await mockMe() : await getData<Me>("/auth/me", { noStore: true });
  setCsrfToken(me.csrf_token);
  return me;
}
export async function adminLogin(email: string, password: string): Promise<Me> {
  if (USE_MOCKS) {
    try {
      sessionStorage.setItem(MOCK_SESSION_KEY, email);
    } catch {
      /* ignore */
    }
    void password;
    return getAdminMe();
  }
  const me = await send<Me>("POST", "/auth/login", { email, password });
  setCsrfToken(me.csrf_token);
  return me;
}
export async function adminLogout(): Promise<void> {
  if (USE_MOCKS) {
    try {
      sessionStorage.removeItem(MOCK_SESSION_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  await send<void>("POST", "/auth/logout");
  setCsrfToken(null);
}

// ---------- multipart ----------
async function multipart<T>(path: string, form: FormData): Promise<T> {
  if (USE_MOCKS) {
    const { mockUpload } = await import("@/lib/admin/mock-db");
    return mockUpload(path, form) as T;
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getCsrfToken();
  if (token) headers["X-CSRF-Token"] = token;
  const res = await fetch(`/api/v1${path}`, { method: "POST", body: form, headers, credentials: "include", cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, json?.error ?? { code: "internal", message: "อัปโหลดไม่สำเร็จ" });
  }
  return (json as { data: T }).data;
}

// ---------- dashboard ----------
export const getDashboard = () => getData<Dashboard>("/admin/dashboard", { noStore: true });

// ---------- catalog ----------
export const listProducts = (query: { q?: string; status?: string; category_id?: number; low_stock?: boolean; page?: number; per_page?: number; sort?: string } = {}) =>
  list<AdminProductRow>("/admin/products", query);
export const getProduct = (id: number) => one<AdminProduct>(`/admin/products/${id}`);
export const createProduct = (body: ProductInput) => send<AdminProduct>("POST", "/admin/products", body);
export const updateProduct = (id: number, body: Partial<ProductInput>) => send<AdminProduct>("PATCH", `/admin/products/${id}`, body);
export const deleteProduct = (id: number) => send<void>("DELETE", `/admin/products/${id}`);
export const createVariant = (productId: number, body: VariantInput) => send<AdminVariant>("POST", `/admin/products/${productId}/variants`, body);
export const updateVariant = (id: number, body: Partial<VariantInput> & { is_active?: boolean }) => send<AdminVariant>("PATCH", `/admin/variants/${id}`, body);
export const deleteVariant = (id: number) => send<void>("DELETE", `/admin/variants/${id}`);
export const getPriceHistory = (variantId: number) => one<{ price_satang: Satang; changed_at: string }[]>(`/admin/variants/${variantId}/price-history`);
export function uploadProductImage(productId: number, file: File, alt: string, variantId?: number | null) {
  const f = new FormData();
  f.set("file", file);
  f.set("alt", alt);
  if (variantId) f.set("variant_id", String(variantId));
  return multipart<Image>(`/admin/products/${productId}/images`, f);
}
export const reorderImages = (productId: number, imageIds: number[]) => send<void>("PUT", `/admin/products/${productId}/images/order`, { image_ids: imageIds });
export const updateImage = (id: number, body: { alt?: string; variant_id?: number | null }) => send<Image>("PATCH", `/admin/images/${id}`, body);
export const deleteImage = (id: number) => send<void>("DELETE", `/admin/images/${id}`);
export function uploadFile(file: File) {
  const f = new FormData();
  f.set("file", file);
  return multipart<Upload>("/admin/uploads", f);
}

export const listCategories = () => list<AdminCategory>("/admin/categories", { per_page: 100 });
export const createCategory = (body: CategoryInput) => send<AdminCategory>("POST", "/admin/categories", body);
export const updateCategory = (id: number, body: Partial<CategoryInput>) => send<AdminCategory>("PATCH", `/admin/categories/${id}`, body);
export const deleteCategory = (id: number) => send<void>("DELETE", `/admin/categories/${id}`);

export const listInventory = (query: { low_stock?: boolean; q?: string; page?: number; per_page?: number } = {}) => list<InventoryRow>("/admin/inventory", query);
export const adjustInventory = (variant_id: number, delta: number, reason: string) =>
  send<{ variant_id: number; stock: number }>("POST", "/admin/inventory/adjust", { variant_id, delta, reason });

export const listReviews = (query: { status?: string; product_id?: number; rating?: number; page?: number } = {}) => list<AdminReview>("/admin/reviews", query);
export const moderateReview = (id: number, body: { status?: "published" | "hidden"; reply_body?: string }) => send<AdminReview>("PATCH", `/admin/reviews/${id}`, body);

// ---------- promotions ----------
export const listPromotions = (query: { kind?: string; layer?: number; state?: string; campaign_id?: number; q?: string; page?: number; per_page?: number } = {}) =>
  list<AdminPromotion>("/admin/promotions", query);
export const getPromotion = (id: number) => getData<AdminPromotion>(`/admin/promotions/${id}`, { noStore: true });
export const createPromotion = (body: PromotionInput) => send<AdminPromotion>("POST", "/admin/promotions", body);
export const updatePromotion = (id: number, body: PromotionInput) => send<AdminPromotion>("PATCH", `/admin/promotions/${id}`, body);
export const deletePromotion = (id: number) => send<void>("DELETE", `/admin/promotions/${id}`);
export const addCodes = (id: number, body: { codes: string[] } | { generate: { count: number; prefix: string; length: number } }) =>
  send<CouponCode[]>("POST", `/admin/promotions/${id}/codes`, body);
export const deactivateCode = (id: number) => send<void>("DELETE", `/admin/coupon-codes/${id}`);
export const listRedemptions = (id: number, page = 1) => list<Redemption>(`/admin/promotions/${id}/redemptions`, { page });
export const previewPromotions = (body: PreviewRequest) => send<Quote>("POST", "/admin/promotions/preview", body);

export const listFlashSales = (query: { page?: number; per_page?: number; q?: string } = {}) => list<AdminFlashSale>("/admin/flash-sales", query);
export const getFlashSale = (id: number) => one<AdminFlashSale>(`/admin/flash-sales/${id}`);
export const createFlashSale = (body: FlashSaleInput) => send<AdminFlashSale>("POST", "/admin/flash-sales", body);
export const updateFlashSale = (id: number, body: Partial<FlashSaleInput>) => send<AdminFlashSale>("PATCH", `/admin/flash-sales/${id}`, body);
export const deleteFlashSale = (id: number) => send<void>("DELETE", `/admin/flash-sales/${id}`);
export const replaceFlashItems = (id: number, items: FlashItemInput[]) => send<AdminFlashSale>("PUT", `/admin/flash-sales/${id}/items`, items);

export const listCampaigns = (query: { page?: number; per_page?: number } = {}) => list<AdminCampaign>("/admin/campaigns", { per_page: 100, ...query });
export const createCampaign = (body: CampaignInput) => send<AdminCampaign>("POST", "/admin/campaigns", body);
export const updateCampaign = (id: number, body: Partial<CampaignInput>) => send<AdminCampaign>("PATCH", `/admin/campaigns/${id}`, body);
export const deleteCampaign = (id: number) => send<void>("DELETE", `/admin/campaigns/${id}`);

export const listCustomerGroups = () => list<CustomerGroup>("/admin/customer-groups", { per_page: 100 });
export const createCustomerGroup = (body: { code: string; name: string; description: string }) => send<CustomerGroup>("POST", "/admin/customer-groups", body);
export const updateCustomerGroup = (id: number, body: Partial<{ code: string; name: string; description: string }>) =>
  send<CustomerGroup>("PATCH", `/admin/customer-groups/${id}`, body);
export const deleteCustomerGroup = (id: number) => send<void>("DELETE", `/admin/customer-groups/${id}`);

// ---------- users / orders ----------
export const listUsers = (query: { role?: string; group_id?: number; tier?: string; q?: string; page?: number; per_page?: number } = {}) =>
  list<AdminUser>("/admin/users", query);
export const getUser = (id: number) => one<AdminUserDetail>(`/admin/users/${id}`);
export const updateUser = (id: number, body: { group_id?: number | null; tier?: Tier; is_active?: boolean; role?: Role }) =>
  send<AdminUser>("PATCH", `/admin/users/${id}`, body);

export const listOrders = (query: { q?: string; status?: OrderStatus | ""; from?: string; to?: string; payment_method?: string; page?: number; per_page?: number } = {}) =>
  list<AdminOrderRow>("/admin/orders", query);
export const getOrder = (orderNo: string) => one<AdminOrder>(`/admin/orders/${encodeURIComponent(orderNo)}`);
export const setOrderStatus = (orderNo: string, to: OrderStatus, note?: string) =>
  send<AdminOrder>("POST", `/admin/orders/${encodeURIComponent(orderNo)}/status`, { to, note });
export const createShipment = (orderNo: string, weight_grams?: number) =>
  send<Shipment>("POST", `/admin/orders/${encodeURIComponent(orderNo)}/shipments`, weight_grams ? { weight_grams } : {});
export const shipmentLabelUrl = (id: number) => `/api/v1/admin/shipments/${id}/label`;
/** Mock carrier only (404 otherwise): advance tracking one step. */
export const advanceShipment = (id: number) => send<Tracking>("POST", `/admin/shipments/${id}/mock-advance`);

// ---------- banners / audit ----------
export const listBanners = (query: { placement?: string; page?: number; per_page?: number } = {}) => list<AdminBanner>("/admin/banners", { per_page: 100, ...query });
export const createBanner = (body: BannerInput) => send<AdminBanner>("POST", "/admin/banners", body);
export const updateBanner = (id: number, body: Partial<BannerInput>) => send<AdminBanner>("PATCH", `/admin/banners/${id}`, body);
export const deleteBanner = (id: number) => send<void>("DELETE", `/admin/banners/${id}`);

export const listAuditLogs = (query: { actor_id?: number; action?: string; target_type?: string; from?: string; to?: string; page?: number; per_page?: number } = {}) =>
  list<AuditLog>("/admin/audit-logs", query);

export type { CategoryRef };

// ---------- products CSV import / export (API.md §12.1) ----------
export type ImportAction = "create" | "update" | "skip" | "error";
export type ImportIssue = { row: number; column: string; message: string };
export type ImportRow = {
  row: number;
  handle: string;
  name: string;
  variant: string;
  sku: string;
  sku_generated: boolean;
  price_satang: Satang | null;
  stock: number | null;
  action: ImportAction;
  product_action: ImportAction;
  changes: string[];
};
export type ImportSummary = {
  rows: number;
  products: number;
  products_create: number;
  products_update: number;
  products_skip: number;
  variants_create: number;
  variants_update: number;
  variants_skip: number;
  images_add: number;
  error_rows: number;
};
export type ImportReport = {
  dry_run: boolean;
  applied: boolean;
  encoding: "utf-8" | "utf-8-bom" | "utf-16" | "windows-874";
  summary: ImportSummary;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  rows: ImportRow[];
  truncated: boolean;
};

const csvNotInMocks = () => new ApiError(501, { code: "not_implemented", message: "โหมดข้อมูลตัวอย่างไม่รองรับไฟล์ CSV กรุณาเชื่อมต่อ API จริง" });

/**
 * POST /admin/products/import?dry_run=… — a failed real run answers 422 with the report in `error.details`
 * (nothing written); the report is returned in both cases.
 */
export async function importProductsCsv(file: File, dryRun: boolean): Promise<ImportReport> {
  if (USE_MOCKS) throw csvNotInMocks();
  const f = new FormData();
  f.set("file", file);
  try {
    return await multipart<ImportReport>(`/admin/products/import?dry_run=${dryRun}`, f);
  } catch (e) {
    const d = e instanceof ApiError ? (e.details as ImportReport | undefined) : undefined;
    if (d && Array.isArray(d.rows)) return d;
    throw e;
  }
}

/** Downloads an admin CSV (the web proxy drops Content-Disposition, so the file name is set here). */
export async function downloadAdminCsv(path: string, filename: string): Promise<void> {
  if (USE_MOCKS) throw csvNotInMocks();
  const res = await fetch(`/api/v1${path}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new ApiError(res.status, json?.error ?? { code: "internal", message: "ดาวน์โหลดไม่สำเร็จ" });
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const PRODUCTS_EXPORT_PATH = "/admin/products/export.csv";
export const PRODUCTS_TEMPLATE_PATH = "/admin/products/import/template.csv";
