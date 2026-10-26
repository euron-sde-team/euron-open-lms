import { describe, expect, it } from "vitest";
import type { LmsSettings } from "@open-lms/types";
import {
  academySection, analyticsSection, bpsToPercent, changeCount, currencySection, isDirty, learningSection, mapFieldErrors, mobileSection, offlineSection, percentToBps, sellerSection, taxSection, toggleCurrency,
} from "@/lib/admin-settings";

const base: LmsSettings = {
  academyName: "Northwind Academy",
  tagline: "Learn by building",
  logoUploadId: null,
  registration: "OPEN",
  supportEmail: null,
  currencies: { enabled: ["USD", "INR"], default: "USD" },
  gateways: { routing: { USD: "STRIPE", INR: "RAZORPAY" }, fallback: "STRIPE" },
  tax: { enabled: true, mode: "EXCLUSIVE", rules: [{ country: "IN", rateBps: 1800, label: "GST" }] },
  seller: { legalName: "Northwind Ltd", address: "1 Main St", taxId: null, email: null },
  learning: { videoCompletePercent: 90, reviewMinProgressPercent: 20, subscriptionGraceDays: 7, orderTtlMinutes: 60, offline: { enabled: true, days: 30, maxPerUser: 25 } },
  certificates: { signatoryName: "", signatoryTitle: "", footer: "" },
  analytics: { timezone: "UTC" },
  mobile: { iosWebPurchaseLink: false, minSupportedVersion: null },
};

describe("dirty tracking", () => {
  it("is clean right after loading", () => {
    for (const def of [academySection, currencySection, taxSection, sellerSection, learningSection, offlineSection, mobileSection, analyticsSection]) {
      expect(isDirty(def as never, base, (def as typeof academySection).toForm(base) as never)).toBe(false);
    }
  });
  it("turns dirty on an edit and clean again when the edit is undone", () => {
    const f = academySection.toForm(base);
    const edited = { ...f, tagline: "New line" };
    expect(isDirty(academySection, base, edited)).toBe(true);
    expect(changeCount(academySection, base, edited)).toBe(1);
    expect(isDirty(academySection, base, { ...edited, tagline: base.tagline })).toBe(false);
  });
  it("counts each changed field", () => {
    const f = { ...learningSection.toForm(base), videoCompletePercent: "80", orderTtlMinutes: "30" };
    expect(changeCount(learningSection, base, f)).toBe(2);
  });
  it("treats a tax rule edit as dirty", () => {
    const f = taxSection.toForm(base);
    expect(isDirty(taxSection, base, { ...f, rules: [{ ...f.rules[0]!, rate: "12" }] })).toBe(true);
  });
});

describe("validation", () => {
  it("requires an academy name and a valid support email", () => {
    const f = academySection.toForm(base);
    expect(academySection.validate({ ...f, academyName: "  " }).academyName).toBeTruthy();
    expect(academySection.validate({ ...f, supportEmail: "nope" }).supportEmail).toBeTruthy();
    expect(academySection.validate({ ...f, supportEmail: "help@northwind.test" })).toEqual({});
  });
  it("keeps the default currency among the enabled ones", () => {
    const f = currencySection.toForm(base);
    expect(currencySection.validate({ ...f, default: "EUR" }).default).toBeTruthy();
    expect(currencySection.validate({ ...f, enabled: [] }).enabled).toBeTruthy();
  });
  it("checks tax rules: country codes, unique countries, rates and labels", () => {
    const e = taxSection.validate({
      enabled: true,
      mode: "EXCLUSIVE",
      rules: [
        { country: "IND", rate: "18", label: "GST" },
        { country: "DE", rate: "120", label: "" },
        { country: "DE", rate: "19", label: "VAT" },
        { country: "*", rate: "0", label: "None" },
      ],
    });
    expect(Object.keys(e).sort()).toEqual(["rules.0.country", "rules.1.label", "rules.1.rate", "rules.2.country"]);
    expect(taxSection.validate({ enabled: true, mode: "INCLUSIVE", rules: [] }).rules).toBeTruthy();
    expect(taxSection.validate({ enabled: false, mode: "INCLUSIVE", rules: [] })).toEqual({});
  });
  it("bounds the learning numbers like the API", () => {
    const f = learningSection.toForm(base);
    expect(learningSection.validate({ ...f, videoCompletePercent: "0" }).videoCompletePercent).toBeTruthy();
    expect(learningSection.validate({ ...f, subscriptionGraceDays: "31" }).subscriptionGraceDays).toBeTruthy();
    expect(learningSection.validate({ ...f, orderTtlMinutes: "4" }).orderTtlMinutes).toBeTruthy();
    expect(learningSection.validate({ ...f, orderTtlMinutes: "12.5" }).orderTtlMinutes).toBeTruthy();
    expect(learningSection.validate(f)).toEqual({});
  });
  it("accepts IANA time zones only", () => {
    expect(analyticsSection.validate({ timezone: "Europe/Berlin" })).toEqual({});
    expect(analyticsSection.validate({ timezone: "Mars/Olympus" }).timezone).toBeTruthy();
    expect(analyticsSection.validate({ timezone: "" }).timezone).toBeTruthy();
  });
});

