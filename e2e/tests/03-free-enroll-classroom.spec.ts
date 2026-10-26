import { expect, test } from "@playwright/test";
import { course, itemsOf, newUser, pageFor, playVideo } from "../helpers";

const SLUG = "git-and-code-review";

test("enroll in a free course and work through the classroom", async ({ browser, request }) => {
  const learner = await newUser(request);
  const c = await course(request, SLUG);
  const [first, second, third, article] = itemsOf(c);
  expect(article!.title).toBe("A review checklist");
  const page = await pageFor(browser, learner, `/courses/${SLUG}`);
  const progress = page.getByTestId("classroom-progress");
  const curriculum = page.getByTestId("classroom-curriculum");
  const video = page.getByTestId("video-player").locator("video");

  await test.step("enroll for free: the classroom opens on the first lesson", async () => {
    await page.getByTestId("purchase-card").getByTestId("cta-enroll").click();
    await expect(page).toHaveURL(new RegExp(`/learn/${SLUG}/${first!.id}$`));
    await expect(page.getByTestId("classroom-item-title")).toHaveText(first!.title);
    await expect(progress).toContainText("0%");
    await expect(progress).toContainText("0 of 4");
  });

  await test.step("a note pinned to the video time seeks back to it", async () => {
    const autoplay = page.getByTestId("classroom-autoplay");
    if ((await autoplay.getAttribute("aria-checked")) === "true") await autoplay.click();
    await expect(autoplay).toHaveAttribute("aria-checked", "false");
    await playVideo(page, 1.2);
    await video.evaluate((v: HTMLVideoElement) => v.pause());
    const at = Math.floor(await video.evaluate((v: HTMLVideoElement) => v.currentTime));

    await page.getByRole("tab", { name: "Notes" }).click();
    await expect(page).toHaveURL(/tab=notes/);
    await expect(page.getByText("No notes on this lesson yet")).toBeVisible();
    await page.getByTestId("note-body").fill("Small commits tell a story");
    await page.getByTestId("note-add").click();
    const row = page.getByTestId("note-row").filter({ hasText: "Small commits tell a story" });
    await expect(row.getByTestId("note-menu")).toBeVisible(); // saved, not the optimistic row
    await expect(row.getByTestId("note-seek")).toHaveText(`0:${String(at).padStart(2, "0")}`);

    await video.evaluate((v: HTMLVideoElement) => {
      v.currentTime = Math.max(0, v.duration - 0.5);
    });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(at + 1);
    await row.getByTestId("note-seek").click();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement, t) => Math.abs(v.currentTime - t), at)).toBeLessThan(1);
  });

  await test.step("next and previous move through the curriculum", async () => {
    await page.getByTestId("classroom-next").click();
    await expect(page.getByTestId("classroom-item-title")).toHaveText(second!.title);
    await page.getByTestId("classroom-next").click();
    await expect(page.getByTestId("classroom-item-title")).toHaveText(third!.title);
    await page.getByTestId("classroom-prev").click();
    await expect(page.getByTestId("classroom-item-title")).toHaveText(second!.title);
  });

  await test.step("open the article from the curriculum and mark it done: the progress updates", async () => {
    const reviews = curriculum.getByTestId("curriculum-section").filter({ hasText: "Reviews" });
    if ((await reviews.getAttribute("aria-expanded")) !== "true") await reviews.click();
    await expect(reviews).toHaveAttribute("aria-expanded", "true");
    const row = curriculum.getByTestId("curriculum-item").filter({ hasText: article!.title });
    await expect(row.getByLabel("Not started")).toBeVisible();
    await row.click();
    await expect(page.getByTestId("lesson-article")).toContainText("Before you approve");
    await expect(page.getByTestId("classroom-next")).toHaveCount(0); // the last lesson
    await page.getByTestId("lesson-mark-done").click();
    await expect(page.getByTestId("lesson-completed")).toBeVisible();
    await expect(progress).toContainText("25%");
    await expect(progress).toContainText("1 of 4");
    await expect(progress.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    await expect(row.getByLabel("Completed")).toBeVisible();
  });

  await test.step("bookmark a lesson; it is listed in My learning", async () => {
    const bookmark = curriculum.getByRole("button", { name: `Bookmark: ${third!.title}` });
    await bookmark.click();
    await expect(curriculum.getByRole("button", { name: `Remove bookmark: ${third!.title}` })).toHaveAttribute("aria-pressed", "true");
    await page.goto("/my-learning");
    await expect(page.getByTestId("learning-entry").filter({ hasText: c.title })).toContainText("25%");
    await page.goto("/my-learning?tab=saved");
    await expect(page.getByTestId("my-bookmarks")).toContainText(third!.title);
  });

  await test.step("opening the course again resumes at the first lesson not done yet", async () => {
    // The last lesson opened (the article) is done, so resume skips to what is left.
    await page.goto(`/learn/${SLUG}`);
    await expect(page).toHaveURL(new RegExp(`/learn/${SLUG}/${first!.id}$`));
    await expect(page.getByTestId("classroom-item-title")).toHaveText(first!.title);
    await expect(progress).toContainText("1 of 4");
  });

  await page.context().close();
});
