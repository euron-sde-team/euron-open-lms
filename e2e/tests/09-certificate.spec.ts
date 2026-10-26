import { expect, test } from "@playwright/test";
import { archiveCourse, as, buildCourse, DEMO, newContext, newUser, pageFor, staff } from "../helpers";

interface Attempt {
  id: string;
  questions: { id: string; options: { id: string; text: string }[] }[];
}

test("finish a short course end to end and verify the certificate publicly", async ({ browser, request }) => {
  const instructor = await staff(request, DEMO.priya);
  const built = await buildCourse(request, instructor, {
    title: `Certificate Sprint ${Date.now().toString(36)}`,
    sections: [
      { title: "Warm up", items: [{ kind: "ARTICLE", title: "Read me first" }, { kind: "QUIZ", title: "One question", passPercent: 100, questions: [{ prompt: "What is 2 + 2?", options: [["4", true], ["5", false]] }] }] },
      { title: "Wrap up", items: [{ kind: "ARTICLE", title: "The last page", body: "## The last page\n\nYou made it to the end." }] },
    ],
  });
  const [intro, quiz] = built.sections[0]!.items;
  const last = built.sections[1]!.items[0]!;
  const learner = await newUser(request, { displayName: `Ada Finisher ${built.slug.slice(-4)}` });
  await as(request, learner, "POST", `/catalog/courses/${built.slug}/enroll`, {});

  await test.step("the first two items are completed through the API", async () => {
    await as(request, learner, "POST", `/learn/items/${intro!.id}/complete`, {});
    const attempt = await as<Attempt>(request, learner, "POST", `/assessments/quizzes/${quiz!.id}/attempts`, {});
    const q = attempt.questions[0]!;
    const right = q.options.find((o) => o.text === "4")!;
    const done = await as<{ attempt: { result: { passed: boolean } } }>(request, learner, "POST", `/assessments/attempts/${attempt.id}/submit`, { answers: { [q.id]: { optionIds: [right.id] } } });
    expect(done.attempt.result.passed).toBe(true);
  });

  const page = await pageFor(browser, learner, `/learn/${built.slug}`);
  let serial = "";

  await test.step("the classroom resumes at the last item; marking it done finishes the course", async () => {
    await expect(page).toHaveURL(new RegExp(`/learn/${built.slug}/${last.id}$`));
    await expect(page.getByTestId("classroom-progress")).toContainText("66%");
    await page.getByTestId("lesson-mark-done").click();
    const banner = page.getByTestId("classroom-complete-banner");
    await expect(banner).toContainText(`You finished ${built.title}`);
    await expect(banner).toContainText("Your certificate is ready");
    await expect(page.getByTestId("classroom-progress")).toContainText("Completed");
    await banner.getByTestId("classroom-certificate-link").click();
    await expect(page).toHaveURL(/\/verify\/[^/]+$/);
    serial = decodeURIComponent(page.url().split("/verify/")[1]!);
  });

  await test.step("the certificate is listed in My learning", async () => {
    await page.goto("/my-learning?tab=certificates");
    await expect(page.getByTestId("certificate-row").filter({ hasText: built.title })).toContainText(serial);
  });

  await test.step("anyone can verify it: valid, with the learner and course names", async () => {
    const ctx = await newContext(browser);
    const visitor = await ctx.newPage();
    await visitor.goto(`/verify/${encodeURIComponent(serial)}`);
    await expect(visitor.getByTestId("verify-status")).toContainText("Valid");
    await expect(visitor.getByTestId("certificate-learner")).toHaveText(learner.displayName);
    await expect(visitor.getByTestId("certificate")).toContainText(built.title);
    await expect(visitor.getByTestId("certificate")).toContainText("Priya Raman");
    await expect(visitor.getByTestId("certificate-download")).toHaveCount(0); // owner only
    await visitor.goto("/verify");
    await visitor.getByTestId("verify-serial").fill(serial);
    await visitor.getByTestId("verify-submit").click();
    await expect(visitor).toHaveURL(new RegExp(`/verify/${serial}$`));
    await expect(visitor.getByTestId("verify-status")).toContainText("Valid");
    await ctx.close();
  });

  await page.context().close();
  await archiveCourse(request, instructor, built.id);
});
