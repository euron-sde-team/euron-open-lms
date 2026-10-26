/**
 * The hand-off from a hosted checkout back into the mobile app. Stripe returns the buyer to
 * an https page on this origin (`/checkout/app-return?app=openlms&orderId=...`), which
 * opens `<app>://checkout/return?orderId=...` only when `app` is one of the schemes the API
 * allows (MOBILE_RETURN_SCHEMES, sent in /api/meta). Anything else gets the fallback page
 * without an app link, so this page can never become an open redirect. Pure, tested in
 * test/checkout/app-return.test.tsx.
 */
export const DEFAULT_APP_SCHEMES: readonly string[] = ["openlms"];

const SCHEME = /^[a-z][a-z0-9+.-]{0,31}$/;
const ORDER_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const NEVER = new Set(["http", "https", "javascript", "data", "file", "blob", "about", "vbscript"]);

export interface AppReturnQuery {
  app: string | null;
  orderId: string | null;
  canceled: boolean;
}

type Search = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** The query Stripe sends back: our `app`, plus the `orderId` and `canceled=1` checkout appended. */
export function parseAppReturn(sp: Search): AppReturnQuery {
  const orderId = first(sp.orderId)?.trim() ?? null;
  return { app: first(sp.app)?.trim().toLowerCase() || null, orderId: orderId && ORDER_ID.test(orderId) ? orderId : null, canceled: first(sp.canceled) === "1" };
}

/** Whether `app` is a scheme the API lets checkout return to. */
export function isAllowedScheme(app: string | null, allowed: readonly string[]): app is string {
  return !!app && SCHEME.test(app) && !NEVER.has(app) && allowed.map((s) => s.toLowerCase()).includes(app);
}

/** The app link to open, or null when the scheme is not allowed or the order id is missing. */
export function appReturnLink(q: AppReturnQuery, allowed: readonly string[]): string | null {
  if (!isAllowedScheme(q.app, allowed) || !q.orderId) return null;
  return `${q.app}://checkout/return?orderId=${encodeURIComponent(q.orderId)}${q.canceled ? "&canceled=1" : ""}`;
}
