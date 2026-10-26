"use client";

import { cn } from "../lib/cn";

const sizes = { sm: "size-4 border-2", md: "size-5 border-2", lg: "size-8 border-[3px]" } as const;

export function Spinner({ size = "md", className, label = "Loading" }: { size?: keyof typeof sizes; className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-block animate-spin rounded-full border-current border-r-transparent text-primary", sizes[size], className)}
    />
  );
}
