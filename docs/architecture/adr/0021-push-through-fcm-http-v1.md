# ADR 0021: Push notifications through FCM HTTP v1

## Status

Accepted.

## Context

The mobile app should hear about the same things the inbox and email already cover:
a reviewed assignment, a Q&A reply, a certificate, a receipt. Android delivery needs
Firebase Cloud Messaging; iOS needs APNs, which FCM can front once the APNs key is uploaded
to the Firebase project. The API must not gain a heavy SDK, must keep side effects after
commit (ADR 0007) and must run fully offline in development and CI.

## Decision

- `push_devices` holds one row per installed app (`platform`, unique `token`, app
  version, locale). `PUT /api/my/devices` upserts by token and moves a token to whoever is
  signed in now; `DELETE /api/my/devices/:token` removes your own. Native sign-out with
  `deviceToken`, sign-out everywhere, a pending deletion and erasure remove devices.
- `notify()` (`notification.service.ts`) queues `notify.push` after commit next to
  `notify.email`, only when `PUSH_PROVIDER` is not `none`. The job
  (`services/push.service.ts`) claims the notification once (`pushed_at`), checks the
  recipient is ACTIVE and the notification recent, applies `users.push_preferences` by the
  same category map as email (`PUSH_DEFAULTS`: learning, community and billing reminders on,
  product updates off; receipts, refunds and access changes always), and sends one message
  per device: the email's title and body (`notificationCopy`) and
  `data: { type, url, notificationId }` where `url` is the inbox link (`hrefFor`).
- The provider (`integrations/push/`) is FCM HTTP v1 with node:crypto only: the API signs an
  RS256 JWT with the service account key (`FCM_SERVICE_ACCOUNT_JSON`, a secret), exchanges
  it for an access token and caches it until a minute before expiry. `UNREGISTERED` and
  `INVALID_ARGUMENT` answers delete the device row; other failures are logged.
- `PUSH_PROVIDER=stub` runs the same client against apps/stubs (a token endpoint and
  `messages:send` that records messages for `GET /fcm/messages`), signed with a throwaway
  key generated at boot. The production guard refuses `stub`; `fcm` without a key is a
  warning. Terraform creates `<prefix>/push` with a `set-me` placeholder when
  `push_provider = "fcm"`.

## Consequences

Positive:

- One provider for both platforms, no SDK, and the local stack exercises the real request
  path, including OAuth and dead-token cleanup.
- Push, email and the inbox agree on wording and destination.

Trade-offs:

- Pushes are best effort: a failure after the claim is not retried for that device (the
  same trade as notification email).
- The service account key can send to every device of the Firebase project; it is stored
  and rotated like the payment keys.

## Alternatives considered

- **firebase-admin.** Correct, but a large dependency tree for one HTTP call.
- **APNs directly for iOS.** A second provider, a second key type and a second set of
  error codes for no gain once FCM fronts APNs.
