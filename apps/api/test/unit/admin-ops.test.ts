import type { LmsSettings, NotificationType } from "@open-lms/types";
import { describe, expect, test } from "vitest";
import { notificationCopy } from "../../src/integrations/mail/admin-templates";
import { usernameFromEmail } from "../../src/services/admin-bootstrap.service";
import { protectionOf } from "../../src/services/admin-learners.service";
import { isCurrencyCode, isTimeZone, settingsProblems } from "../../src/services/admin-settings.service";
import { localToday, resolveRange } from "../../src/services/admin-stats.service";
import { gatewayMode } from "../../src/services/admin.service";
import { DEFAULT_SETTINGS } from "../../src/services/settings.service";
import { USERNAME_PATTERN } from "../../src/domain/username";

describe("who may act on whom", () => {
  const me = (role: "SUPPORT" | "ADMIN" | "FINANCE") => ({ id: "a", role });
  test("never yourself; learners always; staff only strictly below you", () => {
    expect(protectionOf(me("SUPPORT"), { id: "a", role: "SUPPORT" })).toBe("SELF_ACTION");
    expect(protectionOf(me("SUPPORT"), { id: "b", role: "LEARNER" })).toBeNull();
    expect(protectionOf(me("SUPPORT"), { id: "b", role: "INSTRUCTOR" })).toBeNull();
    expect(protectionOf(me("SUPPORT"), { id: "b", role: "SUPPORT" })).toBe("TARGET_PROTECTED");
    expect(protectionOf(me("SUPPORT"), { id: "b", role: "FINANCE" })).toBe("TARGET_PROTECTED");
    expect(protectionOf(me("SUPPORT"), { id: "b", role: "ADMIN" })).toBe("TARGET_PROTECTED");
    for (const role of ["LEARNER", "INSTRUCTOR", "SUPPORT", "FINANCE"] as const) expect(protectionOf(me("ADMIN"), { id: "b", role }), role).toBeNull();
    expect(protectionOf(me("ADMIN"), { id: "b", role: "ADMIN" })).toBe("TARGET_PROTECTED");
  });
});

describe("overview ranges", () => {
  const now = new Date("2026-03-10T20:30:00Z");
  test("today is local to the analytics time zone", () => {
    expect(localToday("UTC", now)).toBe("2026-03-10");
    expect(localToday("Asia/Kolkata", now)).toBe("2026-03-11");
    expect(localToday("America/Los_Angeles", now)).toBe("2026-03-10");
  });
  test("the default is the last 30 days, today included", () => {
    expect(resolveRange({}, "Asia/Kolkata", now)).toEqual({ from: "2026-02-10", to: "2026-03-11", timezone: "Asia/Kolkata" });
    expect(resolveRange({ to: "2026-01-31" }, "UTC", now)).toMatchObject({ from: "2026-01-02", to: "2026-01-31" });
  });
  test("impossible dates, reversed and over-long ranges are refused", () => {
    expect(() => resolveRange({ from: "2026-02-30", to: "2026-03-01" }, "UTC")).toThrow(/real days/);
    expect(() => resolveRange({ from: "2026-03-02", to: "2026-03-01" }, "UTC")).toThrow(/after/);
    expect(() => resolveRange({ from: "2025-01-01", to: "2026-01-02" }, "UTC")).toThrow(/366/);
    expect(resolveRange({ from: "2025-01-01", to: "2026-01-01" }, "UTC").from).toBe("2025-01-01");
  });
});

describe("gateway modes", () => {
  const base = { enabled: true, apiBase: "https://api.stripe.com", defaultBase: "https://api.stripe.com", key: "sk_live_x", testPrefix: "sk_test_" };
  test("off, stub, test and live", () => {
    expect(gatewayMode({ ...base, enabled: false })).toBe("off");
    expect(gatewayMode({ ...base, apiBase: "http://localhost:5119" })).toBe("stub");
    expect(gatewayMode({ ...base, apiBase: "https://api.stripe.com/" })).toBe("live");
    expect(gatewayMode({ ...base, key: "sk_test_abc" })).toBe("test");
    expect(gatewayMode({ ...base, key: "rzp_test_abc", testPrefix: "rzp_test_" })).toBe("test");
  });
});

describe("settings checks", () => {
  test("time zones and currencies come from the runtime's own lists", () => {
    expect(isTimeZone("Asia/Kolkata")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isCurrencyCode("INR")).toBe(true);
    expect(isCurrencyCode("usd")).toBe(false);
    expect(isCurrencyCode("XYZ")).toBe(false);
  });
  test("the merged document must keep the default currency enabled and one rule per country", () => {
    const s: LmsSettings = { ...DEFAULT_SETTINGS };
    expect(settingsProblems(s)).toEqual([]);
    expect(settingsProblems({ ...s, currencies: { enabled: ["USD"], default: "EUR" } })).toHaveLength(1);
    expect(settingsProblems({ ...s, tax: { ...s.tax, rules: [{ country: "IN", rateBps: 1, label: "a" }, { country: "IN", rateBps: 2, label: "b" }] } })).toHaveLength(1);
  });
});

describe("admin:create usernames", () => {
  test("taken from the email in the handle shape", () => {
    expect(usernameFromEmail("ada.lovelace@example.com")).toBe("ada-lovelace");
    expect(usernameFromEmail("Ops_Team+lms@example.com")).toBe("ops-team-lms");
    expect(usernameFromEmail("a@example.com")).toBe("a-op");
    expect(usernameFromEmail("--@example.com")).toBe("admin-op");
    expect(usernameFromEmail(`${"x".repeat(60)}@example.com`)).toHaveLength(36);
    for (const e of ["ada.lovelace@example.com", "a@example.com", "--@example.com", "_x_@example.com", `${"y-".repeat(30)}@example.com`]) expect(USERNAME_PATTERN.test(usernameFromEmail(e)), e).toBe(true);
  });
});

describe("notification email words", () => {
  const types: NotificationType[] = ["ORDER_PAID", "ORDER_FAILED", "REFUND_ISSUED", "ENROLLMENT_GRANTED", "ENROLLMENT_REVOKED", "SUBMISSION_REVIEWED", "CERTIFICATE_ISSUED", "SUBSCRIPTION_RENEWED", "SUBSCRIPTION_PAYMENT_FAILED", "SUBSCRIPTION_CANCELED", "QA_REPLY", "QA_ACCEPTED", "REVIEW_REPLY", "COURSE_UPDATED"];
  test("every type has a distinct subject, a body and a button, with or without a snippet", () => {
    expect(new Set(types.map((t) => notificationCopy(t, null, "Academy").title)).size).toBe(types.length);
    for (const t of types) {
      for (const snippet of [null, "SQL Basics"]) {
        const c = notificationCopy(t, snippet, "Academy");
        expect(c.title.length, t).toBeGreaterThan(5);
        expect(c.body.length, t).toBeGreaterThan(10);
        expect(c.cta.length, t).toBeGreaterThan(2);
        expect(`${c.title}${c.body}`, t).not.toMatch(/null|undefined/);
      }
    }
    expect(notificationCopy("ENROLLMENT_GRANTED", "SQL Basics", "Academy").title).toBe('You now have access to "SQL Basics"');
  });
});
