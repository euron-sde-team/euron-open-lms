/**
 * Pure helpers for the authoring screens: rubric totals and scoring, question
 * validation per kind (mirrors the API's normaliseQuestion so mistakes show inline
 * before a round trip), and the price book's major-unit inputs.
 */
import type { AdminPrice, AdminQuestion, QuestionKind, RubricCriterion, TextMatch } from "@open-lms/types";
import type { AdminQuestionDraft, AdminQuestionInput } from "@open-lms/api-client";
import { toMajorString, toMinor } from "@/lib/money";

// ─── Rubrics ────────────────────────────────────────────────────────────────

export interface RubricRow {
  id?: string;
  title: string;
  description: string;
  maxPoints: string;
}

/** The points a rubric can award (rows whose max is not a positive whole number count as zero). */
export function rubricTotal(rows: readonly { maxPoints: number | string }[]): number {
  return rows.reduce((n, r) => {
    const v = typeof r.maxPoints === "number" ? r.maxPoints : Number(r.maxPoints);
    return n + (Number.isInteger(v) && v > 0 ? v : 0);
  }, 0);
}

/** Errors per row index ("title", "maxPoints"), and a form-level one for the pass mark. */
export function rubricErrors(rows: readonly RubricRow[], passPoints: string): { rows: Record<number, { title?: string; maxPoints?: string }>; passPoints?: string } {
  const out: Record<number, { title?: string; maxPoints?: string }> = {};
  rows.forEach((r, i) => {
    const e: { title?: string; maxPoints?: string } = {};
    if (!r.title.trim()) e.title = "Name the criterion.";
    const v = Number(r.maxPoints);
    if (!Number.isInteger(v) || v < 1 || v > 1000) e.maxPoints = "Use a whole number from 1 to 1000.";
    if (e.title || e.maxPoints) out[i] = e;
  });
  let pass: string | undefined;
  if (passPoints.trim()) {
    const p = Number(passPoints);
    if (!Number.isInteger(p) || p < 0) pass = "Use a whole number of points.";
    else if (p > rubricTotal(rows)) pass = `The pass mark cannot be above the rubric total (${rubricTotal(rows)}).`;
  }
  return { rows: out, passPoints: pass };
}

export function rubricFromRows(rows: readonly RubricRow[]): { id?: string; title: string; description: string | null; maxPoints: number }[] {
  return rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), title: r.title.trim(), description: r.description.trim() || null, maxPoints: Number(r.maxPoints) }));
}

export function rowsFromRubric(rubric: readonly RubricCriterion[]): RubricRow[] {
  return rubric.map((c) => ({ id: c.id, title: c.title, description: c.description ?? "", maxPoints: String(c.maxPoints) }));
}

/** A grader's score for one criterion: a whole number within 0..max, or null when not entered or out of range. */
export function parseScore(raw: string, max: number): number | null {
  if (raw.trim() === "") return null;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > max || !Number.isInteger(v)) return null;
  return v;
}

export interface ScoreSummary {
  total: number;
  max: number;
  /** Every criterion has a valid score. */
  complete: boolean;
  invalid: string[];
  passes: boolean | null;
}

export function scoreSummary(rubric: readonly RubricCriterion[], raw: Record<string, string>, passPoints: number | null): ScoreSummary {
  let total = 0;
  const invalid: string[] = [];
  let complete = true;
  for (const c of rubric) {
    const s = raw[c.id] ?? "";
    const v = parseScore(s, c.maxPoints);
    if (v === null) {
      complete = false;
      if (s.trim() !== "") invalid.push(c.id);
    } else total += v;
  }
  const max = rubricTotal(rubric);
  return { total, max, complete, invalid, passes: passPoints === null ? null : total >= passPoints };
}

// ─── Questions ──────────────────────────────────────────────────────────────

