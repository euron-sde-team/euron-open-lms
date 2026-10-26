import { describe, expect, it } from "vitest";
import type { Note } from "@open-lms/types";
import { isTempNote, notesReducer, sortForItem, tempNoteId } from "@/lib/classroom/notes";

const note = (id: string, atSeconds: number | null = null, body = id): Note => ({ id, itemId: "i", itemTitle: "Item", atSeconds, body, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });

describe("notes optimistic reducer", () => {
  it("adds a temporary note first and swaps in the saved one", () => {
    const temp = tempNoteId();
    expect(isTempNote(temp)).toBe(true);
    let list = notesReducer([note("n1")], { type: "add", note: note(temp, 12, "hello") });
    expect(list.map((n) => n.id)).toEqual([temp, "n1"]);
    list = notesReducer(list, { type: "confirm", tempId: temp, note: note("n2", 12, "hello") });
    expect(list.map((n) => n.id)).toEqual(["n2", "n1"]);
  });

  it("confirming an unknown temp id still shows the note once", () => {
    const list = notesReducer([note("n1")], { type: "confirm", tempId: "tmp_x", note: note("n2") });
    expect(list.map((n) => n.id)).toEqual(["n2", "n1"]);
  });

  it("edits in place and rolls back with replace", () => {
    const original = note("n1", null, "old");
    let list = notesReducer([original], { type: "edit", id: "n1", patch: { body: "new" }, at: "2026-02-02T00:00:00Z" });
    expect(list[0]).toMatchObject({ body: "new", updatedAt: "2026-02-02T00:00:00Z" });
    list = notesReducer(list, { type: "replace", note: original });
    expect(list[0]!.body).toBe("old");
  });

  it("removes and restores at the same position", () => {
    const list = [note("a"), note("b"), note("c")];
    const removed = notesReducer(list, { type: "remove", id: "b" });
    expect(removed.map((n) => n.id)).toEqual(["a", "c"]);
    const restored = notesReducer(removed, { type: "restore", note: list[1]!, index: 1 });
    expect(restored.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(notesReducer(restored, { type: "restore", note: list[1]!, index: 0 })).toBe(restored);
  });

  it("orders timed notes by video time, untimed after", () => {
    const sorted = sortForItem([note("x"), note("late", 90), note("early", 5)]);
    expect(sorted.map((n) => n.id)).toEqual(["early", "late", "x"]);
  });
});
