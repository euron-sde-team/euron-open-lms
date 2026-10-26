/**
 * The signed-in user's push devices (PUT / DELETE /api/my/devices). The app registers its
 * FCM token after every sign-in and on every token refresh; the same token registered by
 * another account moves to this one, since a device belongs to whoever is signed in on
 * it. Sign-out with `deviceToken`, sign-out everywhere and account erasure remove devices.
 */
import type { PushDevice, PushPlatform } from "@open-lms/types";
import type { Actor } from "../core/context";
import { newId } from "../core/ids";
import { pushDeviceRepo, type PushDeviceRow } from "../repositories/push-device.repository";

function present(r: PushDeviceRow): PushDevice {
  return {
    id: r.id,
    platform: r.platform as PushPlatform,
    appVersion: r.app_version,
    locale: r.locale,
    createdAt: r.created_at.toISOString(),
    lastSeenAt: r.last_seen_at.toISOString(),
  };
}

export async function registerDevice(actor: Actor, input: { platform: PushPlatform; token: string; appVersion?: string | null; locale?: string | null }): Promise<PushDevice> {
  const row = await pushDeviceRepo.upsert({ id: newId(), user_id: actor.id, platform: input.platform, token: input.token, app_version: input.appVersion ?? null, locale: input.locale ?? null });
  return present(row);
}

/** DELETE /api/my/devices/:token. Someone else's token is left alone (still 204: nothing to reveal). */
export async function removeDevice(actor: Actor, token: string): Promise<void> {
  await pushDeviceRepo.deleteOwn(actor.id, token);
}

/** Native sign-out: the refresh token named the account, the app names its device. */
export async function removeDeviceOf(userId: string, token: string): Promise<void> {
  await pushDeviceRepo.deleteOwn(userId, token);
}
