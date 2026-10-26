"use client";

/**
 * The shared lecture player (classroom and the course page preview dialog).
 *
 *   <VideoPlayer source={playback} startAt={42} onBeat={...} onEnded={...} onRefresh={...} />
 *
 * EVS and HLS play through hls.js (quality menu from the HLS levels; Safari without MSE
 * falls back to native HLS), MP4 plays natively, YouTube embeds the no-cookie player and
 * follows it over postMessage (youtube-frame.tsx). Captions come from the media's text
 * tracks; a VTT sprite track (`thumbnailsUrl`) previews frames above the seek bar.
 *
 * Heartbeats: `onBeat` fires every 15 s while playing and on pause, end, tab hide and
 * unmount. `playedSeconds` is real playback measured from timeupdate samples
 * (lib/classroom/beat-accumulator.ts), never a position delta, so seeking does not count.
 * The second argument says why the beat fired; "hidden" and "unmount" beats should be
 * sent with fetch keepalive.
 *
 * Signed URLs expire: on a fatal network error the player asks `onRefresh` for a fresh
 * Playback and resumes where it was. Video chrome is dark in both themes (it sits on
 * the picture), so the controls use fixed white-on-black rather than theme tokens.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import type HlsType from "hls.js";
import { Captions, Check, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Settings, Volume1, Volume2, VolumeX } from "lucide-react";
import type { Playback } from "@open-lms/types";
import { Spinner, cn } from "@open-lms/ui";
import { BEAT_INTERVAL_MS, createBeatAccumulator } from "@/lib/classroom/beat-accumulator";
import { clock } from "@/lib/duration";
import { cueAt, parseThumbnailVtt, type ThumbCue } from "./thumbnails";
import { YouTubeFrame } from "./youtube-frame";

export interface PlayerBeat {
  positionSeconds: number;
  playedSeconds: number;
  durationSeconds: number;
}

/** Alias kept for the catalog preview code. */
export type PlayerTick = PlayerBeat;

export type BeatReason = "interval" | "pause" | "ended" | "hidden" | "unmount";

export interface VideoPlayerHandle {
  seek: (seconds: number) => void;
  currentTime: () => number;
  play: () => void;
  pause: () => void;
}

export interface VideoPlayerProps {
  source: Playback;
  startAt?: number;
  onBeat?: (beat: PlayerBeat, meta: { reason: BeatReason }) => void;
  onEnded?: () => void;
  onRefresh?: () => Promise<Playback>;
  autoPlay?: boolean;
  title?: string;
  className?: string;
  /** Rendered inside the player surface (stays visible in fullscreen), e.g. an "Up next" overlay. */
  children?: ReactNode;
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const SPEED_KEY = "lms:speed";

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(props, ref) {
  if (props.source.provider === "YOUTUBE") {
    return (
      <YouTubeFrame
        ref={ref}
        embedUrl={props.source.embedUrl}
        startAt={props.startAt ?? props.source.resumeAt}
        onBeat={props.onBeat}
        onEnded={props.onEnded}
        title={props.title}
        className={props.className}
      >
        {props.children}
      </YouTubeFrame>
    );
  }
  return <MediaPlayer {...props} ref={ref} />;
});

interface Level {
  index: number;
  height: number;
  bitrate: number;
}
interface TextTrackOption {
  index: number;
  label: string;
}

function sourceUrl(p: Playback): string {
  if (p.provider === "EVS") return p.manifestUrl;
  if (p.provider === "YOUTUBE") return p.embedUrl;
  return p.url;
}
const isHlsSource = (p: Playback) => p.provider === "EVS" || p.provider === "HLS" || /\.m3u8(\?|$)/i.test(sourceUrl(p));

