/**
 * Markdown to HTML for everything authors and learners write: course descriptions,
 * articles, quiz prompts, assignment instructions, submissions, Q&A.
 *
 * Safe by construction rather than by scrubbing afterwards:
 *   - raw HTML in the source is escaped, never passed through (html: false). The source
 *     system rendered assignment markdown with rehype-raw and no sanitizer;
 *   - every link and image URL goes through safeUrl (https/http only; no javascript:,
 *     data: or protocol-relative tricks), and links open with rel="noopener noreferrer
 *     nofollow ugc";
 *   - images are allowed only in staff-authored content (`allowImages`).
 * Rendering happens on the server, so the web app inserts trusted HTML only.
 */
import MarkdownIt from "markdown-it";
import { safeUrl } from "./safe-url";

function build(allowImages: boolean): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });
  md.validateLink = (url: string) => safeUrl(url) !== null;
  if (!allowImages) md.disable("image");
  const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    token.attrSet("rel", "noopener noreferrer nofollow ugc");
    token.attrSet("target", "_blank");
    return defaultLink(tokens, idx, options, env, self);
  };
  if (allowImages) {
    const defaultImage = md.renderer.rules.image!;
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      tokens[idx].attrSet("loading", "lazy");
      return defaultImage(tokens, idx, options, env, self);
    };
  }
  return md;
}

const staff = build(true);
const community = build(false);

/** Staff-authored content (courses, lectures, quizzes, assignments): images allowed. */
export function renderAuthored(src: string | null | undefined): string {
  return src ? staff.render(src) : "";
}

/** Learner-written content (submissions, Q&A, reviews): no images. */
export function renderCommunity(src: string | null | undefined): string {
  return src ? community.render(src) : "";
}

/** Plain text for excerpts, search snippets and emails: markdown syntax removed. */
export function plainText(src: string | null | undefined, max = 200): string {
  if (!src) return "";
  const text = community
    .render(src)
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e] ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
