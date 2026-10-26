/**
 * Errors a service throws to end a request with a specific status. Anything else that
 * escapes a handler becomes a 500 with a request id and no internal detail.
 *
 * `code` is a stable machine-readable identifier the web app switches on; `message`
 * is for humans and may change.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = defaultCode(status),
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function defaultCode(status: number): string {
  return (
    {
      400: "BAD_REQUEST",
      401: "UNAUTHENTICATED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      413: "PAYLOAD_TOO_LARGE",
      422: "UNPROCESSABLE",
      429: "RATE_LIMITED",
    }[status] ?? "ERROR"
  );
}

export const badRequest = (message: string, code = "BAD_REQUEST", details?: unknown) => new HttpError(400, message, code, details);
export const unauthenticated = (message = "Sign in to continue", code = "UNAUTHENTICATED") => new HttpError(401, message, code);
export const forbidden = (message = "You do not have permission to do that", code = "FORBIDDEN", details?: unknown) => new HttpError(403, message, code, details);
export const notFound = (message = "Not found", code = "NOT_FOUND") => new HttpError(404, message, code);
export const conflict = (message: string, code = "CONFLICT", details?: unknown) => new HttpError(409, message, code, details);
export const unprocessable = (message: string, code = "UNPROCESSABLE", details?: unknown) => new HttpError(422, message, code, details);
export const tooMany = (message = "Too many requests, slow down", retryAfterSeconds?: number) =>
  new HttpError(429, message, "RATE_LIMITED", retryAfterSeconds ? { retryAfterSeconds } : undefined);
