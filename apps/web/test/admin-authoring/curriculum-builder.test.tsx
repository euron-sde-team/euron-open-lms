import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@open-lms/ui";
import type { AdminCourse } from "@open-lms/types";

const create = vi.fn();
vi.mock("@/lib/api", () => ({
  api: () => ({ authoring: { sections: { create }, items: {}, evs: {} } }),
}));

import { CurriculumBuilder } from "@/components/admin/courses/curriculum-builder";
import { courseRights } from "@/components/admin/courses/course-bits";

const course = (): AdminCourse => ({
  id: "c1",
  slug: "intro",
  title: "Intro",
  subtitle: null,
  description: "",
  outcomes: [],
  prerequisites: [],
  level: "BEGINNER",
  language: "en",
  cover: null,
  status: "DRAFT",
  accessMode: "FREE",
  includedInSubscription: false,
  certificateEnabled: true,
  allowDownloads: true,
  featured: false,
  categoryIds: [],
  prices: [],
  staff: [],
  myRole: "OWNER",
  canManage: true,
  publishedAt: null,
  updatedAt: new Date().toISOString(),
  publishChecklist: [],
  sections: [
    {
      id: "s1",
      title: "Getting started",
      position: 0,
      items: [
        { id: "i1", kind: "LECTURE", title: "Welcome", position: 0, isPreview: true, durationSeconds: 125, lectureKind: "VIDEO", videoStatus: "PROCESSING", meta: {} },
        { id: "i2", kind: "QUIZ", title: "Check yourself", position: 1, isPreview: false, durationSeconds: 0, lectureKind: null, videoStatus: null, meta: { questions: 3 } },
      ],
    },
    { id: "s2", title: "Empty one", position: 1, items: [] },
  ],
});

function renderBuilder(c: AdminCourse, role: "OWNER" | "GRADER" = "OWNER") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const withRole = { ...c, myRole: role, canManage: role === "OWNER" };
  qc.setQueryData(["admin", "courses", "detail", c.id], withRole);
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <CurriculumBuilder course={withRole} rights={courseRights(withRole, { isAdmin: false })} openItemId={null} onOpenItem={() => undefined} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("CurriculumBuilder", () => {
  it("lists sections and items with meta as words", () => {
    renderBuilder(course());
    expect(screen.getByText("Getting started")).toBeInTheDocument();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByText("Free preview")).toBeInTheDocument();
    expect(screen.getByText("3 questions")).toBeInTheDocument();
    expect(screen.getByText("Empty. Add an item, or drag one here.")).toBeInTheDocument();
    expect(screen.getAllByTestId("item-handle")).toHaveLength(2);
    expect(screen.getAllByTestId("section-handle")).toHaveLength(2);
  });

  it("is read-only for graders", () => {
    renderBuilder(course(), "GRADER");
    expect(screen.queryByTestId("item-handle")).toBeNull();
    expect(screen.queryByTestId("section-add")).toBeNull();
    expect(screen.queryByTestId("item-delete")).toBeNull();
  });

  it("adds a section", async () => {
    create.mockResolvedValue({ id: "s3", title: "More", position: 2, items: [] });
    renderBuilder(course());
    await userEvent.type(screen.getByTestId("section-new-title"), "More");
    await userEvent.click(screen.getByTestId("section-add"));
    expect(create).toHaveBeenCalledWith("c1", "More");
  });
});
