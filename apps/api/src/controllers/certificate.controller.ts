/** /api/certificates: public verification and the owner's PDF download. Thin: parse, call the service, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as certificates from "../services/certificate.service";

const serialParam = z.object({ serial: z.string().min(4).max(40) }).strict();

export async function verify(req: Request, res: Response) {
  res.json(await certificates.verify(req.actor ?? null, parse(serialParam, req.params).serial.toUpperCase()));
}

export async function pdf(req: Request, res: Response) {
  const url = await certificates.pdfUrl(actorOf(req), parse(serialParam, req.params).serial.toUpperCase());
  res.setHeader("Cache-Control", "private, no-store");
  res.redirect(302, url);
}
