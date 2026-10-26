# ADR 0015: Lecture video delegated to euron-video-system

## Status

Accepted.

## Context

Video is most of an LMS's bytes and most of its operational risk: uploads of several
gigabytes, transcoding ladders, encryption keys, tokenised playlists, CDN signing, captions.
euron-video-system (EVS) is a separate open-source project that does exactly that and
exposes a small API: list videos, mint a playback session for a viewer, and signed webhooks
when a video is ready or failed. The LMS's job is to decide who may watch.

## Decision

- The LMS never uploads, stores or transcodes lecture video. A video lecture stores a
  provider and a reference: an EVS video id, or an HLS or MP4 https URL, or a YouTube id
  ([`db/migrations/0001_init.sql`](../../../db/migrations/0001_init.sql) `lectures`).
- Playback is a POST that runs the entitlement check first, then (for EVS) mints a session
  server-side with a key scoped to `playback:mint`, passing the learner's id and the app
  origin ([`services/playback.service.ts`](../../../apps/api/src/services/playback.service.ts),
  [`integrations/evs.ts`](../../../apps/api/src/integrations/evs.ts)). The browser gets only
  the manifest URL with its short-lived token.
- An optional second key with `videos:read` powers the editor's video picker and status
  lookups.
- `POST /api/webhooks/evs` verifies `EVS-Signature` and sets `video_status` (and duration)
  on every lecture with that id; publishing requires READY.
- The CSP lists the video origins at run time (`VIDEO_ORIGINS`).
- Locally the stub speaks the EVS API and serves a test HLS stream
  ([ADR 0019](0019-stubs-that-sign-with-real-secrets.md)).

Details: [video.md](../video.md).

## Consequences

Positive:

- No video pipeline in the LMS; its storage and CDN costs stay with EVS.
- Keys never reach a browser; sessions are bound to a viewer.
- Academies without EVS can still teach with their own HLS/MP4 hosting or YouTube.

Trade-offs:

- Two systems to run for protected video.
- Authors upload in EVS, then attach in the LMS.
- HLS/MP4/YouTube lectures are only as protected as their host.

## Alternatives considered

- **Uploading video to S3 and serving MP4.** Simple, but no adaptive bitrate, no
  encryption, and permanent URLs.
- **A built-in transcoding pipeline.** A large system inside the LMS that EVS already is.
