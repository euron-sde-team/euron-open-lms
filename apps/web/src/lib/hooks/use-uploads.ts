"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { kindOf, mimeTypeOf, validateUpload } from "@open-lms/api-client";
import { toast } from "@open-lms/ui";
import type { Media, UploadPurpose } from "@open-lms/types";
import { api } from "../api";
import { errorMessage } from "../errors";

export interface PendingUpload {
  localId: string;
  file: File;
  kind: ReturnType<typeof kindOf>;
  previewUrl: string | null;
  progress: number;
  status: "uploading" | "done" | "error";
  media: Media | null;
  error: string | null;
}

let seq = 0;

/**
 * Upload queue for a composer: files start uploading as soon as they are
 * picked, with progress; `mediaIds` lists the finished ones in order.
 */
export function useUploads(purpose: UploadPurpose, { max = 10, accept }: { max?: number; accept?: (mime: string) => boolean } = {}) {
  const [items, setItems] = useState<PendingUpload[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  const patch = (localId: string, p: Partial<PendingUpload>) => setItems((list) => list.map((i) => (i.localId === localId ? { ...i, ...p } : i)));

  const start = useCallback(
    (item: PendingUpload) => {
      const ctl = new AbortController();
      controllers.current.set(item.localId, ctl);
      api()
        .media.upload({ purpose, file: item.file, signal: ctl.signal, onProgress: (f) => patch(item.localId, { progress: f }) })
        .then((media) => patch(item.localId, { status: "done", media, progress: 1 }))
        .catch((e: unknown) => {
          if (e instanceof Error && e.name === "AbortError") return;
          patch(item.localId, { status: "error", error: errorMessage(e) });
        })
        .finally(() => controllers.current.delete(item.localId));
    },
    [purpose],
  );

  const add = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const room = max - items.length;
      if (room <= 0) {
        toast.error({ title: `You can attach up to ${max} files.` });
        return;
      }
      const accepted: PendingUpload[] = [];
      for (const file of list.slice(0, room)) {
        const problem = validateUpload(file);
        const mime = mimeTypeOf(file);
        if (problem) {
          toast.error({ title: `${file.name}: ${problem}` });
          continue;
        }
        if (accept && !accept(mime)) {
          toast.error({ title: `${file.name}: this file type can not be attached here.` });
          continue;
        }
        const kind = kindOf(mime);
        accepted.push({
          localId: `u${++seq}`,
          file,
          kind,
          previewUrl: kind === "IMAGE" || kind === "VIDEO" ? URL.createObjectURL(file) : null,
          progress: 0,
          status: "uploading",
          media: null,
          error: null,
        });
      }
      if (list.length > room) toast.error({ title: `Only ${max} files can be attached. Some were left out.` });
      if (!accepted.length) return;
      setItems((cur) => [...cur, ...accepted]);
      accepted.forEach(start);
    },
    [items.length, max, accept, start],
  );

  const remove = useCallback((localId: string) => {
    controllers.current.get(localId)?.abort();
    setItems((list) => {
      const item = list.find((i) => i.localId === localId);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (item?.media) void api().media.discard(item.media.id).catch(() => undefined);
      return list.filter((i) => i.localId !== localId);
    });
  }, []);

  const retry = useCallback(
    (localId: string) => {
      const item = items.find((i) => i.localId === localId);
      if (!item) return;
      patch(localId, { status: "uploading", progress: 0, error: null });
      start(item);
    },
    [items, start],
  );

  /** Forget everything after a successful send (the media is attached now, so do not discard it). */
  const reset = useCallback(() => {
    setItems((list) => {
      for (const i of list) if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
      return [];
    });
  }, []);

  useEffect(
    () => () => {
      for (const c of controllers.current.values()) c.abort();
    },
    [],
  );

  return {
    items,
    add,
    remove,
    retry,
    reset,
    busy: items.some((i) => i.status === "uploading"),
    failed: items.some((i) => i.status === "error"),
    mediaIds: items.filter((i) => i.status === "done" && i.media).map((i) => i.media!.id),
  };
}
