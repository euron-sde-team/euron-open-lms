/** /api/my/devices and /api/my/downloads plus /api/learn/items/:itemId/downloads: the mobile app's devices. Thin: parse, call the service, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as offline from "../services/offline.service";
import * as devices from "../services/push-device.service";

const pushToken = z.string().trim().min(1).max(4096);
/** An installation id the app generates once (a UUID or similar); never a hardware identifier. */
const deviceId = z.string().trim().regex(/^[A-Za-z0-9_-]{8,128}$/, "must be 8 to 128 letters, digits, - or _");

export async function registerDevice(req: Request, res: Response) {
  const body = parse(
    z
      .object({
        platform: z.enum(["IOS", "ANDROID"]),
        token: pushToken,
        appVersion: z.string().trim().max(40).optional(),
        locale: z.string().trim().regex(/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/, "must be a locale like en or pt-BR").max(35).optional(),
      })
      .strict(),
    req.body,
  );
  res.json(await devices.registerDevice(actorOf(req), body));
}

export async function removeDevice(req: Request, res: Response) {
  const { token } = parse(z.object({ token: pushToken }).strict(), req.params);
  await devices.removeDevice(actorOf(req), token);
  res.status(204).end();
}

export async function startDownload(req: Request, res: Response) {
  const { itemId } = parse(z.object({ itemId: id() }).strict(), req.params);
  const body = parse(z.object({ deviceId }).strict(), req.body);
  res.status(201).json(await offline.startDownload(actorOf(req), itemId, body.deviceId));
}

export async function validateDownloads(req: Request, res: Response) {
  const body = parse(z.object({ deviceId, itemIds: z.array(id()).max(500) }).strict(), req.body);
  res.json(await offline.validateDownloads(actorOf(req), body.deviceId, body.itemIds));
}

export async function removeDownload(req: Request, res: Response) {
  const { itemId } = parse(z.object({ itemId: id() }).strict(), req.params);
  const q = parse(z.object({ deviceId }).strict(), req.query);
  await offline.removeDownload(actorOf(req), itemId, q.deviceId);
  res.status(204).end();
}
