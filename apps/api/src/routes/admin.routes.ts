/**
 * /api/admin operations: the operator session, the overview, learners and enrollments,
 * certificates, staff roles, settings, integrations and the audit trail. Every route is
 * signed in; each service opens with requireArea(actor, area) (domain/admin-permissions.ts),
 * which is a 403 FORBIDDEN_AREA for roles without the area and for learners.
 */
import { Router } from "express";
import * as ctrl from "../controllers/admin.controller";
import * as learners from "../controllers/admin-learners.controller";
import * as staff from "../controllers/staff.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** The operator session (`AdminSession`): role, the areas it may open, and whether it sees every course. Any operator; learners get 403 FORBIDDEN_AREA. */
router.get("/me", authenticate, ctrl.me);
/**
 * The overview (`AdminStats`) for `?from=&to=` (local dates YYYY-MM-DD in the analytics time zone; default the last 30
 * days, at most 366). Revenue and MRR per currency, never summed across currencies. Instructors see their own courses
 * only (MRR empty). 400 RANGE_INVALID, RANGE_TOO_LONG. Area overview.
 */
router.get("/stats", authenticate, ctrl.stats);
/** The overview's daily series as a CSV download (`date,signups,enrollments,completions,orders`), streamed. Area overview. */
router.get("/stats.csv", authenticate, ctrl.statsCsv);

/** Find accounts (`Page<AdminUserRow>`) by `q` (name, username or email) and `status`, newest first. Area learners. */
router.get("/learners", authenticate, learners.list);
/** One learner (`AdminLearnerDetail`): enrollments with whether each grants access now, subscription, recent orders, certificates. Area learners. */
router.get("/learners/:id", authenticate, learners.detail);
/**
 * Grant access to a course: `{ courseId, validUntil?, note? }` (validUntil in the future, or null for life). Never shortens
 * existing access; the learner is notified. 201 `AdminEnrollment`. 404 COURSE_NOT_FOUND, 400 VALID_UNTIL_PAST. Area learners.
 */
router.post("/learners/:id/enrollments", authenticate, learners.grant);
/** Suspend `{ days, reason }` (1 to 365 days; read-only until it ends). `AdminUserRow`. 403 SELF_ACTION, TARGET_PROTECTED; 409 INVALID_STATUS. Area learners. */
router.post("/learners/:id/suspend", authenticate, learners.suspend);
/** End a suspension now. `AdminUserRow`. 409 INVALID_STATUS. Area learners. */
router.post("/learners/:id/unsuspend", authenticate, learners.unsuspend);
/** Ban `{ reason }`: signed out everywhere at once. `AdminUserRow`. 403 SELF_ACTION, TARGET_PROTECTED; 409 INVALID_STATUS. Area learners. */
router.post("/learners/:id/ban", authenticate, learners.ban);
/** Lift a ban. `AdminUserRow`. 409 INVALID_STATUS. Area learners. */
router.post("/learners/:id/unban", authenticate, learners.unban);
/**
 * Erase an account now `{ reason }` (ADMIN only): identity anonymised, learning traces deleted, financial records kept.
 * 204. 409 SUBSCRIPTION_ACTIVE, ALREADY_ERASED; 403 SELF_ACTION, TARGET_PROTECTED.
 */
router.post("/learners/:id/erase", authenticate, rateLimit("admin-erase", 20, 3600), learners.erase);
/** Revoke an enrollment `{ reason }`: access ends, progress is kept, the learner is notified. `AdminEnrollment`. 409 ENROLLMENT_NOT_ACTIVE. Area learners. */
router.post("/enrollments/:id/revoke", authenticate, learners.revoke);
/** Move an enrollment's end date `{ validUntil }` (future, or null for life). `AdminEnrollment`. 409 ENROLLMENT_NOT_ACTIVE, ENROLLMENT_SUBSCRIPTION. Area learners. */
router.patch("/enrollments/:id", authenticate, learners.patchEnrollment);

/** Issued certificates (`Page<AdminCertificateRow>`), newest first; `q` is a serial or the learner's name, username or email. Area certificates. */
router.get("/certificates", authenticate, ctrl.listCertificates);
/** Revoke `{ reason }`: the public verify page shows it revoked. `AdminCertificateRow`. 409 CERTIFICATE_REVOKED. Area certificates. */
router.post("/certificates/:id/revoke", authenticate, ctrl.revokeCertificate);
/** Restore a revoked certificate. `AdminCertificateRow`. 409 CERTIFICATE_NOT_REVOKED. Area certificates. */
router.post("/certificates/:id/restore", authenticate, ctrl.restoreCertificate);

/** Staff accounts (`Page<StaffRow>`) with their course counts; `?role=&q=`. ADMIN only (area staff). */
router.get("/staff", authenticate, staff.list);
/**
 * Change a platform role `{ role }` (also how a learner becomes an INSTRUCTOR). `StaffRow`. 403 CANNOT_CHANGE_OWN_ROLE;
 * 409 LAST_ADMIN, USER_INACTIVE. A demoted instructor keeps their course staff rows but loses /admin. ADMIN only.
 */
router.patch("/staff/:userId", authenticate, staff.changeRole);

/** The academy settings (`LmsSettings`). ADMIN only (area settings). */
router.get("/settings", authenticate, ctrl.getSettings);
/**
 * Change settings: any subset of the `LmsSettings` groups, each strict (lists and the routing map are replaced as a
 * whole). Audited with the before and after of the changed keys. `LmsSettings`. 400 VALIDATION_FAILED, SETTINGS_INVALID,
 * MEDIA_INVALID. ADMIN only.
 */
router.patch("/settings", authenticate, ctrl.patchSettings);
/** What this deployment has configured (`IntegrationStatus`): gateway modes, EVS, AI, mail, storage. Never a key. ADMIN only. */
router.get("/integrations", authenticate, ctrl.integrations);
/** Check the EVS connection with the read key: `{ ok, message }`. ADMIN only. */
router.post("/integrations/evs/test", authenticate, rateLimit("admin-evs-test", 10, 60), ctrl.testEvs);

/** The audit trail (`Page<AuditEntry>`), newest first; `?action=` (a prefix) `&actorId=&entityType=&entityId=`. ADMIN only (area audit). */
router.get("/audit", authenticate, ctrl.audit);
