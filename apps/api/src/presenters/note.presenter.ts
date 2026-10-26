/** Note rows to DTOs. Notes are private to their author; the body is plain text the web app escapes. */
import type { Note } from "@open-lms/types";

export interface NoteRow {
  id: string;
  item_id: string;
  item_title: string;
  at_seconds: number | null;
  body: string;
  created_at: Date;
  updated_at: Date;
}

export function toNote(r: NoteRow): Note {
  return { id: r.id, itemId: r.item_id, itemTitle: r.item_title, atSeconds: r.at_seconds, body: r.body, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() };
}
