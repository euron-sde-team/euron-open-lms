"use client";

/**
 * A live preview of author markdown, built as React elements (headings, lists,
 * quotes, fenced code, inline code, links, bold and italic). Nothing goes through
 * innerHTML: text stays text, and links are http(s) only (safeHref). The server renders
 * the real thing for learners; this is a close, safe approximation while typing.
 */
import { Fragment, type ReactNode } from "react";
import { cn } from "@open-lms/ui";
import { parseInline } from "@/lib/text";

export type MdBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string };

export function parseMarkdownBlocks(input: string): MdBlock[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    const t = para.join("\n").trim();
    if (t) out.push({ type: "paragraph", text: t });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? "")) code.push(lines[i++] ?? "");
      out.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      out.push({ type: "heading", level: Math.min(3, h[1]!.length) as 1 | 2 | 3, text: h[2]!.trim() });
      continue;
    }
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]!);
      const items = [li[2]!];
      while (i + 1 < lines.length) {
        const next = (lines[i + 1] ?? "").match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (!next || /\d/.test(next[1]!) !== ordered) break;
        items.push(next[2]!);
        i++;
      }
      out.push({ type: "list", ordered, items });
      continue;
    }
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      flush();
      const quote = [q[1]!];
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1] ?? "")) quote.push((lines[++i] ?? "").replace(/^>\s?/, ""));
      out.push({ type: "quote", text: quote.join("\n") });
      continue;
    }
    if (!line.trim()) flush();
    else para.push(line);
  }
  flush();
  return out;
}

/** **bold** and *italic* / _italic_ inside a plain text run. */
function emphasis(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*\n]+)\*\*|(?<![\w*])[*_]([^*_\n]+)[*_](?![\w*])/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(m[1] !== undefined ? <strong key={`${key}b${n++}`}>{m[1]}</strong> : <em key={`${key}i${n++}`}>{m[2]}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s, i) =>
        s.type === "code" ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
            {s.text}
          </code>
        ) : s.type === "link" ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="text-link underline-offset-4 hover:underline">
            {s.text}
          </a>
        ) : (
          <Fragment key={i}>
            {s.text.split("\n").map((ln, j, arr) => (
              <Fragment key={j}>
                {emphasis(ln, `${i}-${j}`)}
                {j < arr.length - 1 ? <br /> : null}
              </Fragment>
            ))}
          </Fragment>
        ),
      )}
    </>
  );
}

export function MarkdownPreview({ source, className, empty = "Nothing to preview yet." }: { source: string; className?: string; empty?: string }) {
  const blocks = parseMarkdownBlocks(source);
  if (!blocks.length) return <p className={cn("text-[13.5px] text-subtle-foreground", className)}>{empty}</p>;
  return (
    <div className={cn("space-y-3 text-[15px] leading-relaxed text-foreground", className)}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading":
            return b.level === 1 ? (
              <h3 key={i} className="font-display text-[22px] font-semibold tracking-[-0.015em]">
                <Inline text={b.text} />
              </h3>
            ) : b.level === 2 ? (
              <h4 key={i} className="font-display text-[18px] font-semibold tracking-[-0.01em]">
                <Inline text={b.text} />
              </h4>
            ) : (
              <h5 key={i} className="text-[15.5px] font-semibold">
                <Inline text={b.text} />
              </h5>
            );
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={cn("space-y-1 pl-5", b.ordered ? "list-decimal" : "list-disc")}>
                {b.items.map((t, j) => (
                  <li key={j}>
                    <Inline text={t} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-border pl-3 text-muted-foreground">
                <Inline text={b.text} />
              </blockquote>
            );
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[13px] leading-snug">
                <code>{b.text}</code>
              </pre>
            );
          default:
            return (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
        }
      })}
    </div>
  );
}

/**
 * HTML the API rendered and sanitised (submission bodies, assignment instructions).
 * Only ever pass `*Html` fields from API responses here, never user input.
 */
export function ServerHtml({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn(
        "space-y-3 text-[15px] leading-relaxed text-foreground [&_a]:text-link [&_a]:underline-offset-4 hover:[&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:font-display [&_h1]:text-[20px] [&_h1]:font-semibold [&_h2]:font-display [&_h2]:text-[18px] [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

