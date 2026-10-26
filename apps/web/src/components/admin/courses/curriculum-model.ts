/**
 * The curriculum builder's local model: pure moves over AdminSection[] and the
 * optimistic reducer the builder runs on (apply a move locally, keep a snapshot,
 * reconcile with what the server returns, roll back on error).
 *
 * `toIndex` follows the API: the index in the target list after the moved thing is
 * taken out (so moving within a list and across lists read the same way).
 */
import type { AdminItemSummary, AdminSection } from "@open-lms/types";

/** dnd-kit ids: one namespace for sections, items and the empty-section drop zones. */
export const sectionDndId = (id: string) => `s:${id}`;
export const itemDndId = (id: string) => `i:${id}`;
export const zoneDndId = (sectionId: string) => `z:${sectionId}`;

export type DndRef = { type: "section" | "item" | "zone"; id: string };

export function parseDndId(raw: string | number): DndRef | null {
  const s = String(raw);
  const id = s.slice(2);
  if (!id) return null;
  if (s.startsWith("s:")) return { type: "section", id };
  if (s.startsWith("i:")) return { type: "item", id };
  if (s.startsWith("z:")) return { type: "zone", id };
  return null;
}

const renumber = <T extends { position: number }>(list: T[]): T[] => list.map((x, position) => (x.position === position ? x : { ...x, position }));

/** Where an item sits now. */
export function locateItem(sections: readonly AdminSection[], itemId: string): { sectionId: string; index: number } | null {
  for (const s of sections) {
    const index = s.items.findIndex((i) => i.id === itemId);
    if (index !== -1) return { sectionId: s.id, index };
  }
  return null;
}

export function findItem(sections: readonly AdminSection[], itemId: string): AdminItemSummary | null {
  for (const s of sections) for (const i of s.items) if (i.id === itemId) return i;
  return null;
}

const clampIndex = (n: number, len: number) => Math.max(0, Math.min(len, Math.floor(n)));

/** Move a section to `toIndex`. Unknown ids leave the list as it was. */
export function moveSection(sections: readonly AdminSection[], sectionId: string, toIndex: number): AdminSection[] {
  const from = sections.findIndex((s) => s.id === sectionId);
  if (from === -1) return sections.slice();
  const rest = sections.filter((s) => s.id !== sectionId);
  rest.splice(clampIndex(toIndex, rest.length), 0, sections[from]!);
  return renumber(rest);
}

/** Move an item into `toSectionId` at `toIndex` (its own section or another one). */
export function moveItem(sections: readonly AdminSection[], itemId: string, toSectionId: string, toIndex: number): AdminSection[] {
  const at = locateItem(sections, itemId);
  if (!at || !sections.some((s) => s.id === toSectionId)) return sections.slice();
  const item = sections.find((s) => s.id === at.sectionId)!.items[at.index]!;
  return sections.map((s) => {
    let items = s.items;
    if (s.id === at.sectionId) items = items.filter((i) => i.id !== itemId);
    if (s.id === toSectionId) {
      items = items.slice();
      items.splice(clampIndex(toIndex, items.length), 0, item);
    }
    return items === s.items ? s : { ...s, items: renumber(items) };
  });
}

/**
 * Where a dragged item lands when it is over `over` (another item, or a section's
 * drop zone, or a section header). Null when the drop target is not a place for items.
 */
export function dropTarget(sections: readonly AdminSection[], activeItemId: string, over: DndRef): { sectionId: string; index: number } | null {
  if (over.type === "zone" || over.type === "section") {
    const s = sections.find((x) => x.id === over.id);
    if (!s) return null;
    const without = s.items.filter((i) => i.id !== activeItemId);
    return { sectionId: s.id, index: without.length };
  }
  if (over.id === activeItemId) return locateItem(sections, activeItemId);
  const at = locateItem(sections, over.id);
  return at;
}

// ─── Optimistic reducer ─────────────────────────────────────────────────────

export interface CurriculumState {
  sections: AdminSection[];
  /** What the list looked like before the in-flight change; null when nothing is pending. */
  snapshot: AdminSection[] | null;
  /** Moves sent but not answered yet. Server syncs wait until this is zero. */
  pending: number;
}

export type CurriculumAction =
  | { type: "sync"; sections: AdminSection[] }
  /** Start a drag: remember where everything was. */
  | { type: "begin" }
  /** Cancel a drag before anything was sent. */
  | { type: "cancel" }
  /** Live preview during a drag (does not count as pending). */
  | { type: "preview-item"; itemId: string; sectionId: string; index: number }
  /** A move that will be sent to the server. */
  | { type: "move-item"; itemId: string; sectionId: string; index: number }
  | { type: "move-section"; sectionId: string; index: number }
  /** A move was sent (after previewing during the drag). */
  | { type: "sent" }
  | { type: "commit"; sections: AdminSection[] }
  | { type: "rollback" };

export const initialCurriculum = (sections: AdminSection[]): CurriculumState => ({ sections, snapshot: null, pending: 0 });

export function curriculumReducer(state: CurriculumState, action: CurriculumAction): CurriculumState {
  switch (action.type) {
    case "sync":
      // Server data never overwrites a move the server has not answered yet.
      return state.pending > 0 || state.snapshot ? state : { ...state, sections: action.sections };
    case "begin":
      return { ...state, snapshot: state.snapshot ?? state.sections };
    case "cancel":
      return state.pending > 0 ? state : { ...state, sections: state.snapshot ?? state.sections, snapshot: null };
    case "preview-item":
      return { ...state, sections: moveItem(state.sections, action.itemId, action.sectionId, action.index) };
    case "move-item":
      return {
        sections: moveItem(state.sections, action.itemId, action.sectionId, action.index),
        snapshot: state.snapshot ?? state.sections,
        pending: state.pending + 1,
      };
    case "move-section":
      return {
        sections: moveSection(state.sections, action.sectionId, action.index),
        snapshot: state.snapshot ?? state.sections,
        pending: state.pending + 1,
      };
    case "sent":
      return { ...state, snapshot: state.snapshot ?? state.sections, pending: state.pending + 1 };
    case "commit": {
      const pending = Math.max(0, state.pending - 1);
      // The last answer is the truth; earlier answers would undo moves still in flight.
      return pending === 0 ? { sections: action.sections, snapshot: null, pending: 0 } : { ...state, pending };
    }
    case "rollback":
      return { sections: state.snapshot ?? state.sections, snapshot: null, pending: 0 };
  }
}

/** The total length of a course from its items. */
export function totalDuration(sections: readonly AdminSection[]): number {
  return sections.reduce((n, s) => n + s.items.reduce((m, i) => m + i.durationSeconds, 0), 0);
}
