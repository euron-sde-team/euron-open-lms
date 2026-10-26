import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckoutQuote } from "@open-lms/types";
import { CouponRow, OrderSummary } from "@/components/checkout/order-summary";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const base: CheckoutQuote = {
  currency: "USD",
  lines: [{ type: "COURSE", id: "c1", title: "SQL basics", unit: usd(5000), discount: usd(0), tax: usd(0), total: usd(5000) }],
  subtotal: usd(5000),
  discount: usd(0),
  tax: usd(0),
  total: usd(5000),
  taxLabel: null,
  taxMode: "EXCLUSIVE",
  coupon: null,
  couponError: null,
  gateway: "STRIPE",
  kind: "ONE_TIME",
  recurring: null,
  alreadyOwned: false,
};

/** A tiny fake server: the quote answers to the code, like POST /checkout/quote. */
function priced(code: string | null): CheckoutQuote {
  if (code === "SAVE20") return { ...base, discount: usd(1000), total: usd(4000), coupon: { code: "SAVE20", description: null, kind: "PERCENT", percentOff: 20, amountOff: null } };
  if (code) return { ...base, couponError: "EXPIRED" };
  return base;
}

function Harness({ onCoupon }: { onCoupon?: (c: string | null) => void }) {
  const [code, setCode] = useState<string | null>(null);
  return (
    <OrderSummary
      quote={priced(code)}
      item={{ type: "COURSE", id: "c1" }}
      couponCode={code}
      onCoupon={(c) => {
        onCoupon?.(c);
        setCode(c);
      }}
    />
  );
}

describe("coupon field", () => {
  it("opens from the link, applies a normalised code and shows CODE · 20% off with Remove", async () => {
    const onCoupon = vi.fn();
    render(<Harness onCoupon={onCoupon} />);
    expect(screen.queryByTestId("coupon-input")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("coupon-open"));
    await userEvent.type(screen.getByTestId("coupon-input"), " save20 ");
    await userEvent.click(screen.getByTestId("coupon-apply"));
    expect(onCoupon).toHaveBeenCalledWith("SAVE20");
    expect(screen.getByTestId("coupon-applied")).toHaveTextContent("SAVE20 · 20% off");
    expect(screen.getByTestId("summary-discount")).toHaveTextContent("-$10.00");
    expect(screen.getByTestId("summary-total")).toHaveTextContent("$40.00");
    await userEvent.click(screen.getByTestId("coupon-remove"));
    expect(onCoupon).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId("coupon-open")).toBeInTheDocument();
    expect(screen.getByTestId("summary-total")).toHaveTextContent("$50.00");
  });

  it("keeps the field open with the error copy for a refused code", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByTestId("coupon-open"));
    await userEvent.type(screen.getByTestId("coupon-input"), "OLD10{enter}");
    expect(screen.getByTestId("coupon-error")).toHaveTextContent("This code has expired.");
    expect(screen.getByTestId("coupon-input")).toHaveAttribute("aria-invalid", "true");
    // Typing a different code hides the stale error.
    await userEvent.type(screen.getByTestId("coupon-input"), "X");
    expect(screen.queryByTestId("coupon-error")).not.toBeInTheDocument();
  });

  it("does not apply an empty code", async () => {
    const onCoupon = vi.fn();
    render(<CouponRow quote={base} couponCode={null} onCoupon={onCoupon} updating={false} />);
    await userEvent.click(screen.getByTestId("coupon-open"));
    expect(screen.getByTestId("coupon-apply")).toBeDisabled();
  });

  it("shows the tax line with its rate and the renewal note", () => {
    const q: CheckoutQuote = { ...base, tax: usd(900), total: usd(5900), taxLabel: "GST", recurring: { price: usd(5000), interval: "MONTH", trialDays: 0 }, kind: "SUBSCRIPTION" };
    render(<OrderSummary quote={q} item={{ type: "PLAN", id: "p1", interval: "MONTH" }} couponCode={null} onCoupon={() => undefined} />);
    expect(screen.getByTestId("summary-tax")).toHaveTextContent("GST (18%)");
    expect(screen.getByTestId("summary-recurring")).toHaveTextContent(/\$50\.00 a month/);
    expect(screen.getByText("Plan, billed monthly")).toBeInTheDocument();
  });
});
