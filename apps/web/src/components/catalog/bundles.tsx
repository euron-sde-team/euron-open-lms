"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import type { BundleCard as Bundle } from "@open-lms/types";
import { Button, EmptyState, Skeleton } from "@open-lms/ui";
import { CourseCard, CourseCardSkeleton, CourseGrid } from "@/components/course/course-card";
import { CourseCover } from "@/components/course/course-cover";
import { PriceTag } from "@/components/course/price-tag";
import { ErrorState } from "@/components/common/states";
import { Page, PageHeader } from "@/components/shell/layouts";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { checkoutHref, loginHref } from "@/lib/course-access";
import { useDisplayCurrency } from "@/lib/currency";
import { usePagedList } from "@/lib/hooks/queries";
import { useSaveCourse } from "@/lib/hooks/use-save-course";
import { formatMoney, savingPercent } from "@/lib/money";
import { qk } from "@/lib/query-keys";

export const bundleHref = (slug: string) => `/bundles/${encodeURIComponent(slug)}`;

/** "Save 30% on buying separately" when the bundle is cheaper. */
function savingLine(b: Pick<Bundle, "price" | "separately">): string | null {
  const pct = savingPercent(b.price, b.separately);
  return pct && b.separately ? `${formatMoney(b.separately, { compact: true })} separately, you save ${pct}%` : null;
}

export function BundleCard({ bundle }: { bundle: Bundle }) {
  const saving = savingLine(bundle);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-card bg-card shadow-card transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-card-hover" data-testid="bundle-card">
      <Link href={bundleHref(bundle.slug)} className="absolute inset-0 z-10 rounded-card focus-visible:ring-2 focus-visible:ring-ring" aria-label={bundle.title} />
      <CourseCover src={bundle.coverUrl} title={bundle.title} seed={`bundle:${bundle.slug}`} kicker="Bundle" />
      <div className="flex flex-1 flex-col gap-1.5 p-4 pt-3.5">
        <h3 className="line-clamp-2 font-display text-[17px] font-semibold leading-snug">{bundle.title}</h3>
        <p className="line-clamp-2 text-[13px] text-muted-foreground">{bundle.description}</p>
        <p className="text-[12.5px] text-subtle-foreground">{bundle.courseCount} courses</p>
        <div className="mt-auto pt-2">
          {bundle.price ? <PriceTag price={bundle.price} size="sm" /> : <p className="text-[14px] font-semibold">Not on sale in your currency</p>}
          {saving ? <p className="mt-0.5 text-[12.5px] text-success">{saving}</p> : null}
        </div>
      </div>
    </article>
  );
}

/** /bundles */
export function BundlesPage() {
  const { currency, ready } = useDisplayCurrency();
  const { status } = useAuth();
  const list = usePagedList<Bundle>({
    queryKey: [...qk.bundles, currency ?? ""],
    fetchPage: (cursor) => api().catalog.bundles({ cursor, currency, limit: 24 }),
    enabled: ready && status !== "loading",
  });
  return (
    <Page>
      <PageHeader title="Bundles" lead="Several courses together, for less than buying them one by one." />
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <CourseGrid>
          {Array.from({ length: 4 }, (_, i) => (
            <CourseCardSkeleton key={i} />
          ))}
        </CourseGrid>
      ) : list.items.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="No bundles on sale right now"
          description="Every course is still available on its own."
          action={
            <Button asChild variant="outline">
              <Link href="/courses">Browse courses</Link>
            </Button>
          }
        />
      ) : (
        <>
          <CourseGrid>
            {list.items.map((b) => (
              <BundleCard key={b.id} bundle={b} />
            ))}
          </CourseGrid>
          {list.hasNextPage ? (
            <div ref={list.sentinelRef} className="flex justify-center pt-10">
              <Button variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                Load more bundles
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Page>
  );
}

/** /bundles/[slug] */
export function BundlePage({ slug }: { slug: string }) {
  const { currency, ready } = useDisplayCurrency();
  const { status } = useAuth();
  const { toggle } = useSaveCourse();
  const q = useQuery({ queryKey: qk.bundle(slug, currency), queryFn: () => api().catalog.bundle(slug, currency), enabled: ready && status !== "loading" });

  if (q.isError) {
    return (
      <Page>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );
  }
  if (!q.data) {
    return (
      <Page>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-11 w-2/3" />
        <Skeleton className="mt-3 h-4 w-1/2" />
        <CourseGrid className="mt-10">
          {Array.from({ length: 3 }, (_, i) => (
            <CourseCardSkeleton key={i} />
          ))}
        </CourseGrid>
      </Page>
    );
  }
  const b = q.data;
  const saving = savingLine(b);
  const path = bundleHref(b.slug);
  return (
    <Page>
      <nav aria-label="Breadcrumb" className="mb-4 text-[13px] text-muted-foreground">
        <Link href="/bundles" className="hover:text-foreground">
          Bundles
        </Link>
      </nav>
      <div className="grid gap-8 border-b border-border pb-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
        <div className="min-w-0">
          <h1 className="text-balance font-display text-[34px] font-semibold leading-[1.06] tracking-[-0.025em] sm:text-[44px]" data-testid="bundle-title">
            {b.title}
          </h1>
          <p className="mt-4 max-w-2xl whitespace-pre-line text-[16px] leading-relaxed text-muted-foreground">{b.description}</p>
          <p className="mt-4 text-[13.5px] text-muted-foreground">{b.courseCount} courses, yours to keep</p>
        </div>
        <div className="space-y-3">
          {b.viewerOwnsAll ? (
            <>
              <p className="text-[14.5px] font-semibold">You already have every course in this bundle.</p>
              <Button asChild variant="outline" block>
                <Link href="/my-learning">Go to my learning</Link>
              </Button>
            </>
          ) : b.price ? (
            <>
              <PriceTag price={b.price} compareAt={b.separately} size="lg" />
              {saving ? <p className="text-[13px] text-success">{saving}</p> : null}
              <Button asChild size="lg" block data-testid="bundle-buy">
                <Link href={status === "signed-in" ? checkoutHref("BUNDLE", b.id, b.price.currency) : loginHref(path)}>{status === "signed-in" ? `Buy bundle · ${formatMoney(b.price, { compact: true })}` : "Sign in to buy"}</Link>
              </Button>
            </>
          ) : (
            <p className="text-[14px] text-muted-foreground">This bundle is not on sale in your currency right now.</p>
          )}
        </div>
      </div>
      <h2 className="mb-6 mt-10 font-display text-[24px] font-semibold tracking-[-0.02em]">What is included</h2>
      <CourseGrid>
        {b.courses.map((c) => (
          <CourseCard key={c.id} course={c} onToggleSave={toggle} />
        ))}
      </CourseGrid>
    </Page>
  );
}
