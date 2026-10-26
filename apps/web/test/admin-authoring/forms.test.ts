import { describe, expect, it } from "vitest";
import type { AdminItem } from "@open-lms/types";
import { itemPatch, itemToForm, validateItemForm } from "@/components/admin/courses/item-form";
import { parseMarkdownBlocks } from "@/components/admin/courses/markdown-preview";
import { decisionProblem } from "@/components/admin/grading/grading-detail";
import { staffProblem } from "@/components/admin/courses/staff-tab";
import { fixTarget } from "@/components/admin/courses/publish-panel";
import { scoreSummary } from "@/components/admin/courses/authoring-model";

const assignment: AdminItem = {
  kind: "ASSIGNMENT",
  id: "it1",
  sectionId: "s1",
  title: "Build it",
  isPreview: false,
  durationSeconds: 0,
  assignment: {
    instructions: "Do it",
    rubric: [{ id: "c1", title: "Works", description: null, maxPoints: 10 }],
    passPoints: 6,
    dueDays: null,
    allowLate: false,
    acceptText: true,
    acceptFiles: false,
    acceptUrl: false,
    maxFiles: 0,
  },
};

describe("item form", () => {
  it("sends nothing when nothing changed, and whole groups when something did", () => {
    const base = itemToForm(assignment);
    expect(itemPatch(base, base)).toEqual({ patch: {}, questionIds: null });
    const next = { ...base, minutes: "5", assignment: { ...base.assignment!, rubric: [...base.assignment!.rubric, { title: "Style", description: "", maxPoints: "5" }] } };
    const { patch } = itemPatch(base, next);
    expect(patch.durationSeconds).toBe(300);
    expect(patch.assignment?.rubric).toEqual([
      { id: "c1", title: "Works", description: null, maxPoints: 10 },
      { title: "Style", description: null, maxPoints: 5 },
    ]);
    expect(patch.assignment?.passPoints).toBe(6);
  });

  it("validates the rubric, pass mark and submission kinds", () => {
    const base = itemToForm(assignment);
    const bad = { ...base, assignment: { ...base.assignment!, passPoints: "11", acceptText: false } };
    const e = validateItemForm(bad);
    expect(e.passPoints).toMatch(/above the rubric total/);
    expect(e.accept).toBeDefined();
  });

  it("turns quiz minutes into seconds and sends the fixed question order separately", () => {
    const quiz: AdminItem = {
      kind: "QUIZ",
      id: "q1",
      sectionId: "s1",
      title: "Check",
      isPreview: false,
      durationSeconds: 0,
      quiz: { instructions: null, selection: "FIXED", drawCount: null, drawTags: [], passPercent: 70, timeLimitSeconds: null, maxAttempts: null, shuffleQuestions: false, shuffleOptions: false, reveal: "AFTER_SUBMIT", questionIds: ["a"] },
    };
    const base = itemToForm(quiz);
    const r = itemPatch(base, { ...base, quiz: { ...base.quiz!, timeLimitMinutes: "15", questionIds: ["b", "a"] } });
    expect(r.patch.quiz?.timeLimitSeconds).toBe(900);
    expect(r.questionIds).toEqual(["b", "a"]);
  });
});

describe("grading decisions", () => {
  const rubric = [{ id: "c1", title: "Works", description: null, maxPoints: 10 }];
  it("needs every score and the pass mark to approve, and feedback otherwise", () => {
    expect(decisionProblem("APPROVED", scoreSummary(rubric, {}, 6), "", 6)).toMatch(/Score every criterion/);
    expect(decisionProblem("APPROVED", scoreSummary(rubric, { c1: "5" }, 6), "", 6)).toMatch(/at least 6/);
    expect(decisionProblem("APPROVED", scoreSummary(rubric, { c1: "7" }, 6), "", 6)).toBeNull();
    expect(decisionProblem("CHANGES_REQUESTED", scoreSummary(rubric, { c1: "3" }, 6), " ", 6)).toMatch(/what to change/);
    expect(decisionProblem("REJECTED", scoreSummary(rubric, { c1: "30" }, 6), "no", 6)).toMatch(/out of range/);
  });
});

describe("small rules", () => {
  it("keeps an owner on the team", () => {
    const u = { id: "u", username: "u", displayName: "U", avatarUrl: null, headline: null, role: "INSTRUCTOR" as const, listed: true };
    expect(staffProblem([{ ...u, courseRole: "EDITOR" }])).toMatch(/owner/);
    expect(staffProblem([{ ...u, courseRole: "OWNER" }])).toBeNull();
  });

  it("links checklist entries to where they are fixed", () => {
    expect(fixTarget({ code: "VIDEO_NOT_READY", message: "", itemId: "x" })).toMatchObject({ tab: "curriculum", item: "x" });
    expect(fixTarget({ code: "NO_PRICE", message: "" }).tab).toBe("pricing");
  });

  it("parses markdown into safe blocks", () => {
    expect(parseMarkdownBlocks("# Title\n\n- a\n- b\n\n```\n<script>\n```\nplain <b>text</b>")).toEqual([
      { type: "heading", level: 1, text: "Title" },
      { type: "list", ordered: false, items: ["a", "b"] },
      { type: "code", text: "<script>" },
      { type: "paragraph", text: "plain <b>text</b>" },
    ]);
  });
});
