import { Star } from "lucide-react";
import { cn } from "@open-lms/ui";

/** Five stars filled to the rating (halves rounded to the nearest half). */
export function Stars({ value, size = 14, className }: { value: number; size?: number; className?: string }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = rounded >= i ? 1 : rounded >= i - 0.5 ? 0.5 : 0;
        return (
          <span key={i} className="relative inline-flex" style={{ width: size, height: size }}>
            <Star className="absolute inset-0 text-border" style={{ width: size, height: size }} fill="currentColor" strokeWidth={0} />
            {fill > 0 ? (
              <span className="absolute inset-0 overflow-hidden" style={{ width: fill === 1 ? size : size / 2 }}>
                <Star className="text-star" style={{ width: size, height: size }} fill="currentColor" strokeWidth={0} />
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** "4.7 ★★★★★ (128)" in one quiet line. */
export function RatingLine({ rating, className }: { rating: { average: number; count: number } | null; className?: string }) {
  if (!rating || rating.count === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px]", className)} aria-label={`Rated ${rating.average.toFixed(1)} out of 5 from ${rating.count} reviews`}>
      <span className="font-semibold text-foreground tabular-nums">{rating.average.toFixed(1)}</span>
      <Stars value={rating.average} size={13} />
      <span className="text-subtle-foreground tabular-nums">({rating.count.toLocaleString()})</span>
    </span>
  );
}
