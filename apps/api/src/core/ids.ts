import { monotonicFactory } from "ulid";

const next = monotonicFactory();

/** A new ULID: 26 characters, sortable by creation time. */
export function newId(): string {
  return next();
}

export const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}
