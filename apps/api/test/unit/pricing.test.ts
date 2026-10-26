import { describe, expect, it } from "vitest";
import { allocate, couponDiscount, couponProblem, divRound, formatMinor, minorExponent, price, taxRuleFor } from "../../src/domain/pricing";

const noTax = { enabled: false, mode: "EXCLUSIVE" as const, rateBps: 0, label: null };

describe("money helpers", () => {
  it("knows minor-unit exponents", () => {
    expect(minorExponent("USD")).toBe(2);
    expect(minorExponent("inr")).toBe(2);
    expect(minorExponent("JPY")).toBe(0);
    expect(minorExponent("KWD")).toBe(3);
    expect(formatMinor(499900, "INR")).toBe("4999.00");
    expect(formatMinor(1200, "JPY")).toBe("1200");
    expect(formatMinor(1234, "KWD")).toBe("1.234");
  });

  it("rounds half up without float drift", () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(4, 2)).toBe(2);
    expect(divRound(1, 3)).toBe(0);
    expect(divRound(2, 3)).toBe(1);
  });

  it("allocates integers that always sum to the amount", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(7, [3000, 1000])).toEqual([5, 2]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    for (let amount = 1; amount < 50; amount++) {
      expect(allocate(amount, [499, 1299, 3]).reduce((a, b) => a + b, 0)).toBe(amount);
    }
  });
});

describe("price", () => {
  it("is the price book sum with no coupon and no tax", () => {
    const p = price([{ key: "a", unitMinor: 4900 }], null, noTax);
    expect(p).toMatchObject({ subtotalMinor: 4900, discountMinor: 0, taxMinor: 0, totalMinor: 4900, taxLabel: null });
  });

  it("applies a percent coupon, rounded half up", () => {
    const p = price([{ key: "a", unitMinor: 4999 }], { kind: "PERCENT", percentOff: 25, amountOffMinor: null }, noTax);
    expect(p.discountMinor).toBe(1250);
    expect(p.totalMinor).toBe(3749);
  });

  it("caps a fixed coupon at the eligible amount: never a negative total", () => {
    const p = price([{ key: "a", unitMinor: 1000 }], { kind: "FIXED", percentOff: null, amountOffMinor: 5000 }, noTax);
    expect(p.discountMinor).toBe(1000);
    expect(p.totalMinor).toBe(0);
  });

  it("discounts only the lines the coupon applies to", () => {
    const d = couponDiscount([{ key: "course:a", unitMinor: 1000 }, { key: "course:b", unitMinor: 3000 }], { kind: "PERCENT", percentOff: 50, amountOffMinor: null, appliesTo: (k) => k === "course:b" });
    expect(d).toEqual([0, 1500]);
  });

  it("adds exclusive tax per line on the discounted amount", () => {
    const p = price([{ key: "a", unitMinor: 10000 }], { kind: "PERCENT", percentOff: 10, amountOffMinor: null }, { enabled: true, mode: "EXCLUSIVE", rateBps: 1800, label: "GST" });
    expect(p).toMatchObject({ subtotalMinor: 10000, discountMinor: 1000, taxMinor: 1620, totalMinor: 10620, taxLabel: "GST", taxRateBps: 1800 });
  });

  it("carves inclusive tax out of the price: the total does not change", () => {
    const p = price([{ key: "a", unitMinor: 11800 }], null, { enabled: true, mode: "INCLUSIVE", rateBps: 1800, label: "GST" });
    expect(p.totalMinor).toBe(11800);
    expect(p.taxMinor).toBe(1800);
  });

  it("keeps lines summing to the totals", () => {
    const p = price(
      [{ key: "a", unitMinor: 3333 }, { key: "b", unitMinor: 6667 }, { key: "c", unitMinor: 1 }],
      { kind: "FIXED", percentOff: null, amountOffMinor: 1001 },
      { enabled: true, mode: "EXCLUSIVE", rateBps: 725, label: "VAT" },
    );
    expect(p.lines.reduce((a, l) => a + l.totalMinor, 0)).toBe(p.totalMinor);
    expect(p.lines.reduce((a, l) => a + l.discountMinor, 0)).toBe(1001);
    expect(p.totalMinor).toBe(p.subtotalMinor - p.discountMinor + p.taxMinor);
  });

  it("ignores tax when disabled", () => {
    expect(price([{ key: "a", unitMinor: 100 }], null, { enabled: false, mode: "EXCLUSIVE", rateBps: 2000, label: "VAT" }).taxMinor).toBe(0);
  });
});

describe("taxRuleFor", () => {
  const rules = [
    { country: "IN", rateBps: 1800, label: "GST" },
    { country: "*", rateBps: 0, label: "Tax" },
  ];
  it("prefers the exact country, then the fallback", () => {
    expect(taxRuleFor(rules, "in")?.label).toBe("GST");
    expect(taxRuleFor(rules, "DE")?.country).toBe("*");
    expect(taxRuleFor([{ country: "IN", rateBps: 1800, label: "GST" }], "DE")).toBeNull();
  });
});

describe("couponProblem", () => {
  const coupon = { active: true, startsAt: null, expiresAt: null, maxRedemptions: null, redemptionCount: 0, perUserLimit: 1, kind: "PERCENT" as const, currency: null };
  const ctx = { now: new Date("2026-01-10T00:00:00Z"), currency: "USD", userRedemptions: 0, applicableLines: 1 };
  it("accepts a usable coupon", () => expect(couponProblem(coupon, ctx)).toBeNull());
  it("rejects with a stable reason", () => {
    expect(couponProblem({ ...coupon, active: false }, ctx)).toBe("EXPIRED");
    expect(couponProblem({ ...coupon, startsAt: new Date("2026-02-01") }, ctx)).toBe("NOT_STARTED");
    expect(couponProblem({ ...coupon, expiresAt: new Date("2026-01-01") }, ctx)).toBe("EXPIRED");
    expect(couponProblem({ ...coupon, maxRedemptions: 5, redemptionCount: 5 }, ctx)).toBe("EXHAUSTED");
    expect(couponProblem(coupon, { ...ctx, userRedemptions: 1 })).toBe("ALREADY_USED");
    expect(couponProblem({ ...coupon, kind: "FIXED", currency: "INR" }, ctx)).toBe("CURRENCY_MISMATCH");
    expect(couponProblem(coupon, { ...ctx, applicableLines: 0 })).toBe("NOT_APPLICABLE");
  });
});
