/** Pure helpers over the classroom curriculum: order, neighbours, ring values, labels. */
import type { Classroom, ClassroomItem, ClassroomSection } from "@open-lms/types";

export interface FlatItem {
  item: ClassroomItem;
  section: ClassroomSection;
  index: number;
}

export function flattenItems(sections: ClassroomSection[]): FlatItem[] {
  const out: FlatItem[] = [];
  for (const section of sections) for (const item of section.items) out.push({ item, section, index: out.length });
  return out;
}

/** Whether the viewer may open this item in the classroom (a PREVIEW viewer only gets preview items). */
export function canOpen(role: Classroom["role"], item: Pick<ClassroomItem, "isPreview">): boolean {
  return role !== "PREVIEW" || item.isPreview;
}

/**
 * Previous and next openable items around `itemId`, in curriculum order across sections.
 * Unknown ids resolve to nothing on both sides.
 */
export function neighbours(classroom: Pick<Classroom, "sections" | "role">, itemId: string | null | undefined): { prev: ClassroomItem | null; next: ClassroomItem | null } {
  const flat = flattenItems(classroom.sections).filter((f) => canOpen(classroom.role, f.item));
  const at = flat.findIndex((f) => f.item.id === itemId);
  if (at < 0) return { prev: null, next: null };
  return { prev: flat[at - 1]?.item ?? null, next: flat[at + 1]?.item ?? null };
}

export function findItem(sections: ClassroomSection[], itemId: string | null | undefined): FlatItem | null {
  if (!itemId) return null;
  return flattenItems(sections).find((f) => f.item.id === itemId) ?? null;
}

/** Where /learn/:slug sends the learner: the resume item, else the first openable item. */
export function startItemId(classroom: Pick<Classroom, "sections" | "role" | "resumeItemId">): string | null {
  if (classroom.resumeItemId && findItem(classroom.sections, classroom.resumeItemId)) return classroom.resumeItemId;
  return null;
}

export function firstItemId(classroom: Pick<Classroom, "sections" | "role">): string | null {
  return flattenItems(classroom.sections).find((f) => canOpen(classroom.role, f.item))?.item.id ?? null;
}

/** The ring value for a curriculum row: completed is full; a video shows what was watched. */
export function ringPercent(item: ClassroomItem): number {
  if (item.progress.completed) return 100;
  if (item.kind === "LECTURE" && item.lectureKind === "VIDEO") return item.progress.watchedPercent;
  return 0;
}

/** The short status after the duration: "Best 80%", "Passed", "Waiting for review". */
export function itemStatusLabel(item: ClassroomItem): string | null {
  const s = item.status;
  if (!s) return null;
  if (s.kind === "QUIZ") {
    if (s.bestPercent === null) return null;
    return `${s.passed ? "Passed" : "Best"} ${Math.round(s.bestPercent)}%`;
  }
  switch (s.submission) {
    case "SUBMITTED":
      return "Waiting for review";
    case "CHANGES_REQUESTED":
      return "Changes requested";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Not approved";
    default:
      return null;
  }
}

export function itemKindLabel(item: Pick<ClassroomItem, "kind" | "lectureKind">): string {
  if (item.kind === "QUIZ") return "Quiz";
  if (item.kind === "ASSIGNMENT") return "Assignment";
  if (item.lectureKind === "ARTICLE") return "Article";
  if (item.lectureKind === "PDF") return "PDF";
  return "Video";
}

/** Updates one item inside the classroom (for optimistic bookmarks and progress). */
export function patchItem(classroom: Classroom, itemId: string, patch: (item: ClassroomItem) => ClassroomItem): Classroom {
  let touched = false;
  const sections = classroom.sections.map((s) => {
    if (!s.items.some((i) => i.id === itemId)) return s;
    touched = true;
    const items = s.items.map((i) => (i.id === itemId ? patch(i) : i));
    return { ...s, items, completedCount: items.filter((i) => i.progress.completed).length };
  });
  return touched ? { ...classroom, sections } : classroom;
}

/** Folds a ProgressResult into the cached classroom: the item's ring, the course line, the certificate. */
export function applyProgress(classroom: Classroom, itemId: string, result: { progress: ClassroomItem["progress"]; course: { progressPercent: number; completedAt: string | null }; certificate: { serial: string } | null }): Classroom {
  const next = patchItem(classroom, itemId, (i) => ({ ...i, progress: result.progress }));
  const completedItems = next.sections.reduce((n, s) => n + s.completedCount, 0);
  return {
    ...next,
    enrollment: next.enrollment ? { ...next.enrollment, progressPercent: result.course.progressPercent, completedAt: result.course.completedAt, completedItems } : null,
    certificate: next.certificate ?? (result.certificate ? { serial: result.certificate.serial, issuedAt: new Date().toISOString() } : null),
  };
}

/** True when this result is the one that finished the course (it was not finished before). */
export function finishesCourse(before: Pick<Classroom, "enrollment"> | undefined, result: { course: { completedAt: string | null } }): boolean {
  return !!before?.enrollment && !before.enrollment.completedAt && !!result.course.completedAt;
}
