import path from "node:path";
import type { NextConfig } from "next";

/**
 * Same-origin deployment: the browser only ever talks to this origin. In local
 * development the rewrite below proxies /api to the API; in production the load
 * balancer routes /api to the API before it reaches Next, so the refresh cookie
 * (scoped to /api/auth) stays first-party.
 */
const apiInternal = (process.env.API_INTERNAL_URL || "http://localhost:5026").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // One self-contained server bundle (`node apps/web/server.js`), the unit the image ships.
  output: "standalone",
  // In a monorepo the standalone trace must start at the repo root.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // The shared packages ship TypeScript source; Next compiles them in place.
  transpilePackages: ["@open-lms/ui", "@open-lms/api-client", "@open-lms/types"],
  poweredByHeader: false,
  reactStrictMode: true,
  // Media URLs are short-lived signed URLs from the API's storage (S3 or the
  // local emulator); optimising them would cache past their expiry.
  images: { unoptimized: true },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiInternal}/api/:path*` },
    ];
  },
  // Static security headers. The Content-Security-Policy is set per request in
  // middleware.ts, because it carries a nonce and runtime media origins.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Razorpay Checkout may use the Payment Request API from its frame; the player needs fullscreen.
          { key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://api.razorpay.com"), fullscreen=(self)' },
          // UPI and wallet flows in Razorpay Checkout can open a popup that must talk back.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
    ];
  },
};

export default nextConfig;
