/**
 * One helper per API route, grouped by area (the same groups as apps/api/src/routes).
 * Paths are relative to the API base (which includes /api).
 */
import type { HttpClient } from "../http";
import { adminEndpoints } from "./admin";
import { assessmentEndpoints } from "./assessments";
import { authoringEndpoints } from "./authoring";
import { catalogEndpoints } from "./catalog";
import { commerceEndpoints } from "./commerce";
import { coreEndpoints } from "./core";
import { helpers } from "./helpers";
import { learningEndpoints } from "./learning";

export function createEndpoints(http: HttpClient) {
  const h = helpers(http);
  return { ...coreEndpoints(h), ...catalogEndpoints(h), ...learningEndpoints(h), ...commerceEndpoints(h), ...adminEndpoints(h), ...assessmentEndpoints(h), ...authoringEndpoints(h) };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
export type { PageQuery } from "./helpers";
export * from "./core";
export * from "./catalog";
export * from "./learning";
export * from "./commerce";
export * from "./admin";
export * from "./assessments";
export * from "./authoring";
