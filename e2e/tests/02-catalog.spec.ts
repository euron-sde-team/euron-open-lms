import { expect, test, type Page } from "@playwright/test";
import { as, newContext, newUser, pageFor, playVideo } from "../helpers";

const cards = (page: Page) => page.getByTestId("course-card");
const cardTitles = (page: Page) => cards(page).locator("h3");

test("browse the catalog with filters in the URL, then search", async ({ browser }) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();

  await test.step("filters in the URL narrow the list and survive a reload", async () => {
    await page.goto("/courses?category=data-and-ai&level=beginner&price=paid");
    await expect(page.getByRole("list", { name: "Active filters" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Remove filter Beginner/ })).toBeVisible();
    await expect(cards(page).getByRole("link", { name: "Practical SQL for Analysts" })).toBeVisible();
    await expect(cards(page).getByRole("link", { name: "Statistics for Decision Making" })).toBeVisible();
    // An intermediate course in the same category is filtered out.
    await expect(cards(page).getByRole("link", { name: "Machine Learning Foundations" })).toHaveCount(0);
    await page.reload();
    await expect(cards(page).getByRole("link", { name: "Practical SQL for Analysts" })).toBeVisible();
  });

  await test.step("free courses only", async () => {
    await page.goto("/courses?price=free");
    await expect(cards(page).getByRole("link", { name: "Git and Code Review Habits" })).toBeVisible();
    await expect(cards(page).getByRole("link", { name: "Writing for Software Teams" })).toBeVisible();
    await expect(cards(page).getByRole("link", { name: "Modern TypeScript from First Principles" })).toHaveCount(0);
  });

  await test.step("clearing a filter updates the URL", async () => {
    await page.getByRole("button", { name: /Remove filter/ }).first().click();
    await expect(page).not.toHaveURL(/price=free/);
    await expect(cards(page).getByRole("link", { name: "Modern TypeScript from First Principles" })).toBeVisible();
  });

  await test.step("search from the catalog box", async () => {
    await page.getByTestId("catalog-search").fill("window functions");
    await page.getByTestId("catalog-search").press("Enter");
    await expect(page).toHaveURL(/q=window(\+|%20)functions/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("window functions");
    await expect(cardTitles(page).first()).toHaveText("Practical SQL for Analysts");
  });

  await test.step("a search with no match says so", async () => {
    await page.goto("/courses?q=zzqxnomatchzz");
    await expect(page.getByText('No courses match "zzqxnomatchzz"')).toBeVisible();
  });

  await ctx.close();
});

test("the course page shows its sections, a free preview plays, and the course can be saved", async ({ browser, request }) => {
  const learner = await newUser(request);
  const page = await pageFor(browser, learner, "/courses/modern-typescript");
  const card = page.getByTestId("purchase-card");

  await test.step("hero, outcomes, curriculum, instructors and reviews", async () => {
    await expect(page.getByTestId("course-title")).toHaveText("Modern TypeScript from First Principles");
    await expect(page.getByTestId("course-outcomes")).toContainText("Model domain data with discriminated unions");
    await expect(page.getByTestId("curriculum-section")).toHaveCount(4);
    await expect(page.getByTestId("course-instructor")).toContainText("Maya Okafor");
    await expect(page.getByRole("heading", { name: "Reviews", level: 2 })).toBeVisible();
    await expect(card.getByTestId("cta-buy")).toContainText("Buy now");
  });

  await test.step("the section tabs scroll to their section", async () => {
    await page.getByRole("tablist", { name: "Course sections" }).getByRole("tab", { name: "Instructors" }).click();
    await expect(page.locator("#instructors")).toBeInViewport();
  });

  await test.step("a free preview opens and the video plays", async () => {
    await page.getByTestId("curriculum-preview").filter({ hasText: "Why types, and which ones" }).click();
    const dialog = page.getByTestId("preview-dialog");
    await expect(dialog).toContainText("Free preview");
    const video = await playVideo(dialog, 0.5);
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  await test.step("save for later, and it shows under Saved", async () => {
    await card.getByTestId("course-save").click();
    await expect(card.getByTestId("course-save")).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByTestId("course-save")).toHaveText(/Saved/);
    await page.goto("/my-learning?tab=saved");
    await expect(cards(page).getByRole("link", { name: "Modern TypeScript from First Principles" })).toBeVisible();
    const saved = await as<{ items: { slug: string }[] }>(request, learner, "GET", "/my/saved");
    expect(saved.items.map((c) => c.slug)).toContain("modern-typescript");
  });

  await page.context().close();
});
