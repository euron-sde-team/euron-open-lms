import { expect, test } from "@playwright/test";
import { archiveCourse, as, DEMO, newContext, pageFor, pngBytes, staff, uniq } from "../helpers";

interface AdminCourse {
  status: string;
  slug: string;
  sections: { title: string; items: { id: string; title: string; kind: string }[] }[];
  prices: { currency: string; amountMinor: number }[];
}

test("an instructor builds a paid course in the editor and publishes it to the catalog", async ({ browser, request }) => {
  const maya = await staff(request, DEMO.maya);
  const title = `Builder Course ${uniq("b").slice(-6)}`;
  const page = await pageFor(browser, maya, "/admin/courses");
  let courseId = "";
  const panel = page.getByTestId("publish-panel");
  const tab = (name: string) => page.getByRole("tablist", { name: "Course editor" }).getByRole("tab", { name: new RegExp(`^${name}`) });
  // Toasts live outside any open sheet (which hides the rest of the page from the accessibility tree).
  const toast = (text: string) => page.getByText(text, { exact: true }).first();

  await test.step("create a course from a title", async () => {
    await page.getByTestId("course-new").click();
    await page.getByTestId("new-course-title").fill(title);
    await page.getByTestId("new-course-create").click();
    await expect(page).toHaveURL(/\/admin\/courses\/[0-9A-Z]{26}/);
    courseId = page.url().match(/\/admin\/courses\/([0-9A-Z]{26})/)![1]!;
  });

  await test.step("the publish checklist blocks an empty course", async () => {
    await expect(panel.getByTestId("check-NO_ITEMS")).toBeVisible();
    await expect(panel.getByTestId("check-NO_COVER")).toBeVisible();
    await expect(panel.getByTestId("check-NO_DESCRIPTION")).toBeVisible();
    await panel.getByTestId("course-publish").click();
    await expect(toast("Finish the checklist before publishing.")).toBeVisible();
    expect((await as<AdminCourse>(request, maya, "GET", `/admin/courses/${courseId}`)).status).toBe("DRAFT");
  });

  await test.step("details: cover, description and paid access", async () => {
    await page.getByTestId("cover-input").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: pngBytes(64) });
    await expect(panel.getByTestId("check-NO_COVER")).toHaveCount(0);
    const details = page.getByTestId("course-details");
    await details.getByTestId("course-subtitle").fill("Built click by click in the editor");
    await details.getByTestId("course-description").fill("A course assembled by the end-to-end suite to prove the editor works from start to finish.");
    await details.getByTestId("course-access").click();
    await page.getByRole("option", { name: "Paid" }).click();
    await details.getByTestId("course-save").click();
    await expect(panel.getByTestId("check-NO_DESCRIPTION")).toHaveCount(0);
    await expect(panel.getByTestId("check-NO_PRICE")).toBeVisible();
  });

  await test.step("write a question in the bank", async () => {
    await tab("Questions").click();
    await page.getByTestId("question-new").click();
    const dialog = page.getByTestId("question-dialog");
    await dialog.getByTestId("question-prompt").fill("Which file lists a project's npm dependencies?");
    await dialog.getByTestId("option-text-0").fill("package.json");
    await dialog.getByTestId("option-text-1").fill("README.md");
    await dialog.getByTestId("option-correct-0").check();
    await dialog.getByTestId("question-save").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("question-bank")).toContainText("Which file lists a project's npm dependencies?");
  });

  await test.step("curriculum: a section with an article and a quiz from the bank", async () => {
    await tab("Curriculum").click();
    await page.getByTestId("section-new-title").fill("Getting started");
    await page.getByTestId("section-add").click();
    const section = page.getByRole("listitem", { name: "Section 1: Getting started" });
    await expect(section).toBeVisible();

    await section.getByTestId("item-add").click();
    await page.getByTestId("item-add-article").click();
    await page.getByTestId("item-title").fill("Welcome aboard");
    await page.getByTestId("article-body").fill("## Welcome\n\nThis is where the course begins.");
    await expect(page.getByTestId("article-preview")).toContainText("This is where the course begins.");
    await page.getByTestId("item-save").click();
    await expect(toast("Saved.")).toBeVisible();
    await page.getByRole("dialog", { name: "Welcome aboard" }).getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByTestId("item-title")).toBeHidden();

    await section.getByTestId("item-add").click();
    await page.getByTestId("item-add-quiz").click();
    await page.getByTestId("item-title").fill("Check yourself");
    await page.getByTestId("quiz-add-questions").click();
    await page.getByTestId("bank-picker").locator("label").filter({ hasText: "npm dependencies" }).getByRole("checkbox").check();
    await expect(page.getByTestId("quiz-questions")).toContainText("Questions in this quiz (1)");
    await page.getByTestId("item-save").click();
    await expect(toast("Saved.")).toBeVisible();
    await page.getByRole("dialog", { name: "Check yourself" }).getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByTestId("item-title")).toBeHidden();

    await expect(section.getByTestId("item-open")).toHaveText(["Welcome aboard", "Check yourself"]);
    await expect(panel.getByTestId("check-NO_ITEMS")).toHaveCount(0);
  });

  await test.step("reorder with the keyboard: the quiz moves above the article", async () => {
    const section = page.getByRole("listitem", { name: "Section 1: Getting started" });
    const handle = section.getByRole("button", { name: "Move Check yourself" });
    await handle.focus();
    // dnd-kit's keyboard sensor: space picks up, arrows move, space drops; its live region narrates.
    const live = page.getByRole("status").filter({ hasText: "Check yourself" });
    await page.keyboard.press("Space");
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    // The sensor attaches its key listener a frame after pick-up; with two items, extra presses stay on top.
    await expect(async () => {
      await page.keyboard.press("ArrowUp");
      await expect(live).toHaveText(/Check yourself is now over Welcome aboard/, { timeout: 1_000 });
    }).toPass();
    await page.keyboard.press("Space");
    await expect(live).toHaveText(/Dropped Check yourself, position 1 of 2 in Getting started/);
    await expect(section.getByTestId("item-open")).toHaveText(["Check yourself", "Welcome aboard"]);
    await expect.poll(async () => (await as<AdminCourse>(request, maya, "GET", `/admin/courses/${courseId}`)).sections[0]!.items.map((i) => i.title)).toEqual(["Check yourself", "Welcome aboard"]);
  });

  await test.step("set a price", async () => {
    await tab("Pricing").click();
    await page.getByTestId("price-amount-USD").fill("25");
    await page.getByTestId("prices-save").click();
    await expect(panel.getByTestId("check-NO_PRICE")).toHaveCount(0);
    await expect(panel.getByTestId("publish-ready")).toBeVisible();
  });

  await test.step("publish", async () => {
    await panel.getByTestId("course-publish").click();
    await expect(toast("Published. Learners can find it in the catalog now.")).toBeVisible();
    await expect(panel.getByTestId("course-unpublish")).toBeVisible();
    const c = await as<AdminCourse>(request, maya, "GET", `/admin/courses/${courseId}`);
    expect(c.status).toBe("PUBLISHED");
    expect(c.prices).toEqual(expect.arrayContaining([expect.objectContaining({ currency: "USD", amount: { amountMinor: 2500, currency: "USD" } })]));
  });

  await test.step("a visitor finds it in the catalog at its price, in the new order", async () => {
    const ctx = await newContext(browser);
    const visitor = await ctx.newPage();
    await visitor.goto(`/courses?q=${encodeURIComponent(title)}`);
    const card = visitor.getByTestId("course-card").filter({ hasText: title });
    await expect(card).toContainText("$25");
    await card.getByRole("link", { name: title }).click();
    await expect(visitor.getByTestId("course-title")).toHaveText(title);
    await expect(visitor.getByTestId("curriculum")).toContainText("Check yourself");
    await ctx.close();
  });

  await page.context().close();
  await archiveCourse(request, maya, courseId);
});
