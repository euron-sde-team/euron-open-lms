"use client";

import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { Avatar, Tooltip, cn, type AvatarSize } from "@open-lms/ui";
import type { UserSummary } from "@open-lms/types";

/** An instructor's public page. Usernames are lowercase ASCII with hyphens, but encode anyway. */
export const instructorHref = (username: string) => `/instructors/${encodeURIComponent(username)}`;

type AvatarUser = Pick<UserSummary, "id" | "displayName" | "avatarUrl" | "username">;

export function UserAvatar({ user, size = "md", className, href }: { user: AvatarUser; size?: AvatarSize; className?: string; href?: string }) {
  const av = <Avatar name={user.displayName} seed={user.id} src={user.avatarUrl} size={size} className={className} />;
  if (!href) return av;
  return (
    <Link href={href} className="shrink-0 rounded-full focus-visible:ring-2" tabIndex={-1} aria-hidden>
      {av}
    </Link>
  );
}

/** A small mark next to staff names in Q&A and reviews. */
export function StaffMark({ label = "Course staff", className }: { label?: string; className?: string }) {
  return (
    <Tooltip content={label}>
      <span className={cn("inline-flex text-primary", className)} aria-label={label}>
        <BadgeCheck className="size-3.5" />
      </span>
    </Tooltip>
  );
}

/** The second line under a name: the headline, else the handle. */
export function userTagline(user: Pick<UserSummary, "headline" | "username">): string {
  return user.headline ?? `@${user.username}`;
}
