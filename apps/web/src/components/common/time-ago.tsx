"use client";

import { Tooltip } from "@open-lms/ui";
import { fullTimestamp, relativeTime } from "@/lib/time";
import { useNow } from "@/lib/hooks/use-now";

export function TimeAgo({ value, className }: { value: string; className?: string }) {
  const now = useNow();
  return (
    <Tooltip content={fullTimestamp(value)}>
      <time dateTime={value} className={className} suppressHydrationWarning>
        {relativeTime(value, now)}
      </time>
    </Tooltip>
  );
}
