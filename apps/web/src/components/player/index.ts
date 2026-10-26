/**
 * The shared video player. `VideoPlayer` (video-player.tsx, owned by the classroom build)
 * takes a `Playback` directly; player-utils.ts holds the pure helpers (clock, seeking,
 * speeds, keyboard map, played-time meter, HLS engine choice) used by the catalog and tests.
 */
export { VideoPlayer, type VideoPlayerHandle, type VideoPlayerProps, type PlayerBeat, type PlayerTick, type BeatReason } from "./video-player";
export * from "./player-utils";
