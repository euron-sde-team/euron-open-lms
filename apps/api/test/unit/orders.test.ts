import { describe, expect, it } from "vitest";
import { amountMatches, canMove, certificateSerial, orderNumber, sourcesOf, statusAfterRefund } from "../../src/domain/orders";

describe("order state machine", () => {
  it("pays a pending order, and a failed or expired one when money really arrived", () => {
    expect(canMove("PENDING", "PAID")).toBe(true);
    expect(canMove("FAILED", "PAID")).toBe(true);
    expect(canMove("EXPIRED", "PAID")).toBe(true);
    expect(sourcesOf("PAID").sort()).toEqual(["EXPIRED", "FAILED", "PENDING"]);
  });

  it("never lets a late failure undo a payment", () => {
    expect(canMove("PAID", "FAILED")).toBe(false);
    expect(sourcesOf("FAILED")).toEqual(["PENDING"]);
  });

  it("refunds only paid orders, partially or fully, and REFUNDED is final", () => {
    expect(canMove("PAID", "PARTIALLY_REFUNDED")).toBe(true);
    expect(canMove("PARTIALLY_REFUNDED", "REFUNDED")).toBe(true);
    expect(canMove("PENDING", "REFUNDED")).toBe(false);
    expect(canMove("REFUNDED", "PAID")).toBe(false);
    expect(statusAfterRefund(1000, 400)).toBe("PARTIALLY_REFUNDED");
    expect(statusAfterRefund(1000, 1000)).toBe("REFUNDED");
  });

  it("trusts a webhook for whether, never for how much", () => {
    expect(amountMatches({ totalMinor: 4900, currency: "USD" }, { amountMinor: 4900, currency: "usd" })).toBe(true);
    expect(amountMatches({ totalMinor: 4900, currency: "USD" }, { amountMinor: 100, currency: "USD" })).toBe(false);
    expect(amountMatches({ totalMinor: 4900, currency: "USD" }, { amountMinor: 4900, currency: "INR" })).toBe(false);
  });

  it("makes readable numbers and serials without ambiguous characters", () => {
    const n = orderNumber(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 255]));
    expect(n).toMatch(/^ORD-[2-9A-HJ-NP-Z]{8}$/);
    expect(certificateSerial(new Uint8Array(10).fill(31))).toBe("LMS-ZZZZ-ZZZZ-ZZ");
  });
});
