import { describe, expect, it } from "vitest";
import { defaultRefundAmount, parseAmount, validateRefund } from "@/components/admin/commerce/commerce-model";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });

describe("parseAmount", () => {
  it("converts major units with the currency's own decimals", () => {
    expect(parseAmount("49.99", "USD")).toEqual({ minor: 4999 });
    expect(parseAmount("49.9", "USD")).toEqual({ minor: 4990 });
    expect(parseAmount("1,200", "INR")).toEqual({ minor: 120000 });
    expect(parseAmount("500", "JPY")).toEqual({ minor: 500 });
    expect(parseAmount("1.234", "KWD")).toEqual({ minor: 1234 });
  });
  it("never loses a cent to floating point", () => {
    expect(parseAmount("0.29", "USD")).toEqual({ minor: 29 });
    expect(parseAmount("19.99", "EUR")).toEqual({ minor: 1999 });
  });
  it("rejects text, negatives and too many decimals", () => {
    expect(parseAmount("abc", "USD")).toMatchObject({ error: "INVALID" });
    expect(parseAmount("-5", "USD")).toMatchObject({ error: "INVALID" });
    expect(parseAmount("1.999", "USD")).toMatchObject({ error: "DECIMALS", decimals: 2 });
    expect(parseAmount("5.5", "JPY")).toMatchObject({ error: "DECIMALS", decimals: 0 });
  });
});

describe("refund validation", () => {
  it("defaults to what is left to refund", () => {
    expect(defaultRefundAmount(usd(4999))).toBe("49.99");
    expect(defaultRefundAmount({ amountMinor: 500, currency: "JPY" })).toBe("500");
  });
  it("accepts a partial refund and reports the minor amount", () => {
    expect(validateRefund({ amount: "20", reason: "Asked for a partial refund" }, usd(4999))).toEqual({ ok: true, amountMinor: 2000, reason: "Asked for a partial refund", full: false });
  });
  it("marks a full refund", () => {
    const r = validateRefund({ amount: "49.99", reason: "Duplicate purchase" }, usd(4999));
    expect(r).toMatchObject({ ok: true, amountMinor: 4999, full: true });
  });
  it("rejects more than the refundable amount", () => {
    const r = validateRefund({ amount: "50", reason: "Duplicate purchase" }, usd(4999));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.amount).toMatch(/left to refund/);
  });
  it("rejects zero, empty and malformed amounts", () => {
    for (const amount of ["0", "", "1.234", "ten"]) {
      const r = validateRefund({ amount, reason: "Reason here" }, usd(4999));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.amount).toBeTruthy();
    }
  });
  it("requires a reason of at least 3 characters", () => {
    const r = validateRefund({ amount: "10", reason: "  x " }, usd(4999));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.reason).toBeTruthy();
      expect(r.errors.amount).toBeUndefined();
    }
  });
  it("says so when nothing is left", () => {
    const r = validateRefund({ amount: "1", reason: "Again" }, usd(0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.amount).toMatch(/Nothing is left/);
  });
});
