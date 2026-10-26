import { expect, test } from "@playwright/test";
import { API, buyWithStripe, course, DEMO, newUser, pageFor, staff } from "../helpers";

const SLUG = "product-discovery";

test("finance refunds a paid order with access revoked; the learner is locked out and the audit log records it", async ({ browser, request }) => {
  const learner = await newUser(request, { currency: "USD", displayName: `Refund Buyer ${Date.now().toString(36)}` });
  const c = await course(request, SLUG);
  const order = await buyWithStripe(request, learner, { type: "COURSE", id: c.id });
  const finance = await staff(request, DEMO.finance);
  const admin = await staff(request, DEMO.admin);
  const fp = await pageFor(browser, finance, `/admin/orders?q=${encodeURIComponent(order.number)}`);

  await test.step("the learner has the course to begin with", async () => {
    const r = await request.get(`${API}/learn/${SLUG}`, { headers: { Authorization: `Bearer ${learner.accessToken}`, "X-Forwarded-For": learner.ip } });
    expect(r.status()).toBe(200);
  });

  await test.step("finance finds the order and refunds it in full, revoking access", async () => {
    await fp.getByTestId(`order-link-${order.number}`).click();
    await expect(fp).toHaveURL(new RegExp(`/admin/orders/${order.id}$`));
    await expect(fp.getByTestId("order-lines")).toContainText("Product Discovery in Practice");
    await fp.getByTestId("order-refund").click();
    const dialog = fp.getByTestId("refund-dialog");
    await expect(dialog.getByTestId("refund-amount")).toHaveValue("59.00");
    await dialog.getByTestId("refund-reason").fill("Bought by mistake, asked within a day");
    const revoke = dialog.getByTestId("refund-revoke");
    if ((await revoke.getAttribute("aria-checked")) !== "true") await revoke.click();
    await expect(dialog.getByTestId("refund-revoke")).toHaveAttribute("aria-checked", "true");
    await dialog.getByTestId("refund-review").click();
    await expect(dialog).toContainText("Revoked");
    await dialog.getByTestId("refund-confirm").click();
    await expect(dialog).toBeHidden();
    const refunds = fp.getByTestId("order-refund-list");
    await expect(refunds).toContainText("$59.00");
    await expect(refunds).toContainText("Bought by mistake");
  });

  await test.step("the learner's course page says refunded and the classroom is closed", async () => {
    const lp = await pageFor(browser, learner, `/courses/${SLUG}`);
    await expect(lp.getByTestId("purchase-card").getByTestId("cta-note")).toContainText("This purchase was refunded");
    await lp.goto(`/learn/${SLUG}`);
    await expect(lp.getByText("Your access to this course ended")).toBeVisible();
    const r = await request.get(`${API}/learn/${SLUG}`, { headers: { Authorization: `Bearer ${learner.accessToken}`, "X-Forwarded-For": learner.ip } });
    expect(r.status()).toBe(403);
    expect(await r.json()).toMatchObject({ code: "COURSE_ACCESS_REQUIRED", details: { reason: "REFUNDED" } });
    await lp.goto("/account/orders");
    await expect(lp.getByTestId("order-row").filter({ hasText: order.number })).toContainText("Refunded");
    await lp.context().close();
  });

  await test.step("the audit log shows the refund request by finance", async () => {
    const ap = await pageFor(browser, admin, `/admin/audit?action=refund.request&entityType=order&entityId=${order.id}`);
    const row = ap.getByTestId("audit-list").getByRole("listitem").filter({ hasText: "refund.request" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(finance.displayName);
    await row.getByRole("button", { name: "Show details" }).click();
    await expect(ap.getByTestId("audit-data")).toContainText("Bought by mistake");
    await expect(ap.getByTestId("audit-data")).toContainText('"revokeAccess": true');
    await ap.context().close();
  });

  await fp.context().close();
});
