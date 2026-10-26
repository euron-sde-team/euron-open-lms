"use client";

/**
 * Generated course cover. When a course has no uploaded cover it still gets a
 * distinct, calm one: a duotone keyed off the course's first category (so a
 * category reads as one family), a quiet arc motif, and the title set in the
 * display face. No network image, so it paints instantly.
 */
import { useState } from "react";
import { cn } from "@open-lms/ui";

interface Palette {
  from: string;
  to: string;
  line: string;
}

/** Ten duotones that all carry white type at AA. */
const PALETTES: Palette[] = [
  { from: "#0A6B78", to: "#0E99AD", line: "#BFF3FA" },
  { from: "#1E3A8A", to: "#2563EB", line: "#C7D7FE" },
  { from: "#3B1C7A", to: "#6D28D9", line: "#DDD6FE" },
  { from: "#064E3B", to: "#059669", line: "#A7F3D0" },
  { from: "#7C2D12", to: "#C2410C", line: "#FED7AA" },
  { from: "#881337", to: "#BE123C", line: "#FECDD3" },
  { from: "#0F172A", to: "#334155", line: "#CBD5E1" },
  { from: "#075985", to: "#0284C7", line: "#BAE6FD" },
  { from: "#78350F", to: "#B45309", line: "#FDE68A" },
  { from: "#18181B", to: "#0B7F90", line: "#A5F3FC" },
];

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function paletteFor(seed: string): Palette {
  return PALETTES[hashString(seed) % PALETTES.length]!;
}

export function GeneratedCover({ title, seed, kicker, className, size = "md" }: { title: string; seed: string; kicker?: string | null; className?: string; size?: "sm" | "md" | "lg" }) {
  const p = paletteFor(seed);
  const variant = hashString(`${seed}:v`) % 3;
  return (
    <div className={cn("relative isolate flex size-full flex-col justify-end overflow-hidden text-white", className)} style={{ background: `linear-gradient(135deg, ${p.from} 0%, ${p.to} 100%)` }} aria-hidden>
      <svg className="absolute inset-0 -z-10 size-full opacity-[0.22]" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice">
        {variant === 0 ? (
          [18, 30, 42, 54, 66].map((r) => <circle key={r} cx="136" cy="14" r={r} fill="none" stroke={p.line} strokeWidth="0.8" />)
        ) : variant === 1 ? (
          [0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M ${-10 + i * 14} 100 Q ${60 + i * 6} ${30 - i * 3} 170 ${8 + i * 9}`} fill="none" stroke={p.line} strokeWidth="0.8" />)
        ) : (
          [0, 1, 2, 3, 4].map((i) => <rect key={i} x={102 - i * 9} y={-8 + i * 9} width={70} height={70} rx={14} fill="none" stroke={p.line} strokeWidth="0.8" transform={`rotate(${12 + i * 3} 130 30)`} />)
        )}
      </svg>
      <div className={cn("p-4", size === "lg" && "p-6", size === "sm" && "p-3")}>
        {kicker ? <p className={cn("mb-1 font-semibold uppercase tracking-[0.12em] text-white/80", size === "sm" ? "text-[9px]" : "text-[10.5px]")}>{kicker}</p> : null}
        <p className={cn("line-clamp-3 text-balance font-display font-semibold leading-[1.08] tracking-[-0.02em]", size === "lg" ? "text-[30px]" : size === "sm" ? "text-[15px]" : "text-[20px]")}>{title}</p>
      </div>
    </div>
  );
}

/** The uploaded cover when there is one (falls back to the generated one if it fails to load). */
export function CourseCover({ src, title, seed, kicker, className, size, rounded = "top" }: { src: string | null; title: string; seed: string; kicker?: string | null; className?: string; size?: "sm" | "md" | "lg"; rounded?: "top" | "all" | "none" }) {
  const [failed, setFailed] = useState(false);
  const radius = rounded === "top" ? "rounded-t-card" : rounded === "all" ? "rounded-card" : "";
  return (
    <div className={cn("relative aspect-video w-full overflow-hidden bg-muted", radius, className)}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
      ) : (
        <GeneratedCover title={title} seed={seed} kicker={kicker} size={size} className="transition-transform duration-500 group-hover:scale-[1.03]" />
      )}
    </div>
  );
}
