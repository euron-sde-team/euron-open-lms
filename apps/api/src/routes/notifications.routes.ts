/** /api/notifications: your notification inbox. */
import { Router } from "express";
import * as ctrl from "../controllers/notification.controller";
import { authenticate } from "../middleware/auth";

export const router = Router();

/** Your notifications, newest first (`Page<Notification>`), `unread=true` filter. */
router.get("/", authenticate, ctrl.list);
/** The unread badge (`NotificationCounts`). */
router.get("/counts", authenticate, ctrl.counts);
/** Mark everything read. 204. */
router.post("/read-all", authenticate, ctrl.markAllRead);
/** Mark one notification read. 204. */
router.post("/:id/read", authenticate, ctrl.markRead);
