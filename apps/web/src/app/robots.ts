import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/server-api";

/** Public pages are crawlable; private areas and the API are not. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await publicOrigin();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/learn", "/my-learning", "/checkout", "/notifications", "/account"] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
