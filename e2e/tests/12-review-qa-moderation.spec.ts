import { expect, test } from "@playwright/test";
import { archiveCourse, as, buildCourse, DEMO, newContext, newUser, pageFor, staff } from "../helpers";

test("reviews and Q&A: a learner reviews and asks, the instructor answers, a report gets the review hidden", async ({ browser, request }) => {
  const instructor = await staff(request, DEMO.priya);
  const support = await staff(request, DEMO.support);
  const built = await buildCourse(request, instructor, {
    sections: [{ title: "Basics", items: [{ kind: "ARTICLE", title: "Reading a chart" }, { kind: "ARTICLE", title: "Choosing a scale" }] }],
  });
  const [first] = built.sections[0]!.items;
  const author = await newUser(request, { displayName: `Rae Reviewer ${built.slug.slice(-4)}` });
  const reporter = await newUser(request);
  await as(request, author, "POST", `/catalog/courses/${built.slug}/enroll`, {});
  // Reviews open at 20% progress: one of two lessons done.
  await as(request, author, "POST", `/learn/items/${first!.id}/complete`, {});
  const reviewText = `Short and practical, the scale lesson clicked for me ${built.slug.slice(-4)}`;
  const questionTitle = "Should a bar chart always start at zero?";

  const lp = await pageFor(browser, author, `/learn/${built.slug}/${first!.id}`);

  await test.step("the learner rates the course from the classroom", async () => {
    const prompt = lp.getByTestId("review-prompt");
    await prompt.getByTestId("review-star-4").click();
    await prompt.getByTestId("review-body").fill(reviewText);
    await prompt.getByTestId("review-save").click();
    await expect(lp.getByTestId("review-mine")).toContainText(reviewText);
  });

  await test.step("the review shows on the public course page", async () => {
    const ctx = await newContext(browser);
    const visitor = await ctx.newPage();
    await visitor.goto(`/courses/${built.slug}`);
    await expect(visitor.getByTestId("reviews-list").getByTestId("review")).toContainText(reviewText);
    await ctx.close();
  });

  await test.step("the learner asks a question on the lesson", async () => {
    await lp.getByRole("tab", { name: "Q&A" }).click();
    await lp.getByTestId("qa-ask").click();
    const form = lp.getByTestId("qa-ask-form");
    await form.getByLabel("Your question").fill(questionTitle);
    await form.getByLabel("Details").fill("The lesson says it depends. When is it fine not to?");
    await form.getByTestId("qa-post").click();
    await expect(lp.getByTestId("qa-thread")).toContainText(questionTitle);
  });

  await test.step("the instructor answers and accepts the answer", async () => {
    const ip = await pageFor(browser, instructor, `/learn/${built.slug}/${first!.id}?tab=qa`);
    await ip.getByTestId("qa-thread-row").filter({ hasText: questionTitle }).click();
    const thread = ip.getByTestId("qa-thread");
    await thread.getByTestId("qa-reply-body").fill("Bars encode length, so yes. Lines and dots can start elsewhere.");
    await thread.getByTestId("qa-reply-send").click();
    const reply = thread.getByTestId("qa-reply").filter({ hasText: "Bars encode length" });
    await expect(reply).toBeVisible();
    await reply.getByTestId("qa-accept").click();
    await expect(reply.getByTestId("qa-accepted")).toBeVisible();
    await ip.context().close();
  });

  await test.step("the learner sees the accepted answer", async () => {
    await lp.reload();
    await lp.getByTestId("qa-thread-row").filter({ hasText: questionTitle }).click();
    const reply = lp.getByTestId("qa-thread").getByTestId("qa-reply").filter({ hasText: "Bars encode length" });
    await expect(reply.getByTestId("qa-accepted")).toBeVisible();
  });

  await test.step("another learner reports the review", async () => {
    const eligibility = await as<{ mine: { id: string } }>(request, author, "GET", `/community/courses/${built.id}/review-eligibility`);
    // The public course page has no report control for reviews, so the report goes through the API.
    await as(request, reporter, "POST", "/community/reports", { targetType: "REVIEW", targetId: eligibility.mine.id, reason: "OFF_TOPIC", note: "Not about this course" });
  });

  await test.step("support hides it from the moderation queue", async () => {
    const sp = await pageFor(browser, support, "/admin/moderation");
    const row = sp.getByRole("row").filter({ hasText: reviewText });
    await expect(row).toContainText("Not about this course");
    await row.getByTestId("report-hide").click();
    const dialog = sp.getByTestId("moderation-dialog");
    await dialog.getByTestId("reason-input").fill("Off topic, hidden");
    await dialog.getByTestId("reason-confirm").click();
    await expect(dialog).toBeHidden();
    await expect(sp.getByRole("row").filter({ hasText: reviewText })).toHaveCount(0);
    await sp.goto("/admin/moderation?status=RESOLVED");
    await expect(sp.getByRole("row").filter({ hasText: reviewText })).toContainText("Hidden");
    await sp.context().close();
  });

  await test.step("the review is gone from the public page", async () => {
    const ctx = await newContext(browser);
    const visitor = await ctx.newPage();
    await visitor.goto(`/courses/${built.slug}`);
    await expect(visitor.getByTestId("course-title")).toHaveText(built.title);
    await expect(visitor.getByText(reviewText)).toHaveCount(0);
    const reviews = await as<{ items: { body: string | null }[] }>(request, reporter, "GET", `/catalog/courses/${built.slug}/reviews`);
    expect(reviews.items.map((r) => r.body)).not.toContain(reviewText);
    await ctx.close();
  });

  await lp.context().close();
  await archiveCourse(request, instructor, built.id);
});
