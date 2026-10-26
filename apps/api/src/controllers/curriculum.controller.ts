/**
 * /api/admin/courses/:id/sections and /items: the curriculum editor. Item PATCH bodies
 * carry the common fields plus at most one kind block (`lecture`, `quiz` or
 * `assignment`); the service rejects a block that does not match the item's kind.
 */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, parse, text } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as curriculum from "../services/curriculum.service";

const courseParam = z.object({ id: id() });
const sectionParams = z.object({ id: id(), sectionId: id() });
const itemParams = z.object({ id: id(), itemId: id() });
const resourceParams = z.object({ id: id(), itemId: id(), resourceId: id() });

const index = z.number().int().min(0).max(10_000);

const sectionBody = z.object({ title: text(120, 1) }).strict();
const sectionMoveBody = z.object({ toIndex: index }).strict();

const createItemBody = z
  .object({
    sectionId: id(),
    kind: z.enum(["LECTURE", "QUIZ", "ASSIGNMENT"]),
    title: text(160, 1),
    lectureKind: z.enum(["VIDEO", "ARTICLE", "PDF"]).optional(),
  })
  .strict();

const tag = z.string().trim().min(1).max(40);

const itemPatchBody = z
  .object({
    title: text(160, 1),
    isPreview: z.boolean(),
    durationSeconds: z.number().int().min(0).max(360_000),
    lecture: z
      .object({
        lectureKind: z.enum(["VIDEO", "ARTICLE", "PDF"]),
        videoProvider: z.enum(["EVS", "HLS", "MP4", "YOUTUBE"]),
        videoRef: z.string().max(500).nullable(),
        body: z.string().max(100_000).nullable(),
        pdfUploadId: id().nullable(),
      })
      .partial()
      .strict(),
    quiz: z
      .object({
        instructions: z.string().max(5000).nullable(),
        selection: z.enum(["FIXED", "RANDOM"]),
        drawCount: z.number().int().min(1).max(200).nullable(),
        drawTags: z.array(tag).max(20),
        passPercent: z.number().int().min(0).max(100),
        timeLimitSeconds: z.number().int().min(30).max(86_400).nullable(),
        maxAttempts: z.number().int().min(1).max(100).nullable(),
        shuffleQuestions: z.boolean(),
        shuffleOptions: z.boolean(),
        reveal: z.enum(["AFTER_SUBMIT", "AFTER_PASS", "NEVER"]),
      })
      .partial()
      .strict(),
    assignment: z
      .object({
        instructions: z.string().max(20_000),
        rubric: z
          .array(
            z
              .object({
                id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
                title: text(120, 1),
                description: z.string().trim().max(1000).nullable().optional(),
                maxPoints: z.number().int().min(1).max(1000),
              })
              .strict(),
          )
          .max(20),
        passPoints: z.number().int().min(0).max(20_000).nullable(),
        dueDays: z.number().int().min(1).max(365).nullable(),
        allowLate: z.boolean(),
        acceptText: z.boolean(),
        acceptFiles: z.boolean(),
        acceptUrl: z.boolean(),
        maxFiles: z.number().int().min(0).max(20),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

const itemMoveBody = z.object({ sectionId: id(), toIndex: index }).strict();
const resourceBody = z.object({ title: text(120, 1), uploadId: id().optional(), url: z.string().trim().max(500).optional() }).strict();
const quizQuestionsBody = z.object({ questionIds: z.array(id()).max(200) }).strict();

export async function createSection(req: Request, res: Response) {
  const { id: courseId } = parse(courseParam, req.params);
  res.status(201).json(await curriculum.createSection(actorOf(req), courseId, parse(sectionBody, req.body).title, meta(req)));
}

export async function updateSection(req: Request, res: Response) {
  const p = parse(sectionParams, req.params);
  res.json(await curriculum.updateSection(actorOf(req), p.id, p.sectionId, parse(sectionBody, req.body).title, meta(req)));
}

export async function deleteSection(req: Request, res: Response) {
  const p = parse(sectionParams, req.params);
  await curriculum.deleteSection(actorOf(req), p.id, p.sectionId, meta(req));
  res.status(204).end();
}

export async function moveSection(req: Request, res: Response) {
  const p = parse(sectionParams, req.params);
  res.json(await curriculum.moveSection(actorOf(req), p.id, p.sectionId, parse(sectionMoveBody, req.body).toIndex, meta(req)));
}

export async function createItem(req: Request, res: Response) {
  const { id: courseId } = parse(courseParam, req.params);
  res.status(201).json(await curriculum.createItem(actorOf(req), courseId, parse(createItemBody, req.body), meta(req)));
}

export async function getItem(req: Request, res: Response) {
  const p = parse(itemParams, req.params);
  res.json(await curriculum.getItem(actorOf(req), p.id, p.itemId));
}

export async function updateItem(req: Request, res: Response) {
  const p = parse(itemParams, req.params);
  res.json(await curriculum.updateItem(actorOf(req), p.id, p.itemId, parse(itemPatchBody, req.body), meta(req)));
}

export async function deleteItem(req: Request, res: Response) {
  const p = parse(itemParams, req.params);
  await curriculum.deleteItem(actorOf(req), p.id, p.itemId, meta(req));
  res.status(204).end();
}

export async function moveItem(req: Request, res: Response) {
  const p = parse(itemParams, req.params);
  res.json(await curriculum.moveItem(actorOf(req), p.id, p.itemId, parse(itemMoveBody, req.body), meta(req)));
}

export async function addResource(req: Request, res: Response) {
  const p = parse(itemParams, req.params);
  res.status(201).json(await curriculum.addResource(actorOf(req), p.id, p.itemId, parse(resourceBody, req.body), meta(req)));
}

export async function deleteResource(req: Request, res: Response) {
  const p = parse(resourceParams, req.params);
  res.json(await curriculum.deleteResource(actorOf(req), p.id, p.itemId, p.resourceId, meta(req)));
}

export async function setQuizQuestions(req: Request, res: Response) {
  const p = parse(itemParams, req.params);
  res.json(await curriculum.setQuizQuestions(actorOf(req), p.id, p.itemId, parse(quizQuestionsBody, req.body).questionIds, meta(req)));
}
