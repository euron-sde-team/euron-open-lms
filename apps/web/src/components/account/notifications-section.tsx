"use client";

import { useMutation } from "@tanstack/react-query";
import { EMAIL_CATEGORIES, type EmailCategory, type Me } from "@open-lms/types";
import { Switch, toast } from "@open-lms/ui";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { AccountSection, SectionTitle } from "./section";

export const EMAIL_CATEGORY_COPY: Record<EmailCategory, { title: string; body: string }> = {
  LEARNING: { title: "Learning", body: "Graded assignments, new certificates, and nudges to finish a course you started." },
  COMMUNITY: { title: "Questions and reviews", body: "Replies to your questions, accepted answers and replies to your reviews." },
  BILLING_REMINDERS: { title: "Billing reminders", body: "Notice before a renewal or a trial ends, and when a payment needs attention." },
  PRODUCT_UPDATES: { title: "News and new courses", body: "Occasional news about new courses and changes to courses you are taking." },
};

export function NotificationsSection() {
  const me = useMe();
  const { setUser } = useAuth();
  const save = useMutation({
    mutationFn: (patch: Partial<Record<EmailCategory, boolean>>) => api().users.updateMe({ emailPreferences: patch }),
    onMutate: (patch) => {
      const prev: Me = me;
      setUser({ ...me, emailPreferences: { ...me.emailPreferences, ...patch } as Me["emailPreferences"] });
      return { prev };
    },
    onSuccess: (m) => setUser(m),
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) setUser(ctx.prev);
      toast.error({ title: "Could not update your email settings" });
    },
    meta: { silent: true },
  });
  return (
    <div>
      <SectionTitle title="Notifications" lead="Choose which emails you get. In-app notifications stay on." />
      <AccountSection title="Email" description="Receipts, invoices and security emails (sign-in codes, password changes) are always sent.">
        <ul className="max-w-[620px] divide-y divide-border border-y border-border">
          {EMAIL_CATEGORIES.map((c) => {
            const copy = EMAIL_CATEGORY_COPY[c];
            const on = me.emailPreferences?.[c] ?? true;
            return (
              <li key={c} className="flex items-start justify-between gap-6 py-4">
                <label htmlFor={`email-${c}`} className="min-w-0 cursor-pointer">
                  <span className="block text-[14.5px] font-semibold">{copy.title}</span>
                  <span className="mt-0.5 block text-[13.5px] text-muted-foreground">{copy.body}</span>
                </label>
                <Switch id={`email-${c}`} checked={on} onCheckedChange={(v) => save.mutate({ [c]: v })} data-testid={`email-pref-${c}`} />
              </li>
            );
          })}
        </ul>
      </AccountSection>
    </div>
  );
}
