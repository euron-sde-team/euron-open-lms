"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Clock, RotateCcw } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import type { ClassroomItem, ItemContent } from "@open-lms/types";
import { Skeleton, Switch } from "@open-lms/ui";
import { VideoPlayer, type BeatReason, type PlayerBeat } from "@/components/player/video-player";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { learnHref, useClassroom } from "./classroom-context";
import { useApplyProgress } from "./use-progress";

type LectureContent = Extract<ItemContent, { kind: "LECTURE" }>;
type VideoLecture = Extract<LectureContent["lecture"], { lectureKind: "VIDEO" }>;

export const AUTOPLAY_KEY = "lms:autoplay";
const COUNTDOWN = 5;

export function readAutoplay(): boolean {
  try {
    return window.localStorage.getItem(AUTOPLAY_KEY) !== "off";
  } catch {
    return true;
  }
}
function writeAutoplay(on: boolean) {
  try {
    window.localStorage.setItem(AUTOPLAY_KEY, on ? "on" : "off");
  } catch {
    /* storage blocked: the choice holds for this page view */
  }
}

/** Codes after which this item stops sending heartbeats (they can never succeed). */
const STOP_CODES = new Set(["STAFF_PREVIEW", "PREVIEW", "COURSE_ACCESS_REQUIRED", "ENROLLMENT_NOT_ACTIVE"]);

export function LectureVideo({ content, lecture, nextItem }: { content: LectureContent; lecture: VideoLecture; nextItem: ClassroomItem | null }) {
  const { slug, classroom, player } = useClassroom();
  const itemId = content.item.id;
  const router = useRouter();
  const apply = useApplyProgress();
  const ready = lecture.videoStatus === "READY";
  const playback = useQuery({
    queryKey: qk.playback(itemId),
    queryFn: () => api().learn.playback(itemId),
    enabled: ready,
    // A minted session is single use per mount; do not cache signed URLs.
    staleTime: Infinity,
    gcTime: 0,
    meta: { silent: true },
  });

  const [autoplay, setAutoplay] = useState(true);
  useEffect(() => setAutoplay(readAutoplay()), []);
  const [ended, setEnded] = useState(false);

  const tracking = useRef(classroom.role === "LEARNER");
  const onBeat = useCallback(
    (beat: PlayerBeat, { reason }: { reason: BeatReason }) => {
      if (!tracking.current) return;
      const keepalive = reason === "hidden" || reason === "unmount";
      api()
        .learn.progress(itemId, { positionSeconds: beat.positionSeconds, playedSeconds: beat.playedSeconds, ...(beat.durationSeconds > 0 ? { durationSeconds: beat.durationSeconds } : {}) }, { keepalive })
        .then((r) => apply(itemId, r))
        .catch((e: unknown) => {
          if (isApiError(e) && STOP_CODES.has(e.code)) tracking.current = false;
        });
    },
    [apply, itemId],
  );

  const onRefresh = useCallback(() => api().learn.playback(itemId), [itemId]);

  if (!ready) {
    return (
      <VideoNotice
        title={lecture.videoStatus === "FAILED" ? "This video could not be processed" : "This video is still processing"}
        body={lecture.videoStatus === "FAILED" ? "The instructor has been told. Try another lesson for now." : "It will be ready in a few minutes. Try again shortly."}
      />
    );
  }
  if (playback.isPending) return <Skeleton className="aspect-video w-full rounded-card" />;
  if (playback.isError) return <VideoNotice title="The video did not start" body={errorMessage(playback.error)} onRetry={() => void playback.refetch()} />;

  const startAt = content.progress.completed ? playback.data.resumeAt || 0 : playback.data.resumeAt || content.progress.positionSeconds;

  return (
    <div>
      <VideoPlayer
        ref={player}
        source={playback.data}
        startAt={startAt}
        title={content.item.title}
        onBeat={onBeat}
        onRefresh={onRefresh}
        onEnded={() => setEnded(true)}
        autoPlay
      >
        {ended && nextItem ? (
          <UpNext
            title={nextItem.title}
            countdown={autoplay}
            onGo={() => router.push(learnHref(slug, nextItem.id))}
            onCancel={() => setEnded(false)}
            onReplay={() => {
              setEnded(false);
              player.current?.seek(0);
            }}
          />
        ) : null}
      </VideoPlayer>
      {nextItem ? (
        <label className="mt-2 flex w-fit items-center gap-2 text-[12.5px] text-muted-foreground">
          <Switch
            checked={autoplay}
            onCheckedChange={(v: boolean) => {
              setAutoplay(v);
              writeAutoplay(v);
            }}
            aria-label="Autoplay the next lesson"
            data-testid="classroom-autoplay"
          />
          Autoplay next lesson
        </label>
      ) : null}
    </div>
  );
}

/** "Up next" over the end of the video, with a 5 second countdown when autoplay is on. */
function UpNext({ title, countdown, onGo, onCancel, onReplay }: { title: string; countdown: boolean; onGo: () => void; onCancel: () => void; onReplay: () => void }) {
  const [left, setLeft] = useState(COUNTDOWN);
  const [running, setRunning] = useState(countdown);
  const goRef = useRef(onGo);
  goRef.current = onGo;
  useEffect(() => {
    if (!running) return;
    if (left <= 0) {
      goRef.current();
      return;
    }
    const id = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left, running]);
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => primaryRef.current?.focus({ preventScroll: true }), []);

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/75 p-4 text-center" role="dialog" aria-label="Up next" data-testid="classroom-up-next">
      <div className="max-w-sm">
        <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white/70">Up next</p>
        <p className="mt-1 text-balance font-display text-[20px] font-semibold leading-snug">{title}</p>
        {running ? (
          <p className="mt-2 text-[13px] text-white/80" aria-live="polite">
            Starting in {left} {left === 1 ? "second" : "seconds"}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button ref={primaryRef} type="button" onClick={onGo} className="rounded-[10px] bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90" data-testid="up-next-play">
            Play now
          </button>
          {running ? (
            <button type="button" onClick={() => setRunning(false)} className="rounded-[10px] px-4 py-2 text-sm font-semibold text-white hover:bg-white/15" data-testid="up-next-cancel">
              Cancel
            </button>
          ) : (
            <button type="button" onClick={onReplay} className="inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">
              <RotateCcw className="size-4" /> Watch again
            </button>
          )}
          {!running ? (
            <button type="button" onClick={onCancel} className="rounded-[10px] px-3 py-2 text-sm text-white/80 hover:bg-white/15">
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function VideoNotice({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-card bg-ground-2 px-6 text-center" role="status">
      <Clock className="size-6 text-muted-foreground" aria-hidden />
      <p className="font-semibold">{title}</p>
      <p className="max-w-sm text-[14px] text-muted-foreground">{body}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-1 text-sm font-semibold text-link hover:underline">
          Try again
        </button>
      ) : null}
    </div>
  );
}
