/** Social preview cards (1200x630) drawn with next/og: no external fonts, images or calls. */
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export function ogCard(opts: { product: string; title: string; subtitle?: string | null; meta?: string | null; badge?: string | null; square?: boolean }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#f4f6f9", fontFamily: "sans-serif" }}>
        <div style={{ height: 170, display: "flex", background: "linear-gradient(120deg, #1257b8, #6f9fe0)" }} />
        <div style={{ display: "flex", flexDirection: "column", padding: "0 72px", marginTop: -90, flex: 1 }}>
          <div
            style={{
              width: 180,
              height: 180,
              borderRadius: opts.square ? 36 : 90,
              background: "#1257b8",
              border: "8px solid #ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontSize: 72,
              fontWeight: 700,
            }}
          >
            {initials(opts.title)}
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 28, gap: 18 }}>
            <div style={{ fontSize: 60, fontWeight: 700, color: "#111827" }}>{opts.title}</div>
            {opts.badge ? <div style={{ fontSize: 26, color: "#0f7a3d", background: "#dcf3e5", borderRadius: 999, padding: "6px 18px" }}>{opts.badge}</div> : null}
          </div>
          {opts.subtitle ? <div style={{ fontSize: 32, color: "#374151", marginTop: 12, maxWidth: 1050 }}>{opts.subtitle.slice(0, 110)}</div> : null}
          {opts.meta ? <div style={{ fontSize: 26, color: "#6b7280", marginTop: 10 }}>{opts.meta.slice(0, 90)}</div> : null}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 26, color: "#1257b8", fontWeight: 600, marginBottom: 44 }}>{opts.product}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
