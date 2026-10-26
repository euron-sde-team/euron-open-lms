/**
 * Runtime configuration.
 *
 * Next inlines NEXT_PUBLIC_* at BUILD time, but one image ships to every
 * environment. So the server renders `/env.js` from its own environment at
 * request time (app/env.js/route.ts), the root layout loads it before any
 * client code runs, and everything reads configuration through these getters.
 *
 * Precedence: globalThis.__LMS_ENV (runtime) > NEXT_PUBLIC_* (build time,
 * handy for `next dev`) > the defaults below.
 */
// Kept free of imports: middleware (edge runtime) loads this module.
const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export interface RuntimeEnv {
  /** Product name shown in the header wordmark, titles and copy. */
  productName: string;
  /** API base including /api. Same origin by default. */
  apiUrl: string;
}

export const DEFAULT_ENV: RuntimeEnv = {
  productName: "Euron Open LMS",
  apiUrl: "/api",
};

declare global {
  var __LMS_ENV: Partial<RuntimeEnv> | undefined;
}

/** Server-side resolution, used by the env.js route and by server components. */
export function serverEnv(env: Record<string, string | undefined> = process.env): RuntimeEnv {
  return {
    productName: nonEmpty(env.PRODUCT_NAME) ?? nonEmpty(env.NEXT_PUBLIC_PRODUCT_NAME) ?? DEFAULT_ENV.productName,
    apiUrl: nonEmpty(env.PUBLIC_API_URL) ?? nonEmpty(env.NEXT_PUBLIC_API_URL) ?? DEFAULT_ENV.apiUrl,
  };
}

export function runtimeEnv(): RuntimeEnv {
  // During SSR read the process env directly so server and client renders agree.
  if (typeof window === "undefined") return serverEnv();
  const injected = globalThis.__LMS_ENV;
  return {
    productName: nonEmpty(injected?.productName) ?? nonEmpty(process.env.NEXT_PUBLIC_PRODUCT_NAME) ?? DEFAULT_ENV.productName,
    apiUrl: nonEmpty(injected?.apiUrl) ?? nonEmpty(process.env.NEXT_PUBLIC_API_URL) ?? DEFAULT_ENV.apiUrl,
  };
}

export const productName = () => runtimeEnv().productName;

/** Media origins for the CSP (S3 bucket, the local emulator, a CDN). */
export function mediaOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/[^\s/]+$/i.test(s.replace(/\/+$/, "")))
    .map((s) => s.replace(/\/+$/, ""));
}
