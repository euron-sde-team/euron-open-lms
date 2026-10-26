/**
 * Server-only reads for metadata, JSON-LD and the sitemap. They call the API directly
 * (API_INTERNAL_URL, the same target the /api rewrite uses), signed out, and never
 * throw: a page still renders when the API is briefly unavailable.
 */
import { headers } from "next/headers";

const apiInternal = () => (process.env.API_INTERNAL_URL || "http://localhost:5026").replace(/\/+$/, "");

export async function serverGet<T>(path: string, revalidate = 300): Promise<T | null> {
  try {
    const res = await fetch(`${apiInternal()}/api${path}`, { next: { revalidate }, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** The public origin for absolute URLs: APP_WEB_URL when set, else the request's host. */
export async function publicOrigin(): Promise<string> {
  const fixed = process.env.APP_WEB_URL?.trim();
  if (fixed) return fixed.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3530";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** JSON for a <script type="application/ld+json">, safe to inline in HTML. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
