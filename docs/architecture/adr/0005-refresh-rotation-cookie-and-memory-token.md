# ADR 0005: Short access token in memory, rotating refresh token in an httpOnly cookie

## Status

Accepted.

## Context

The web app is a browser client on the same origin as the API. The system this one
replaces kept its tokens in `localStorage`, readable by any script that runs in the page.
A pure session cookie needs CSRF defences on every endpoint. Bans, suspensions, password
changes and "sign out everywhere" must take effect quickly, including for operators who
can refund money.

## Decision

[`security/tokens.ts`](../../../apps/api/src/security/tokens.ts),
[`services/auth.service.ts`](../../../apps/api/src/services/auth.service.ts),
[`controllers/auth.controller.ts`](../../../apps/api/src/controllers/auth.controller.ts):

- **Access token**: HS256 JWT, 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`), audience `open-lms`
  and issuer `open-lms-api` checked, claims `sub` and `ver` (`users.token_version`).
  Returned in the body and kept only in memory
  ([`apps/web/src/lib/session.ts`](../../../apps/web/src/lib/session.ts)); sent as
  `Authorization: Bearer`. Every request reloads the user, so a version bump, ban or
  deactivation applies on the next request.
- **Refresh token**: 32 random bytes in the `lms_refresh` cookie (`httpOnly`,
  `SameSite=Lax`, `Path=/api/auth`, `Secure` when served over https), 30 days
  (`REFRESH_TOKEN_TTL_DAYS`). Only its SHA-256 is stored in `sessions`.
- **Rotation with reuse detection**: each refresh issues a new token in the same
  `family_id` and marks the old row with `replaced_by`. A rotated token presented 10 s or
  more after its rotation revokes the family and audits `session.reuse_detected`; within
  10 s it is a benign double refresh. The client serialises refreshes across tabs with the
  Web Locks API ([`packages/api-client/src/http.ts`](../../../packages/api-client/src/http.ts)).
- A refresh without a cookie answers 204, so a signed-out page load is not an error.
- Unsafe methods with a foreign `Origin` get `403 CORS_ORIGIN_DENIED`.
- Password reset and change, "sign out everywhere" and a ban revoke every session and bump
  `token_version`.

## Consequences

Positive:

- No long-lived credential is readable by page scripts; a stolen access token lasts at
  most 15 minutes.
- A replayed refresh token kills the session family.

Trade-offs:

- A page load needs a refresh round trip before the first authenticated call.
- Signing out one session revokes its refresh family, not the access token already issued.
- Every authenticated request reads the user row.

## Alternatives considered

- **Tokens in localStorage.** The defect being fixed.
- **Server sessions with a cookie only.** CSRF tokens everywhere.
- **Long-lived JWTs.** Revocation would need a denylist.
