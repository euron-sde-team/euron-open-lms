# ADR 0008: Direct-to-storage uploads, referenced by upload id only

## Status

Accepted.

## Context

Course covers, PDF lectures, downloadable resources and assignment files (up to 200 MB for
a video submission) should not stream through the API tasks. The system this one replaces
stored whatever file URL or storage key a client sent, so anyone could attach someone
else's file or an arbitrary link. The declared type of a file cannot be trusted. Lecture
video is out of scope here: it lives in euron-video-system ([ADR 0015](0015-video-delegated-to-euron-video-system.md)).

## Decision

- The browser asks for an upload (`POST /api/media/uploads` with purpose, file name, type
  and size). Purposes are `AVATAR`, `COURSE_COVER`, `BRANDING`, `LECTURE_PDF`,
  `LECTURE_RESOURCE` and `SUBMISSION`, each with its allowed kinds; SVG, HTML, XML,
  JavaScript and executables are refused by type and extension. The API stores a `PENDING`
  row and returns a presigned PUT (600 s, content type and length signed)
  ([`services/media.service.ts`](../../../apps/api/src/services/media.service.ts),
  [`domain/media-rules.ts`](../../../apps/api/src/domain/media-rules.ts)).
- After uploading, the client calls `complete`. The API reads the object's size (must equal
  the declared size) and its first bytes (must match the type's magic number), then queues
  `media.process`, which re-encodes images with sharp (EXIF and GPS stripped) and writes a
  thumbnail.
- Content references media only by upload id: a course cover, a PDF lecture, a resource, a
  submission's files, an avatar, the academy logo. `claimUploads` checks owner, purpose,
  status and single use under `FOR UPDATE`
  ([`services/media-attach.service.ts`](../../../apps/api/src/services/media-attach.service.ts)).
- The bucket is private; reads are presigned GETs minted after the API's own permission
  check (a PDF lecture needs course access; a submission file is visible to its learner,
  the course staff and platform staff). Keys are `media/<purpose>/<yyyy>/<mm>/<id>.<ext>`.
- `STORAGE=local` keeps the same browser flow with HMAC-signed URLs served by the API, for
  development and tests.
- `maintenance.expire-uploads` deletes abandoned, rejected and never-attached uploads.

## Consequences

Positive:

- Upload bandwidth never touches the API or the CDN.
- No hotlinking, no attaching other people's files, nothing scriptable served from the
  bucket.

Trade-offs:

- Three round trips per file and a CORS rule on the bucket.
- Signed URLs expire (900 s by default), so clients refetch rather than cache them, and a
  URL stays valid until expiry even if access is revoked.
- Only images are re-encoded; documents and archives are type-checked but not scanned.

## Alternatives considered

- **Multipart upload through the API.** Ties API memory and tasks to file size.
- **Public bucket or CDN URLs.** Permanent public links to paid content.
- **Accepting client URLs or keys.** The defect being fixed.
