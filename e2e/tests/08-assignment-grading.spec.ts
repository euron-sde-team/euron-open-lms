import { expect, test } from "@playwright/test";
import { archiveCourse, as, buildCourse, DEMO, newUser, pageFor, staff } from "../helpers";

test("a project goes from submission to changes requested to approval", async ({ browser, request }) => {
  const instructor = await staff(request, DEMO.daniel);
  const built = await buildCourse(request, instructor, {
    sections: [{ title: "Project", items: [{ kind: "ASSIGNMENT", title: "Ship a tiny dashboard", instructions: "Build a one-page dashboard and share the link.", rubric: [{ title: "Clarity", maxPoints: 10 }, { title: "Correctness", maxPoints: 10 }] }] }],
  });
  const assignment = built.sections[0]!.items[0]!;
  const learner = await newUser(request, { displayName: `Grace Builder ${built.slug.slice(-4)}` });
  await as(request, learner, "POST", `/catalog/courses/${built.slug}/enroll`, {});

  const lp = await pageFor(browser, learner, `/learn/${built.slug}/${assignment.id}`);
  const ip = await pageFor(browser, instructor, `/admin/grading?course=${built.id}`);
  const panel = lp.getByTestId("assignment");

  await test.step("the learner submits text and a link", async () => {
    await expect(panel.getByTestId("assignment-rubric")).toContainText("Clarity");
    await panel.getByTestId("assignment-body").fill("My dashboard shows **weekly signups** and churn.");
    await panel.getByTestId("assignment-url").fill("https://example.com/dashboards/v1");
    await panel.getByTestId("assignment-submit").click();
    await expect(panel.getByTestId("submission-row").filter({ hasText: "Version 1" })).toContainText("Waiting for review");
    await expect(panel.getByTestId("assignment-closed")).toContainText("with the reviewer");
  });

  await test.step("the instructor finds it in the queue and requests changes", async () => {
    await ip.reload();
    await ip.getByRole("row").filter({ hasText: learner.displayName }).click();
    await expect(ip).toHaveURL(/\/admin\/grading\/[0-9A-Z]{26}/);
    await expect(ip.getByTestId("submission-body")).toContainText("weekly signups");
    await expect(ip.getByTestId("submission-url")).toHaveAttribute("href", "https://example.com/dashboards/v1");
    const rubric = ip.getByTestId("rubric-panel");
    await rubric.getByTestId("decide-changes").click();
    await expect(rubric.getByTestId("decision-problem")).toHaveText("Tell the learner what to change.");
    await rubric.getByLabel("Feedback").fill("Add a chart for churn by plan, please.");
    await rubric.getByTestId("decide-changes").click();
    await expect(ip.getByText("Changes requested. The learner is notified.", { exact: true })).toBeVisible();
  });

  await test.step("the learner reads the feedback and resubmits", async () => {
    await lp.reload();
    const v1 = panel.getByTestId("submission-row").filter({ hasText: "Version 1" });
    await expect(v1).toContainText("Changes requested");
    await v1.getByRole("button").first().click();
    await expect(v1).toContainText("Add a chart for churn by plan");
    await panel.getByTestId("assignment-body").fill("Added churn by plan.");
    await panel.getByTestId("assignment-url").fill("https://example.com/dashboards/v2");
    await panel.getByTestId("assignment-submit").click();
    await expect(panel.getByTestId("submission-row").filter({ hasText: "Version 2" })).toContainText("Waiting for review");
  });

  await test.step("the instructor scores and approves the resubmission", async () => {
    await ip.goto(`/admin/grading?course=${built.id}`);
    const row = ip.getByRole("row").filter({ hasText: learner.displayName });
    await expect(row).toContainText("Resubmission 2");
    await row.click();
    await expect(ip.getByTestId("submission-body")).toContainText("Added churn by plan");
    const rubric = ip.getByTestId("rubric-panel");
    await rubric.getByTestId("score-0").fill("9");
    await rubric.getByTestId("score-1").fill("8");
    await expect(rubric.getByTestId("score-total")).toContainText("17");
    await rubric.getByLabel("Feedback").fill("Clear and correct. Well done.");
    await rubric.getByTestId("decide-approve").click();
    await expect(ip.getByText("Approved. The learner is notified.", { exact: true })).toBeVisible();
  });

  await test.step("the learner sees the approval, the score and the feedback; the item is complete", async () => {
    await lp.reload();
    const v2 = panel.getByTestId("submission-row").filter({ hasText: "Version 2" });
    await expect(v2).toContainText("Approved");
    await expect(v2).toContainText("17 / 20");
    await v2.getByRole("button").first().click();
    await expect(v2).toContainText("Clear and correct. Well done.");
    await expect(panel.getByTestId("assignment-closed")).toContainText("approved");
    await expect(lp.getByTestId("classroom-curriculum").getByTestId("curriculum-item").filter({ hasText: assignment.title }).getByLabel("Completed")).toBeVisible();
    await expect(lp.getByTestId("classroom-progress")).toContainText("Completed");
  });

  await lp.context().close();
  await ip.context().close();
  await archiveCourse(request, instructor, built.id);
});
