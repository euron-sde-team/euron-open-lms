"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@open-lms/ui";
import { Page } from "@/components/shell/layouts";

/**
 * Where a hosted checkout lands when it was started from the mobile app. With an allowed
 * app link the page opens the app at once; the text and buttons below are the fallback for
 * a browser that blocks the automatic hand-off (or a link opened on a computer).
 */
export function AppReturn({ academyName, orderId, canceled, appLink }: { academyName: string; orderId: string | null; canceled: boolean; appLink: string | null }) {
  useEffect(() => {
    if (appLink) window.location.replace(appLink);
  }, [appLink]);

  const Icon = canceled ? XCircle : CheckCircle2;
  return (
    <Page width="reading" className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{academyName}</p>
      <Icon className={canceled ? "mt-4 size-10 text-muted-foreground" : "mt-4 size-10 text-success"} aria-hidden />
      <h1 className="mt-3 font-display text-[28px] font-semibold tracking-[-0.02em]" data-testid="app-return-title">
        {canceled ? "Payment canceled" : "Payment received"}
      </h1>
      <p className="mt-2 max-w-md text-[15px] text-muted-foreground">
        {canceled ? "Nothing was charged. You can try again from the app whenever you like." : "Thank you. Your order is being confirmed; the app shows it as soon as it is ready."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {appLink ? (
          <Button asChild size="lg">
            <a href={appLink} data-testid="app-return-open">
              Return to the app
            </a>
          </Button>
        ) : null}
        <Button asChild size="lg" variant={appLink ? "outline" : "primary"}>
          <Link href={orderId ? `/checkout/orders/${encodeURIComponent(orderId)}${canceled ? "?canceled=1" : ""}` : "/my-learning"} data-testid="app-return-web">
            Continue on the website
          </Link>
        </Button>
      </div>
    </Page>
  );
}
