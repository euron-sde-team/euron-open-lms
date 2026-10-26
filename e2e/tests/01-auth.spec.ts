import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { clientIp, newContext, newUser, signIn, signOut, uniq, verificationLink } from "../helpers";

test("sign up in the UI, confirm from the email, land back on the course, survive a reload, sign out", async ({ browser, request }) => {
  const ctx = await newContext(browser, clientIp());
  const page = await ctx.newPage();
  const username = uniq("su");
  const email = `${username}@example.com`;
  const password = `Pw-${randomBytes(9).toString("base64url")}`;
  const next = "/courses/git-and-code-review";

  await test.step("sign up in the UI, with a destination to come back to", async () => {
    await page.goto(`/signup?next=${encodeURIComponent(next)}`);
    await page.locator("#email").fill(email);
    await page.locator("#displayName").fill("Signup Tester");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByTestId("signup-submit").click();
    await expect(page.getByTestId("signup-check-email")).toContainText(email);
  });

  await test.step("the emailed link signs in and returns to the course", async () => {
    await page.goto(await verificationLink(request, email));
    await expect(page).toHaveURL(new RegExp(`${next}$`));
    await expect(page.getByTestId("avatar-menu").first()).toBeVisible();
    await expect(page.getByTestId("course-title")).toContainText("Git and Code Review Habits");
  });

  await test.step("the session survives a reload (refresh cookie)", async () => {
    await page.reload();
    await expect(page.getByTestId("avatar-menu").first()).toBeVisible();
  });

  await test.step("sign out, and signed-in pages send you to sign in", async () => {
    await signOut(page);
    await page.goto("/my-learning");
    await expect(page).toHaveURL(/\/login\?next=%2Fmy-learning/);
  });

  await ctx.close();
});

test("a wrong password is refused; the right one signs in and follows `next`", async ({ browser, request }) => {
  const user = await newUser(request);
  const ctx = await newContext(browser, user.ip);
  const page = await ctx.newPage();

  await test.step("a signed-out visit to a private page asks to sign in, remembering where", async () => {
    await page.goto("/account/orders");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Forders/);
  });

  await test.step("a wrong password is refused", async () => {
    await page.locator("#login").fill(user.email);
    await page.locator("#password").fill(`${user.password}-wrong`);
    await page.getByTestId("login-submit").click();
    await expect(page.getByRole("alert").filter({ hasText: "is not right" })).toBeVisible();
    await expect(page.getByTestId("avatar-menu")).toHaveCount(0);
  });

  await test.step("the right password (by username) lands on the remembered page", async () => {
    await page.locator("#login").fill(user.username);
    await page.locator("#password").fill(user.password);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/account\/orders$/);
    await expect(page.getByTestId("avatar-menu").first()).toBeVisible();
  });

  await test.step("an outside `next` is ignored", async () => {
    await signOut(page);
    await signIn(page, user, { next: "//evil.example.com/" });
    await expect(page).toHaveURL(/localhost:3530\/$/);
  });

  await ctx.close();
});
