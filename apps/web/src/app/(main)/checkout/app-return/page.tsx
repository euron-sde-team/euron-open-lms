import type { AcademyMeta } from "@open-lms/types";
import type { Metadata } from "next";
import { AppReturn } from "@/components/checkout/app-return";
import { appReturnLink, DEFAULT_APP_SCHEMES, parseAppReturn } from "@/lib/app-return";
import { serverEnv } from "@/lib/runtime-env";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Back to the app", robots: { index: false, follow: false } };

// The query decides everything, so this page is rendered per request.
export const dynamic = "force-dynamic";

/** Stripe's https return for checkouts started in the mobile app; hands off to `<app>://checkout/return`. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseAppReturn(await searchParams);
  const meta = await serverGet<AcademyMeta>("/meta", 60);
  const allowed = meta?.mobile?.appReturnSchemes ?? DEFAULT_APP_SCHEMES;
  return <AppReturn academyName={meta?.academyName?.trim() || serverEnv().productName} orderId={query.orderId} canceled={query.canceled} appLink={appReturnLink(query, allowed)} />;
}
