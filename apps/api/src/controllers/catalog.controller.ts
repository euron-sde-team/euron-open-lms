/** /api/catalog: the public catalog, course pages, bundles, instructors, free enrollment and the wishlist. Thin: parse, call the service, respond. */
import { CATALOG_MIN_RATINGS, COURSE_LENGTHS, COURSE_LEVELS, type CatalogMinRating } from "@open-lms/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { pageQuery, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as catalog from "../services/catalog.service";

const slug = z.string().min(1).max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a slug");
const slugParam = z.object({ slug }).strict();
const currency = z.string().regex(/^[A-Za-z]{3}$/).transform((v) => v.toUpperCase());

const filters = z.object({
  q: z.string().trim().max(100).optional(),
  category: slug.optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/).optional(),
  price: z.enum(["free", "paid", "subscription"]).optional(),
  minRating: z.coerce
    .number()
    .refine((v): v is CatalogMinRating => (CATALOG_MIN_RATINGS as readonly number[]).includes(v), `must be one of ${CATALOG_MIN_RATINGS.join(", ")}`)
    .optional(),
  length: z.enum(COURSE_LENGTHS).optional(),
});

const listQuery = filters
  .extend({ sort: z.enum(["relevance", "popular", "newest", "rating", "price_asc", "price_desc"]).optional(), currency: currency.optional() })
  .merge(pageQuery)
  .strict();

export async function listCourses(req: Request, res: Response) {
  res.json(await catalog.listCourses(req.actor ?? null, parse(listQuery, req.query)));
}

export async function facets(req: Request, res: Response) {
  res.json(await catalog.facets(parse(filters.strict(), req.query)));
}

export async function featured(req: Request, res: Response) {
  const q = parse(z.object({ currency: currency.optional() }).strict(), req.query);
  res.json(await catalog.featured(req.actor ?? null, q.currency));
}

export async function categories(_req: Request, res: Response) {
  res.json(await catalog.categories());
}

export async function courseDetail(req: Request, res: Response) {
  const q = parse(z.object({ currency: currency.optional() }).strict(), req.query);
  res.json(await catalog.courseDetail(req.actor ?? null, parse(slugParam, req.params).slug, q.currency));
}

export async function reviews(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ rating: z.coerce.number().int().min(1).max(5).optional() }).strict(), req.query);
  res.json(await catalog.reviews(req.actor ?? null, parse(slugParam, req.params).slug, q));
}

export async function listBundles(req: Request, res: Response) {
  res.json(await catalog.listBundles(req.actor ?? null, parse(pageQuery.extend({ currency: currency.optional() }).strict(), req.query)));
}

export async function bundleDetail(req: Request, res: Response) {
  const q = parse(z.object({ currency: currency.optional() }).strict(), req.query);
  res.json(await catalog.bundleDetail(req.actor ?? null, parse(slugParam, req.params).slug, q.currency));
}

export async function instructor(req: Request, res: Response) {
  const p = parse(z.object({ username: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{1,38}[a-zA-Z0-9]$/) }).strict(), req.params);
  res.json(await catalog.instructor(req.actor ?? null, p.username));
}

export async function enroll(req: Request, res: Response) {
  parse(z.object({}).strict(), req.body);
  res.status(201).json(await catalog.enrollFree(actorOf(req), parse(slugParam, req.params).slug));
}

export async function save(req: Request, res: Response) {
  await catalog.save(actorOf(req), parse(slugParam, req.params).slug);
  res.status(204).end();
}

export async function unsave(req: Request, res: Response) {
  await catalog.unsave(actorOf(req), parse(slugParam, req.params).slug);
  res.status(204).end();
}
