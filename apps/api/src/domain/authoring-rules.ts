/**
 * Authoring rules for the /admin course editor: question validation per kind, video
 * reference checks per provider, the publish checklist, rubric criterion ids and slug
 * suffixes. Pure, so every rule is unit-tested (test/unit/authoring-rules.test.ts); the
 * services only load facts and write what these functions return.
 *
 * Rules worth knowing:
 *   - SINGLE has 2 to 8 options and exactly one correct; MULTI 2 to 8 and at least one
 *     correct; TRUE_FALSE exactly the options True and False with one correct;
 *     SHORT_TEXT has no options and 1 to 10 accepted answers. REGEX answers must compile
 *     (the grader anchors them as ^(?:...)$ with the iu flags) and stay under 200 chars.
 *   - Option ids are generated ("a", "b", ...) when the author sends none, so the
 *     answer key never depends on what a client invented.
 *   - Video refs: EVS ids are [A-Za-z0-9_-]{1,64}; HLS and MP4 must be https URLs;
 *     YouTube takes a URL or the bare 11-character id and stores the id.
 */
import type { AccessMode, AdminCourse, QuestionKind, RubricCriterion, TextMatch, VideoProvider, VideoStatus } from "@open-lms/types";
import { safeUrl, youtubeId } from "./safe-url";
import { slugify } from "./slug";

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(message: string): Result<T> => ({ ok: false, message });

// ─── Questions ──────────────────────────────────────────────────────────────

export interface QuestionInput {
  kind: QuestionKind;
  options?: { id?: string; text: string; correct: boolean }[];
  acceptedAnswers?: string[];
  matchMode?: TextMatch;
}

export interface QuestionKey {
  options: { id: string; text: string; correct: boolean }[];
  acceptedAnswers: string[];
  matchMode: TextMatch;
}

const OPTION_ID = /^[a-z0-9]{1,8}$/;
export const MAX_REGEX_LENGTH = 200;

