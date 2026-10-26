import { describe, expect, it } from "vitest";
import type { Classroom, ClassroomItem } from "@open-lms/types";
import { applyProgress, finishesCourse, firstItemId, itemStatusLabel, neighbours, ringPercent, startItemId } from "@/lib/classroom/curriculum";

const item = (id: string, extra: Partial<ClassroomItem> = {}): ClassroomItem => ({
  id,
  kind: "LECTURE",
  title: id,
  lectureKind: "VIDEO",
  durationSeconds: 60,
  isPreview: false,
  progress: { completed: false, completedAt: null, positionSeconds: 0, watchedPercent: 0 },
  status: null,
  bookmarked: false,
  ...extra,
});

const classroom = (role: Classroom["role"] = "LEARNER"): Classroom => ({
  course: { id: "c", slug: "c", title: "C", coverUrl: null, certificateEnabled: true },
  role,
  enrollment: { id: "e", progressPercent: 0, completedItems: 0, totalItems: 4, completedAt: null, validUntil: null },
  sections: [
    { id: "s1", title: "One", items: [item("a", { isPreview: true }), item("b")], completedCount: 0 },
    { id: "s2", title: "Two", items: [], completedCount: 0 },
    { id: "s3", title: "Three", items: [item("c"), item("d", { isPreview: true })], completedCount: 0 },
  ],
  resumeItemId: "c",
  certificate: null,
  settings: { videoCompletePercent: 90 },
});

describe("curriculum navigation", () => {
  it("walks across sections, skipping empty ones", () => {
    expect(neighbours(classroom(), "b")).toMatchObject({ prev: { id: "a" }, next: { id: "c" } });
    expect(neighbours(classroom(), "a").prev).toBeNull();
    expect(neighbours(classroom(), "d").next).toBeNull();
  });

  it("unknown items have no neighbours", () => {
    expect(neighbours(classroom(), "zzz")).toEqual({ prev: null, next: null });
    expect(neighbours(classroom(), null)).toEqual({ prev: null, next: null });
  });

  it("a preview viewer only moves between preview items", () => {
    expect(neighbours(classroom("PREVIEW"), "a")).toMatchObject({ prev: null, next: { id: "d" } });
  });

  it("resumes where the learner left off, else nothing", () => {
    expect(startItemId(classroom())).toBe("c");
    expect(startItemId({ ...classroom(), resumeItemId: null })).toBeNull();
    expect(startItemId({ ...classroom(), resumeItemId: "gone" })).toBeNull();
    expect(firstItemId(classroom())).toBe("a");
  });

  it("rings and status labels", () => {
    expect(ringPercent(item("x", { progress: { completed: false, completedAt: null, positionSeconds: 10, watchedPercent: 40 } }))).toBe(40);
    expect(ringPercent(item("x", { kind: "QUIZ", lectureKind: null, progress: { completed: false, completedAt: null, positionSeconds: 0, watchedPercent: 40 } }))).toBe(0);
    expect(itemStatusLabel(item("q", { kind: "QUIZ", status: { kind: "QUIZ", bestPercent: 80, passed: true } }))).toBe("Passed 80%");
    expect(itemStatusLabel(item("w", { kind: "ASSIGNMENT", status: { kind: "ASSIGNMENT", submission: "SUBMITTED" } }))).toBe("Waiting for review");
  });

  it("folds a progress result into the classroom and detects the finishing beat", () => {
    const before = classroom();
    const result = { progress: { completed: true, completedAt: "2026-01-01T00:00:00Z", positionSeconds: 60, watchedPercent: 100 }, justCompleted: true, course: { progressPercent: 100, completedAt: "2026-01-01T00:00:00Z" }, certificate: { serial: "S1" } };
    const after = applyProgress(before, "b", result);
    expect(after.sections[0]!.completedCount).toBe(1);
    expect(after.enrollment).toMatchObject({ progressPercent: 100, completedItems: 1 });
    expect(after.certificate?.serial).toBe("S1");
    expect(finishesCourse(before, result)).toBe(true);
    expect(finishesCourse(after, result)).toBe(false);
  });
});