export interface QuestionForm {
  kind: QuestionKind;
  prompt: string;
  explanation: string;
  points: string;
  options: { id?: string; text: string; correct: boolean }[];
  acceptedAnswers: string[];
  matchMode: TextMatch;
  tags: string;
}

export type QuestionErrors = Partial<Record<"prompt" | "points" | "options" | "acceptedAnswers" | "correct", string>>;

const TRUE_FALSE = () => [
  { text: "True", correct: true },
  { text: "False", correct: false },
];

export function emptyQuestion(kind: QuestionKind = "SINGLE"): QuestionForm {
  return {
    kind,
    prompt: "",
    explanation: "",
    points: "1",
    options: kind === "TRUE_FALSE" ? TRUE_FALSE() : kind === "SHORT_TEXT" ? [] : [{ text: "", correct: kind === "SINGLE" }, { text: "", correct: false }],
    acceptedAnswers: kind === "SHORT_TEXT" ? [""] : [],
    matchMode: "CASE_INSENSITIVE",
    tags: "",
  };
}

/** Switch kinds, keeping what still makes sense (the prompt, choice texts between SINGLE and MULTI). */
export function changeKind(form: QuestionForm, kind: QuestionKind): QuestionForm {
  if (kind === form.kind) return form;
  const base = emptyQuestion(kind);
  const choice = (k: QuestionKind) => k === "SINGLE" || k === "MULTI";
  let options = base.options;
  if (choice(kind) && choice(form.kind) && form.options.length) {
    options = form.options.map((o) => ({ ...o }));
    if (kind === "SINGLE") {
      const first = options.findIndex((o) => o.correct);
      options = options.map((o, i) => ({ ...o, correct: i === (first === -1 ? 0 : first) }));
    }
  }
  return { ...base, prompt: form.prompt, explanation: form.explanation, points: form.points, tags: form.tags, options };
}

export function questionToForm(q: Pick<AdminQuestion, "kind" | "prompt" | "explanation" | "points" | "options" | "acceptedAnswers" | "matchMode" | "tags">): QuestionForm {
  return {
    kind: q.kind,
    prompt: q.prompt,
    explanation: q.explanation ?? "",
    points: String(q.points),
    options: q.options.map((o) => ({ id: o.id, text: o.text, correct: o.correct })),
    acceptedAnswers: q.kind === "SHORT_TEXT" ? (q.acceptedAnswers.length ? q.acceptedAnswers.slice() : [""]) : [],
    matchMode: q.matchMode,
    tags: q.tags.join(", "),
  };
}

export const parseTags = (raw: string): string[] => [...new Set(raw.split(/[,\n]/).map((t) => t.trim().toLowerCase()).filter(Boolean))];

export function validateQuestion(f: QuestionForm): QuestionErrors {
  const e: QuestionErrors = {};
  if (!f.prompt.trim()) e.prompt = "Write the question.";
  else if (f.prompt.length > 5000) e.prompt = "Keep the question under 5000 characters.";
  const pts = Number(f.points);
  if (!Number.isInteger(pts) || pts < 1 || pts > 100) e.points = "Use a whole number from 1 to 100.";

  if (f.kind === "SHORT_TEXT") {
    const answers = f.acceptedAnswers.map((a) => a.trim()).filter(Boolean);
    if (answers.length < 1 || answers.length > 10) e.acceptedAnswers = "Add 1 to 10 accepted answers.";
    else if (answers.some((a) => a.length > 200)) e.acceptedAnswers = "Each accepted answer is at most 200 characters.";
    else if (f.matchMode === "REGEX") {
      for (const a of answers) {
        try {
          new RegExp(`^(?:${a})$`, "iu");
        } catch {
          e.acceptedAnswers = `Not a valid pattern: ${a}`;
          break;
        }
      }
    }
    return e;
  }

  const correct = f.options.filter((o) => o.correct).length;
  if (f.kind === "TRUE_FALSE") {
    if (correct !== 1) e.correct = "Mark True or False as the answer.";
    return e;
  }
  if (f.options.length < 2 || f.options.length > 8) e.options = "Give 2 to 8 options.";
  else if (f.options.some((o) => !o.text.trim())) e.options = "Every option needs text.";
  else if (f.options.some((o) => o.text.length > 500)) e.options = "Options are at most 500 characters.";
  if (f.kind === "SINGLE" && correct !== 1) e.correct = "Mark exactly one option as correct.";
  if (f.kind === "MULTI" && correct < 1) e.correct = "Mark at least one option as correct.";
  return e;
}

