/**
 * /api/admin/courses: the course editor (authoring). Area "courses". ADMIN sees every
 * course, SUPPORT reads every course, an INSTRUCTOR only the courses they are staff on
 * (anything else is 404). OWNER (or ADMIN) manages settings, prices, staff and status;
 * EDITOR edits content; GRADER reads. A viewer without the right gets 403 COURSE_ROLE_REQUIRED.
 */
import { Router } from "express";
import * as ctrl from "../controllers/admin-course.controller";
import * as curriculum from "../controllers/curriculum.controller";
import * as questions from "../controllers/question.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

router.use(authenticate);

/** Courses you may see: `?q=&status=DRAFT|PUBLISHED|ARCHIVED&cursor=&limit=`. Returns `Page<AdminCourseRow>`. */
router.get("/", ctrl.list);
/** Create a draft `{ title, slug? }` (INSTRUCTOR or ADMIN; you become OWNER). Returns `AdminCourse`. 409 SLUG_TAKEN, 403 COURSE_CREATE_FORBIDDEN. */
router.post("/", rateLimit("course-create", 30, 3600), ctrl.create);
/** One course for the editor, with the curriculum and the publish checklist. Returns `AdminCourse`. */
router.get("/:id", ctrl.get);
/**
 * Edit `{ title?, subtitle?, description?, outcomes?, prerequisites?, level?, language?, coverUploadId?, categoryIds?, slug?,
 * accessMode?, includedInSubscription?, certificateEnabled?, featured? }`. Settings fields (slug, access, certificate) need OWNER;
 * featured needs ADMIN. Never changes status. Returns `AdminCourse`. 409 SLUG_TAKEN, 400 CATEGORY_NOT_FOUND, MEDIA_INVALID.
 */
router.patch("/:id", ctrl.update);
/** Delete an unused draft (OWNER). 204; 409 COURSE_IN_USE when it has learners, orders or is not a draft (archive it instead). */
router.delete("/:id", ctrl.remove);
/** Publish (OWNER). Returns `AdminCourse`; 422 PUBLISH_BLOCKED with `details.checklist`, 409 INVALID_STATUS. */
router.post("/:id/publish", ctrl.publish);
/** Back to draft (OWNER). Returns `AdminCourse`; 409 INVALID_STATUS. */
router.post("/:id/unpublish", ctrl.unpublish);
/** Archive (OWNER). Returns `AdminCourse`; 409 INVALID_STATUS. */
router.post("/:id/archive", ctrl.archive);
/**
 * Replace the one-time prices `{ prices: { currency, amountMinor, compareAtMinor? }[] }` (OWNER). Returns `AdminPrice[]`.
 * 400 CURRENCY_NOT_ENABLED, PRICE_ZERO, DUPLICATE_CURRENCY, COMPARE_AT_TOO_LOW.
 */
router.put("/:id/prices", ctrl.setPrices);
/** Replace the staff `{ staff: { userId, role, listed }[] }` (OWNER). Returns `AdminCourse`. 400 OWNER_REQUIRED, USER_NOT_FOUND, USER_INACTIVE, NOT_STAFF_ROLE. */
router.put("/:id/staff", ctrl.setStaff);
/** Enrolled learners with progress `?cursor=`. Returns `Page<{ user, progressPercent, completedAt, source, createdAt }>`. */
router.get("/:id/learners", ctrl.learners);

/** Add a section `{ title }` at the end (OWNER, EDITOR). Returns `AdminSection`. */
router.post("/:id/sections", curriculum.createSection);
/** Rename a section `{ title }`. Returns `AdminSection`. 404 SECTION_NOT_FOUND. */
router.patch("/:id/sections/:sectionId", curriculum.updateSection);
/** Delete a section and its items. 204. */
router.delete("/:id/sections/:sectionId", curriculum.deleteSection);
/** Move a section `{ toIndex }`. Returns every `AdminSection`, renumbered. */
router.post("/:id/sections/:sectionId/move", curriculum.moveSection);

/** Add an item `{ sectionId, kind: LECTURE|QUIZ|ASSIGNMENT, title, lectureKind? }` at the end of its section. Returns `AdminItem`. 400 LECTURE_KIND_REQUIRED. */
router.post("/:id/items", curriculum.createItem);
/** One item with its kind's settings (video ref, quiz settings, rubric). Returns `AdminItem`. */
router.get("/:id/items/:itemId", curriculum.getItem);
/**
 * Edit `{ title?, isPreview?, durationSeconds?, lecture? | quiz? | assignment? }` (the block must match the kind).
 * Returns `AdminItem`. 400 KIND_MISMATCH, INVALID_VIDEO_REF, INVALID_RUBRIC, DRAW_COUNT_REQUIRED, PREVIEW_LECTURES_ONLY.
 */
router.patch("/:id/items/:itemId", curriculum.updateItem);
/** Delete an item (its learner progress and submissions go with it). 204. */
router.delete("/:id/items/:itemId", curriculum.deleteItem);
/** Move an item `{ sectionId, toIndex }` within or across sections of this course. Returns every `AdminSection`. 404 SECTION_NOT_FOUND. */
router.post("/:id/items/:itemId/move", curriculum.moveItem);
/** Attach a resource to a lecture `{ title, uploadId? | url? }` (an upload of purpose LECTURE_RESOURCE, or an https link). Returns `AdminItem`. */
router.post("/:id/items/:itemId/resources", curriculum.addResource);
/** Remove a resource. Returns `AdminItem`. 404 RESOURCE_NOT_FOUND. */
router.delete("/:id/items/:itemId/resources/:resourceId", curriculum.deleteResource);
/** Set a FIXED quiz's questions `{ questionIds }` in order. Returns `AdminItem`. 400 QUESTION_NOT_IN_COURSE, NOT_FIXED_QUIZ. */
router.put("/:id/items/:itemId/questions", curriculum.setQuizQuestions);

/** The question bank `?q=&tag=&cursor=`. Returns `Page<AdminQuestion>`. */
router.get("/:id/questions", questions.list);
/** Add a question `{ kind, prompt, explanation?, points?, options?, acceptedAnswers?, matchMode?, tags? }`. Returns `AdminQuestion`. 400 QUESTION_INVALID. */
router.post("/:id/questions", questions.create);
/** Edit a question (validated as a whole). Returns `AdminQuestion`. 400 QUESTION_INVALID. */
router.patch("/:id/questions/:questionId", questions.update);
/** Delete a question: 204, or 200 with the archived `AdminQuestion` when a quiz still uses it. */
router.delete("/:id/questions/:questionId", questions.remove);

/**
 * Draft quiz questions with AI `{ itemId?, sourceText?, count, kinds }` from the given text or the item's article/notes.
 * Returns `{ drafts }` (never saved). 503 AI_UNAVAILABLE, 400 NO_SOURCE_TEXT, 429 when over the hourly budget.
 */
router.post("/:id/ai/questions", rateLimit("authoring-ai", 30, 3600, "user"), ctrl.aiQuestions);
/** Polish a description, subtitle or outcome `{ field, text }`. Returns `{ text }` (never saved). 503 AI_UNAVAILABLE. */
router.post("/:id/ai/polish", rateLimit("authoring-ai", 30, 3600, "user"), ctrl.aiPolish);
