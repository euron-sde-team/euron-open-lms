import { describe, expect, test } from "vitest";
import { baseDomain, safeUrl, youtubeId } from "../../src/domain/safe-url";

describe("safeUrl", () => {
  test("http and https URLs survive, normalised", () => {
    expect(safeUrl("https://example.com/work?a=1#b")).toBe("https://example.com/work?a=1#b");
    expect(safeUrl("http://example.com")).toBe("http://example.com/");
    expect(safeUrl("HTTPS://Example.COM/Path")).toBe("https://example.com/Path");
    expect(safeUrl("  https://example.com  ")).toBe("https://example.com/");
  });

  test("a bare host gets https", () => {
    expect(safeUrl("example.com/portfolio")).toBe("https://example.com/portfolio");
    expect(safeUrl("github.example.com/ada")).toBe("https://github.example.com/ada");
  });

  test("javascript:, data:, file: and every other scheme are refused, in any case or disguise", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "javascript://example.com/%0aalert(1)",
      "data:text/html,<script>alert(1)</script>",
      "data:image/png;base64,AAAA",
      "file:///etc/passwd",
      "ftp://example.com/x",
      "mailto:ada@example.com",
      "vbscript:msgbox(1)",
    ]) {
      expect(safeUrl(bad), bad).toBeNull();
    }
  });

  test("control characters and whitespace inside are refused (no java\\tscript: tricks)", () => {
    expect(safeUrl("java\tscript:alert(1)")).toBeNull();
    expect(safeUrl("https://exa mple.com")).toBeNull();
    expect(safeUrl("https://example.com/a\u0000b")).toBeNull();
    expect(safeUrl("https://example.com/a\nb")).toBeNull();
    expect(safeUrl("https://example.com/a\u007fb")).toBeNull();
  });

  test("protocol-relative URLs become https on the same host, never a scheme of their own", () => {
    expect(safeUrl("//example.com/x")).toBe("https://example.com/x");
    expect(safeUrl("///example.com/x")).toBe("https://example.com/x");
  });

  test("credentials, hosts without a dot, a trailing dot and over-long URLs are refused", () => {
    expect(safeUrl("https://user:pass@example.com")).toBeNull();
    expect(safeUrl("https://user@example.com")).toBeNull();
    expect(safeUrl("https://localhost/admin")).toBeNull();
    expect(safeUrl("http://intranet")).toBeNull();
    expect(safeUrl("https://example.com./x")).toBeNull();
    expect(safeUrl(`https://example.com/${"a".repeat(500)}`)).toBeNull();
  });

  test("empty input is null", () => {
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl("   ")).toBeNull();
    expect(safeUrl("https://")).toBeNull();
  });
});

describe("baseDomain", () => {
  test("the registrable-ish domain of a host or an email, lower-cased", () => {
    expect(baseDomain("example.com")).toBe("example.com");
    expect(baseDomain("jobs.example.com")).toBe("example.com");
    expect(baseDomain("Deep.Jobs.Example.COM.")).toBe("example.com");
    expect(baseDomain("ada@mail.example.com")).toBe("example.com");
  });

  test("two-label public suffixes keep three labels", () => {
    expect(baseDomain("jobs.example.co.uk")).toBe("example.co.uk");
    expect(baseDomain("ada@example.com.au")).toBe("example.com.au");
  });

  test("not a domain: null", () => {
    for (const bad of ["localhost", "192.168.0.1", "", "@", "exa mple.com", "example.c"]) expect(baseDomain(bad), bad).toBeNull();
  });
});

describe("youtubeId", () => {
  const ID = "abcDEF12345";
  test("the usual URL shapes", () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=42`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?t=10`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
    ]) {
      expect(youtubeId(url), url).toBe(ID);
    }
  });

  test("other hosts, malformed ids and non-URLs are null", () => {
    expect(youtubeId(`https://video.example.com/watch?v=${ID}`)).toBeNull();
    expect(youtubeId(`https://youtube.com.example.com/watch?v=${ID}`)).toBeNull();
    expect(youtubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(youtubeId("https://www.youtube.com/watch?v=abc<script>12")).toBeNull();
    expect(youtubeId("https://www.youtube.com/channel/abcDEF12345")).toBeNull();
    expect(youtubeId("not a url")).toBeNull();
  });
});
