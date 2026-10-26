"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Award, BadgeCheck, CircleAlert, CreditCard, GraduationCap, MessageCircle, MessageSquareReply, Receipt, RotateCcw, Sparkles, Star, type LucideIcon } from "lucide-react";
import { cn } from "@open-lms/ui";
import type { Notification, NotificationCounts, NotificationType } from "@open-lms/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { TimeAgo } from "@/components/common/time-ago";

/** What each notification says. `snippet` (usually the course title) follows it. */
export const NOTIFICATION_COPY: Record<NotificationType, { text: string; icon: LucideIcon; tone: "primary" | "success" | "warning" | "danger" }> = {
  ORDER_PAID: { text: "Payment received. You're enrolled", icon: Receipt, tone: "success" },
  ORDER_FAILED: { text: "Your payment did not go through", icon: CircleAlert, tone: "danger" },
  REFUND_ISSUED: { text: "Your refund was issued", icon: RotateCcw, tone: "primary" },
  ENROLLMENT_GRANTED: { text: "You were given access to a course", icon: GraduationCap, tone: "success" },
  ENROLLMENT_REVOKED: { text: "Your access to a course ended", icon: CircleAlert, tone: "warning" },
  SUBMISSION_REVIEWED: { text: "Your assignment was reviewed", icon: BadgeCheck, tone: "primary" },
  CERTIFICATE_ISSUED: { text: "You earned a certificate", icon: Award, tone: "success" },
  SUBSCRIPTION_RENEWED: { text: "Your subscription renewed", icon: CreditCard, tone: "primary" },
  SUBSCRIPTION_PAYMENT_FAILED: { text: "We could not renew your subscription", icon: CircleAlert, tone: "danger" },
  SUBSCRIPTION_CANCELED: { text: "Your subscription was cancelled", icon: CreditCard, tone: "warning" },
  QA_REPLY: { text: "New answer to your question", icon: MessageCircle, tone: "primary" },
  QA_ACCEPTED: { text: "Your answer was marked as accepted", icon: MessageSquareReply, tone: "success" },
  REVIEW_REPLY: { text: "The instructor replied to your review", icon: Star, tone: "primary" },
  COURSE_UPDATED: { text: "A course you take has new content", icon: Sparkles, tone: "primary" },
};

const TONE = { primary: "text-primary", success: "text-success", warning: "text-warning", danger: "text-danger" } as const;

export function NotificationItem({ n, compact, onNavigate }: { n: Notification; compact?: boolean; onNavigate?: () => void }) {
  const qc = useQueryClient();
  const copy = NOTIFICATION_COPY[n.type] ?? { text: "Something happened", icon: Sparkles, tone: "primary" as const };
  const Icon = copy.icon;
  const read = useMutation({
    mutationFn: () => api().notifications.read(n.id),
    onMutate: () => {
      if (!n.readAt) qc.setQueryData<NotificationCounts>(qk.counts, (c) => (c ? { notifications: Math.max(0, c.notifications - 1) } : c));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notificationsAll }),
    meta: { silent: true },
  });
  return (
    <Link
      href={n.href}
      onClick={() => {
        if (!n.readAt) read.mutate();
        onNavigate?.();
      }}
      data-testid="notification-item"
      data-unread={n.readAt ? undefined : ""}
      className={cn("group flex items-start gap-3 rounded-xl px-3 transition-colors hover:bg-muted", compact ? "py-2.5" : "py-3.5")}
    >
      <Icon className={cn("mt-0.5 size-[18px] shrink-0", TONE[copy.tone])} strokeWidth={2} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[14px] leading-snug", n.readAt ? "text-muted-foreground" : "text-foreground")}>
          <span className={n.readAt ? "" : "font-semibold"}>{copy.text}</span>
          {n.snippet ? <span className="text-muted-foreground"> · {n.snippet}</span> : null}
        </span>
        <TimeAgo value={n.createdAt} className="mt-0.5 block text-[12.5px] text-subtle-foreground" />
      </span>
      {n.readAt ? null : <span aria-label="Unread" className="mt-2 size-2 shrink-0 rounded-full bg-brand" />}
    </Link>
  );
}
