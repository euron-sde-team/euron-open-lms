import { describe, expect, it } from "vitest";
import { ApiError } from "@open-lms/api-client";
import { exportErrorMessage, ownedCompany } from "@/lib/account";
import { exportFileName } from "@/lib/download";
import { resolveProductName } from "@/lib/meta";

const fallback = () => "fallback";

describe("data export", () => {
  it("names the file after the username", () => {
    expect(exportFileName("ada_l")).toBe("ada_l-export.json");
    expect(exportFileName("a/b")).toBe("a_b-export.json");
  });
  it("explains the daily limit on 429", () => {
    expect(exportErrorMessage(new ApiError({ status: 429, code: "RATE_LIMITED", message: "x" }), fallback)).toBe("You can export 3 times a day. Try again tomorrow.");
    expect(exportErrorMessage(new ApiError({ status: 500, code: "SERVER_ERROR", message: "x" }), fallback)).toBe("fallback");
  });
});

describe("account deletion", () => {
  it("names the company page that needs another owner", () => {
    const e = new ApiError({ status: 409, code: "OWNER_MUST_TRANSFER", message: "x", details: { company: { name: "Northwind Labs", slug: "northwind-labs" } } });
    expect(ownedCompany(e)).toEqual({ name: "Northwind Labs", slug: "northwind-labs" });
  });
  it("falls back to generic copy without details, and ignores other errors", () => {
    expect(ownedCompany(new ApiError({ status: 409, code: "OWNER_MUST_TRANSFER", message: "x" }))).toEqual({ name: "your company", slug: "" });
    expect(ownedCompany(new ApiError({ status: 401, code: "INVALID_CREDENTIALS", message: "x" }))).toBeNull();
  });
});

describe("academy meta", () => {
  it("uses the academy name when set, else the runtime product name", () => {
    expect(resolveProductName({ academyName: "Book Club" }, "Open LMS")).toBe("Book Club");
    expect(resolveProductName({ academyName: "  " }, "Open LMS")).toBe("Open LMS");
    expect(resolveProductName(undefined, "Open LMS")).toBe("Open LMS");
  });
});
