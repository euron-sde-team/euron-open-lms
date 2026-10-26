"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "../lib/cn";
import { avatarColor, initials } from "../lib/avatar";

const sizes = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-20 text-2xl",
  "2xl": "size-32 text-4xl",
} as const;

export type AvatarSize = keyof typeof sizes;

export interface AvatarProps {
  name: string;
  /** Stable seed for the fallback colour (user id or username). Defaults to the name. */
  seed?: string;
  src?: string | null;
  size?: AvatarSize;
  /** Rounded square (branding) instead of a circle (people). */
  shape?: "circle" | "square";
  className?: string;
}

export function Avatar({ name, seed, src, size = "md", shape = "circle", className }: AvatarProps) {
  const radius = shape === "circle" ? "rounded-full" : "rounded-[22%]";
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <AvatarPrimitive.Root
        className={cn("inline-flex items-center justify-center overflow-hidden align-middle", radius, sizes[size])}
      >
        {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
        <AvatarPrimitive.Fallback
          delayMs={src ? 400 : undefined}
          className="flex size-full select-none items-center justify-center font-semibold text-white"
          style={{ backgroundColor: avatarColor(seed ?? name) }}
          aria-hidden
          data-testid="avatar-fallback"
        >
          {initials(name)}
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
      <span className="sr-only">{name}</span>
    </span>
  );
}

/** Overlapping row of avatars (attendees, group participants). */
export function AvatarStack({ people, max = 4, size = "sm" }: { people: { id: string; name: string; src?: string | null }[]; max?: number; size?: AvatarSize }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="flex items-center -space-x-2">
      {shown.map((p) => (
        <Avatar key={p.id} name={p.name} seed={p.id} src={p.src} size={size} className="rounded-full ring-2 ring-card" />
      ))}
      {extra > 0 ? (
        <span className={cn("inline-flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-card", sizes[size])}>
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