export function formToInput(f: QuestionForm): AdminQuestionInput {
  const base: AdminQuestionInput = {
    kind: f.kind,
    prompt: f.prompt.trim(),
    explanation: f.explanation.trim() || null,
    points: Number(f.points),
    tags: parseTags(f.tags),
  };
  if (f.kind === "SHORT_TEXT") return { ...base, options: [], acceptedAnswers: f.acceptedAnswers.map((a) => a.trim()).filter(Boolean), matchMode: f.matchMode };
  return { ...base, options: f.options.map((o) => ({ ...(o.id ? { id: o.id } : {}), text: o.text.trim(), correct: o.correct })), acceptedAnswers: [] };
}

/** An AI draft as a create body (option ids dropped: the server assigns them). */
export function draftToInput(d: AdminQuestionDraft): AdminQuestionInput {
  return formToInput({ ...questionToForm(d), options: d.options.map((o) => ({ text: o.text, correct: o.correct })) });
}

export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = {
  SINGLE: "Single choice",
  MULTI: "Multiple choice",
  TRUE_FALSE: "True or false",
  SHORT_TEXT: "Short answer",
};

// ─── Prices ─────────────────────────────────────────────────────────────────

export interface PriceRow {
  currency: string;
  amount: string;
  compareAt: string;
}

/** One row per enabled currency (the default first), filled from the active prices. */
export function priceRows(currencies: readonly string[], prices: readonly AdminPrice[]): PriceRow[] {
  const active = prices.filter((p) => p.active && !p.interval);
  const known = [...currencies, ...active.map((p) => p.currency).filter((c) => !currencies.includes(c))];
  return known.map((currency) => {
    const p = active.find((x) => x.currency === currency);
    return {
      currency,
      amount: p ? toMajorString(p.amount.amountMinor, currency) : "",
      compareAt: p?.compareAt ? toMajorString(p.compareAt.amountMinor, currency) : "",
    };
  });
}

export type PricePayload = { currency: string; amountMinor: number; compareAtMinor: number | null }[];

/** The PUT body, or errors per currency. Empty rows are left out (that currency is not sold). */
export function pricePayload(rows: readonly PriceRow[]): { ok: true; prices: PricePayload } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const prices: PricePayload = [];
  for (const r of rows) {
    const amount = r.amount.trim();
    const compare = r.compareAt.trim();
    if (!amount) {
      if (compare) errors[r.currency] = "Set the price before a compare-at price.";
      continue;
    }
    const minor = toMinor(amount, r.currency);
    if (minor === null || !/^\d+(\.\d+)?$/.test(amount.replace(/,/g, ""))) {
      errors[r.currency] = "Enter the price as a number, like 49.99.";
      continue;
    }
    if (minor <= 0) {
      errors[r.currency] = "Set a price above zero, or make the course free.";
      continue;
    }
    let compareMinor: number | null = null;
    if (compare) {
      compareMinor = toMinor(compare, r.currency);
      if (compareMinor === null || !/^\d+(\.\d+)?$/.test(compare.replace(/,/g, ""))) {
        errors[r.currency] = "Enter the compare-at price as a number.";
        continue;
      }
      if (compareMinor <= minor) {
        errors[r.currency] = "The compare-at price must be above the price.";
        continue;
      }
    }
    prices.push({ currency: r.currency, amountMinor: minor, compareAtMinor: compareMinor });
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, prices };
}
