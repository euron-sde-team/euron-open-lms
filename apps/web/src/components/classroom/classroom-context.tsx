"use client";

import { createContext, useContext, type MutableRefObject } from "react";
import type { Classroom } from "@open-lms/types";
import type { VideoPlayerHandle } from "@/components/player/video-player";

export interface ClassroomContextValue {
  slug: string;
  classroom: Classroom;
  /** The open item (from the URL), or null on the course overview. */
  itemId: string | null;
  /** The mounted video player, so notes can seek it and stamp the current time. */
  player: MutableRefObject<VideoPlayerHandle | null>;
  /** Set when this session finished the course: drives the completion moment. */
  finished: { serial: string | null } | null;
  setFinished: (f: { serial: string | null } | null) => void;
  openCurriculum: () => void;
}

const Ctx = createContext<ClassroomContextValue | null>(null);
export const ClassroomProvider = Ctx.Provider;

export function useClassroom(): ClassroomContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useClassroom outside the classroom layout");
  return v;
}

export const learnHref = (slug: string, itemId?: string | null) => `/learn/${encodeURIComponent(slug)}${itemId ? `/${encodeURIComponent(itemId)}` : ""}`;
