/** /api/certificates: anyone may verify a serial; only its owner downloads the PDF. */
import { Router } from "express";
import * as ctrl from "../controllers/certificate.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** Verify a certificate (`Certificate`): names, course, issue date and whether it was revoked. `pdfUrl` only for its owner. 404 for unknown serials. */
router.get("/:serial", optionalAuth, rateLimit("certificate-verify", 120, 60, "ip"), ctrl.verify);
/** Download your certificate: 302 to a short-lived signed URL. 409 CERTIFICATE_RENDERING until the PDF exists, 409 CERTIFICATE_REVOKED, 404 if it is not yours. */
router.get("/:serial/pdf", authenticate, ctrl.pdf);
