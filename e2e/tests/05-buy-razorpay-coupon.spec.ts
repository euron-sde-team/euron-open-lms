import { expect, test } from "@playwright/test";
import { as, newUser, pageFor } from "../helpers";

const SLUG = "statistics-for-decisions";

test("an INR learner applies WELCOME20 and pays through Razorpay, with GST on top", async ({ browser, request }) => {
  const learner = await newUser(request, { currency: "INR" });
  const page = await pageFor(browser, learner, `/courses/${SLUG}`);

  await test.step("the course is priced in rupees and checkout routes to Razorpay", async () => {
    const buy = page.getByTestId("purchase-card").getByTestId("cta-buy");
    await expect(buy).toContainText("₹3,499");
    await buy.click();
    await expect(page).toHaveURL(/currency=INR/);
    await page.getByTestId("billing-country").selectOption("IN");
    await expect(page.getByTestId("checkout-gateway")).toContainText(/Razorpay/i);
    await expect(page.getByTestId("summary-subtotal")).toContainText("₹3,499.00");
  });

  await test.step("a wrong code is refused, WELCOME20 (20% off courses) is applied", async () => {
    await page.getByTestId("coupon-open").click();
    await page.getByTestId("coupon-input").fill("NOPE-NOT-A-CODE");
    await page.getByTestId("coupon-apply").click();
    await expect(page.getByTestId("coupon-error")).toBeVisible();
    await page.getByTestId("coupon-input").fill("WELCOME20");
    await page.getByTestId("coupon-apply").click();
    await expect(page.getByTestId("coupon-applied")).toContainText("WELCOME20");
    await expect(page.getByTestId("summary-discount")).toContainText("₹699.80");
  });

  await test.step("GST 18% is charged on the discounted price", async () => {
    // (3,499.00 - 699.80) x 18% = 503.86, exclusive of the price.
    await expect(page.getByTestId("summary-tax")).toContainText("GST");
    await expect(page.getByTestId("summary-tax")).toContainText("₹503.86");
    await expect(page.getByTestId("summary-total")).toContainText("₹3,303.06");
  });

  await test.step("pay in the Razorpay overlay and land on the paid order", async () => {
    await page.getByTestId("checkout-pay").click();
    await expect(page.getByText("Test payment (local stub)")).toBeVisible();
    await page.getByRole("button", { name: "Pay", exact: true }).click();
    await expect(page).toHaveURL(/\/checkout\/orders\//);
    await expect(page.getByTestId("order-paid")).toContainText("You are enrolled");
    await expect(page.getByTestId("order-paid")).toContainText("₹3,303.06");
  });

  await test.step("the order records the coupon, the tax and the gateway", async () => {
    const orders = await as<{ items: { status: string; gateway: string; couponCode: string | null; taxLabel: string | null; tax: { amountMinor: number }; total: { amountMinor: number; currency: string } }[] }>(request, learner, "GET", "/billing/orders");
    expect(orders.items[0]).toMatchObject({ status: "PAID", gateway: "RAZORPAY", couponCode: "WELCOME20", tax: { amountMinor: 50386 }, total: { amountMinor: 330306, currency: "INR" } });
    await page.getByTestId("order-continue").click();
    await expect(page).toHaveURL(new RegExp(`/learn/${SLUG}`));
  });

  await page.context().close();
});
