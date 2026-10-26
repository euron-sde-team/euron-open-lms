import type { Money } from "@open-lms/types";
import { cn } from "@open-lms/ui";
import { formatMoney, savingPercent } from "@/lib/money";

/** The price as type: the amount, a struck-through "was" price, and the saving. */
export function PriceTag({ price, compareAt, size = "md", className }: { price: Money | null; compareAt?: Money | null; size?: "sm" | "md" | "lg"; className?: string }) {
  if (!price) return null;
  const saving = savingPercent(price, compareAt);
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span className={cn("font-display font-semibold tracking-[-0.01em] text-foreground tabular-nums", size === "lg" ? "text-[30px]" : size === "sm" ? "text-[15px]" : "text-[18px]")}>{formatMoney(price, { compact: true })}</span>
      {saving && compareAt ? (
        <>
          <span className="text-[13px] text-subtle-foreground line-through tabular-nums">{formatMoney(compareAt, { compact: true })}</span>
          <span className="text-[12.5px] font-semibold text-success">{saving}% off</span>
        </>
      ) : null}
    </span>
  );
}
