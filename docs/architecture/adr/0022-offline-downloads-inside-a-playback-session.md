# ADR 0022: Offline downloads as licences inside a playback session

## Status

Accepted. Builds on [ADR 0012](0012-entitlements-as-one-pure-function.md) and
[ADR 0015](0015-video-delegated-to-euron-video-system.md).

## Context

Learners on the mobile app want to watch lectures on a train. A downloaded file outlives
the entitlement that allowed it: an enrollment can be revoked, an order refunded, a plan
can lapse, a course can stop allowing downloads. The LMS never holds the video itself
(EVS does), and the access rule must stay in one place (ADR 0012).

## Decision

- A download is a **licence**, not a file: `offline_downloads` keeps one row per learner,
  item and device (`device_id` is an installation id the app generates) with an
  `expires_at` window and `revoked_at`.
- `POST /api/learn/items/:itemId/downloads { deviceId }` runs the same check as playback
  (`requireItemAccess`, so `decideAccess`), refuses a free preview, and then requires the
  academy switch (`settings.learning.offline.enabled`), the course switch
  (`courses.allow_downloads`), a READY video lecture that is not on YouTube, and fewer than
  `maxPerUser` active licences (counted under the learner's row lock). Stable 409 codes say
  which rule failed.
- The stream comes from the same place playback does: an EVS session minted for this
  viewer with the longest ttl EVS grants (`ttlSeconds` 3600), or the HLS/MP4 URL. The app
  fetches and encrypts the stream within that session; the licence window is
  `learning.offline.days`.
- While online the app calls `POST /api/my/downloads/validate { deviceId, itemIds }`.
  Licences whose access still holds, with downloads still allowed, slide their window
  forward; every other copy (access ended or refunded, switches off, item changed, admin
  revoked, never licensed on this device) comes back in `revoked` and is marked revoked.
- Support staff see a learner's licences and revoke one (`download.revoke`, audited); the
  copy is deleted at the app's next check.

## Consequences

Positive:

- No second access rule: the same function decides playback, downloads and validation.
- Revocation and refunds reach offline copies within one online check, and an offline-only
  device stops playing after `days`.

Trade-offs:

- Enforcement on the device is the app's job (an encrypted store, a clock check, deletion of
  revoked copies). A rooted device can keep bytes it already decrypted; the watermark is the
  deterrent, as online.
- The licence window is counted from the last check, so a learner online daily keeps a copy
  for as long as their access lasts.

## Alternatives considered

- **Platform DRM offline licences (FairPlay, Widevine).** Strongest, but requires a DRM
  licence server and packaging in EVS; the licence table can sit in front of that later.
- **Signed long-lived download URLs.** Simple, but nothing could ever take a copy back.
