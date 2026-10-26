"use client";

/**
 * YouTube lectures: the no-cookie embed with its own controls, followed over the embed's
 * postMessage channel (no extra script, so the CSP stays as it is). After the frame loads
 * we send "listening"; YouTube then posts `infoDelivery` messages with the current time
 * and the player state, which feed the same played-seconds accumulator as the HTML5
 * player. If YouTube never answers, the player still plays; it just sends no beats.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import { cn } from "@open-lms/ui";
import { BEAT_INTERVAL_MS, createBeatAccumulator } from "@/lib/classroom/beat-accumulator";
import type { BeatReason, PlayerBeat, VideoPlayerHandle } from "./video-player";

const YT_ORIGINS = new Set(["https://www.youtube-nocookie.com", "https://www.youtube.com"]);

/** YouTube player states. */
const PLAYING = 1;
const PAUSED = 2;
const ENDED = 0;

export function youtubeSrc(embedUrl: string, startAt: number, origin: string): string {
  try {
    const u = new URL(embedUrl);
    u.searchParams.set("enablejsapi", "1");
    u.searchParams.set("origin", origin);
    u.searchParams.set("rel", "0");
    u.searchParams.set("playsinline", "1");
    if (startAt > 0) u.searchParams.set("start", String(Math.floor(startAt)));
    return u.toString();
  } catch {
    return embedUrl;
  }
}

export const YouTubeFrame = forwardRef<
  VideoPlayerHandle,
  {
    embedUrl: string;
    startAt: number;
    onBeat?: (beat: PlayerBeat, meta: { reason: BeatReason }) => void;
    onEnded?: () => void;
    title?: string;
    className?: string;
    children?: ReactNode;
  }
>(function YouTubeFrame({ embedUrl, startAt, onBeat, onEnded, title, className, children }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const acc = useRef(createBeatAccumulator());
  const state = useRef<number>(-1);
  const time = useRef(startAt);
  const duration = useRef(0);
  const rate = useRef(1);
  const lastBeatPos = useRef(-1);
  const hasPlayed = useRef(false);
  const onBeatRef = useRef(onBeat);
  const onEndedRef = useRef(onEnded);
  onBeatRef.current = onBeat;
  onEndedRef.current = onEnded;

  // The start time is fixed per mount: a changing startAt must not reload the frame.
  const src = useMemo(() => youtubeSrc(embedUrl, startAt, typeof window === "undefined" ? "" : window.location.origin), [embedUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = useCallback((msg: object) => {
    const target = frame.current?.contentWindow;
    if (!target) return;
    try {
      target.postMessage(JSON.stringify(msg), new URL(embedUrl).origin);
    } catch {
      /* frame gone */
    }
  }, [embedUrl]);

  const emit = useCallback((reason: BeatReason) => {
    if (!hasPlayed.current) return;
    const playedSeconds = acc.current.take();
    const position = time.current;
    if (playedSeconds === 0 && Math.abs(position - lastBeatPos.current) < 1) return;
    lastBeatPos.current = position;
    onBeatRef.current?.({ positionSeconds: Math.round(position), playedSeconds, durationSeconds: Math.round(duration.current) }, { reason });
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!YT_ORIGINS.has(e.origin) || e.source !== frame.current?.contentWindow) return;
      let data: { event?: string; info?: unknown };
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const info = data.info as { currentTime?: number; playerState?: number; duration?: number; playbackRate?: number } | number | undefined;
      let nextState: number | undefined;
      if (data.event === "onStateChange" && typeof info === "number") nextState = info;
      if (info && typeof info === "object") {
        if (typeof info.duration === "number" && info.duration > 0) duration.current = info.duration;
        if (typeof info.playbackRate === "number") rate.current = info.playbackRate;
        if (typeof info.playerState === "number") nextState = info.playerState;
        if (typeof info.currentTime === "number") {
          time.current = info.currentTime;
          if (state.current === PLAYING) acc.current.feed(info.currentTime, performance.now(), rate.current);
        }
      }
      if (nextState !== undefined && nextState !== state.current) {
        const prev = state.current;
        state.current = nextState;
        if (nextState === PLAYING) {
          hasPlayed.current = true;
          acc.current.discontinuity();
        }
        if (prev === PLAYING && nextState === PAUSED) {
          acc.current.pause();
          emit("pause");
        }
        if (nextState === ENDED) {
          acc.current.pause();
          emit("ended");
          onEndedRef.current?.();
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [emit]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (state.current === PLAYING) emit("interval");
    }, BEAT_INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === "hidden") emit("hidden");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      emit("unmount");
    };
  }, [emit]);

  useImperativeHandle(
    ref,
    () => ({
      seek: (s) => {
        acc.current.discontinuity();
        time.current = s;
        post({ event: "command", func: "seekTo", args: [s, true] });
        post({ event: "command", func: "playVideo", args: [] });
      },
      currentTime: () => time.current,
      play: () => post({ event: "command", func: "playVideo", args: [] }),
      pause: () => post({ event: "command", func: "pauseVideo", args: [] }),
    }),
    [post],
  );

  return (
    <div className={cn("relative aspect-video w-full overflow-hidden rounded-card bg-black shadow-card", className)} data-testid="video-player">
      <iframe
        ref={frame}
        src={src}
        title={title ?? "Video"}
        className="absolute inset-0 size-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => post({ event: "listening", id: "lms", channel: "widget" })}
      />
      {children}
    </div>
  );
});
