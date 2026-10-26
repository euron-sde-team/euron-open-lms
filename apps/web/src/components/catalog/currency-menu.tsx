"use client";

import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger, cn } from "@open-lms/ui";
import { useDisplayCurrency } from "@/lib/currency";

function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The display currency picker. Hidden unless the academy sells in more than one currency. */
export function CurrencyMenu({ className }: { className?: string }) {
  const { currency, currencies, setCurrency } = useDisplayCurrency();
  if (currencies.length < 2 || !currency) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("inline-flex h-10 items-center gap-1 rounded-md px-2 text-[14px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground", className)}
          aria-label={`Prices in ${currencyName(currency)}. Change currency`}
          data-testid="currency-menu"
        >
          {currency}
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Show prices in</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={currency} onValueChange={setCurrency}>
          {currencies.map((c) => (
            <DropdownMenuRadioItem key={c} value={c} data-testid={`currency-${c}`}>
              <span className="font-semibold tabular-nums">{c}</span>
              <span className="text-muted-foreground">{currencyName(c)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