describe("patches", () => {
  it("converts tax percentages to basis points and upper-cases countries", () => {
    expect(percentToBps("7.5")).toBe(750);
    expect(percentToBps("18")).toBe(1800);
    expect(percentToBps("101")).toBeNull();
    expect(percentToBps("1.234")).toBeNull();
    expect(bpsToPercent(1850)).toBe("18.5");
    expect(taxSection.toPatch({ enabled: true, mode: "EXCLUSIVE", rules: [{ country: "de", rate: "19", label: " VAT " }] })).toEqual({
      tax: { enabled: true, mode: "EXCLUSIVE", rules: [{ country: "DE", rateBps: 1900, label: "VAT" }] },
    });
  });
  it("routes only enabled currencies and empties become null", () => {
    const f = toggleCurrency(currencySection.toForm(base), "INR");
    expect(f.enabled).toEqual(["USD"]);
    expect(currencySection.toPatch(f).gateways).toEqual({ routing: { USD: "STRIPE" }, fallback: "STRIPE" });
    expect(academySection.toPatch({ ...academySection.toForm(base), supportEmail: "  " }).supportEmail).toBeNull();
  });
  it("moves the default when its currency is switched off", () => {
    const f = toggleCurrency(currencySection.toForm(base), "USD");
    expect(f.default).toBe("INR");
  });
  it("maps API field paths to the section's keys", () => {
    expect(mapFieldErrors({ "tax.rules.0.label": "is required" }, ["tax"])).toEqual({ "rules.0.label": "Is required" });
    expect(mapFieldErrors({ academyName: "too long" }, [])).toEqual({ academyName: "Too long" });
  });

  it("offline downloads and the mobile app patch their own groups, validated", () => {
    const off = offlineSection.toForm(base);
    expect(offlineSection.toPatch({ ...off, enabled: false, days: "14" })).toEqual({ learning: { offline: { enabled: false, days: 14, maxPerUser: 25 } } });
    expect(offlineSection.validate({ ...off, days: "0" }).days).toBeTruthy();
    expect(offlineSection.validate({ ...off, maxPerUser: "501" }).maxPerUser).toBeTruthy();
    const mob = mobileSection.toForm(base);
    expect(mobileSection.toPatch({ ...mob, minSupportedVersion: " " })).toEqual({ mobile: { iosWebPurchaseLink: false, minSupportedVersion: null } });
    expect(mobileSection.toPatch({ iosWebPurchaseLink: true, minSupportedVersion: "1.4.0" })).toEqual({ mobile: { iosWebPurchaseLink: true, minSupportedVersion: "1.4.0" } });
    expect(mobileSection.validate({ ...mob, minSupportedVersion: "v1" }).minSupportedVersion).toBeTruthy();
    expect(mapFieldErrors({ "learning.offline.days": "too big" }, ["learning.offline", "learning"])).toEqual({ days: "Too big" });
  });
});
