import { describe, expect, it } from "vitest";
import { isRestricted, restrictionMessage } from "@/lib/restriction";

describe("restriction", () => {
  it("is on only for SUSPENDED accounts", () => {
    expect(isRestricted({ status: "SUSPENDED" })).toBe(true);
    expect(isRestricted({ status: "ACTIVE" })).toBe(false);
    expect(isRestricted(null)).toBe(false);
  });
  it("names the end date when the API reports it", () => {
    expect(restrictionMessage("2026-03-05T09:41:00.000Z", "en-US", "UTC")).toBe("Your account is restricted until Thursday, March 5, 2026 at 9:41 AM.");
    expect(restrictionMessage(null)).toBe("Your account is restricted.");
  });
});
