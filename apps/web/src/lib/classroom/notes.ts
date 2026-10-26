/**
 * Optimistic edits to the notes list. The list is newest first; a note added offline-first
 * carries a temporary id until the server answers. Pure (test/classroom/notes.test.ts).
 */
import type { Note } from "@open-lms/types";

export type NotesAction =
  | { type: "add"; note: Note }
  | { type: "confirm"; tempId: string; note: Note }
  | { type: "edit"; id: string; patch: Partial<Pick<Note, "body" | "atSeconds">>; at?: string }
  | { type: "replace"; note: Note }
  | { type: "remove"; id: string }
  | { type: "restore"; note: Note; index: number };

export const TEMP_PREFIX = "tmp_";
export const isTempNote = (id: string) => id.startsWith(TEMP_PREFIX);
let tempSeq = 0;
export const tempNoteId = () => `${TEMP_PREFIX}${Date.now().toString(36)}${(++tempSeq).toString(36)}`;

export function notesReducer(list: Note[], action: NotesAction): Note[] {
  switch (action.type) {
    case "add":
      return [action.note, ...list.filter((n) => n.id !== action.note.id)];
    case "confirm":
      return list.some((n) => n.id === action.tempId) ? list.map((n) => (n.id === action.tempId ? action.note : n)) : [action.note, ...list];
    case "edit":
      return list.map((n) => (n.id === action.id ? { ...n, ...action.patch, updatedAt: action.at ?? n.updatedAt } : n));
    case "replace":
      return list.map((n) => (n.id === action.note.id ? action.note : n));
    case "remove":
      return list.filter((n) => n.id !== action.id);
    case "restore": {
      if (list.some((n) => n.id === action.note.id)) return list;
      const next = [...list];
      next.splice(Math.max(0, Math.min(action.index, next.length)), 0, action.note);
      return next;
    }
  }
}

/** Notes at a video time read in playback order; the rest keep newest first. */
export function sortForItem(list: Note[]): Note[] {
  const timed = list.filter((n) => n.atSeconds !== null).sort((a, b) => (a.atSeconds ?? 0) - (b.atSeconds ?? 0));
  const untimed = list.filter((n) => n.atSeconds === null);
  return [...timed, ...untimed];
}
