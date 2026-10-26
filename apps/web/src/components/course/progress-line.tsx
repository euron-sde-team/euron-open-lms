import { cn } from "@open-lms/ui";

/** "42% complete · 8 of 19 lessons" over a hairline track. Renders nothing before the learner starts. */
export function ProgressLine({ percent, completed, total, className, showEmpty }: { percent: number; completed?: number; total?: number; className?: string; showEmpty?: boolean }) {
  const value = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  if (value <= 0 && !showEmpty) return null;
  return (
    <div className={className}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ground-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label="Course progress">
        <div className={cn("h-full rounded-full transition-[width] duration-500", value >= 100 ? "bg-success" : "bg-brand")} style={{ width: `${value}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[12px] text-muted-foreground">
        <span className="font-semibold text-foreground">{value >= 100 ? "Completed" : `${value}% complete`}</span>
        {total ? (
          <span className="tabular-nums">
            {completed ?? 0} of {total} lessons
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** A small ring for curriculum rows: empty, partial or a check. */
export function ProgressRing({ percent, size = 18, className }: { percent: number; size?: number; className?: string }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, percent));
  if (value >= 100) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn("shrink-0 text-success", className)} aria-label="Completed">
        <circle cx={size / 2} cy={size / 2} r={size / 2} fill="currentColor" />
        <path d={`M ${size * 0.3} ${size * 0.52} l ${size * 0.14} ${size * 0.14} l ${size * 0.27} ${-size * 0.3}`} fill="none" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn("shrink-0 -rotate-90", className)} aria-label={value > 0 ? `${Math.round(value)}% watched` : "Not started"}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-border" strokeWidth={1.6} />
      {value > 0 ? <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-brand" strokeWidth={1.8} strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} strokeLinecap="round" /> : null}
    </svg>
  );
}
