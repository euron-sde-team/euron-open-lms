/**
 * /api/admin/courses: course settings, status moves, prices, staff, learners and AI help.
 * Thin: parse with strict schemas (unknown keys are a 400), call the service, respond.
 * The curriculum and the question bank have their own controllers.
 */
import { COURSE_LEVELS } from "@open-lms/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, pageQuery, parse, text } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as courses from "../services/admin-course.service";
import * as ai from "../services/authoring-ai.service";

const slug = z.string().trim().toLowerCase().min(3).max(60);
const listItem = text(200, 1);

const listQuery = pageQuery
  .extend({ q: z.string().trim().max(100).optional(), status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional() })
  .strict();

const createBody = z.object({ title: text(120, 3), slug: slug.optional() }).strict();

const patchBody = z
  .object({
    title: text(120, 3),
    subtitle: z.string().trim().max(200).nullable().transform((v) => (v ? v : null)),
    description: z.string().max(20000),
    outcomes: z.array(listItem).max(20),
    prerequisites: z.array(listItem).max(20),
    level: z.enum(COURSE_LEVELS),
    language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "must be a language code like en or pt-BR"),
    coverUploadId: id().nullable(),
    categoryIds: z.array(id()).max(10),
    slug,
    accessMode: z.enum(["FREE", "PAID", "SUBSCRIPTION_ONLY"]),
    includedInSubscription: z.boolean(),
    certificateEnabled: z.boolean(),
    allowDownloads: z.boolean(),
    featured: z.boolean(),
  })
  .partial()
  .strict();

const pricesBody = z
  .object({
    prices: z
      .array(
        z
          .object({
            currency: z.string().regex(/^[A-Z]{3}$/, "must be an ISO 4217 code"),
            amountMinor: z.number().int().min(0).max(10_000_000_000),
            compareAtMinor: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

const staffBody = z
  .object({
    staff: z.array(z.object({ userId: id(), role: z.enum(["OWNER", "EDITOR", "GRADER"]), listed: z.boolean() }).strict()).min(1).max(20),
  })
  .strict();

const KINDS = ["SINGLE", "MULTI", "TRUE_FALSE", "SHORT_TEXT"] as const;
const aiQuestionsBody = z
  .object({
    itemId: id().optional(),
    sourceText: z.string().max(30_000).optional(),
    count: z.number().int().min(1).max(20),
    kinds: z.array(z.enum(KINDS)).min(1).max(4),
  })
  .strict();

const polishBody = z.object({ field: z.enum(["description", "subtitle", "outcome"]), text: z.string().trim().min(1).max(20_000) }).strict();

export async function list(req: Request, res: Response) {
  res.json(await courses.listCourses(actorOf(req), parse(listQuery, req.query)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await courses.createCourse(actorOf(req), parse(createBody, req.body), meta(req)));
}

export async function get(req: Request, res: Response) {
  res.json(await courses.getCourse(actorOf(req), parse(idParam, req.params).id));
}

export async function update(req: Request, res: Response) {
  res.json(await courses.updateCourse(actorOf(req), parse(idParam, req.params).id, parse(patchBody, req.body), meta(req)));
}

export async function remove(req: Request, res: Response) {
  await courses.deleteCourse(actorOf(req), parse(idParam, req.params).id, meta(req));
  res.status(204).end();
}

export async function publish(req: Request, res: Response) {
  res.json(await courses.publishCourse(actorOf(req), parse(idParam, req.params).id, meta(req)));
}

export async function unpublish(req: Request, res: Response) {
  res.json(await courses.unpublishCourse(actorOf(req), parse(idParam, req.params).id, meta(req)));
}

export async function archive(req: Request, res: Response) {
  res.json(await courses.archiveCourse(actorOf(req), parse(idParam, req.params).id, meta(req)));
}

export async function setPrices(req: Request, res: Response) {
  const { prices } = parse(pricesBody, req.body);
  res.json(await courses.setPrices(actorOf(req), parse(idParam, req.params).id, prices, meta(req)));
}

export async function setStaff(req: Request, res: Response) {
  const { staff } = parse(staffBody, req.body);
  res.json(await courses.setStaff(actorOf(req), parse(idParam, req.params).id, staff, meta(req)));
}

export async function learners(req: Request, res: Response) {
  res.json(await courses.courseLearners(actorOf(req), parse(idParam, req.params).id, parse(pageQuery.strict(), req.query)));
}

export async function aiQuestions(req: Request, res: Response) {
  res.json(await ai.draftQuizQuestions(actorOf(req), parse(idParam, req.params).id, parse(aiQuestionsBody, req.body)));
}

export async function aiPolish(req: Request, res: Response) {
  res.json(await ai.polishText(actorOf(req), parse(idParam, req.params).id, parse(polishBody, req.body)));
}
