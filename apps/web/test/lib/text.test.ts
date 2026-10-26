import { describe, expect, it } from "vitest";
import { activeMention, extractMentions, extractTags, insertMention, isLong, parseInline, parseMarkdownLite, safeHref, tokenize } from "@/lib/text";

describe("tokenize", () => {
  it("finds urls, mentions and tags in order", () => {
    const s = tokenize("Hi @ada_l see https://example.org/x. #Launch!");
    expect(s.map((x) => x.type)).toEqual(["text", "mention", "text", "url", "text", "tag", "text"]);
    expect(s[1]).toMatchObject({ username: "ada_l" });
    expect(s[3]).toMatchObject({ href: "https://example.org/x", text: "https://example.org/x" });
    expect(s[5]).toMatchObject({ tag: "launch" });
  });
  it("does not treat emails or url fragments as mentions or tags", () => {
    expect(tokenize("mail me at ada@example.org").some((s) => s.type === "mention")).toBe(false);
    const url = tokenize("https://example.org/page#section");
    expect(url).toHaveLength(1);
    expect(url[0]!.type).toBe("url");
    expect(tokenize("price&#39;s").some((s) => s.type === "tag")).toBe(false);
  });
  it("keeps trailing punctuation outside links and supports www", () => {
    const s = tokenize("(see www.example.org)");
    expect(s[1]).toMatchObject({ type: "url", href: "https://www.example.org/", text: "www.example.org" });
    expect(s[2]).toMatchObject({ type: "text", text: ")" });
  });
  it("supports unicode tags and requires 3+ char usernames", () => {
    expect(extractTags("#café #Café #日本")).toEqual(["café", "日本"]);
    expect(tokenize("@ab hi").some((s) => s.type === "mention")).toBe(false);
  });
  it("merges adjacent text and preserves newlines", () => {
    expect(tokenize("line one\nline two")).toEqual([{ type: "text", text: "line one\nline two" }]);
  });
  it("only ever links http and https", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://ok.example")).toBe("https://ok.example/");
  });
});

describe("mentions while typing", () => {
  it("detects the active @query at the caret", () => {
    expect(activeMention("hello @ad", 9)).toEqual({ start: 6, query: "ad" });
    expect(activeMention("hello @", 7)).toEqual({ start: 6, query: "" });
    expect(activeMention("mail a@b", 8)).toBeNull();
    expect(activeMention("done @ada ", 10)).toBeNull();
  });
  it("inserts the username with a trailing space and moves the caret", () => {
    expect(insertMention("hi @ad and", 3, 6, "ada")).toEqual({ text: "hi @ada  and", caret: 8 });
  });
  it("extracts unique mentions", () => {
    expect(extractMentions("@Ada and @ada and @lin_x")).toEqual(["ada", "lin_x"]);
  });
});

describe("isLong", () => {
  it("counts wrapped lines", () => {
    expect(isLong("short")).toBe(false);
    expect(isLong("a\nb\nc\nd\ne\nf\ng")).toBe(true);
    expect(isLong("x".repeat(70 * 7))).toBe(true);
  });
});

describe("markdown-lite", () => {
  it("splits paragraphs and fenced code", () => {
    const blocks = parseMarkdownLite("First para\nstill first\n\n```ts\nconst a = 1;\n```\nlast");
    expect(blocks).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "First para\nstill first" }] },
      { type: "code", text: "const a = 1;", lang: "ts" },
      { type: "paragraph", inlines: [{ type: "text", text: "last" }] },
    ]);
  });
  it("parses inline code and safe links only", () => {
    expect(parseInline("use `npm i` then [docs](https://example.org) or [bad](javascript:x)")).toEqual([
      { type: "text", text: "use " },
      { type: "code", text: "npm i" },
      { type: "text", text: " then " },
      { type: "link", text: "docs", href: "https://example.org/" },
      { type: "text", text: " or [bad](javascript:x)" },
    ]);
  });
  it("leaves an unterminated fence as code to the end", () => {
    expect(parseMarkdownLite("```\nopen")).toEqual([{ type: "code", text: "open", lang: null }]);
  });
});
