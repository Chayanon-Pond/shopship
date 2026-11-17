/**
 * NEXT_PUBLIC_USE_MOCKS=true backend: answers API calls from the golden
 * fixtures (docs/fixtures -> `npm run sync:fixtures` -> ./fixtures).
 * Unknown routes throw ApiError 501 so missing mocks are obvious.
 * Owner: coordinator; agents may ADD routes here for new fixtures.
 */
import { ApiError, type Query } from "@/lib/api/client";
import { adminMock } from "@/lib/admin/mock-db";
import adminPromotions from "./fixtures/admin-promotion-list.json";
import banners from "./fixtures/banners.json";
import campaign from "./fixtures/campaign-active.json";
import cart from "./fixtures/cart.json";
import quoteExclusive from "./fixtures/cart-quote-exclusive-loses.json";
import quoteFlash from "./fixtures/cart-quote-flash.json";
import quoteInvalid from "./fixtures/cart-quote-invalid-seasonal.json";
import quoteTrade from "./fixtures/cart-quote-trade-code-freeship.json";
import categories from "./fixtures/categories.json";
import flash from "./fixtures/flash-sale-current.json";
import meAdmin from "./fixtures/me-admin.json";
import me from "./fixtures/me.json";
import offers from "./fixtures/offers.json";
import orderDetail from "./fixtures/order-detail.json";
import orderList from "./fixtures/order-list.json";
import charge from "./fixtures/payment-charge-promptpay.json";
import productDetail from "./fixtures/product-detail.json";
import productList from "./fixtures/product-list.json";
import reviews from "./fixtures/product-reviews.json";

const quotesByCode: Record<string, unknown> = {
  TRADE5: quoteTrade,
  SAVE10X: quoteExclusive,
  SONGKRAN26: quoteInvalid,
};

type Route = [method: string, pattern: RegExp, respond: (m: RegExpMatchArray, q?: Query, body?: unknown) => unknown];

const routes: Route[] = [
  ["GET", /^\/categories$/, () => categories],
  ["GET", /^\/products$/, () => productList],
  ["GET", /^\/products\/[^/]+\/reviews$/, () => reviews],
  ["GET", /^\/products\/[^/]+\/related$/, () => ({ data: productList.data.slice(0, 4) })],
  ["GET", /^\/products\/[^/]+$/, () => productDetail],
  ["GET", /^\/campaigns\/active$/, () => campaign],
  ["GET", /^\/banners$/, () => banners],
  ["GET", /^\/flash-sales\/current$/, () => flash],
  ["GET", /^\/offers$/, () => offers],
  // ?mock_role=admin on any page switches /auth/me to the owner fixture
  ["GET", /^\/auth\/me$/, () => (mockRole() === "admin" ? meAdmin : me)],
  ["POST", /^\/auth\/login$/, () => (mockRole() === "admin" ? meAdmin : me)],
  ["POST", /^\/auth\/logout$/, () => undefined],
  ["GET", /^\/cart$/, () => cart],
  [
    "POST",
    /^\/cart\/quote$/,
    (_m, _q, body) => {
      const code = String((body as { coupon_code?: string } | undefined)?.coupon_code ?? "").toUpperCase();
      return quotesByCode[code] ?? quoteFlash;
    },
  ],
  ["GET", /^\/orders$/, () => orderList],
  ["GET", /^\/orders\/[^/]+$/, () => orderDetail],
  ["POST", /^\/orders$/, () => orderDetail],
  ["POST", /^\/payments\/charges$/, () => charge],
  ["GET", /^\/payments\/charges\/[^/]+$/, () => charge],
  // admin agent: stateful back-office mock (web/src/lib/admin/mock-db.ts); listed first so it wins over the static fixture below
  ...(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map(
    (method): Route => [method, /^\/admin\/.+/, (m, q, body) => adminMock(method, m[0], q, body)],
  ),
  ["GET", /^\/admin\/promotions$/, () => adminPromotions],
];

function mockRole(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("mock_role");
}

export async function mockRequest<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T> {
  for (const [m, re, respond] of routes) {
    if (m !== method) continue;
    const match = path.match(re);
    if (match) return structuredClone(respond(match, query, body)) as T;
  }
  throw new ApiError(501, { code: "not_implemented", message: `ไม่มี mock สำหรับ ${method} ${path}` });
}
