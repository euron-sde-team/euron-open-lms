import { describe, expect, it } from "vitest";
import { buildCsp } from "@/middleware";
import { mediaOrigins, serverEnv } from "@/lib/runtime-env";

describe("content security policy", () => {
  it("is strict by default and adds the media and video origins", () => {
    const csp = buildCsp({ nonce: "abc", dev: false, media: ["https://media.example.org"], video: ["https://video.example.org"] });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("media-src 'self' blob: https://media.example.org https://video.example.org");
    expect(csp).toContain("connect-src 'self' https://media.example.org https://video.example.org");
    expect(csp).toContain("frame-src 'self' https://www.youtube-nocookie.com https://media.example.org https://checkout.razorpay.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/(media|connect)-src[^;]* https:(;| )/);
  });
  it("allows eval and websockets for the dev server only", () => {
    expect(buildCsp({ nonce: "n", dev: true, media: [], video: [] })).toContain("'unsafe-eval'");
    expect(buildCsp({ nonce: "n", dev: false, media: [], video: [] })).not.toContain("ws:");
  });
  it("parses media origins and drops anything that is not an origin", () => {
    expect(mediaOrigins("http://localhost:4566, https://cdn.example.org/ ,javascript:x,https://a.example/path")).toEqual(["http://localhost:4566", "https://cdn.example.org"]);
    expect(mediaOrigins(undefined)).toEqual([]);
  });
});

describe("runtime env", () => {
  it("reads the container environment with defaults", () => {
    expect(serverEnv({})).toEqual({ productName: "Euron Open LMS", apiUrl: "/api" });
    expect(serverEnv({ PRODUCT_NAME: " Acme Academy ", PUBLIC_API_URL: "https://api.example.org/api" })).toMatchObject({ productName: "Acme Academy", apiUrl: "https://api.example.org/api" });
  });
});
