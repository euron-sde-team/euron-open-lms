/** Certificates: public lookups by serial, the owner's list, and the PDF key the render job sets. */
import { db, type Executor } from "../db/kysely";

const COLUMNS = ["k.id", "k.serial", "k.user_id", "k.course_id", "k.learner_name", "k.course_title", "k.instructor_names", "k.pdf_key", "k.issued_at", "k.revoked_at", "c.slug as course_slug"] as const;

export class CertificateRepository {
  bySerial(serial: string, exec: Executor = db) {
    return exec.selectFrom("certificates as k").innerJoin("courses as c", "c.id", "k.course_id").select([...COLUMNS]).where("k.serial", "=", serial).executeTakeFirst();
  }

  byId(id: string, exec: Executor = db) {
    return exec.selectFrom("certificates as k").innerJoin("courses as c", "c.id", "k.course_id").select([...COLUMNS]).where("k.id", "=", id).executeTakeFirst();
  }

  ownedBy(userId: string, exec: Executor = db) {
    return exec.selectFrom("certificates as k").innerJoin("courses as c", "c.id", "k.course_id").select([...COLUMNS]).where("k.user_id", "=", userId).orderBy("k.issued_at", "desc").orderBy("k.id", "desc").limit(500).execute();
  }

  /** Set the rendered PDF once (a retried job never overwrites a finished render). */
  async setPdfKey(id: string, key: string, exec: Executor = db): Promise<boolean> {
    const r = await exec.updateTable("certificates").set({ pdf_key: key }).where("id", "=", id).where("pdf_key", "is", null).executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }
}

export const certificateRepo = new CertificateRepository();
