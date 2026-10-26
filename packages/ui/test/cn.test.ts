import { describe, expect, it } from "vitest";
import { cn } from "../src/lib/cn";

describe("cn", () => {
  it("joins truthy class names and drops falsy ones", () => {
    expect(cn("a", Math.random() < 0 && "b", null, undefined, "c")).toBe("a c");
  });
  it("lets later Tailwind utilities win", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("bg-muted", { "bg-primary": true })).toBe("bg-primary");
  });
  it("keeps token colour utilities from different properties", () => {
    expect(cn("text-foreground", "bg-card")).toBe("text-foreground bg-card");
  });
});
