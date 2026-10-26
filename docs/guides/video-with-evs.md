# Video with euron-video-system

Lecture video in Euron Open LMS plays from euron-video-system (EVS), a separate
open-source video platform that handles uploads, transcoding, encryption, tokenised HLS and
delivery. The LMS stores an EVS video id per lecture, mints a playback session after its own
entitlement check, and listens for `video.ready` and `video.failed`. How it works is in
[architecture/video.md](../architecture/video.md). Lectures can also use your own HLS or MP4
URLs or YouTube, with no EVS at all.

What the LMS needs from EVS:

| Item | Scope or kind | LMS variable |
| --- | --- | --- |
| The EVS API origin | | `EVS_BASE_URL` |
| A playback key | `playback:mint` | `EVS_PLAYBACK_KEY` |
| A read key (optional: the editor's video picker and status lookups) | `videos:read` | `EVS_READ_KEY` |
| A webhook endpoint for `video.ready` and `video.failed` | its signing secret | `EVS_WEBHOOK_SECRET` |
| The origins video plays from, for the CSP | | `VIDEO_ORIGINS` (web app) |

Use two separate keys: the playback key is the one used on every lecture view, and it
should not be able to list the library.

## Locally: EVS next to the LMS

Without any of this, the LMS stack plays its demo lessons from the stub, which speaks the
EVS API ([`apps/stubs/README.md`](../../apps/stubs/README.md)). To use a real EVS:

1. **Run EVS** from its repository (`make up`; see its local quickstart). By default its API
   is on `http://localhost:8080`, its console on `http://localhost:3000` and its AWS
   emulator on `http://localhost:4566`; none of these clash with the LMS ports
   ([quickstart-local.md](quickstart-local.md#ports)). Upload a video in the EVS console or
   with its demo upload script and wait for `ready`.

2. **Create the two keys** inside the EVS stack, with its CLI (run from the EVS repository):

   ```bash
   docker compose -f deploy/compose/compose.yaml -f deploy/compose/compose.floci.yaml \
     run --rm -T migrate pnpm --silent evs keys:create --name lms-playback --scopes playback:mint
   docker compose -f deploy/compose/compose.yaml -f deploy/compose/compose.floci.yaml \
     run --rm -T migrate pnpm --silent evs keys:create --name lms-library --scopes videos:read
   ```

   (or `POST /v1/api-keys`, or the console's API keys page). Each prints an `evs_...` key once.

3. **Register the LMS webhook** in EVS, with a key that has `webhooks:manage`:

   ```bash
   curl -s -X POST http://localhost:8080/v1/webhooks -H "Authorization: Bearer $EVS_ADMIN_KEY" \
     -H "Content-Type: application/json" \
     -d '{"url":"http://host.docker.internal:5026/api/webhooks/evs","events":["video.ready","video.failed"],"description":"Euron Open LMS"}'
   ```

   Keep the `signingSecret` from the response: it is shown once. The local EVS stack allows
   private webhook targets; a production EVS only accepts public `https://` URLs.

4. **Point the LMS at it** in `deploy/compose/.env` (values there win over the stub
   defaults):

   ```bash
   EVS_BASE_URL=http://host.docker.internal:8080
   EVS_PLAYBACK_KEY=evs_...          # playback:mint
   EVS_READ_KEY=evs_...              # videos:read
   EVS_WEBHOOK_SECRET=whsec_...      # the signingSecret from step 3
   VIDEO_ORIGINS=http://localhost:8080 http://localhost:4566
   ```

   `EVS_BASE_URL` is how the API container reaches EVS (`host.docker.internal` works on
   Docker Desktop and OrbStack; on Linux use the host's address on the Docker bridge).
   `VIDEO_ORIGINS` is what the **browser** fetches from: the EVS API origin that serves the
   tokenised manifests, and the origin that serves the segments (the emulator locally).
   Then `make up` again so the containers pick up the values.

5. **Check it**: sign in as an admin, open `/admin/settings` and run the EVS connection test
   (`POST /api/admin/integrations/evs/test`), which lists one video with the read key.

## On AWS

1. In `terraform.tfvars`:

   ```hcl
   evs_base_url  = "https://video.example.com"
   # Default: the origin of evs_base_url. List the media or CDN origin too when segments
   # are served from elsewhere.
   video_origins = ["https://video.example.com", "https://media.video.example.com"]
   ```

2. `make aws-deploy` creates `<name_prefix>/evs` with three `set-me` placeholders. Create the
   keys in your EVS deployment (over its API with a bootstrap key, or its console), register
   the webhook on `https://<domain>/api/webhooks/evs` (`terraform output webhook_urls`) for
   `video.ready` and `video.failed`, then put the values:

   ```bash
   aws secretsmanager put-secret-value --secret-id <name_prefix>/evs --secret-string \
     '{"EVS_PLAYBACK_KEY":"evs_...","EVS_READ_KEY":"evs_...","EVS_WEBHOOK_SECRET":"whsec_..."}'
   ```

   and roll the api and worker ([deploy-aws.md](deploy-aws.md#3-replace-the-set-me-placeholders)).
   Without a read key, leave `EVS_READ_KEY` as `set-me`: the picker is then off and authors
   paste ids.

`EVS_WEBHOOK_SECRET` must not stay `set-me` ([security.md](../architecture/security.md#known-limitations)).

## Attaching videos in the course editor

1. Open `/admin/courses/<id>`, add a lecture of kind **Video**, and pick the provider **EVS**.
2. With a read key, choose the video from the library (search by title); without one, paste
   the EVS video id (1 to 64 letters, digits, `-` or `_`).
3. On save the API looks the video up: its status (`READY`, `PROCESSING` or `FAILED`) and
   its duration, which becomes the lecture's length. A processing video flips to READY by
   itself when EVS sends `video.ready`.
4. Optionally mark the lecture as a **free preview**: anyone can then watch it from the
   course page, signed in or not (EVS sessions for signed-out viewers use the viewer id
   `preview-anon`).
5. Publishing the course is blocked while any video lecture has no video or a video that is
   not READY.

For HLS or MP4 lectures paste an `https://` URL and add its host to `VIDEO_ORIGINS`; for
YouTube paste the link or the 11-character id.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `503 VIDEO_NOT_CONFIGURED` | `EVS_BASE_URL` or `EVS_PLAYBACK_KEY` missing (or `set-me`) |
| `502 VIDEO_SERVICE_UNAVAILABLE` | The API cannot reach `EVS_BASE_URL` (network, DNS, the container name) |
| `502 VIDEO_SERVICE_ERROR` | EVS refused the mint: a wrong key or a key without `playback:mint` |
| `404 VIDEO_NOT_FOUND` | The id does not exist in that EVS |
| `409 VIDEO_NOT_READY` | Still processing (EVS answered 422), or the lecture's status is not READY |
| The player spins; the console shows a CSP violation | Add the manifest and segment origins to `VIDEO_ORIGINS` |
| Status stays PROCESSING | The webhook is not reaching `/api/webhooks/evs`, or `EVS_WEBHOOK_SECRET` does not match (`400 BAD_SIGNATURE` in the API log); EVS shows failed deliveries |
| `503 VIDEO_LIBRARY_NOT_CONFIGURED` in the editor | No read key: paste ids, or set `EVS_READ_KEY` |

More in [troubleshooting.md](troubleshooting.md#video).
