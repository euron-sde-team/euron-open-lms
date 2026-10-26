import { HttpClient, type ApiClientOptions } from "./http";
import { createEndpoints } from "./endpoints/index";

export { ApiError, isApiError, fieldErrorsOf, toApiError, networkError, REFRESHABLE_CODES, type FieldError } from "./errors";
export { HttpClient, buildQuery, type ApiClientOptions, type Query, type QueryValue, type RequestOptions, type SignOutReason } from "./http";
export { nextCursor, flattenPages, flattenAll, collectPages, mapPages, filterPages } from "./pagination";
export { uploadMedia, putWithProgress, validateUpload, mimeTypeOf, kindOf, UPLOAD_LIMITS, type UploadOptions, type UploadTicket } from "./upload";
export { envScript, envScriptResponse, nonEmpty } from "./runtime-env";
export * from "./endpoints/index";

/** The typed client: every contract helper plus the raw request and the refresh. */
export function createApiClient(opts: ApiClientOptions) {
  const http = new HttpClient(opts);
  return {
    http,
    request: http.request.bind(http),
    refreshSession: () => http.refreshSession(),
    ...createEndpoints(http),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
