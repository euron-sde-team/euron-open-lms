/** /api/meta: public facts about the academy for page titles, checkout and the sign-up form. */
import { Router } from "express";
import * as ctrl from "../controllers/meta.controller";

export const router = Router();

/** `AcademyMeta`: name, tagline, logo, registration mode, currencies, gateway routing and public keys, AI and plan availability. Public; cached 30 seconds. */
router.get("/", ctrl.meta);

/** Public paths for the sitemap: `?type=courses|bundles|instructors&cursor=`, 1000 per page, newest change first. */
router.get("/sitemap", ctrl.sitemap);