/** Option ids for a list: the author's (validated, unique) or the next free letter. */
export function withOptionIds(options: { id?: string; text: string; correct: boolean }[]): Result<{ id: string; text: string; correct: boolean }[]> {
  const used = new Set<string>();
  for (const o of options) {
    if (o.id === undefined) continue;
    if (!OPTION_ID.test(o.id)) return fail("Option ids are 1 to 8 lower-case letters or digits");
    if (used.has(o.id)) return fail(`Duplicate option id ${o.id}`);
    used.add(o.id);
  }
  let next = 0;
  const fresh = (): string => {
    for (;;) {
      const id = letterId(next++);
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
  return ok(options.map((o) => ({ id: o.id ?? fresh(), text: o.text, correct: o.correct })));
}

/** 0 -> "a", 25 -> "z", 26 -> "aa". */
function letterId(n: number): string {
  let s = "";
  let x = n;
  do {
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
}

/** The answer key a question stores, or why the input is not a valid question of its kind. */
export function normaliseQuestion(q: QuestionInput): Result<QuestionKey> {
  const options = (q.options ?? []).map((o) => ({ ...o, text: o.text.trim() }));
  const accepted = (q.acceptedAnswers ?? []).map((a) => a.trim());
  const matchMode = q.matchMode ?? "CASE_INSENSITIVE";
  if (options.some((o) => !o.text || o.text.length > 500)) return fail("Each option needs 1 to 500 characters of text");

  if (q.kind === "SHORT_TEXT") {
    if (options.length) return fail("Short-answer questions have no options");
    if (accepted.length < 1 || accepted.length > 10) return fail("Short-answer questions need 1 to 10 accepted answers");
    if (accepted.some((a) => !a || a.length > 200)) return fail("Each accepted answer needs 1 to 200 characters");
    if (matchMode === "REGEX") {
      for (const a of accepted) {
        if (a.length > MAX_REGEX_LENGTH) return fail(`Patterns are at most ${MAX_REGEX_LENGTH} characters`);
        try {
          new RegExp(`^(?:${a})$`, "iu");
        } catch {
          return fail(`Not a valid pattern: ${a}`);
        }
      }
    }
    return ok({ options: [], acceptedAnswers: accepted, matchMode });
  }

  if (accepted.length) return fail("Only short-answer questions have accepted answers");
  const withIds = withOptionIds(options);
  if (!withIds.ok) return withIds;
  const opts = withIds.value;
  const correct = opts.filter((o) => o.correct).length;

  if (q.kind === "TRUE_FALSE") {
    const texts = opts.map((o) => o.text.toLowerCase()).sort();
    if (opts.length !== 2 || texts[0] !== "false" || texts[1] !== "true") return fail("True/false questions have exactly the options True and False");
    if (correct !== 1) return fail("Mark exactly one of True or False as correct");
    return ok({ options: opts.map((o) => ({ ...o, text: o.text.toLowerCase() === "true" ? "True" : "False" })), acceptedAnswers: [], matchMode });
  }
  if (opts.length < 2 || opts.length > 8) return fail("Choice questions have 2 to 8 options");
  if (q.kind === "SINGLE" && correct !== 1) return fail("Mark exactly one option as correct");
  if (q.kind === "MULTI" && correct < 1) return fail("Mark at least one option as correct");
  return ok({ options: opts, acceptedAnswers: [], matchMode });
}

/** Tags are trimmed, lower-cased and de-duplicated. */
export function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

// ─── Video references ───────────────────────────────────────────────────────

export const EVS_VIDEO_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The stored form of a video reference for its provider, or why it is not acceptable. */
export function normaliseVideoRef(provider: VideoProvider, raw: string): Result<string> {
  const s = raw.trim();
  if (!s) return fail("A video reference is required");
  if (provider === "EVS") return EVS_VIDEO_ID.test(s) ? ok(s) : fail("An EVS video id is 1 to 64 letters, digits, - or _");
  if (provider === "YOUTUBE") {
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return ok(s);
    const id = youtubeId(s);
    return id ? ok(id) : fail("Paste a YouTube link or an 11-character video id");
  }
  const url = safeUrl(s);
  if (!url || !url.startsWith("https://") || !/^https:\/\//i.test(s)) return fail("Use an https:// URL");
  return ok(url);
}

/** EVS reports its own status words; anything not clearly ready or failed is still processing. */
export function evsStatusOf(status: string | null | undefined): VideoStatus {
  const s = (status ?? "").toLowerCase();
  if (s === "ready" || s === "available" || s === "published") return "READY";
  if (s === "failed" || s === "error" || s === "errored") return "FAILED";
  return "PROCESSING";
}

// ─── Publish checklist ──────────────────────────────────────────────────────

export type ChecklistEntry = AdminCourse["publishChecklist"][number];

export interface ChecklistFacts {
  itemCount: number;
  hasCover: boolean;
  description: string;
  accessMode: AccessMode;
  /** Active one-time prices in currencies the academy sells in. */
  sellablePrices: number;
  videos: { itemId: string; title: string; hasRef: boolean; status: VideoStatus }[];
  quizzes: { itemId: string; title: string; selection: "FIXED" | "RANDOM"; questions: number; drawable: number }[];
}

export const MIN_DESCRIPTION = 30;

/** What blocks publishing; empty means the course may go live. */
export function publishChecklist(f: ChecklistFacts): ChecklistEntry[] {
  const out: ChecklistEntry[] = [];
  if (f.itemCount === 0) out.push({ code: "NO_ITEMS", message: "Add at least one lesson" });
  if (!f.hasCover) out.push({ code: "NO_COVER", message: "Upload a cover image" });
  if (f.description.trim().length < MIN_DESCRIPTION) out.push({ code: "NO_DESCRIPTION", message: `Write a description of at least ${MIN_DESCRIPTION} characters` });
  if (f.accessMode === "PAID" && f.sellablePrices === 0) out.push({ code: "NO_PRICE", message: "Set a price, or make the course free or subscription-only" });
  for (const v of f.videos) {
    if (!v.hasRef) out.push({ code: "VIDEO_NOT_READY", message: `"${v.title}" has no video yet`, itemId: v.itemId });
    else if (v.status !== "READY") out.push({ code: "VIDEO_NOT_READY", message: v.status === "FAILED" ? `The video for "${v.title}" failed to process` : `The video for "${v.title}" is still processing`, itemId: v.itemId });
  }
  for (const q of f.quizzes) {
    const empty = q.selection === "FIXED" ? q.questions === 0 : q.drawable === 0;
    if (empty) out.push({ code: "EMPTY_QUIZ", message: `The quiz "${q.title}" has no questions`, itemId: q.itemId });
  }
  return out;
}

// ─── Rubrics ────────────────────────────────────────────────────────────────

/** Criteria with ids: the author's kept (submissions are scored by them), missing ones generated as c1, c2, ... */
export function withCriterionIds(rubric: { id?: string; title: string; description?: string | null; maxPoints: number }[]): RubricCriterion[] {
  const used = new Set(rubric.map((c) => c.id).filter((x): x is string => !!x));
  let n = 1;
  return rubric.map((c) => {
    let id = c.id;
    if (!id) {
      while (used.has(`c${n}`)) n++;
      id = `c${n}`;
      used.add(id);
    }
    return { id, title: c.title, description: c.description ?? null, maxPoints: c.maxPoints };
  });
}

// ─── Slugs and ordering ─────────────────────────────────────────────────────

export const COURSE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isCourseSlug(s: string): boolean {
  return s.length >= 3 && s.length <= 60 && COURSE_SLUG.test(s);
}

/**
 * The slug a title starts from (domain/slug.ts). Titles too short to make three slug
 * characters get the fallback word appended ("Go" -> "go-course"), instead of the
 * company-style "-co" padding.
 */
export function slugBase(title: string, fallback: string): string {
  const letters = title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return slugify(letters.length >= 3 ? title : `${title} ${fallback}`);
}

/** `base`, else `base-2`, `base-3`, ... the first not in `taken` (compared case-insensitively). */
export function nextSlug(base: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((s) => s.toLowerCase()));
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!set.has(candidate)) return candidate;
  }
}

/** True when `ids` is exactly `current` in some order (no extras, no gaps, no repeats). */
export function isPermutation(ids: readonly string[], current: readonly string[]): boolean {
  if (ids.length !== current.length || new Set(ids).size !== ids.length) return false;
  const have = new Set(current);
  return ids.every((id) => have.has(id));
}
