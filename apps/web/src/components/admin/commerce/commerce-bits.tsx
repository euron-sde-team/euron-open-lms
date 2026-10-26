"use client";

import { useQuery } from "@tanstack/react-query";
import { collectPages } from "@open-lms/api-client";
import { Badge, cn } from "@open-lms/ui";
import type { AdminBundle, AdminCourseRow, OrderStatus, RefundStatus, SubscriptionStatus } from "@open-lms/types";
import { api } from "@/lib/api";
import { useAcademyMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import {
  CATALOG_STATUS_LABEL, CATALOG_STATUS_TONE, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, REFUND_STATUS_LABEL, REFUND_STATUS_TONE, SUBSCRIPTION_STATUS_LABEL, SUBSCRIPTION_STATUS_TONE, type CatalogStatus,
} from "./commerce-model";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}

export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  return <Badge tone={SUBSCRIPTION_STATUS_TONE[status]}>{SUBSCRIPTION_STATUS_LABEL[status]}</Badge>;
}

export function RefundStatusBadge({ status }: { status: RefundStatus }) {
  return <Badge tone={REFUND_STATUS_TONE[status]}>{REFUND_STATUS_LABEL[status]}</Badge>;
}

export function CatalogStatusBadge({ status }: { status: CatalogStatus }) {
  return <Badge tone={CATALOG_STATUS_TONE[status]}>{CATALOG_STATUS_LABEL[status]}</Badge>;
}

/** Orders and Subscriptions are one area: two words at the top, each its own route. */
export function OrdersViews({ value }: { value: "orders" | "subscriptions" }) {
  return (
    <UnderlineTabs
      label="Orders or subscriptions"
      value={value}
      className="mb-5"
      tabs={[
        { value: "orders", label: "Orders", href: "/admin/orders" },
        { value: "subscriptions", label: "Subscriptions", href: "/admin/orders/subscriptions" },
      ]}
    />
  );
}

/** The currencies the academy sells in (default first). */
export function useCurrencies() {
  const meta = useAcademyMeta();
  return { currencies: meta.data?.currencies ?? [], defaultCurrency: meta.data?.defaultCurrency ?? "USD", ready: !!meta.data || meta.isError, query: meta };
}

/** Every course (up to 500), for the bundle and coupon pickers. */
export function useAllCourses(enabled = true) {
  return useQuery({
    queryKey: qk.admin.list("courses", { picker: true }),
    queryFn: () => collectPages<AdminCourseRow>((cursor) => api().authoring.courses.list({ cursor, limit: 50 })),
    enabled,
    staleTime: 60_000,
  });
}

/** Every bundle (up to 500), for the coupon picker. */
export function useAllBundles(enabled = true) {
  return useQuery({
    queryKey: qk.admin.list("bundles", { picker: true }),
    queryFn: () => collectPages<AdminBundle>((cursor) => api().adminCommerce.bundles({ cursor, limit: 50 })),
    enabled,
    staleTime: 60_000,
  });
}

export function usePlansList(enabled = true) {
  return useQuery({ queryKey: qk.admin.list("plans"), queryFn: () => api().adminCommerce.plans(), enabled });
}

/** A monospace reference (order numbers, gateway ids, coupon codes). */
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[13px] tracking-tight", className)}>{children}</span>;
}
