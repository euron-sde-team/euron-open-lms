import { describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { as, anon, createUser } from "./harness";

/** Staff invoice downloads: the orders area may fetch any invoice; nobody else may. */
describe("admin invoice PDF", () => {
  async function invoiceFor(userId: string, pdfKey: string | null): Promise<string> {
    const id = newId();
    await db
      .insertInto("invoices")
      .values({ id, number: `INV-T-${id.slice(-8)}`, user_id: userId, currency: "USD", subtotal_minor: 4900, total_minor: 4900, seller: JSON.stringify({}), buyer: JSON.stringify({}), lines: JSON.stringify([]), pdf_key: pdfKey })
      .execute();
    return id;
  }

  test("finance and support download any learner's invoice; others are refused", async () => {
    const learner = await createUser();
    const id = await invoiceFor(learner.id, "invoices/2026/test.pdf");
    for (const role of ["FINANCE", "SUPPORT", "ADMIN"] as const) {
      const res = await as(await createUser({ role })).get(`/api/admin/commerce/invoices/${id}/pdf`).expect(302);
      expect(res.headers.location).toBeTruthy();
    }
    await as(learner).get(`/api/admin/commerce/invoices/${id}/pdf`).expect(403);
    await as(await createUser({ role: "INSTRUCTOR" })).get(`/api/admin/commerce/invoices/${id}/pdf`).expect(403);
    await anon().get(`/api/admin/commerce/invoices/${id}/pdf`).expect(401);
  });

  test("an invoice still rendering is a 409, an unknown one a 404", async () => {
    const finance = await createUser({ role: "FINANCE" });
    const id = await invoiceFor((await createUser()).id, null);
    const res = await as(finance).get(`/api/admin/commerce/invoices/${id}/pdf`).expect(409);
    expect(res.body.code).toBe("INVOICE_RENDERING");
    await as(finance).get(`/api/admin/commerce/invoices/${newId()}/pdf`).expect(404);
  });
});
