"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Award, X } from "lucide-react";
import { Button, IconButton } from "@open-lms/ui";

/** A short confetti burst on a canvas, a few dozen particles, skipped with reduced motion. */
export function ConfettiBurst() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const style = getComputedStyle(document.documentElement);
    const colors = ["--brand", "--star", "--success", "--primary"].map((v) => `hsl(${style.getPropertyValue(v).trim() || "188 85% 37%"})`);
    const particles = Array.from({ length: 70 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.3,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 9 - 3,
      size: 4 + Math.random() * 4,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)]!,
    }));
    const start = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const elapsed = t - start;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 1800);
      for (const p of particles) {
        p.vy += 0.25;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (elapsed < 1800) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-[70] size-full" />;
}

/** The calm moment when the course reaches 100%. */
export function CompletionBanner({ courseTitle, serial, certificateEnabled, onDismiss }: { courseTitle: string; serial: string | null; certificateEnabled: boolean; onDismiss: () => void }) {
  return (
    <div role="status" className="animate-rise border-b border-border bg-success-soft text-success-soft-foreground" data-testid="classroom-complete-banner">
      <ConfettiBurst />
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Award className="size-5 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 text-[14.5px]">
          <span className="font-semibold">You finished {courseTitle}.</span>{" "}
          {serial ? "Your certificate is ready." : certificateEnabled ? "Your certificate is being prepared." : "Every lesson is complete."}
        </p>
        {serial ? (
          <Button asChild size="sm" variant="primary">
            <Link href={`/verify/${encodeURIComponent(serial)}`} data-testid="classroom-certificate-link">
              View certificate
            </Link>
          </Button>
        ) : certificateEnabled ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/my-learning?tab=certificates">My certificates</Link>
          </Button>
        ) : null}
        <IconButton label="Dismiss" size="sm" onClick={onDismiss}>
          <X />
        </IconButton>
      </div>
    </div>
  );
}
