import { describe, expect, it } from "vitest";
import type { Plan } from "@open-lms/types";
import { availableIntervals, planPricing } from "@/lib/billing";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const plan = (prices: Plan["prices"]): Pick<Plan, "prices"> => ({ prices });

describe("plan pricing", () => {
  it("monthly shows the monthly price only", () => {
    const p = planPricing(plan([{ id: "m", interval: "MONTH", price: usd(2000) }, { id: "y", interval: "YEAR", price: usd(19900) }]), "MONTH");
    expect(p).toMatchObject({ price: { id: "m" }, perMonth: null, savingPercent: null });
  });
  it("yearly shows the monthly equivalent and an honest, rounded-down saving", () => {
    const p = planPricing(plan([{ id: "m", interval: "MONTH", price: usd(2000) }, { id: "y", interval: "YEAR", price: usd(19900) }]), "YEAR");
    expect(p.perMonth).toEqual(usd(1658));
    // 24000 vs 19900: 17.08% off, shown as 17.
    expect(p.savingPercent).toBe(17);
    expect(p.saving).toEqual(usd(4100));
  });
  it("claims no saving when yearly is not cheaper or there is no monthly price", () => {
    expect(planPricing(plan([{ id: "m", interval: "MONTH", price: usd(1000) }, { id: "y", interval: "YEAR", price: usd(12000) }]), "YEAR").savingPercent).toBeNull();
    expect(planPricing(plan([{ id: "y", interval: "YEAR", price: usd(12000) }]), "YEAR")).toMatchObject({ perMonth: usd(1000), savingPercent: null });
  });
  it("has no price when the interval is not sold", () => {
    expect(planPricing(plan([{ id: "m", interval: "MONTH", price: usd(1000) }]), "YEAR").price).toBeNull();
  });
  it("lists the intervals on sale", () => {
    expect(availableIntervals([plan([{ id: "y", interval: "YEAR", price: usd(1) }]), plan([{ id: "m", interval: "MONTH", price: usd(1) }])])).toEqual(["MONTH", "YEAR"]);
    expect(availableIntervals([])).toEqual([]);
  });
});
