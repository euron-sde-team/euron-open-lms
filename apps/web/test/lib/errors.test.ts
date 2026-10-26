import { describe, expect, it } from "vitest";
import { ApiError } from "@open-lms/api-client";
import { errorCopy, errorMessage, isQuietError } from "@/lib/errors";

describe("error copy", () => {
  it("maps known codes and falls back to the server message", () => {
    expect(errorCopy("RATE_LIMITED")).toMatch(/too fast/);
    expect(errorCopy("SOMETHING_NEW", "Server says no")).toBe("Server says no");
    expect(errorCopy(undefined)).toBe("Something went wrong. Try again.");
  });
  it("uses the first field error for validation failures", () => {
    const e = new ApiError({ status: 400, code: "VALIDATION_FAILED", message: "x", details: { fields: [{ path: "body", message: "must not be empty" }] } });
    expect(errorMessage(e)).toBe("Some fields need attention. Must not be empty.");
  });
  it("treats 404, 401 and validation as quiet", () => {
    expect(isQuietError(new ApiError({ status: 404, code: "NOT_FOUND", message: "" }))).toBe(true);
    expect(isQuietError(new ApiError({ status: 500, code: "SERVER_ERROR", message: "" }))).toBe(false);
  });
});
