import { expect, test } from "@playwright/test";
import { as, newUser, pageFor } from "../helpers";

const MEMBERS_ONLY = "interfaces-people-trust";

test("subscribe to All-Access monthly through Stripe, open a members-only course, cancel at period end", async ({ browser, request }) => {
  const learner = await newUser(request, { currency: "USD" });
  const page = await pageFor(browser, learner, `/courses/${MEMBERS_ONLY}`);
  const card = page.getByTestId("purchase-card");

  await test.step("a members-only course points to the plans", async () => {
    await expect(card.getByTestId("cta-plans")).toBeVisible();
    await expect(card.getByTestId("cta-note")).toContainText("available with a plan");
    await card.getByTestId("cta-plans").click();
    await expect(page).toHaveURL(/\/plans/);
  });

  await test.step("choose All-Access monthly and pay on the hosted page", async () => {
    const plan = page.getByTestId("plan-all-access");
    await expect(plan).toContainText("$19");
    await expect(plan).toContainText("a month");
    await plan.getByTestId("plan-cta").click();
    await expect(page).toHaveURL(/\/checkout\?type=PLAN/);
    await expect(page.getByTestId("summary-title")).toContainText("All-Access");
    await expect(page.getByTestId("summary-recurring")).toBeVisible();
    await page.getByTestId("billing-country").selectOption("US");
    await page.getByTestId("checkout-pay").click();
    await expect(page).toHaveURL(/localhost:5119\/stub\/stripe\/checkout\//);
    await page.getByRole("button", { name: "Pay", exact: true }).click();
    await expect(page).toHaveURL(/\/checkout\/orders\//);
    // The plan has a 7-day trial, so the first order is free.
    await expect(page.getByTestId("order-paid")).toContainText(/Your free trial has started|Your plan is active/);
  });

  await test.step("the members-only course is now included", async () => {
    await page.goto(`/courses/${MEMBERS_ONLY}`);
    await expect(card.getByTestId("cta-start")).toHaveText("Start learning");
    await expect(card.getByTestId("cta-note")).toContainText("Included in your plan");
    await card.getByTestId("cta-start").click();
    await expect(page).toHaveURL(new RegExp(`/learn/${MEMBERS_ONLY}/`));
    await expect(page.getByTestId("classroom-item-title")).toHaveText("What trust looks like on screen");
  });

  await test.step("cancel at period end from the account page", async () => {
    await page.goto("/account/subscription");
    await expect(page.getByTestId("subscription-status")).toHaveText(/Free trial|Active/);
    await page.getByTestId("subscription-cancel").click();
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("subscription-resume")).toBeVisible();
    await expect(page.getByTestId("subscription-date")).toContainText(/will not renew|Ends on/);
    const sub = await as<{ cancelAtPeriodEnd: boolean; grantsAccess: boolean }>(request, learner, "GET", "/billing/subscription");
    expect(sub).toMatchObject({ cancelAtPeriodEnd: true, grantsAccess: true });
  });

  await test.step("access continues until the period ends", async () => {
    await page.goto(`/courses/${MEMBERS_ONLY}`);
    await expect(card.getByTestId("cta-continue").or(card.getByTestId("cta-start"))).toBeVisible();
  });

  await page.context().close();
});