function readSpeed(): number {
  try {
    const v = Number(window.localStorage.getItem(SPEED_KEY));
    return (SPEEDS as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

const MediaPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function MediaPlayer({ source, startAt, onBeat, onEnded, onRefresh, autoPlay, title, className, children }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const acc = useRef(createBeatAccumulator());
  const lastPos = useRef(0);
  const lastBeatPos = useRef(-1);
  const hasPlayed = useRef(false);
  const pendingSeek = useRef<number | null>(startAt ?? source.resumeAt ?? null);
  const refreshes = useRef(0);
  const onBeatRef = useRef(onBeat);
  const onEndedRef = useRef(onEnded);
  const onRefreshRef = useRef(onRefresh);
  onBeatRef.current = onBeat;
  onEndedRef.current = onEnded;
  onRefreshRef.current = onRefresh;

  const [playback, setPlayback] = useState(source);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [levels, setLevels] = useState<Level[]>([]);
  const [level, setLevel] = useState(-1);
  const [autoHeight, setAutoHeight] = useState<number | null>(null);
  const [tracks, setTracks] = useState<TextTrackOption[]>([]);
  const [track, setTrack] = useState(-1);
  const [menu, setMenu] = useState<null | "settings" | "captions">(null);
  const [chrome, setChrome] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<ThumbCue[]>([]);

  // A new source from the parent (another lecture) starts over.
  useEffect(() => {
    setPlayback(source);
    pendingSeek.current = startAt ?? source.resumeAt ?? null;
    refreshes.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const emit = useCallback((reason: BeatReason) => {
    const v = videoRef.current;
    const position = v ? v.currentTime : lastPos.current;
    // Nothing played yet (a mount and unmount, StrictMode in dev): sending position 0 would wipe the resume point.
    if (!hasPlayed.current) return;
    const playedSeconds = acc.current.take();
    const durationSeconds = v && Number.isFinite(v.duration) ? v.duration : 0;
    if (playedSeconds === 0 && Math.abs(position - lastBeatPos.current) < 1) return;
    lastBeatPos.current = position;
    onBeatRef.current?.({ positionSeconds: Math.max(0, Math.round(position)), playedSeconds, durationSeconds: Math.round(durationSeconds) }, { reason });
  }, []);

  const refresh = useCallback(async () => {
    const fn = onRefreshRef.current;
    const v = videoRef.current;
    pendingSeek.current = v?.currentTime || lastPos.current || pendingSeek.current;
    if (!fn || refreshes.current >= 3) {
      setError("The video stopped loading. Try again in a moment.");
      return;
    }
    refreshes.current += 1;
    try {
      const next = await fn();
      setError(null);
      setPlayback(next);
    } catch {
      setError("The video stopped loading. Try again in a moment.");
    }
  }, []);

  // Attach the source.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || playback.provider === "YOUTUBE") return;
    let cancelled = false;
    setError(null);
    setLevels([]);
    setLevel(-1);
    const url = sourceUrl(playback);
    const wasPlaying = started && playing;

    const native = () => {
      video.src = url;
      video.load();
    };

    (async () => {
      if (isHlsSource(playback)) {
        const Hls = (await import("hls.js")).default;
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true, capLevelToPlayerSize: true, startPosition: pendingSeek.current ?? -1 });
          hlsRef.current = hls;
          hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
            setLevels(data.levels.map((l, index) => ({ index, height: l.height, bitrate: l.bitrate })).filter((l) => l.height > 0).sort((a, b) => b.height - a.height));
          });
          hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setAutoHeight(hls.levels[data.level]?.height ?? null));
          let mediaRecoveries = 0;
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
              mediaRecoveries += 1;
              hls.recoverMediaError();
              return;
            }
            void refresh();
          });
          hls.loadSource(url);
          hls.attachMedia(video);
          return;
        }
        if (!video.canPlayType("application/vnd.apple.mpegurl")) {
          setError("This browser cannot play this video.");
          return;
        }
      }
      native();
    })();

    if (wasPlaying) video.addEventListener("loadeddata", () => void video.play().catch(() => undefined), { once: true });

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback]);

  // Thumbnails track (EVS only).
  const thumbsUrl = playback.provider === "EVS" ? playback.thumbnailsUrl : null;
  useEffect(() => {
    setThumbs([]);
    if (!thumbsUrl) return;
    const ctl = new AbortController();
    fetch(thumbsUrl, { signal: ctl.signal })
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => setThumbs(parseThumbnailVtt(text, thumbsUrl)))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [thumbsUrl]);

  // Media events.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      lastPos.current = v.currentTime;
      setTime(v.currentTime);
      if (!v.paused && !v.seeking) acc.current.feed(v.currentTime, performance.now(), v.playbackRate);
      if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
    };
    const onMeta = () => {
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
      const at = pendingSeek.current;
      if (at && at > 0 && at < (v.duration || Infinity) - 3 && Math.abs(v.currentTime - at) > 1) v.currentTime = at;
      pendingSeek.current = null;
      v.playbackRate = readSpeed();
    };
    const onPlay = () => {
      hasPlayed.current = true;
      setPlaying(true);
      setStarted(true);
      acc.current.discontinuity();
    };
    const onPause = () => {
      acc.current.feed(v.currentTime, performance.now(), v.playbackRate);
      acc.current.pause();
      setPlaying(false);
      if (!v.ended) emit("pause");
    };
    const onEnd = () => {
      acc.current.feed(v.currentTime, performance.now(), v.playbackRate);
      acc.current.pause();
      setPlaying(false);
      emit("ended");
      onEndedRef.current?.();
    };
    const onSeeking = () => acc.current.discontinuity();
    const onWaiting = () => setWaiting(true);
    const onPlaying = () => setWaiting(false);
    const onVolume = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };
    const onRate = () => setRate(v.playbackRate);
    const onError = () => {
      if (!hlsRef.current && v.error) void refresh();
    };
    const onDuration = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    const pairs: [string, () => void][] = [
      ["timeupdate", onTime],
      ["loadedmetadata", onMeta],
      ["durationchange", onDuration],
      ["play", onPlay],
      ["pause", onPause],
      ["ended", onEnd],
      ["seeking", onSeeking],
      ["waiting", onWaiting],
      ["playing", onPlaying],
      ["canplay", onPlaying],
      ["volumechange", onVolume],
      ["ratechange", onRate],
      ["error", onError],
    ];
    for (const [e, fn] of pairs) v.addEventListener(e, fn);
    return () => {
      for (const [e, fn] of pairs) v.removeEventListener(e, fn);
    };
  }, [emit, refresh]);

  // Text tracks (hls.js renders HLS subtitles into native tracks too).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      const list: TextTrackOption[] = [];
      let showing = -1;
      for (let i = 0; i < v.textTracks.length; i++) {
        const t = v.textTracks[i]!;
        if (t.kind !== "subtitles" && t.kind !== "captions") continue;
        list.push({ index: i, label: t.label || t.language || `Track ${list.length + 1}` });
        if (t.mode === "showing") showing = i;
      }
      setTracks(list);
      setTrack(showing);
    };
    sync();
    v.textTracks.addEventListener("addtrack", sync);
    v.textTracks.addEventListener("removetrack", sync);
    return () => {
      v.textTracks.removeEventListener("addtrack", sync);
      v.textTracks.removeEventListener("removetrack", sync);
    };
  }, []);

  // Heartbeats while playing, on tab hide and on unmount.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => emit("interval"), BEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, emit]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") emit("hidden");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      emit("unmount");
    };
  }, [emit]);

  // Fullscreen state.
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Controls hide while playing after a moment without the pointer.
  const hideTimer = useRef<number | undefined>(undefined);
  const poke = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setChrome(false), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  const showChrome = chrome || !playing || menu !== null;

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);
  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.max(0, Math.min(d - 0.1, t));
    setTime(v.currentTime);
  }, []);
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  }, []);
  const setSpeed = (s: number) => {
    const v = videoRef.current;
    if (v) v.playbackRate = s;
    try {
      window.localStorage.setItem(SPEED_KEY, String(s));
    } catch {
      /* storage blocked */
    }
  };
  const chooseLevel = (i: number) => {
    const hls = hlsRef.current;
    if (hls) hls.currentLevel = i;
    setLevel(i);
  };
  const chooseTrack = (i: number) => {
    const v = videoRef.current;
    if (!v) return;
    for (let k = 0; k < v.textTracks.length; k++) v.textTracks[k]!.mode = k === i ? "showing" : "hidden";
    setTrack(i);
  };

  useImperativeHandle(
    ref,
    () => ({
      seek: (s) => {
        seekTo(s);
        void videoRef.current?.play().catch(() => undefined);
      },
      currentTime: () => videoRef.current?.currentTime ?? lastPos.current,
      play: () => void videoRef.current?.play().catch(() => undefined),
      pause: () => videoRef.current?.pause(),
    }),
    [seekTo],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-player-menu]")) return;
    const v = videoRef.current;
    if (!v) return;
    switch (e.key) {
      case " ":
      case "k":
        if (target.tagName === "BUTTON" && e.key === " ") return;
        e.preventDefault();
        toggle();
        break;
      case "ArrowLeft":
        e.preventDefault();
        seekTo(v.currentTime - 5);
        break;
      case "ArrowRight":
        e.preventDefault();
        seekTo(v.currentTime + 5);
        break;
      case "j":
        seekTo(v.currentTime - 10);
        break;
      case "l":
        seekTo(v.currentTime + 10);
        break;
      case "ArrowUp":
        e.preventDefault();
        v.volume = Math.min(1, v.volume + 0.1);
        v.muted = false;
        break;
      case "ArrowDown":
        e.preventDefault();
        v.volume = Math.max(0, v.volume - 0.1);
        break;
      case "m":
        v.muted = !v.muted;
        break;
      case "f":
        toggleFullscreen();
        break;
      case "c":
        if (tracks.length) chooseTrack(track >= 0 ? -1 : tracks[0]!.index);
        break;
      case "Escape":
        setMenu(null);
        break;
      default:
        return;
    }
    poke();
  };

  const poster = playback.provider === "YOUTUBE" ? undefined : (playback.posterUrl ?? undefined);
  const watermark = playback.watermark;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const qualityLabel = level === -1 ? (autoHeight ? `Auto (${autoHeight}p)` : "Auto") : `${levels.find((l) => l.index === level)?.height ?? ""}p`;
  const pipSupported = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label={title ? `Video player: ${title}` : "Video player"}
      onKeyDown={onKeyDown}
      onPointerMove={poke}
      onPointerLeave={() => playing && setChrome(false)}
      className={cn("group/player relative aspect-video w-full overflow-hidden bg-black text-white outline-none focus-visible:ring-2 focus-visible:ring-ring", fullscreen ? "rounded-none" : "rounded-card shadow-card", className)}
      data-testid="video-player"
    >
      <video
        ref={videoRef}
        className="absolute inset-0 size-full"
        poster={poster}
        playsInline
        autoPlay={autoPlay}
        preload="metadata"
        crossOrigin="anonymous"
        onClick={toggle}
        onDoubleClick={toggleFullscreen}
        aria-label={title}
      />

      {watermark ? <Watermark text={watermark} /> : null}

      {waiting && playing ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner size="lg" className="text-white" />
        </div>
      ) : null}

      {!started && !error ? (
        <button type="button" onClick={toggle} aria-label="Play" className="absolute inset-0 flex items-center justify-center" data-testid="player-big-play">
          <span className="flex size-16 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition-transform duration-200 hover:scale-105">
            <Play className="ml-1 size-7 fill-current" />
          </span>
        </button>
      ) : null}

      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center" role="alert">
          <p className="text-[15px] font-medium">{error}</p>
          <button
            type="button"
            className="rounded-[10px] bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90"
            onClick={() => {
              refreshes.current = 0;
              void refresh();
            }}
          >
            Try again
          </button>
        </div>
      ) : null}

      {children}

      <div className={cn("absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2 pt-10 transition-opacity duration-200", showChrome ? "opacity-100" : "pointer-events-none opacity-0")}>
        <SeekBar time={time} duration={duration} buffered={buffered} thumbs={thumbs} onSeek={seekTo} />
        <div className="mt-1 flex items-center gap-1">
          <CtrlButton label={playing ? "Pause (k)" : "Play (k)"} onClick={toggle} testId="player-play">
            {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
          </CtrlButton>
          <CtrlButton label="Back 10 seconds (j)" onClick={() => seekTo(time - 10)}>
            <RotateCcw />
          </CtrlButton>
          <CtrlButton label="Forward 10 seconds (l)" onClick={() => seekTo(time + 10)}>
            <RotateCw />
          </CtrlButton>
          <div className="group/vol flex items-center">
            <CtrlButton
              label={muted ? "Unmute (m)" : "Mute (m)"}
              onClick={() => {
                const v = videoRef.current;
                if (v) v.muted = !v.muted;
              }}
            >
              <VolumeIcon />
            </CtrlButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(e) => {
                const v = videoRef.current;
                if (!v) return;
                v.volume = Number(e.target.value);
                v.muted = v.volume === 0;
              }}
              className="hidden h-1 w-20 cursor-pointer accent-white sm:block"
            />
          </div>
          <span className="ml-2 text-[12.5px] tabular-nums text-white/90" aria-live="off">
            {clock(time)} / {clock(duration)}
          </span>
          <div className="flex-1" />
          {tracks.length ? (
            <CtrlButton label="Captions (c)" onClick={() => setMenu(menu === "captions" ? null : "captions")} pressed={track >= 0} testId="player-captions">
              <Captions />
            </CtrlButton>
          ) : null}
          <CtrlButton label="Settings" onClick={() => setMenu(menu === "settings" ? null : "settings")} testId="player-settings">
            <Settings />
          </CtrlButton>
          {pipSupported ? (
            <CtrlButton
              label="Picture in picture"
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
                else void v.requestPictureInPicture().catch(() => undefined);
              }}
              className="hidden sm:inline-flex"
            >
              <PictureInPicture2 />
            </CtrlButton>
          ) : null}
          <CtrlButton label={fullscreen ? "Exit full screen (f)" : "Full screen (f)"} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize /> : <Maximize />}
          </CtrlButton>
        </div>
      </div>

      {menu ? (
        <PlayerMenu onClose={() => setMenu(null)}>
          {menu === "settings" ? (
            <>
              <MenuHeading>Speed</MenuHeading>
              {SPEEDS.map((s) => (
                <MenuOption key={s} selected={rate === s} onSelect={() => setSpeed(s)}>
                  {s === 1 ? "Normal" : `${s}x`}
                </MenuOption>
              ))}
              {levels.length > 1 ? (
                <>
                  <MenuHeading>Quality: {qualityLabel}</MenuHeading>
                  <MenuOption selected={level === -1} onSelect={() => chooseLevel(-1)}>
                    Auto
                  </MenuOption>
                  {levels.map((l) => (
                    <MenuOption key={l.index} selected={level === l.index} onSelect={() => chooseLevel(l.index)}>
                      {l.height}p
                    </MenuOption>
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <>
              <MenuHeading>Captions</MenuHeading>
              <MenuOption selected={track === -1} onSelect={() => chooseTrack(-1)}>
                Off
              </MenuOption>
              {tracks.map((t) => (
                <MenuOption key={t.index} selected={track === t.index} onSelect={() => chooseTrack(t.index)}>
                  {t.label}
                </MenuOption>
              ))}
            </>
          )}
        </PlayerMenu>
      ) : null}
    </div>
  );
});

function CtrlButton({ label, onClick, children, pressed, className, testId }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean; className?: string; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-testid={testId}
      className={cn("inline-flex size-9 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white [&_svg]:size-[18px]", pressed && "text-white underline", className)}
    >
      {children}
    </button>
  );
}

function PlayerMenu({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("[role=menuitemradio]");
    first?.focus();
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      data-player-menu
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? []);
          const at = items.indexOf(document.activeElement as HTMLElement);
          items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        }
      }}
      className="no-scrollbar absolute bottom-14 right-3 max-h-[70%] w-52 overflow-y-auto rounded-lg bg-black/85 py-1.5 text-[13px] shadow-lg backdrop-blur"
    >
      {children}
    </div>
  );
}

