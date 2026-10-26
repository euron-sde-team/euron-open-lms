import { expect, test, type APIRequestContext } from "@playwright/test";
import { API, clientIp, course, DEMO, itemsOf, newContext, newUser, pageFor, staff } from "../helpers";

const PAID = "modern-typescript"; // Maya's course

async function status(request: APIRequestContext, route: string, token?: string): Promise<{ status: number; body: { code?: string; details?: { reason?: string } } }> {
  const headers: Record<string, string> = { "X-Forwarded-For": clientIp() };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await request.get(`${API}${route}`, { headers });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
}

test("a signed-out visitor cannot open a paid lesson", async ({ browser, request }) => {
  const c = await course(request, PAID);
  const locked = itemsOf(c).find((i) => !i.isPreview && i.lectureKind === "VIDEO")!;

  const r = await status(request, `/learn/items/${locked.id}`);
  expect(r.status).toBe(403);
  expect(r.body.code).toBe("SIGN_IN_REQUIRED");
  expect((await request.post(`${API}/learn/items/${locked.id}/playback`, { headers: { "X-Forwarded-For": clientIp() } })).status()).toBe(403);

  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await page.goto(`/learn/${PAID}/${locked.id}`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/learn/${PAID}/${locked.id}`)}`));
  await ctx.close();
});

test("a learner who is not enrolled sees the lock, and the API refuses", async ({ browser, request }) => {
  const learner = await newUser(request);
  const c = await course(request, PAID);
  const locked = itemsOf(c).find((i) => !i.isPreview && i.lectureKind === "VIDEO")!;

  const item = await status(request, `/learn/items/${locked.id}`, learner.accessToken);
  expect(item.status).toBe(403);
  expect(item.body).toMatchObject({ code: "COURSE_ACCESS_REQUIRED", details: { reason: "NOT_ENROLLED" } });

  const page = await pageFor(browser, learner, `/learn/${PAID}/${locked.id}`);
  await expect(page.getByText("You need access to this course")).toBeVisible();
  await expect(page.getByTestId("video-player")).toHaveCount(0);
  await page.getByRole("link", { name: "Go to the course page" }).click();
  await expect(page).toHaveURL(new RegExp(`/courses/${PAID}$`));
  await expect(page.getByTestId("purchase-card").getByTestId("cta-buy")).toBeVisible();
  await page.context().close();
});

test("an instructor cannot open another instructor's course editor", async ({ browser, request }) => {
  const daniel = await staff(request, DEMO.daniel);
  const maya = await staff(request, DEMO.maya);
  const mine = await status(request, `/admin/courses?q=${encodeURIComponent("Modern TypeScript")}`, maya.accessToken);
  const target = (mine.body as unknown as { items: { id: string; slug: string }[] }).items.find((x) => x.slug === PAID)!;

  const r = await status(request, `/admin/courses/${target.id}`, daniel.accessToken);
  expect(r.status).toBe(404);

  const page = await pageFor(browser, daniel, `/admin/courses/${target.id}`);
  await expect(page.getByText("This page is not available")).toBeVisible();
  await expect(page.getByTestId("curriculum-builder")).toHaveCount(0);
  await expect(page.getByTestId("course-details")).toHaveCount(0);
  // His own list does not show it either.
  await page.goto(`/admin/courses?q=${encodeURIComponent("Statistics for Decision")}`);
  await expect(page.getByRole("row").filter({ hasText: "Statistics for Decision Making" })).toBeVisible();
  await page.goto(`/admin/courses?q=${encodeURIComponent("Modern TypeScript")}`);
  await expect(page.getByText("No courses match")).toBeVisible();
  await page.context().close();
});

test("a learner gets the no-access page at /admin", async ({ browser, request }) => {
  const learner = await newUser(request);
  expect((await status(request, "/admin/me", learner.accessToken)).status).toBe(403);
  const page = await pageFor(browser, learner, "/admin");
  await expect(page.getByTestId("admin-forbidden")).toContainText("You do not have access");
  await expect(page.getByTestId("admin-sidebar")).toHaveCount(0);
  await page.goto("/admin/orders");
  await expect(page.getByTestId("admin-forbidden")).toBeVisible();
  await page.context().close();
});
