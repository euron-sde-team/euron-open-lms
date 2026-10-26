# ADR 0020: Native token mode for the mobile app

## Status

Accepted. Extends [ADR 0005](0005-refresh-rotation-cookie-and-memory-token.md).

## Context

The web app keeps the access token in memory and the refresh token in an httpOnly
`lms_refresh` cookie scoped to `/api/auth` (ADR 0005). A React Native app has no browser
cookie jar it controls well, no same-site protection to lean on, and a far better place for
a long-lived secret: the platform keystore (iOS Keychain, Android Keystore). It still needs
exactly the same session semantics: short access tokens, one refresh token per login that
rotates on every use, and family revocation when a rotated token is replayed.

## Decision

- A client opts in per request with the header `X-Client: native` (value compared without
  case). The header changes only the transport of the refresh token, never what a session
  is.
- Every endpoint that issues a session (sign-up without verification, verify-email,
  sign-in including the TOTP and recovery-code completion, refresh) answers
  `IssuedNativeSession`: the `AuthResult` plus `refreshToken` and `refreshExpiresAt` (ISO).
  No `Set-Cookie` header is ever sent in native mode, also on sign-out, sign-out
  everywhere and password change.
- `POST /api/auth/refresh` and `POST /api/auth/logout` take a strict body
  `{ refreshToken }` in native mode (logout also takes an optional `deviceToken` to drop
  that push registration). Without the header both behave exactly as before, cookie only.
- Rotation and reuse detection are one code path, `auth.service.ts refresh`: the stored
  value is still only the SHA-256, a rotated token replayed after the ten-second two-tab
  grace revokes its family and writes `session.reuse_detected`.
- Sign-out everywhere (and password change and reset, which share it) also deletes every
  push device of the account, so a signed-out phone stops receiving notifications.

## Consequences

Positive:

- One session model, one table, one set of tests for both clients; the integration suite
  covers native login, body refresh, replay revoking the family and body logout, and that
  cookie mode is unchanged.
- The refresh token never sits in JavaScript-readable storage on the web, and never in a
  cookie jar on a phone.

Trade-offs:

- A native refresh token in the body is readable by the app's JavaScript. The app must keep
  it only in the keystore and never log it (the API's logger already redacts bodies).
- The header is a client claim. It does not weaken the web: a browser page that sends
  `X-Client: native` only stops receiving the httpOnly cookie, and CORS still limits which
  origins can call with credentials.

## Alternatives considered

- **Cookies in the app.** Works with some libraries, but couples token storage to an HTTP
  stack instead of the keystore, and breaks on platform cookie quirks.
- **A separate `/api/auth/native/*` set of routes.** Duplicates every session-issuing route
  and its tests; the header keeps one route table.
