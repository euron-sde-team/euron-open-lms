/**
 * Plain-text parsing for user content. Everything renders as React text nodes
 * and elements built from these segments: user content never goes through
 * dangerouslySetInnerHTML.
 */

export type Segment =
  | { type: "text"; text: string }
  | { type: "url"; text: string; href: string }
  | { type: "mention"; text: string; username: string }
  | { type: "tag"; text: string; tag: string };

// One pass over three alternatives so overlapping matches resolve left to right.
const TOKEN = /(\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+)|(^|[^\w@/])@([A-Za-z0-9_]{3,30})\b|(^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_]{1,50})/gu;
const TRAILING = /[.,!?;:'")\]}]+$/;

/** Only http(s) links are ever produced, so `javascript:` and friends can not sneak in. */
export function safeHref(raw: string): string | null {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const u = new URL(candidate);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function tokenize(input: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  const pushText = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === "text") prev.text += t;
    else out.push({ type: "text", text: t });
  };
  for (const m of input.matchAll(TOKEN)) {
    const index = m.index ?? 0;
    if (m[1]) {
      let raw = m[1];
      // Keep a closing parenthesis that belongs to the URL: (see https://x.org/a_(b)).
      const trail = raw.match(TRAILING)?.[0] ?? "";
      if (trail) raw = raw.slice(0, raw.length - trail.length);
      const href = safeHref(raw);
      pushText(input.slice(last, index));
      if (href) out.push({ type: "url", text: raw, href });
      else pushText(raw);
      pushText(trail);
      last = index + m[0].length;
    } else if (m[3] !== undefined) {
      const lead = m[2] ?? "";
      pushText(input.slice(last, index) + lead);
      out.push({ type: "mention", text: `@${m[3]}`, username: m[3] });
      last = index + m[0].length;
    } else if (m[5] !== undefined) {
      const lead = m[4] ?? "";
      pushText(input.slice(last, index) + lead);
      out.push({ type: "tag", text: `#${m[5]}`, tag: m[5].toLowerCase() });
      last = index + m[0].length;
    }
  }
  pushText(input.slice(last));
  return out;
}

/** Unique lower-case hashtags in order of appearance (the composer sends these as `tags`). */
export function extractTags(input: string, max = 10): string[] {
  const seen: string[] = [];
  for (const s of tokenize(input)) {
    if (s.type === "tag" && !seen.includes(s.tag)) seen.push(s.tag);
    if (seen.length >= max) break;
  }
  return seen;
}

export function extractMentions(input: string): string[] {
  const seen: string[] = [];
  for (const s of tokenize(input)) if (s.type === "mention" && !seen.includes(s.username.toLowerCase())) seen.push(s.username.toLowerCase());
  return seen;
}

/** The @query being typed at the caret, if any: drives the mention typeahead. */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|[^\w@])@([A-Za-z0-9_]{0,30})$/);
  if (!m) return null;
  const query = m[2] ?? "";
  return { start: caret - query.length - 1, query };
}

/** Replace the active @query with the chosen username and a trailing space. */
export function insertMention(text: string, start: number, caret: number, username: string): { text: string; caret: number } {
  const insert = `@${username} `;
  const next = text.slice(0, start) + insert + text.slice(caret);
  return { text: next, caret: start + insert.length };
}

/** Rough "is this longer than N lines" check for the "See more" toggle. */
export function isLong(text: string, maxLines = 6, charsPerLine = 70): boolean {
  const lines = text.split("\n");
  let count = 0;
  for (const l of lines) count += Math.max(1, Math.ceil(l.length / charsPerLine));
  return count > maxLines;
}

// ─── Markdown-lite for Q&A ───────────────────────────────────────────────────

export type Inline = { type: "text"; text: string } | { type: "code"; text: string } | { type: "link"; text: string; href: string };
export type Block = { type: "paragraph"; inlines: Inline[] } | { type: "code"; text: string; lang: string | null };

/** Paragraphs, fenced code blocks, inline code and links ([text](url) or bare URLs). */
export function parseMarkdownLite(input: string): Block[] {
  const blocks: Block[] = [];
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    const text = para.join("\n").trim();
    if (text) blocks.push({ type: "paragraph", inlines: parseInline(text) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? "")) code.push(lines[i++] ?? "");
      blocks.push({ type: "code", text: code.join("\n"), lang: fence[1] || null });
      continue;
    }
    if (!line.trim()) flush();
    else para.push(line);
  }
  flush();
  return blocks;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /`([^`\n]+)`|\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)|(\bhttps?:\/\/[^\s<>"'`]+)/g;
  let last = 0;
  const pushText = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === "text") prev.text += t;
    else out.push({ type: "text", text: t });
  };
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0;
    pushText(text.slice(last, index));
    if (m[1] !== undefined) out.push({ type: "code", text: m[1] });
    else if (m[2] !== undefined && m[3] !== undefined) {
      const href = safeHref(m[3]);
      if (href) out.push({ type: "link", text: m[2], href });
      else pushText(m[0]);
    } else if (m[4]) {
      let raw = m[4];
      const trail = raw.match(TRAILING)?.[0] ?? "";
      if (trail) raw = raw.slice(0, -trail.length);
      const href = safeHref(raw);
      if (href) out.push({ type: "link", text: raw, href });
      else pushText(raw);
      pushText(trail);
    }
    last = index + m[0].length;
  }
  pushText(text.slice(last));
  return out;
}
