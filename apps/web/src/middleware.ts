import { NextResponse, type NextRequest } from "next/server";
import { mediaOrigins } from "@/lib/runtime-env";

/**
 * Per-request Content-Security-Policy with a nonce. Next reads the nonce from the
 * request's CSP header and stamps it on its own scripts; `strict-dynamic` lets those
 * load the app chunks (and the Razorpay Checkout script the checkout page inserts).
 * Origins come from the runtime environment, so one image fits every deployment:
 *   MEDIA_ORIGINS  uploads and signed media (S3, the local emulator, a CDN)
 *   VIDEO_ORIGINS  where lecture video plays from: the EVS API origin and its media or
 *                  CDN origin, plus any host you use for HLS/MP4 lectures. hls.js fetches
 *                  playlists and segments, so they need connect-src as well as media-src.
 * Razorpay's hosted checkout runs in frames on razorpay.com; Stripe Checkout is a full
 * redirect and needs nothing here.
 */
const RAZORPAY = "https://checkout.razorpay.com https://api.razorpay.com https://*.razorpay.com";

export function buildCsp(opts: { nonce: string; dev: boolean; media: string[]; video: string[] }): string {
  const media = opts.media.join(" ");
  const video = opts.video.join(" ");
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    // Radix positions popovers with inline styles; styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${media} ${video} https://*.razorpay.com`.replace(/\s+/g, " ").trim(),
    `media-src 'self' blob: ${media} ${video}`.replace(/\s+/g, " ").trim(),
    "font-src 'self' data:",
    // Uploads PUT straight to the storage origin; the player fetches playlists and segments.
    `connect-src 'self' ${media} ${video} ${RAZORPAY}${opts.dev ? " ws: wss:" : ""}`.replace(/\s+/g, " ").trim(),
    // YouTube lectures embed from the no-cookie host; PDF lectures render in a frame from
    // the media origin; Razorpay Checkout opens in frames.
    `frame-src 'self' https://www.youtube-nocookie.com ${media} ${RAZORPAY}`.replace(/\s+/g, " "),
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // Stripe Checkout and the local payment stub are reached by redirect, not by form posts.
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];
  return directives.join("; ");
}

export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV !== "production",
    media: mediaOrigins(process.env.MEDIA_ORIGINS),
    video: mediaOrigins(process.env.VIDEO_ORIGINS),
  });

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|env.js|icon.svg|favicon.ico).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
