import { expect, test } from "@playwright/test";
import { newUser, pageFor } from "../helpers";

const SLUG = "practical-sql";

test("buy a paid course in USD through Stripe's hosted page and start learning", async ({ browser, request }) => {
  const learner = await newUser(request, { currency: "USD" });
  const page = await pageFor(browser, learner, `/courses/${SLUG}`);

  await test.step("Buy now opens checkout in USD", async () => {
    const buy = page.getByTestId("purchase-card").getByTestId("cta-buy");
    await expect(buy).toContainText("$39");
    await buy.click();
    await expect(page).toHaveURL(/\/checkout\?type=COURSE&id=.+currency=USD/);
    await expect(page.getByTestId("summary-title")).toHaveText("Practical SQL for Analysts");
    await page.getByTestId("billing-country").selectOption("US");
    await expect(page.getByTestId("summary-tax")).toHaveCount(0); // no tax rule for the US
    await expect(page.getByTestId("summary-total")).toContainText("$39.00");
    await expect(page.getByTestId("checkout-gateway")).toContainText(/Stripe/i);
  });

  await test.step("pay on the hosted page and come back to a paid order", async () => {
    await page.getByTestId("checkout-pay").click();
    await expect(page).toHaveURL(/localhost:5119\/stub\/stripe\/checkout\//);
    await page.getByRole("button", { name: "Pay", exact: true }).click();
    await expect(page).toHaveURL(/\/checkout\/orders\//);
    await expect(page.getByTestId("order-paid")).toContainText("You are enrolled");
    await expect(page.getByTestId("order-paid")).toContainText("Payment of $39.00 received");
  });

  await test.step("Start learning opens the classroom", async () => {
    await page.getByTestId("order-continue").click();
    await expect(page).toHaveURL(new RegExp(`/learn/${SLUG}`));
    await expect(page.getByTestId("classroom-item-title")).toHaveText("Your first SELECT");
    await expect(page.getByTestId("classroom-progress")).toContainText("0 of 8");
  });

  await test.step("the course page now offers to continue", async () => {
    await page.goto(`/courses/${SLUG}`);
    await expect(page.getByTestId("purchase-card").getByTestId("cta-continue")).toBeVisible();
  });

  await test.step("the order and its invoice appear in Orders (the worker renders the PDF)", async () => {
    await page.goto("/account/orders");
    const row = page.getByTestId("order-row").filter({ hasText: "Practical SQL for Analysts" });
    await expect(row).toContainText("Paid");
    await expect(row).toContainText("$39.00");
    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("order-row").filter({ hasText: "Practical SQL for Analysts" }).getByTestId("order-invoice-download")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 45_000 });
  });

  await page.context().close();
});
