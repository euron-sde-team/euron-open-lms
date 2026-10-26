import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SubscriptionSummary } from "@open-lms/types";
import { cancelExplainer, subscriptionCopy } from "@/lib/billing";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/api", () => ({ api: () => ({}) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ reloadMe: vi.fn() }) }));

import { SubscriptionView } from "@/components/account/subscription-section";
import { blocksDeletion } from "@/components/account/privacy-section";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const future = "2026-11-26T12:00:00Z";
const past = "2026-09-26T12:00:00Z";

function sub(over: Partial<SubscriptionSummary> = {}): SubscriptionSummary {
  return {
    id: "s1",
    plan: { id: "p1", slug: "pro", name: "Pro" },
    status: "ACTIVE",
    interval: "MONTH",
    price: { amountMinor: 2000, currency: "USD" },
    currentPeriodEnd: future,
    trialEnd: null,
    cancelAtPeriodEnd: false,
    gateway: "STRIPE",
    grantsAccess: true,
    ...over,
  };
}

const fmt = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));

describe("subscription copy per status", () => {
  it("ACTIVE renews, with the price, and can be canceled", () => {
    const c = subscriptionCopy(sub(), NOW, "en-GB");
    expect(c).toMatchObject({ status: "Active", tone: "success", canCancel: true, canResume: false, warning: null });
    expect(c.dateLine).toBe(`Renews on ${fmt(future)} at $20.00 a month`);
  });
  it("ACTIVE with a pending cancel ends on the date and can resume", () => {
    expect(subscriptionCopy(sub({ cancelAtPeriodEnd: true }), NOW, "en-GB")).toMatchObject({ status: "Ending", dateLine: `Ends on ${fmt(future)}`, canCancel: false, canResume: true });
  });
  it("CANCELED at period end (how the API stores a scheduled cancel) still ends on the date", () => {
    expect(subscriptionCopy(sub({ status: "CANCELED", cancelAtPeriodEnd: true }), NOW, "en-GB")).toMatchObject({ status: "Ending", canResume: true });
  });
  it("TRIALING says when the trial ends and what follows", () => {
    const c = subscriptionCopy(sub({ status: "TRIALING", trialEnd: future, interval: "YEAR" }), NOW, "en-GB");
    expect(c).toMatchObject({ status: "Free trial", canCancel: true });
    expect(c.dateLine).toBe(`Trial ends on ${fmt(future)}, then $20.00 a year`);
  });
  it("PAST_DUE warns and says what to do", () => {
    const c = subscriptionCopy(sub({ status: "PAST_DUE" }), NOW, "en-GB");
    expect(c.status).toBe("Payment overdue");
    expect(c.tone).toBe("danger");
    expect(c.warning).toMatch(/could not take your last payment/);
    expect(c.warning).toMatch(/progress is kept/);
  });
  it("CANCELED now, still inside the paid period, keeps access until the end", () => {
    expect(subscriptionCopy(sub({ status: "CANCELED" }), NOW, "en-GB")).toMatchObject({ status: "Canceled", dateLine: `Access until ${fmt(future)}`, canResume: false });
  });
  it("CANCELED in the past and EXPIRED read as Ended", () => {
    expect(subscriptionCopy(sub({ status: "CANCELED", currentPeriodEnd: past, grantsAccess: false }), NOW, "en-GB")).toMatchObject({ status: "Ended", dateLine: `Ended on ${fmt(past)}`, live: false });
    expect(subscriptionCopy(sub({ status: "EXPIRED", currentPeriodEnd: past, grantsAccess: false }), NOW, "en-GB").status).toBe("Ended");
  });
  it("INCOMPLETE explains the first payment has not finished", () => {
    expect(subscriptionCopy(sub({ status: "INCOMPLETE", grantsAccess: false }), NOW).warning).toMatch(/first payment/);
  });
  it("the cancel dialog says what happens", () => {
    expect(cancelExplainer(sub(), "en-GB")).toMatch(new RegExp(`You keep Pro until ${fmt(future)}.*will not be charged again`));
    expect(cancelExplainer(sub({ status: "TRIALING", trialEnd: future }), "en-GB")).toMatch(/trial continues.*not be charged/);
  });
});

describe("SubscriptionView", () => {
  it("offers cancel on an active plan and resume on an ending one", async () => {
    const onCancel = vi.fn();
    const onResume = vi.fn();
    const { rerender } = render(<SubscriptionView sub={sub()} onCancel={onCancel} onResume={onResume} />);
    expect(screen.getByTestId("subscription-status")).toHaveTextContent("Active");
    expect(screen.queryByTestId("subscription-resume")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("subscription-cancel"));
    expect(onCancel).toHaveBeenCalled();
    rerender(<SubscriptionView sub={sub({ cancelAtPeriodEnd: true })} onCancel={onCancel} onResume={onResume} />);
    expect(screen.queryByTestId("subscription-cancel")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("subscription-resume"));
    expect(onResume).toHaveBeenCalled();
  });
  it("shows the past-due warning", () => {
    render(<SubscriptionView sub={sub({ status: "PAST_DUE" })} onCancel={() => undefined} onResume={() => undefined} />);
    expect(screen.getByTestId("subscription-warning")).toBeInTheDocument();
  });
});

describe("deletion rule", () => {
  it("a renewing subscription blocks deletion; a scheduled cancel does not", () => {
    expect(blocksDeletion(sub())).toBe(true);
    expect(blocksDeletion(sub({ status: "PAST_DUE" }))).toBe(true);
    expect(blocksDeletion(sub({ cancelAtPeriodEnd: true }))).toBe(false);
    expect(blocksDeletion(sub({ status: "CANCELED" }))).toBe(false);
    expect(blocksDeletion(null)).toBe(false);
  });
});
