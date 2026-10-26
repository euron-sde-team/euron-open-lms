# Progress and certificates

The one path from "this item is done" to "this course is done" to "here is your
certificate", shared by every item kind:
[`apps/api/src/services/progress.service.ts`](../../apps/api/src/services/progress.service.ts).
The pure rules are in [`apps/api/src/domain/progress.ts`](../../apps/api/src/domain/progress.ts).

## Who writes progress

Only a learner with an enrollment that grants access (a SUBSCRIPTION enrollment is
created on first open under a plan). Everyone else is refused so analytics stay honest:

| Viewer | Progress writes |
| --- | --- |
| Learner with access | Recorded |
| Course staff or ADMIN/SUPPORT browsing without an enrollment | `409 STAFF_PREVIEW` |
| Anyone on a free preview item without access | `409 PREVIEW` |
| Suspended learner | Heartbeats and "mark as done" still record (a suspension restricts posting, not learning) |

## Video heartbeats and anti-skip

While a video plays, the web player sends `POST /api/learn/items/:itemId/progress` with
`ProgressBeat { positionSeconds, playedSeconds, durationSeconds? }` every 15 s, and on
pause, end, tab hide and unmount.

On the client, [`apps/web/src/lib/classroom/beat-accumulator.ts`](../../apps/web/src/lib/classroom/beat-accumulator.ts)
counts `playedSeconds` from `timeupdate` samples: a forward step counts only when it is
within 1.5 times what the wall clock and the playback rate allow (plus 0.35 s of jitter),
so a seek, a scrub to the end or a jump after a stall is not watching. Whole seconds are
sent and the fraction carries over.

The server does not trust that number either. `applyBeat(prev, beat, duration, now)`:

- `played` is clamped to at most `min(60, ceil(elapsed * 2 + 2))` seconds, where `elapsed`
  is the wall-clock time since the previous beat (60 for the first one). Two-times speed is
  allowed; a beat cannot claim more time than has passed.
- `watched_seconds` grows only by `played`, capped at the duration.
- `furthest_seconds` moves forward by at most `played + 5` per beat, however far the
  playhead jumped.
- `position_seconds` is where the playhead is (the resume point), clamped to the duration.
- The duration is the item's `duration_seconds` (set by the author or by EVS); when that is
  0 the beat's `durationSeconds`, capped at six hours.

A video **completes** when `watched_seconds * 100 / duration >= settings.learning.videoCompletePercent`
(default 90). Dragging the scrubber to the end completes nothing.

The beat is written in a transaction that first locks the learner's enrollment row, then
reads and saves `item_progress`, completes the item if this beat crossed the threshold, and
touches `enrollments.last_item_id` and `last_activity_at`.

## Completion rules per item kind

| Kind | Completes when | From |
| --- | --- | --- |
| Video lecture | `videoCompletePercent` of it was actually watched | Heartbeats ([`services/classroom.service.ts`](../../apps/api/src/services/classroom.service.ts) `beat`) |
| Article or PDF lecture | The learner presses "Mark as done" (opening it is not reading it) | `POST /api/learn/items/:itemId/complete`; videos, quizzes and assignments answer `409 ITEM_COMPLETES_ITSELF` |
| Quiz | The first passing attempt | [`services/quiz.service.ts`](../../apps/api/src/services/quiz.service.ts) |
| Assignment | A reviewer approves a submission | [`services/grading.service.ts`](../../apps/api/src/services/grading.service.ts) |

`markItemComplete` is idempotent: an upsert on `item_progress` that keeps the first
`completed_at`, and reports `justCompleted` only the first time (the web app shows its
"Completed" toast once).

## The rollup

`refreshRollup(userId, courseId)` runs in the same transaction as the completion:

1. Lock the enrollment row (`FOR UPDATE`). Without it, a quiz pass, an approval and a final
   video beat landing at the same moment on different items could each see "one item
   left" and none would complete the course.
2. Count completed items against the **current** curriculum in SQL
   (`course_items LEFT JOIN item_progress`), never by incrementing, so the number is right
   after items are added, moved or deleted.
3. Store `completed_items` and `progress_percent = floor(done * 100 / total)` (99.6% never
   shows as 100%).
4. When every item is done, set `completed_at` once (`coalesce(completed_at, now())`).
   Completion is sticky: adding a lesson later lowers the percentage on the next write but
   does not take a finished course, or its certificate, away.
5. Issue the certificate if the course has `certificate_enabled` (below).

`resumeTarget` picks where "Continue" goes: the last item touched if it is not done, else
the first item not done, else the last one touched, else the first.

My Learning's dashboard (`GET /api/my/summary`) adds courses in progress and completed,
certificates, approximate minutes watched this week and the day streak (consecutive days
of activity ending today or yesterday, in `settings.analytics.timezone`).

## Certificates

### Issue

`issueCertificate` (inside the completing transaction):

- Skipped when the course has certificates off.
- Inserts `certificates` with `ON CONFLICT (user_id, course_id) DO NOTHING`: one per
  learner per course, however many completions race.
- **Freezes** what it prints: `learner_name` (the account's `certificate_name`, else the
  display name), `course_title`, and the names of the listed course staff in order.
  Renaming a course or a learner never changes an issued certificate.
- The serial is `LMS-XXXX-XXXX-XX` from 10 random bytes over an alphabet without `0`, `O`,
  `1` and `I` (`certificateSerial` in [`apps/api/src/domain/orders.ts`](../../apps/api/src/domain/orders.ts)).
- Queues `certificates.render` after commit and notifies `CERTIFICATE_ISSUED`. The
  `ProgressResult` of the completing request carries the serial, so the classroom can show
  the completion moment at once.

### Render

`renderCertificate` ([`apps/api/src/services/certificate.service.ts`](../../apps/api/src/services/certificate.service.ts))
draws a landscape A4 page with pdfkit's built-in Helvetica (no font files, no headless
browser): the academy name, the learner, the course, "Taught by ...", the issue date, the
serial, the verify URL (`APP_WEB_URL/verify/<serial>`), and the signatory and footer from
`settings.certificates`. It stores the PDF privately at
`certificates/<yyyy>/<serial>.pdf` and sets `pdf_key`. A certificate that already has a
PDF is left alone, so retries are safe.

### Verify

`GET /api/certificates/:serial` is public (120 per minute per IP). The serial must match
`^[A-Z0-9]{2,10}(-[A-Z0-9]{1,10}){1,5}$` before any lookup; an unknown serial is 404. The
answer has the frozen names, the course, the issue date and whether it was revoked. The web
page is `/verify/[serial]`; `/verify` takes a typed serial.

### Download

`GET /api/certificates/:serial/pdf` is for the owner only (anyone else 404): a 302 to a
short-lived signed URL, `409 CERTIFICATE_RENDERING` until the PDF exists,
`409 CERTIFICATE_REVOKED` for a revoked one. `pdfUrl` in the DTO follows the same rule.

### Revoke and restore

Area `certificates` (ADMIN, SUPPORT):
`POST /api/admin/certificates/:id/revoke { reason }` and `/restore`, each a conditional
update on `revoked_at`, audited in the same transaction
([`apps/api/src/services/admin-certificates.service.ts`](../../apps/api/src/services/admin-certificates.service.ts)).
The public verify page shows a revoked certificate as revoked at once. Revoking an
enrollment does not revoke a certificate already earned. Erasing an account deletes its
certificates, because they carry the person's name.
