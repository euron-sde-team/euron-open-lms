/** Learning endpoints: the classroom, playback, progress, notes, My Learning and certificates. See docs/api/rest-contract.md. */
import type { Certificate, Classroom, ItemContent, ItemKind, LearningEntry, LearningSummary, Note, OfflineDownload, OfflineValidation, Page, Playback, ProgressBeat, ProgressResult, CourseCard } from "@open-lms/types";
import { enc, type Helpers, type PageQuery } from "./helpers";

export interface BookmarkEntry {
  item: { id: string; title: string; kind: ItemKind };
  course: { slug: string; title: string };
  createdAt: string;
}

export function learningEndpoints(h: Helpers) {
  const { get, post, put, patch, del, pq, download } = h;

  const learn = {
    classroom: (courseSlug: string) => get<Classroom>(`/learn/${enc(courseSlug)}`),
    item: (itemId: string) => get<ItemContent>(`/learn/items/${enc(itemId)}`),
    /** Mint a playback session (EVS) or get the URL/embed. 409 VIDEO_NOT_READY. */
    playback: (itemId: string) => post<Playback>(`/learn/items/${enc(itemId)}/playback`, {}),
    /** A licence to keep this video on this device (mobile app). 409 OFFLINE_DISABLED, DOWNLOADS_NOT_ALLOWED, DOWNLOAD_LIMIT_REACHED... */
    download: (itemId: string, deviceId: string) => post<OfflineDownload>(`/learn/items/${enc(itemId)}/downloads`, { deviceId }),
    /** `keepalive` for the final beat when the tab hides or the player unmounts (sendBeacon cannot carry the bearer token). */
    progress: (itemId: string, beat: ProgressBeat, opts?: { keepalive?: boolean }) =>
      h.http.request<ProgressResult>("POST", `/learn/items/${enc(itemId)}/progress`, { body: beat, keepalive: opts?.keepalive }),
    /** Articles and PDFs only (409 ITEM_COMPLETES_ITSELF otherwise). */
    complete: (itemId: string) => post<ProgressResult>(`/learn/items/${enc(itemId)}/complete`, {}),
    bookmark: (itemId: string) => put(`/learn/items/${enc(itemId)}/bookmark`),
    unbookmark: (itemId: string) => del(`/learn/items/${enc(itemId)}/bookmark`),
    notes: (courseSlug: string, q?: PageQuery & { itemId?: string }) => get<Page<Note>>(`/learn/${enc(courseSlug)}/notes`, pq(q)),
    addNote: (itemId: string, body: { body: string; atSeconds?: number | null }) => post<Note>(`/learn/items/${enc(itemId)}/notes`, body),
    editNote: (noteId: string, body: { body?: string; atSeconds?: number | null }) => patch<Note>(`/learn/notes/${enc(noteId)}`, body),
    deleteNote: (noteId: string) => del(`/learn/notes/${enc(noteId)}`),
  };

  const my = {
    learning: (q?: PageQuery & { status?: "in_progress" | "completed" | "all" }) => get<Page<LearningEntry>>("/my/learning", pq(q)),
    summary: () => get<LearningSummary>("/my/summary"),
    saved: (q?: PageQuery) => get<Page<CourseCard>>("/my/saved", pq(q)),
    bookmarks: (q?: PageQuery) => get<Page<BookmarkEntry>>("/my/bookmarks", pq(q)),
    certificates: () => get<Certificate[]>("/my/certificates"),
    /** Which saved videos may keep playing; delete the `revoked` copies. */
    validateDownloads: (deviceId: string, itemIds: string[]) => post<OfflineValidation>("/my/downloads/validate", { deviceId, itemIds }),
    removeDownload: (itemId: string, deviceId: string) => del(`/my/downloads/${enc(itemId)}`, { deviceId }),
  };

  const certificates = {
    /** Public verification; `pdfUrl` is set only for the owner. */
    verify: (serial: string) => get<Certificate>(`/certificates/${enc(serial)}`),
    /** The owner's PDF (follows the redirect to the signed URL). 409 CERTIFICATE_RENDERING while it is prepared. */
    downloadPdf: (serial: string) => download(`/certificates/${enc(serial)}/pdf`),
  };

  return { learn, my, certificates };
}
