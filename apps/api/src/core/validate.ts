/**
 * Request validation with zod. Controllers parse `req.body` / `req.query` / `req.params`
 * through a schema; a failure is a 400 with the field paths, never a 500.
 */
import { z, type ZodTypeAny } from "zod";
import { badRequest } from "./errors";
import { ID_PATTERN } from "./ids";

export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const first = fields[0];
    throw badRequest(first ? `${first.path || "body"}: ${first.message}` : "Invalid request", "VALIDATION_FAILED", { fields });
  }
  return result.data;
}

export const id = () => z.string().regex(ID_PATTERN, "must be an id");
export const idParam = z.object({ id: id() });

/** Trimmed text with a length range; empty strings become undefined when optional. */
export const text = (max: number, min = 0) => z.string().trim().min(min).max(max);
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const pageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
