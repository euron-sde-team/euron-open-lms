/** Notification rows to DTOs. */
import type { Notification } from "@open-lms/types";
import type { Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Notifications } from "../db/types";
import { hrefFor } from "../services/notification.service";
import { loadSummaries } from "./user.presenter";

export type NotificationRow = Selectable<Notifications>;

export async function presentNotifications(rows: readonly NotificationRow[], exec: Executor = db): Promise<Notification[]> {
  if (!rows.length) return [];
  const actors = await loadSummaries(rows.map((r) => r.actor_id), exec);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    actor: r.actor_id ? (actors.get(r.actor_id) ?? null) : null,
    entityType: r.entity_type,
    entityId: r.entity_id,
    snippet: r.snippet,
    href: hrefFor(r),
    readAt: r.read_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  }));
}
