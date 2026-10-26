/** Category rows to the Category DTO. */
import type { Category } from "@open-lms/types";
import type { CategoryRow } from "../repositories/category.repository";

export function toCategory(c: CategoryRow): Category {
  return { id: c.id, slug: c.slug, name: c.name, description: c.description, courseCount: Number(c.course_count ?? 0) };
}