function MenuHeading({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-white/60">{children}</p>;
}

function MenuOption({ children, selected, onSelect }: { children: ReactNode; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={selected} onClick={onSelect} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-white/90 hover:bg-white/10 focus-visible:bg-white/15 focus-visible:outline-none">
      <Check className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")} aria-hidden />
      {children}
    </button>
  );
}

function SeekBar({ time, duration, buffered, thumbs, onSeek }: { time: number; duration: number; buffered: number; thumbs: ThumbCue[]; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const pct = (t: number) => (duration > 0 ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0);
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    return { x, t: r.width ? (x / r.width) * duration : 0 };
  };
  const shown = drag ?? time;
  const cue = hover ? cueAt(thumbs, hover.t) : null;
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${clock(shown)} of ${clock(duration)}`}
      className="group/seek relative flex h-4 cursor-pointer touch-none items-center"
      onPointerMove={(e) => {
        const p = at(e.clientX);
        setHover(p);
        if (drag !== null) setDrag(p.t);
      }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setDrag(at(e.clientX).t);
      }}
      onPointerUp={(e) => {
        if (drag !== null) onSeek(at(e.clientX).t);
        setDrag(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          onSeek(time + (e.key === "ArrowRight" ? 5 : -5));
        } else if (e.key === "Home") onSeek(0);
        else if (e.key === "End") onSeek(duration - 1);
      }}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25 transition-[height] group-hover/seek:h-1.5">
        <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${pct(buffered)}%` }} />
        <div className="absolute inset-y-0 left-0 bg-brand" style={{ width: `${pct(shown)}%` }} />
      </div>
      <div className="pointer-events-none absolute size-3 -translate-x-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover/seek:opacity-100" style={{ left: `${pct(shown)}%` }} />
      {hover && duration > 0 ? (
        <div className="pointer-events-none absolute bottom-6 flex -translate-x-1/2 flex-col items-center gap-1" style={{ left: Math.max(84, Math.min((ref.current?.clientWidth ?? 0) - 84, hover.x)) }}>
          {cue ? <ThumbPreview cue={cue} /> : null}
          <span className="rounded bg-black/80 px-1.5 py-0.5 text-[12px] tabular-nums">{clock(hover.t)}</span>
        </div>
      ) : null}
    </div>
  );
}

function ThumbPreview({ cue }: { cue: ThumbCue }) {
  const w = 160;
  if (!cue.rect) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={cue.url} alt="" width={w} className="rounded border border-white/30" />;
  }
  const scale = w / cue.rect.w;
  return (
    <div
      className="overflow-hidden rounded border border-white/30"
      style={{
        width: w,
        height: cue.rect.h * scale,
        backgroundImage: `url("${cue.url}")`,
        backgroundPosition: `-${cue.rect.x * scale}px -${cue.rect.y * scale}px`,
        backgroundSize: "auto",
        transform: scale === 1 ? undefined : undefined,
        imageRendering: "auto",
      }}
    />
  );
}

/** The viewer's identity over the picture, moving every half minute. */
function Watermark({ text }: { text: string }) {
  const [pos, setPos] = useState({ x: 8, y: 10 });
  useEffect(() => {
    const id = window.setInterval(() => setPos({ x: 5 + Math.random() * 60, y: 8 + Math.random() * 70 }), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span aria-hidden className="pointer-events-none absolute select-none text-[13px] font-semibold text-white/35 transition-[left,top] duration-1000" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
      {text}
    </span>
  );
}
