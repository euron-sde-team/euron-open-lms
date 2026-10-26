/** /api/admin/catalog: the category taxonomy. Area "courses" reads; only ADMIN writes. */
import { Router } from "express";
import * as ctrl from "../controllers/category.controller";
import { authenticate } from "../middleware/auth";

export const router = Router();

router.use(authenticate);

/** Every category in display order, with course counts. Returns `Category[]`. */
router.get("/categories", ctrl.list);
/** Add a category `{ name, slug?, description? }` (ADMIN). Returns `Category[]`. 409 SLUG_TAKEN. */
router.post("/categories", ctrl.create);
/** Put categories in a new order `{ ids }` (every id, once; ADMIN). Returns `Category[]`. 400 REORDER_MISMATCH. */
router.post("/categories/reorder", ctrl.reorder);
/** Edit a category `{ name?, slug?, description? }` (ADMIN). Returns `Category`. 409 SLUG_TAKEN. */
router.patch("/categories/:id", ctrl.update);
/** Delete a category; courses keep everything else (ADMIN). Returns the deleted `Category`. */
router.delete("/categories/:id", ctrl.remove);
