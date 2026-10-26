/** /api/catalog: the public catalog (published courses only), course pages, bundles, instructors, free enrollment and the wishlist. */
import { Router } from "express";
import * as ctrl from "../controllers/catalog.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/**
 * Search and browse: `?q=&category=&level=&language=&price=free|paid|subscription&sort=relevance|popular|newest|rating|
 * price_asc|price_desc&currency=&cursor=&limit=`. Returns `Page<CourseCard>` (prices in the display currency; `viewer`
 * when signed in). 400 INVALID_CURSOR.
 */
router.get("/courses", optionalAuth, ctrl.listCourses);
/** Counts per category, level, language and price for the same filters (`CatalogFacets`); each facet ignores its own filter. */
router.get("/facets", ctrl.facets);
/** Home page shelves: `{ featured, popular, newest, free }`, each a short `CourseCard[]`. `?currency=`. */
router.get("/featured", optionalAuth, ctrl.featured);
/** Every category with its number of published courses (`Category[]`). */
router.get("/categories", ctrl.categories);
/** Active bundles (`Page<BundleCard>`), with `separately` = the included courses bought one by one. `?currency=&cursor=`. */
router.get("/bundles", optionalAuth, ctrl.listBundles);
/** One active bundle (`BundleDetail`): its courses as cards and whether you already own them all. 404 otherwise. */
router.get("/bundles/:slug", optionalAuth, ctrl.bundleDetail);
/** An instructor listed on a published course: `{ instructor: Instructor, courses: CourseCard[] }`. 404 otherwise. */
router.get("/instructors/:username", optionalAuth, ctrl.instructor);
/**
 * The course page (`CourseDetail`): description, public curriculum (no content), instructors, ratings, bundles and what you
 * can do (`access`). DRAFT and ARCHIVED courses are 404 except to their staff and admins (access STAFF). `?currency=`.
 */
router.get("/courses/:slug", optionalAuth, ctrl.courseDetail);
/** Published reviews of a published course, newest first (`Page<Review>`), `?rating=1..5`. */
router.get("/courses/:slug/reviews", optionalAuth, ctrl.reviews);
/**
 * Enroll in a FREE course with one click: body `{}`, returns `{ enrollmentId, resumeItemId }` (the same enrollment when
 * called again). 403 NOT_FREE for paid and plan-only courses, 403 ACCOUNT_RESTRICTED, 404 for unpublished ones.
 */
router.post("/courses/:slug/enroll", authenticate, rateLimit("catalog-enroll", 60, 3600), ctrl.enroll);
/** Add a published course to your wishlist. 204 (idempotent). */
router.put("/courses/:slug/save", authenticate, rateLimit("catalog-save", 300, 3600), ctrl.save);
/** Remove a course from your wishlist. 204. */
router.delete("/courses/:slug/save", authenticate, ctrl.unsave);
