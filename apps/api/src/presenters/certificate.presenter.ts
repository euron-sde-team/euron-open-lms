/**
 * Certificate DTOs. Public fields only (names frozen at issue, course, dates, status);
 * the signed PDF URL is added for the owner alone, and never for a revoked certificate.
 */
import type { Certificate } from "@open-lms/types";
import { config } from "../core/config";
import { storage } from "../integrations/storage";

export interface CertificateRow {
  id: string;
  serial: string;
  user_id: string;
  learner_name: string;
  course_title: string;
  course_slug: string;
  instructor_names: string[];
  pdf_key: string | null;
  issued_at: Date;
  revoked_at: Date | null;
}

export function verifyUrl(serial: string): string {
  return `${config.APP_WEB_URL.replace(/\/+$/, "")}/verify/${encodeURIComponent(serial)}`;
}

export function pdfFileName(row: Pick<CertificateRow, "serial">): string {
  return `certificate-${row.serial}.pdf`;
}

export async function toCertificate(row: CertificateRow, viewerId: string | null, academyName: string): Promise<Certificate> {
  const owner = !!viewerId && viewerId === row.user_id;
  return {
    serial: row.serial,
    learnerName: row.learner_name,
    courseTitle: row.course_title,
    courseSlug: String(row.course_slug),
    instructorNames: row.instructor_names ?? [],
    issuedAt: row.issued_at.toISOString(),
    revoked: !!row.revoked_at,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    pdfUrl: owner && row.pdf_key && !row.revoked_at ? await storage().signedGetUrl(row.pdf_key, { downloadName: pdfFileName(row) }) : null,
    verifyUrl: verifyUrl(row.serial),
    academyName,
  };
}
