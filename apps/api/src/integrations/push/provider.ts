/** What every push provider implements. One message goes to one device token. */
import type { PushPlatform } from "@open-lms/types";

export interface PushMessage {
  token: string;
  platform: PushPlatform;
  title: string;
  body: string;
  /** String values only (FCM's data map); the app reads `type` and `url`. */
  data: Record<string, string>;
}

/** `dead`: the token will never work again (uninstalled, rotated); its device row is removed. */
export type PushResult = { ok: true; id: string | null } | { ok: false; dead: boolean; error: string };

export interface PushProvider {
  readonly name: "fcm" | "stub";
  send(message: PushMessage): Promise<PushResult>;
}
