import { describe, expect, it } from "vitest";
import type { AdminPrice } from "@open-lms/types";
import {
  bundlePriceRows, moveItem, nextPlanPriceRow, planFormSchema, planPayload, planPriceRows, planPriceSummary, separatelyTotal, slugify, validateBundlePrices, validatePlanPrices, type PlanPriceRow,
} from "@/components/admin/commerce/commerce-model";

const row = (currency: string, interval: "MONTH" | "YEAR", amount: string, key = `${currency}-${interval}-${amount}`): PlanPriceRow => ({ key, currency, interval, amount });

const price = (p: Partial<AdminPrice> & Pick<AdminPrice, "currency">): AdminPrice => ({
  id: p.currency + (p.interval ?? ""),
  amount: { amountMinor: 900, currency: p.currency },
  compareAt: null,
  interval: null,
  active: true,
  ...p,
});

describe("plan prices editor", () => {
  it("builds the PUT body in minor units", () => {
    const r = validatePlanPrices([row("USD", "MONTH", "9"), row("USD", "YEAR", "90"), row("INR", "MONTH", "499")]);
    expect(r).toEqual({
      ok: true,
      prices: [
        { currency: "USD", interval: "MONTH", amountMinor: 900 },
        { currency: "USD", interval: "YEAR", amountMinor: 9000 },
        { currency: "INR", interval: "MONTH", amountMinor: 49900 },
      ],
    });
  });
  it("rejects a duplicate currency and interval on the later row", () => {
    const r = validatePlanPrices([row("USD", "MONTH", "9", "a"), row("USD", "MONTH", "10", "b")]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.a).toBeUndefined();
      expect(r.errors.b).toMatch(/already a monthly price in USD/);
    }
  });
  it("allows the same currency on both intervals", () => {
    expect(validatePlanPrices([row("USD", "MONTH", "9"), row("USD", "YEAR", "90")]).ok).toBe(true);
  });
  it("rejects empty, zero and malformed amounts, and disabled currencies", () => {
    for (const amount of ["", "0", "9.999", "x"]) expect(validatePlanPrices([row("USD", "MONTH", amount, "k")]).ok).toBe(false);
    const r = validatePlanPrices([row("EUR", "MONTH", "9", "k")], ["USD", "INR"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.k).toMatch(/not enabled/);
  });
  it("loads only active recurring prices, monthly first", () => {
    const rows = planPriceRows([
      price({ currency: "USD", interval: "YEAR", amount: { amountMinor: 9000, currency: "USD" } }),
      price({ currency: "USD", interval: "MONTH" }),
      price({ currency: "INR", interval: "MONTH", active: false }),
      price({ currency: "EUR" }),
    ]);
    expect(rows.map((r) => [r.currency, r.interval, r.amount])).toEqual([
      ["USD", "MONTH", "9.00"],
      ["USD", "YEAR", "90.00"],
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
  it("suggests the next unused pair", () => {
    const next = nextPlanPriceRow([row("USD", "MONTH", "9")], ["USD", "INR"]);
    expect([next.currency, next.interval]).toEqual(["INR", "MONTH"]);
    const after = nextPlanPriceRow([row("USD", "MONTH", "9"), row("INR", "MONTH", "1")], ["USD", "INR"]);
    expect([after.currency, after.interval]).toEqual(["USD", "YEAR"]);
  });
  it("summarises prices for the list", () => {
    expect(planPriceSummary([price({ currency: "USD", interval: "MONTH" })])).toMatch(/9 \/ month$/);
  });
});

describe("plan form", () => {
  it("validates and trims into the API body", () => {
    const f = { name: " Pro ", slug: "pro", description: "", features: [{ text: " All courses " }, { text: "" }], trialDays: "7", status: "ACTIVE" as const, position: "1" };
    expect(planFormSchema.safeParse(f).success).toBe(true);
    expect(planPayload(f)).toEqual({ name: "Pro", slug: "pro", description: "", features: ["All courses"], trialDays: 7, status: "ACTIVE", position: 1 });
    expect(planFormSchema.safeParse({ ...f, slug: "Pro Plan" }).success).toBe(false);
    expect(planFormSchema.safeParse({ ...f, trialDays: "120" }).success).toBe(false);
  });
  it("slugifies names", () => {
    expect(slugify("Pro Annual!")).toBe("pro-annual");
    expect(slugify("  Data -- Science  ")).toBe("data-science");
    expect(slugify("Café")).toBe("cafe");
  });
});

describe("bundle prices and comparison", () => {
  it("one row per enabled currency, empty rows skipped", () => {
    const rows = bundlePriceRows(["USD", "INR"], [price({ currency: "USD", amount: { amountMinor: 4900, currency: "USD" }, compareAt: { amountMinor: 9900, currency: "USD" } })]);
    expect(rows).toEqual([
      { currency: "USD", amount: "49.00", compareAt: "99.00" },
      { currency: "INR", amount: "", compareAt: "" },
    ]);
    expect(validateBundlePrices(rows)).toEqual({ ok: true, prices: [{ currency: "USD", amountMinor: 4900, compareAtMinor: 9900 }] });
  });
  it("rejects a compare-at price that is not higher", () => {
    const r = validateBundlePrices([{ currency: "USD", amount: "49", compareAt: "40" }]);
    expect(r.ok).toBe(false);
  });
  it("adds up the courses bought separately per currency", () => {
    const courses = [{ prices: [{ amountMinor: 2000, currency: "USD" }] }, { prices: [{ amountMinor: 3000, currency: "USD" }, { amountMinor: 99900, currency: "INR" }] }];
    expect(separatelyTotal(courses, "USD")).toEqual({ total: { amountMinor: 5000, currency: "USD" }, missing: 0 });
    expect(separatelyTotal(courses, "INR").missing).toBe(1);
  });
  it("reorders courses", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], 1, 5)).toEqual(["a", "b"]);
  });
});
