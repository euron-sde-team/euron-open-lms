import type { ApiError as ApiErrorBody } from "@open-lms/types";

export interface FieldError {
  path: string;
  message: string;
}

/**
 * Every failed call rejects with this. `code` is the API's stable code
 * (`VALIDATION_FAILED`, `DM_NOT_ALLOWED`, ...); switch on it, never on `message`.
 * Transport failures use `NETWORK_ERROR` with status 0.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(init: { status: number; code: string; message: string; details?: unknown; requestId?: string }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
  }

  /** Per-field validation messages from a 400 VALIDATION_FAILED, keyed by path. */
  get fieldErrors(): Record<string, string> {
    return fieldErrorsOf(this.details);
  }

  /** `details.reason` (for example the DmDenialReason on 403 DM_NOT_ALLOWED). */
  get reason(): string | null {
    const d = this.details as { reason?: unknown } | null | undefined;
    return d && typeof d.reason === "string" ? d.reason : null;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function fieldErrorsOf(details: unknown): Record<string, string> {
  const fields = (details as { fields?: unknown } | null | undefined)?.fields;
  const out: Record<string, string> = {};
  if (!Array.isArray(fields)) return out;
  for (const f of fields as Partial<FieldError>[]) {
    if (f && typeof f.path === "string" && typeof f.message === "string" && !(f.path in out)) out[f.path] = f.message;
  }
  return out;
}

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  422: "UNPROCESSABLE",
  429: "RATE_LIMITED",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
  504: "GATEWAY_TIMEOUT",
};

/** Build an ApiError from a non-2xx status and whatever body came back. */
export function toApiError(status: number, body: unknown): ApiError {
  const b = body as Partial<ApiErrorBody> | null | undefined;
  if (b && typeof b === "object" && typeof b.code === "string") {
    return new ApiError({
      status,
      code: b.code,
      message: typeof b.error === "string" && b.error ? b.error : "Request failed",
      details: b.details,
      requestId: b.requestId,
    });
  }
  return new ApiError({
    status,
    code: STATUS_CODES[status] ?? (status >= 500 ? "SERVER_ERROR" : `HTTP_${status}`),
    message: status >= 500 ? "The server had a problem. Try again in a moment." : `Request failed (${status})`,
  });
}

export function networkError(cause?: unknown): ApiError {
  return new ApiError({
    status: 0,
    code: "NETWORK_ERROR",
    message: "Could not reach the server. Check your connection.",
    details: cause instanceof Error ? { cause: cause.message } : undefined,
  });
}

/** Codes on a 401 that mean "your access token is stale, refresh and retry". */
export const REFRESHABLE_CODES: ReadonlySet<string> = new Set(["TOKEN_INVALID", "TOKEN_EXPIRED", "SESSION_EXPIRED"]);
