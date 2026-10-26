# Video lectures

The LMS does not host lecture video. A video lecture stores a **reference** (a
euron-video-system video id, an HLS or MP4 URL, or a YouTube id), and the LMS decides who
may play it. Upload, transcoding, encryption, tokenised manifests and delivery belong to euron-video-system (EVS), a
separate open-source project that runs as its own deployment
([ADR 0015](adr/0015-video-delegated-to-euron-video-system.md)). Running the two together
is in [guides/video-with-evs.md](../guides/video-with-evs.md).

## Providers

`lectures.video_provider` with `lectures.video_ref`
([`db/migrations/0001_init.sql`](../../db/migrations/0001_init.sql)), validated by
`normaliseVideoRef` in [`apps/api/src/domain/authoring-rules.ts`](../../apps/api/src/domain/authoring-rules.ts):

| Provider | `video_ref` | Playback |
| --- | --- | --- |
| `EVS` | An EVS video id, `[A-Za-z0-9_-]{1,64}` | A playback session minted server-side for this viewer: a manifest URL with a short-lived token, thumbnails, poster, an optional watermark |
| `HLS` | An `https://` URL of a master playlist you host | The URL, with the learner's email as a watermark when signed in |
| `MP4` | An `https://` URL of a file you host | Same |
| `YOUTUBE` | An 11-character id (a pasted YouTube URL is reduced to the id) | A `youtube-nocookie.com` embed |

`video_status` (`PROCESSING`, `READY`, `FAILED`) gates playback and publishing. It is
`READY` by default; for EVS lectures it follows EVS.

## Attaching a video (authoring)

In the course editor an author either pastes a reference or picks from the EVS library:

- `GET /api/admin/evs/videos?q=&page=` lists videos with the **read key**
  (`EVS_READ_KEY`, scope `videos:read`); without it the picker is off
  (`503 VIDEO_LIBRARY_NOT_CONFIGURED`) and authors paste ids.
- `GET /api/admin/evs/status` reports `{ configured, canListVideos }`;
  `POST /api/admin/integrations/evs/test` (ADMIN) checks the connection.
- Saving an EVS reference looks the video up (`lookupVideo` in
  [`apps/api/src/services/evs.service.ts`](../../apps/api/src/services/evs.service.ts)),
  before the curriculum transaction opens: its status (`ready` to READY, `failed` to FAILED,
  anything else PROCESSING) and its duration, which becomes the item's
  `duration_seconds`. Without a read key, or when EVS does not answer, the video is assumed
  READY and playback reports `VIDEO_NOT_READY` if it is not.
- Publishing is blocked (`422 PUBLISH_BLOCKED`, `VIDEO_NOT_READY`) while any video lecture
  has no reference or a status other than READY.

## Playing a video

![Classroom playback: the browser asks the API for playback; the API runs the entitlement check, then mints an EVS session with the playback key; the browser plays the manifest from EVS and sends heartbeats to the API](../assets/diagrams/classroom-playback.svg)

`POST /api/learn/items/:itemId/playback` ([`apps/api/src/services/playback.service.ts`](../../apps/api/src/services/playback.service.ts)):

1. `requireItemAccess(viewer, itemId)`: an enrollment that grants access, course staff, an
   active plan, or a free preview ([entitlements.md](entitlements.md)). Nothing is minted
   before this check.
2. The item must be a VIDEO lecture (`409 NOT_A_VIDEO`) with status READY
   (`409 VIDEO_NOT_READY`).
3. `resumeAt` is the learner's stored `position_seconds` (0 for previews and staff).
4. By provider:
   - **EVS**: `POST {EVS_BASE_URL}/v1/videos/{id}/playback-sessions` with
     `Authorization: Bearer EVS_PLAYBACK_KEY` (scope `playback:mint`) and
     `{ viewerId, origin }`: the learner's user id (`preview-anon` for a signed-out
     preview) and the origin of `APP_WEB_URL`. EVS answers with `manifestUrl`,
     `thumbnailsUrl`, `posterUrl`, `expiresAt` and a watermark policy. EVS 404 becomes
     `404 VIDEO_NOT_FOUND`, 422 becomes `409 VIDEO_NOT_READY`, other failures
     `502 VIDEO_SERVICE_ERROR`, an unreachable EVS `502 VIDEO_SERVICE_UNAVAILABLE`, and a
     missing base URL or key (`set-me` counts as missing) `503 VIDEO_NOT_CONFIGURED`
     ([`apps/api/src/integrations/evs.ts`](../../apps/api/src/integrations/evs.ts)).
   - **HLS / MP4**: the stored URL; `watermark` is the learner's email when signed in.
   - **YouTube**: `https://www.youtube-nocookie.com/embed/<id>?rel=0`.
