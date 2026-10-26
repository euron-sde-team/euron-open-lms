import { describe, expect, it } from "vitest";
import type { AdminItemSummary, AdminSection } from "@open-lms/types";
import {
  curriculumReducer,
  dropTarget,
  initialCurriculum,
  locateItem,
  moveItem,
  moveSection,
  parseDndId,
  totalDuration,
} from "@/components/admin/courses/curriculum-model";

const item = (id: string, position: number, durationSeconds = 60): AdminItemSummary => ({
  id,
  kind: "LECTURE",
  title: id,
  position,
  isPreview: false,
  durationSeconds,
  lectureKind: "VIDEO",
  videoStatus: "READY",
  meta: {},
});

const fixture = (): AdminSection[] => [
  { id: "A", title: "Intro", position: 0, items: [item("a1", 0), item("a2", 1), item("a3", 2)] },
  { id: "B", title: "Core", position: 1, items: [item("b1", 0)] },
  { id: "C", title: "Empty", position: 2, items: [] },
];

const ids = (s: AdminSection[]) => s.map((x) => `${x.id}:${x.items.map((i) => i.id).join(",")}`);

describe("moveItem", () => {
  it("reorders within a section like arrayMove and renumbers positions", () => {
    const next = moveItem(fixture(), "a1", "A", 2);
    expect(ids(next)).toEqual(["A:a2,a3,a1", "B:b1", "C:"]);
    expect(next[0]!.items.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("moves across sections, including into an empty one", () => {
    expect(ids(moveItem(fixture(), "a2", "B", 0))).toEqual(["A:a1,a3", "B:a2,b1", "C:"]);
    expect(ids(moveItem(fixture(), "b1", "C", 5))).toEqual(["A:a1,a2,a3", "B:", "C:b1"]);
  });

  it("leaves untouched sections as the same objects and ignores unknown ids", () => {
    const base = fixture();
    const next = moveItem(base, "a1", "A", 1);
    expect(next[1]).toBe(base[1]);
    expect(ids(moveItem(base, "zz", "A", 0))).toEqual(ids(base));
    expect(ids(moveItem(base, "a1", "ZZ", 0))).toEqual(ids(base));
  });
});

describe("moveSection", () => {
  it("moves a section and renumbers", () => {
    const next = moveSection(fixture(), "C", 0);
    expect(next.map((s) => s.id)).toEqual(["C", "A", "B"]);
    expect(next.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(moveSection(fixture(), "A", 99).map((s) => s.id)).toEqual(["B", "C", "A"]);
  });
});

describe("dropTarget", () => {
  it("resolves items, zones and section headers", () => {
    const s = fixture();
    expect(dropTarget(s, "a1", { type: "item", id: "b1" })).toEqual({ sectionId: "B", index: 0 });
    expect(dropTarget(s, "a1", { type: "zone", id: "C" })).toEqual({ sectionId: "C", index: 0 });
    expect(dropTarget(s, "a1", { type: "section", id: "A" })).toEqual({ sectionId: "A", index: 2 });
    expect(dropTarget(s, "a1", { type: "item", id: "a1" })).toEqual({ sectionId: "A", index: 0 });
  });

  it("parses dnd ids", () => {
    expect(parseDndId("i:x")).toEqual({ type: "item", id: "x" });
    expect(parseDndId("z:x")).toEqual({ type: "zone", id: "x" });
    expect(parseDndId("bad")).toBeNull();
  });
});

describe("curriculumReducer", () => {
  it("applies a move optimistically and commits the server answer", () => {
    let st = initialCurriculum(fixture());
    st = curriculumReducer(st, { type: "move-item", itemId: "a3", sectionId: "B", index: 1 });
    expect(ids(st.sections)).toEqual(["A:a1,a2", "B:b1,a3", "C:"]);
    expect(st.pending).toBe(1);
    // A server sync while the move is in flight must not undo it.
    st = curriculumReducer(st, { type: "sync", sections: fixture() });
    expect(ids(st.sections)).toEqual(["A:a1,a2", "B:b1,a3", "C:"]);
    const server = moveItem(fixture(), "a3", "B", 1);
    st = curriculumReducer(st, { type: "commit", sections: server });
    expect(st).toEqual({ sections: server, snapshot: null, pending: 0 });
  });

  it("rolls back to the snapshot on error", () => {
    let st = initialCurriculum(fixture());
    st = curriculumReducer(st, { type: "move-section", sectionId: "C", index: 0 });
    st = curriculumReducer(st, { type: "move-item", itemId: "a1", sectionId: "C", index: 0 });
    expect(st.pending).toBe(2);
    st = curriculumReducer(st, { type: "rollback" });
    expect(ids(st.sections)).toEqual(ids(fixture()));
    expect(st.pending).toBe(0);
    expect(st.snapshot).toBeNull();
  });

  it("previews across sections during a drag, then sends or cancels", () => {
    let st = curriculumReducer(initialCurriculum(fixture()), { type: "begin" });
    st = curriculumReducer(st, { type: "preview-item", itemId: "a1", sectionId: "C", index: 0 });
    expect(ids(st.sections)).toEqual(["A:a2,a3", "B:b1", "C:a1"]);
    expect(st.pending).toBe(0);
    const cancelled = curriculumReducer(st, { type: "cancel" });
    expect(ids(cancelled.sections)).toEqual(ids(fixture()));

    st = curriculumReducer(st, { type: "move-item", itemId: "a1", sectionId: "C", index: 0 });
    expect(st.pending).toBe(1);
    expect(locateItem(st.sections, "a1")).toEqual({ sectionId: "C", index: 0 });
    st = curriculumReducer(st, { type: "rollback" });
    expect(ids(st.sections)).toEqual(ids(fixture()));
  });

  it("only takes the last answer when two moves overlap", () => {
    let st = initialCurriculum(fixture());
    st = curriculumReducer(st, { type: "move-item", itemId: "a1", sectionId: "B", index: 0 });
    st = curriculumReducer(st, { type: "move-item", itemId: "a2", sectionId: "B", index: 0 });
    const first = moveItem(fixture(), "a1", "B", 0);
    st = curriculumReducer(st, { type: "commit", sections: first });
    expect(ids(st.sections)).toEqual(["A:a3", "B:a2,a1,b1", "C:"]);
    const second = moveItem(first, "a2", "B", 0);
    st = curriculumReducer(st, { type: "commit", sections: second });
    expect(st.pending).toBe(0);
    expect(st.sections).toBe(second);
  });

  it("sums durations", () => {
    expect(totalDuration(fixture())).toBe(240);
  });
});
