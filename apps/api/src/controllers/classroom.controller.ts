/** /api/learn: the classroom, item content, playback, progress, bookmarks and notes. Thin: parse, call the service, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, pageQuery, parse, text } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as classroom from "../services/classroom.service";
import * as notes from "../services/note.service";
import * as playbackService from "../services/playback.service";

const slugParam = z.object({ courseSlug: z.string().min(1).max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a slug") }).strict();
const itemParam = z.object({ itemId: id() }).strict();
const noteParam = z.object({ noteId: id() }).strict();
const empty = z.object({}).strict();

const beat = z
  .object({
    positionSeconds: z.number().min(0).max(86_400),
    playedSeconds: z.number().min(0).max(3_600),
    durationSeconds: z.number().min(0).max(86_400).optional(),
  })
  .strict();

const atSeconds = z.number().int().min(0).max(86_400).nullable();

export async function show(req: Request, res: Response) {
  res.json(await classroom.classroom(actorOf(req), parse(slugParam, req.params).courseSlug));
}

export async function item(req: Request, res: Response) {
  res.json(await classroom.itemContent(req.actor ?? null, parse(itemParam, req.params).itemId));
}

export async function playback(req: Request, res: Response) {
  parse(empty, req.body);
  res.json(await playbackService.playback(req.actor ?? null, parse(itemParam, req.params).itemId));
}

export async function progress(req: Request, res: Response) {
  res.json(await classroom.beat(actorOf(req), parse(itemParam, req.params).itemId, parse(beat, req.body)));
}

export async function complete(req: Request, res: Response) {
  parse(empty, req.body);
  res.json(await classroom.complete(actorOf(req), parse(itemParam, req.params).itemId));
}

export async function bookmark(req: Request, res: Response) {
  await classroom.bookmark(actorOf(req), parse(itemParam, req.params).itemId);
  res.status(204).end();
}

export async function unbookmark(req: Request, res: Response) {
  await classroom.unbookmark(actorOf(req), parse(itemParam, req.params).itemId);
  res.status(204).end();
}

export async function listNotes(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ itemId: id().optional() }).strict(), req.query);
  res.json(await notes.list(actorOf(req), parse(slugParam, req.params).courseSlug, q));
}

export async function createNote(req: Request, res: Response) {
  const body = parse(z.object({ body: text(5000, 1), atSeconds: atSeconds.optional() }).strict(), req.body);
  res.status(201).json(await notes.create(actorOf(req), parse(itemParam, req.params).itemId, body));
}

export async function updateNote(req: Request, res: Response) {
  const body = parse(z.object({ body: text(5000, 1), atSeconds }).partial().strict(), req.body);
  res.json(await notes.update(actorOf(req), parse(noteParam, req.params).noteId, body));
}

export async function deleteNote(req: Request, res: Response) {
  await notes.remove(actorOf(req), parse(noteParam, req.params).noteId);
  res.status(204).end();
}
