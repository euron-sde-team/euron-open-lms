/** /api/admin/catalog/categories: the category taxonomy. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, parse, text } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as categories from "../services/category.service";

const fields = {
  name: text(60, 1),
  slug: z.string().trim().toLowerCase().min(3).max(60),
  description: z.string().trim().max(300).nullable().transform((v) => (v ? v : null)),
};
const createBody = z.object(fields).partial({ slug: true, description: true }).strict();
const patchBody = z.object(fields).partial().strict();
const reorderBody = z.object({ ids: z.array(id()).max(200) }).strict();

export async function list(req: Request, res: Response) {
  res.json(await categories.listCategories(actorOf(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await categories.createCategory(actorOf(req), parse(createBody, req.body), meta(req)));
}

export async function update(req: Request, res: Response) {
  res.json(await categories.updateCategory(actorOf(req), parse(idParam, req.params).id, parse(patchBody, req.body), meta(req)));
}

export async function remove(req: Request, res: Response) {
  res.json(await categories.deleteCategory(actorOf(req), parse(idParam, req.params).id, meta(req)));
}

export async function reorder(req: Request, res: Response) {
  res.json(await categories.reorderCategories(actorOf(req), parse(reorderBody, req.body).ids, meta(req)));
}
