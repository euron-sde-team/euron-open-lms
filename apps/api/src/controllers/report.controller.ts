/** /api/community/reports. Thin: parse, call services/report.service.ts, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, optionalText, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as reports from "../services/report.service";

const reportBody = z
  .object({
    targetType: z.enum(["REVIEW", "QA_THREAD", "QA_REPLY"]),
    targetId: id(),
    reason: z.enum(["SPAM", "HARASSMENT", "OFF_TOPIC", "SPOILER", "INAPPROPRIATE", "OTHER"]),
    note: optionalText(500),
  })
  .strict();

export async function create(req: Request, res: Response) {
  res.status(201).json(await reports.createReport(actorOf(req), parse(reportBody, req.body)));
}
