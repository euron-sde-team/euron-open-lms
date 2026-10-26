import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { display, sans } from "./fonts";
import { Providers } from "@/lib/providers";
import { serverEnv } from "@/lib/runtime-env";
import { THEME_BOOT } from "@/lib/stores/theme";

// Per request: the product name and /env.js come from the container's environment,
// and the CSP nonce is per response.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const name = serverEnv().productName;
  return {
    title: { default: name, template: `%s | ${name}` },
    description: `${name}: courses you can finish. Video lessons, quizzes, graded projects and certificates, at your own pace.`,
    openGraph: { siteName: name, type: "website" },
    twitter: { card: "summary_large_image" },
    icons: { icon: "/icon.svg" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
      <head>
        {/* Applies the saved theme before first paint (no flash). */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {/* Runtime config (API URL, product name), parser-blocking so it runs before any
            client code reads it. Browsers hide nonce attributes from the DOM, hence the
            suppressed hydration warning. It is tiny and same-origin, so blocking is cheap. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/env.js" nonce={nonce} suppressHydrationWarning />
      </head>
      <body className="min-h-dvh font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