5. The rate limit is 120 mints per hour per learner.

The EVS key never reaches the browser: the browser only gets the session's manifest URL,
which carries a token bound to that viewer and video. `video_ref` is in no learner DTO;
it is only revealed here, in the form the player needs (and in the admin item editor).

In the browser ([`apps/web/src/components/player/video-player.tsx`](../../apps/web/src/components/player/video-player.tsx)):
EVS and HLS play through hls.js (native HLS where MSE is missing), MP4 natively, YouTube in
[`youtube-frame.tsx`](../../apps/web/src/components/player/youtube-frame.tsx). When the
session is about to expire (30 s margin) or a fatal HLS error occurs, the player calls the
playback route again and resumes in place, up to three times. A watermark, when present,
is drawn over the video and moves every 30 s. Heartbeats go to the API every 15 s while
playing ([progress-and-certificates.md](progress-and-certificates.md)).

## Webhook: `video.ready` and `video.failed`

`POST /api/webhooks/evs`, raw body, no auth
([`apps/api/src/routes/evs-webhook.routes.ts`](../../apps/api/src/routes/evs-webhook.routes.ts)):

1. `EVS_WEBHOOK_SECRET` unset: `503 EVS_WEBHOOK_NOT_CONFIGURED`.
2. Verify `EVS-Signature: t=<unix>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`,
   constant time, within 300 s (`400 BAD_SIGNATURE`). Parse the JSON envelope
   (`400 BAD_PAYLOAD`).
3. `video.ready` sets READY and, when EVS reports `durationSeconds`, the item duration
   (capped at 100 hours); `video.failed` sets FAILED. Other types and unknown video ids are a
   no-op answered `200 { received: true, updated: 0 }`.
4. In one transaction: lock every affected course row in id order (the same lock the
   curriculum editor takes, so the two never deadlock), update every EVS lecture with that
   id, recount the course's `duration_seconds`.

There is no event-id deduplication because none is needed: the handler **sets** state, so
a redelivered event writes the same values again. Subscribe only `video.ready` and
`video.failed`.

## Content Security Policy

The web app's CSP is built per request in
[`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts). `VIDEO_ORIGINS`
(space- or comma-separated origins) is added to `media-src`, `img-src` (posters and
thumbnails) and `connect-src` (hls.js fetches playlists and segments with XHR). List the
EVS API origin (it serves the tokenised manifests) and its media or CDN origin, plus any
host of HLS or MP4 lectures. `frame-src` allows `https://www.youtube-nocookie.com`. On AWS,
Terraform sets `VIDEO_ORIGINS` from `video_origins`, or from the origin of `evs_base_url`
when the list is empty ([`infra/terraform/modules/deployment/main.tf`](../../infra/terraform/modules/deployment/main.tf)).
A missing origin shows up as a blocked request in the browser console and a player that
never starts.

## The stub

Locally, [`apps/stubs/server.mjs`](../../apps/stubs/server.mjs) speaks the EVS API
([README](../../apps/stubs/README.md)):

- `POST /v1/videos/:id/playback-sessions` answers 201 with a session whose manifest is
  `http://localhost:5119/stub/evs/play/:id/master.m3u8?token=...`; ids starting with
  `missing` are 404, `processing...` and `vid_processing` are 422.
- The manifest serves one rendition and three 2-second MPEG-TS segments from
  `apps/stubs/assets/hls`; a bad or expired token is 403.
- `GET /v1/videos` lists three fixed videos for the picker.
- `POST /stub/evs/videos/:id/ready` and `/failed` send a signed webhook to the API, so the
  whole status flow can be exercised.

The compose file sets `EVS_BASE_URL=http://stubs:5119`, a generated `EVS_PLAYBACK_KEY`
(used for the read key too), `EVS_WEBHOOK_SECRET`, and
`VIDEO_ORIGINS=http://localhost:5119`.

## Limits of the design

- HLS and MP4 URLs you host are handed out after the entitlement check, but the URL itself
  is whatever your host makes it: a public URL can be shared. Use EVS for content that must
  not leak, since its tokens are short-lived and bound to a viewer.
- YouTube lectures are only as private as the video's YouTube visibility.
- The watermark on HLS and MP4 lectures is drawn by the web player, not burned into the
  stream; it deters casual screen recording, nothing more.
