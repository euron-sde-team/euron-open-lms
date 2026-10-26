import { describe, expect, it } from "vitest";
import type { AdminCoupon } from "@open-lms/types";
import {
  couponPatchPayload, couponScopeLabel, couponState, couponToForm, couponValueLabel, emptyCouponForm, generateCouponCode, redemptionsLabel, validateCoupon, type CouponForm,
} from "@/components/admin/commerce/commerce-model";

const form = (p: Partial<CouponForm> = {}): CouponForm => ({ ...emptyCouponForm("USD"), code: "SPRING20", percentOff: "20", ...p });

const coupon: AdminCoupon = {
  id: "c1",
  code: "FLAT500",
  description: null,
  kind: "FIXED",
  percentOff: null,
  amountOff: { amountMinor: 50000, currency: "INR" },
  scope: "SPECIFIC",
  targets: [
    { type: "COURSE", id: "a", title: "Intro to SQL" },
    { type: "BUNDLE", id: "b", title: "Data bundle" },
    { type: "PLAN", id: "p", title: "Pro" },
  ],
  maxRedemptions: 100,
  redemptionCount: 3,
  perUserLimit: 1,
  startsAt: null,
  expiresAt: null,
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("coupon form: kind", () => {
  it("accepts a percent coupon and sends no amount", () => {
    const r = validateCoupon(form());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toMatchObject({ code: "SPRING20", kind: "PERCENT", percentOff: 20, amountOffMinor: null, currency: null, scope: "ALL", targets: [], maxRedemptions: null, perUserLimit: 1 });
  });
  it("rejects a percent outside 1 to 100 or with decimals", () => {
    for (const percentOff of ["0", "101", "12.5", ""]) {
      const r = validateCoupon(form({ percentOff }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.percentOff).toBeTruthy();
    }
  });
  it("needs an amount and a currency for a fixed coupon, converted to minor units", () => {
    const r = validateCoupon(form({ kind: "FIXED", percentOff: "", amountOff: "500", currency: "INR" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toMatchObject({ kind: "FIXED", percentOff: null, amountOffMinor: 50000, currency: "INR" });
    const noAmount = validateCoupon(form({ kind: "FIXED", amountOff: "" }));
    expect(noAmount.ok).toBe(false);
    if (!noAmount.ok) expect(noAmount.errors.amountOff).toBeTruthy();
    const noCurrency = validateCoupon(form({ kind: "FIXED", amountOff: "5", currency: "" }));
    expect(noCurrency.ok).toBe(false);
    if (!noCurrency.ok) expect(noCurrency.errors.currency).toBeTruthy();
  });
  it("respects the currency's decimals", () => {
    const r = validateCoupon(form({ kind: "FIXED", amountOff: "5.5", currency: "JPY" }));
    expect(r.ok).toBe(false);
  });
});

describe("coupon form: scope and limits", () => {
  it("needs a target for SPECIFIC and only sends targets then", () => {
    const empty = validateCoupon(form({ scope: "SPECIFIC" }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.targets).toBeTruthy();
    const ok = validateCoupon(form({ scope: "SPECIFIC", targets: [{ type: "COURSE", id: "a", title: "A" }] }));
    expect(ok.ok && ok.body.targets).toEqual([{ type: "COURSE", id: "a" }]);
    const all = validateCoupon(form({ scope: "COURSES", targets: [{ type: "COURSE", id: "a", title: "A" }] }));
    expect(all.ok && all.body.targets).toEqual([]);
  });
  it("validates the code, limits and window", () => {
    expect(validateCoupon(form({ code: "ab" })).ok).toBe(false);
    expect(validateCoupon(form({ code: "has space" })).ok).toBe(false);
    expect(validateCoupon(form({ maxRedemptions: "0" })).ok).toBe(false);
    expect(validateCoupon(form({ perUserLimit: "" })).ok).toBe(false);
    const window = validateCoupon(form({ startsAt: "2026-05-02", expiresAt: "2026-05-01" }));
    expect(window.ok).toBe(false);
    if (!window.ok) expect(window.errors.expiresAt).toBeTruthy();
    const same = validateCoupon(form({ startsAt: "2026-05-01", expiresAt: "2026-05-01" }));
    expect(same.ok).toBe(true);
    if (same.ok) expect(new Date(same.body.startsAt!).getTime()).toBeLessThan(new Date(same.body.expiresAt!).getTime());
  });
});

describe("coupon display", () => {
  it("types the value", () => {
    expect(couponValueLabel({ kind: "PERCENT", percentOff: 20, amountOff: null })).toBe("20% off");
    expect(couponValueLabel(coupon)).toMatch(/500 off$/);
  });
  it("summarises scope and redemptions", () => {
    expect(couponScopeLabel({ scope: "COURSES", targets: [] })).toBe("All courses");
    expect(couponScopeLabel(coupon)).toBe("Intro to SQL, Data bundle +1");
    expect(redemptionsLabel(coupon)).toBe("3 of 100");
    expect(redemptionsLabel({ redemptionCount: 7, maxRedemptions: null })).toBe("7 used");
  });
  it("knows when a coupon is live", () => {
    const now = Date.parse("2026-06-01T00:00:00Z");
    expect(couponState(coupon, now)).toBe("LIVE");
    expect(couponState({ ...coupon, active: false }, now)).toBe("OFF");
    expect(couponState({ ...coupon, expiresAt: "2026-05-01T00:00:00Z" }, now)).toBe("EXPIRED");
    expect(couponState({ ...coupon, redemptionCount: 100 }, now)).toBe("USED_UP");
    expect(couponState({ ...coupon, startsAt: "2026-07-01T00:00:00Z" }, now)).toBe("SCHEDULED");
  });
  it("round-trips an existing coupon into the patch body (fixed fields left out)", () => {
    const f = couponToForm(coupon, "USD");
    expect(f).toMatchObject({ kind: "FIXED", amountOff: "500.00", currency: "INR", maxRedemptions: "100" });
    const patch = couponPatchPayload(f);
    expect(patch).not.toHaveProperty("code");
    expect(patch).not.toHaveProperty("kind");
    expect(patch.targets).toEqual([{ type: "COURSE", id: "a" }, { type: "BUNDLE", id: "b" }, { type: "PLAN", id: "p" }]);
  });
  it("generates readable codes", () => {
    const code = generateCouponCode();
    expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{8}$/);
    expect(generateCouponCode(() => 0)).toBe("AAAAAAAA");
  });
});
