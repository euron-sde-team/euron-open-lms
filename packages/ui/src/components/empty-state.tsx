"use client";

import * as React from "react";
import { cn } from "../lib/cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14", className)}>
      {icon ? (
        <div className={cn("flex items-center justify-center rounded-full bg-muted text-muted-foreground", compact ? "size-10 [&_svg]:size-5" : "size-14 [&_svg]:size-6")}>
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-base")}>{title}</p>
        {description ? <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
