/**
 * Certificates: the public verify page, the owner's PDF download and the PDF render.
 *
 * Issuing is not here: services/progress.service.ts issues a certificate in the same
 * transaction that completes the course and queues `certificates.render`. The render
 * job (jobs/learning.jobs.ts) draws a landscape A4 page with pdfkit's built-in
 * Helvetica fonts, stores it privately at certificates/<yyyy>/<serial>.pdf and sets
 * pdf_key. It is idempotent: a certificate that already has a PDF is left alone, and
 * the conditional UPDATE means two concurrent runs keep one key.
 *
 * Anyone may verify a serial (that is the point of a certificate). Only the owner gets
 * the download URL, and a revoked certificate says so instead.
 */
import type { Certificate } from "@open-lms/types";
import PDFDocument from "pdfkit";
import type { Actor } from "../core/context";
import { conflict, notFound } from "../core/errors";
import { storage } from "../integrations/storage";
import { pdfFileName, toCertificate, verifyUrl, type CertificateRow } from "../presenters/certificate.presenter";
import { certificateRepo } from "../repositories/certificate.repository";
import { academyName, getSettings } from "./settings.service";

const SERIAL = /^[A-Z0-9]{2,10}(-[A-Z0-9]{1,10}){1,5}$/;

async function findBySerial(serial: string) {
  if (!SERIAL.test(serial)) return undefined;
  return certificateRepo.bySerial(serial);
}

export async function verify(viewer: Actor | null, serial: string): Promise<Certificate> {
  const row = await findBySerial(serial);
  if (!row) throw notFound("Certificate not found");
  return toCertificate(row, viewer?.id ?? null, await academyName());
}

/** The owner's signed download URL. 409 CERTIFICATE_RENDERING until the job has run. */
export async function pdfUrl(actor: Actor, serial: string): Promise<string> {
  const row = await findBySerial(serial);
  if (!row || row.user_id !== actor.id) throw notFound("Certificate not found");
  if (row.revoked_at) throw conflict("This certificate has been revoked", "CERTIFICATE_REVOKED");
  if (!row.pdf_key) throw conflict("The certificate PDF is still being prepared", "CERTIFICATE_RENDERING");
  return storage().signedGetUrl(row.pdf_key, { downloadName: pdfFileName(row) });
}

export async function mine(actor: Actor): Promise<Certificate[]> {
  const [rows, name] = await Promise.all([certificateRepo.ownedBy(actor.id), academyName()]);
  return Promise.all(rows.map((r) => toCertificate(r, actor.id, name)));
}

/** The private object key of a certificate's PDF. */
export function pdfKey(row: Pick<CertificateRow, "serial" | "issued_at">): string {
  return `certificates/${row.issued_at.getUTCFullYear()}/${row.serial}.pdf`;
}

/** Render and store one certificate's PDF (the certificates.render job). Idempotent. */
export async function renderCertificate(certificateId: string): Promise<void> {
  const row = await certificateRepo.byId(certificateId);
  if (!row || row.pdf_key) return;
  const settings = await getSettings();
  const pdf = await renderPdf({
    academy: (await academyName()) || settings.academyName,
    learner: row.learner_name,
    course: row.course_title,
    instructors: row.instructor_names ?? [],
    issuedAt: row.issued_at,
    serial: row.serial,
    verifyUrl: verifyUrl(row.serial),
    signatory: settings.certificates,
  });
  const key = pdfKey(row);
  await storage().put(key, pdf, "application/pdf");
  await certificateRepo.setPdfKey(row.id, key);
}

export interface CertificatePdfInput {
  academy: string;
  learner: string;
  course: string;
  instructors: string[];
  issuedAt: Date;
  serial: string;
  verifyUrl: string;
  signatory: { signatoryName: string; signatoryTitle: string; footer: string };
}

/** A landscape A4 certificate, built-in fonts only. Exported for tests. */
export function renderPdf(input: CertificatePdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, info: { Title: `Certificate ${input.serial}`, Author: input.academy, Subject: input.course } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const W = doc.page.width;
  const H = doc.page.height;
  const ink = "#1f2937";
  const muted = "#6b7280";
  const accent = "#1d4ed8";
  const centered = (text: string, y: number, font: string, size: number, color = ink) => {
    doc.font(font).fontSize(size).fillColor(color).text(text, 60, y, { width: W - 120, align: "center", lineBreak: true });
  };

  doc.lineWidth(3).strokeColor(accent).rect(24, 24, W - 48, H - 48).stroke();
  doc.lineWidth(0.75).strokeColor(muted).rect(34, 34, W - 68, H - 68).stroke();

  centered(input.academy, 70, "Helvetica-Bold", 18, accent);
  centered("Certificate of completion", 120, "Helvetica-Bold", 34);
  centered("This certifies that", 185, "Helvetica", 13, muted);
  centered(input.learner, 210, "Helvetica-Bold", 30);
  centered("has completed the course", 262, "Helvetica", 13, muted);
  centered(input.course, 287, "Helvetica-Bold", 22);
  if (input.instructors.length) centered(`Taught by ${input.instructors.join(", ")}`, 335, "Helvetica-Oblique", 12, muted);

  const issued = input.issuedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const baseY = H - 150;
  doc.font("Helvetica").fontSize(11).fillColor(ink).text(`Issued ${issued}`, 80, baseY, { width: 260 });
  doc.font("Helvetica").fontSize(10).fillColor(muted).text(`Serial ${input.serial}`, 80, baseY + 18, { width: 260 });
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(`Verify at ${input.verifyUrl}`, 80, baseY + 34, { width: 320 });

  if (input.signatory.signatoryName) {
    const x = W - 340;
    doc.lineWidth(0.75).strokeColor(ink).moveTo(x, baseY + 10).lineTo(x + 260, baseY + 10).stroke();
    doc.font("Helvetica-Bold").fontSize(11).fillColor(ink).text(input.signatory.signatoryName, x, baseY + 16, { width: 260, align: "center" });
    if (input.signatory.signatoryTitle) doc.font("Helvetica").fontSize(10).fillColor(muted).text(input.signatory.signatoryTitle, x, baseY + 32, { width: 260, align: "center" });
  }
  if (input.signatory.footer) centered(input.signatory.footer, H - 70, "Helvetica", 9, muted);

  doc.end();
  return done;
}
