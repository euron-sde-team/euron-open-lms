import { expect, test, type Page } from "@playwright/test";
import { course, grant, itemsOf, newUser, pageFor } from "../helpers";

const SLUG = "modern-typescript";
const QUIZ = "Check your understanding: narrowing";

/** The quiz's questions (apps/api/src/demo/content.ts TS_QUIZ), keyed by a piece of the prompt. */
const KEY: { prompt: string; right: string[]; wrong: string[]; text?: string }[] = [
  { prompt: "force you to do before using a value", right: ["Narrow it with a check"], wrong: ["Cast it to `any`"] },
  { prompt: "narrow a union type", right: ['`typeof x === "string"`', '`"id" in x`', '`x.kind === "circle"`'], wrong: ["`x as Circle`"] },
  { prompt: "stops you from calling", right: ["True"], wrong: ["False"] },
  { prompt: "without widening it", right: [], wrong: [], text: "satisfies" },
  { prompt: "main benefit of a discriminated union", right: ["Exhaustive, narrowed handling of each case"], wrong: ["Smaller bundles"] },
];

/** Answers every question in order, right or wrong, then submits. */
async function answerAll(page: Page, mode: "right" | "wrong") {
  const runner = page.getByTestId("quiz-runner");
  for (let i = 0; i < KEY.length; i++) {
    const question = runner.getByTestId("quiz-question");
    await expect(question).toBeVisible();
    const prompt = (await question.locator(".lms-prose").innerText()).trim();
    const key = KEY.find((k) => prompt.includes(k.prompt));
    expect(key, `a key for "${prompt}"`).toBeTruthy();
    if (key!.text !== undefined) await question.getByTestId("quiz-text-answer").fill(mode === "right" ? key!.text : "as const");
    else for (const option of mode === "right" ? key!.right : key!.wrong) await question.getByTestId("quiz-option").filter({ hasText: option }).click();
    await runner.getByTestId("quiz-next").click();
  }
  await expect(runner.getByTestId("quiz-review")).toContainText("Every question has an answer");
  await runner.getByTestId("quiz-submit").click();
}

test("take a quiz: fail, retake and pass within the attempts, with the answers revealed", async ({ browser, request }) => {
  const learner = await newUser(request);
  const c = await course(request, SLUG);
  await grant(request, learner, c.id);
  const quiz = itemsOf(c).find((i) => i.title === QUIZ)!;
  const page = await pageFor(browser, learner, `/learn/${SLUG}/${quiz.id}`);
  const result = page.getByTestId("quiz-result");

  await test.step("the overview states the rules", async () => {
    const overview = page.getByTestId("quiz-overview");
    await expect(overview).toContainText("5 questions");
    await expect(overview).toContainText("Pass mark 60%");
    await expect(overview).toContainText("0 of 3 attempts used");
    await overview.getByTestId("quiz-start").click();
  });

  await test.step("first attempt: wrong answers, not passed", async () => {
    await answerAll(page, "wrong");
    await expect(result.getByTestId("quiz-result-status")).toHaveText("Not passed");
    await expect(result).toContainText("0%");
    await expect(result.getByLabel("Incorrect")).toHaveCount(5);
  });

  await test.step("retake: every answer right, passed, the explanations shown", async () => {
    await result.getByTestId("quiz-retake").click();
    await expect(page.getByTestId("quiz-runner")).toHaveAttribute("aria-label", "Quiz attempt 2");
    await answerAll(page, "right");
    await expect(result.getByTestId("quiz-result-status")).toHaveText("Passed");
    await expect(result).toContainText("100%");
    await expect(result.getByLabel("Correct")).toHaveCount(5);
    await expect(result).toContainText("keeps the narrower inferred type");
  });

  await test.step("the quiz is complete and its attempts are listed", async () => {
    const row = page.getByTestId("classroom-curriculum").getByTestId("curriculum-item").filter({ hasText: QUIZ });
    await expect(row.getByLabel("Completed")).toBeVisible();
    await result.getByRole("button", { name: "Back to the quiz" }).click();
    const overview = page.getByTestId("quiz-overview");
    await expect(overview).toContainText("2 of 3 attempts used");
    await expect(overview).toContainText("1 attempt left");
    await expect(overview.getByTestId("quiz-attempt-row")).toHaveCount(2);
    await expect(overview.getByTestId("quiz-attempt-row").filter({ hasText: "Not passed" })).toContainText("Attempt 1");
    await expect(overview.getByTestId("quiz-attempt-row").filter({ hasText: "100%" })).toContainText("Attempt 2");
  });

  await page.context().close();
});
