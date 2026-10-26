/**
 * The category taxonomy. Anyone in the "courses" area may read it (to tag their
 * courses); only admins change it. Slugs come from the name and get -2, -3, ... when
 * taken; writes take one advisory lock so two admins cannot pick the same slug or
 * interleave a reorder. Reorder takes the complete list of ids in the new order.
 */
import type { Category } from "@open-lms/types";
import { requireAdmin, requireArea, type Actor, type RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { isCourseSlug, isPermutation, nextSlug, slugBase } from "../domain/authoring-rules";
import { toCategory } from "../presenters/category.presenter";
import { categoryRepo } from "../repositories/category.repository";
import { audit } from "./audit.service";

const MAX_CATEGORIES = 200;

export async function listCategories(actor: Actor): Promise<Category[]> {
  requireArea(actor, "courses");
  return (await categoryRepo.list()).map(toCategory);
}

function writer(actor: Actor): Actor {
  requireArea(actor, "courses");
  return requireAdmin(actor);
}

export async function createCategory(actor: Actor, input: { name: string; slug?: string; description?: string | null }, meta: RequestMeta): Promise<Category[]> {
  writer(actor);
  if (input.slug !== undefined && !isCourseSlug(input.slug)) throw badRequest("A slug is 3 to 60 lower-case letters, digits and single hyphens", "INVALID_SLUG");
  await withTransaction(async (trx) => {
    await categoryRepo.lockTaxonomy(trx);
    if ((await categoryRepo.count(trx)) >= MAX_CATEGORIES) throw badRequest(`At most ${MAX_CATEGORIES} categories`, "TOO_MANY_CATEGORIES");
    let slug: string;
    if (input.slug) {
      if ((await categoryRepo.slugsLike(input.slug, null, trx)).includes(input.slug)) throw conflict("That slug is already used", "SLUG_TAKEN");
      slug = input.slug;
    } else {
      const base = slugBase(input.name, "category");
      slug = nextSlug(base, await categoryRepo.slugsLike(base, null, trx));
    }
    const id = newId();
    await categoryRepo.insert({ id, slug, name: input.name, description: input.description ?? null, position: await categoryRepo.nextPosition(trx) }, trx);
    await audit({ actorId: actor.id, action: "category.create", entityType: "category", entityId: id, ip: meta.ip, data: { slug, name: input.name } }, trx);
  });
  return (await categoryRepo.list()).map(toCategory);
}

export async function updateCategory(actor: Actor, id: string, patch: { name?: string; slug?: string; description?: string | null }, meta: RequestMeta): Promise<Category> {
  writer(actor);
  if (patch.slug !== undefined && !isCourseSlug(patch.slug)) throw badRequest("A slug is 3 to 60 lower-case letters, digits and single hyphens", "INVALID_SLUG");
  await withTransaction(async (trx) => {
    await categoryRepo.lockTaxonomy(trx);
    const current = await categoryRepo.find(id, trx);
    if (!current) throw notFound("Category not found");
    if (patch.slug !== undefined && patch.slug !== current.slug && (await categoryRepo.slugsLike(patch.slug, id, trx)).includes(patch.slug)) throw conflict("That slug is already used", "SLUG_TAKEN");
    await categoryRepo.update(id, patch, trx);
    await audit({ actorId: actor.id, action: "category.update", entityType: "category", entityId: id, ip: meta.ip, data: { fields: Object.keys(patch) } }, trx);
  });
  return toCategory((await categoryRepo.find(id))!);
}

/** Removes the category from every course that had it; returns it as it was. */
export async function deleteCategory(actor: Actor, id: string, meta: RequestMeta): Promise<Category> {
  writer(actor);
  return withTransaction(async (trx) => {
    await categoryRepo.lockTaxonomy(trx);
    const current = await categoryRepo.find(id, trx);
    if (!current) throw notFound("Category not found");
    await categoryRepo.delete(id, trx);
    await audit({ actorId: actor.id, action: "category.delete", entityType: "category", entityId: id, ip: meta.ip, data: { slug: current.slug, courses: Number(current.course_count) } }, trx);
    return toCategory(current);
  });
}

export async function reorderCategories(actor: Actor, ids: string[], meta: RequestMeta): Promise<Category[]> {
  writer(actor);
  await withTransaction(async (trx) => {
    await categoryRepo.lockTaxonomy(trx);
    const current = (await categoryRepo.list(trx)).map((c) => c.id);
    if (!isPermutation(ids, current)) throw badRequest("Send every category id exactly once, in the new order", "REORDER_MISMATCH");
    await categoryRepo.setPositions(ids, trx);
    await audit({ actorId: actor.id, action: "category.reorder", entityType: "category", entityId: null, ip: meta.ip, data: { ids } }, trx);
  });
  return (await categoryRepo.list()).map(toCategory);
}
