import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, IconButton } from "../src/components/button";
import { CountBadge } from "../src/components/badge";
import { EmptyState } from "../src/components/empty-state";
import { Segmented } from "../src/components/tabs";
import { Toaster, toast, toastStore } from "../src/components/toast";

describe("Button", () => {
  it("is a non-submitting button by default and fires clicks", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toHaveAttribute("type", "button");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("is disabled and busy while loading", () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole("button", { name: /save/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
  it("IconButton always has an accessible name", () => {
    render(<IconButton label="Close">x</IconButton>);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

describe("CountBadge", () => {
  it("hides at zero and caps at 99+", () => {
    const { container, rerender } = render(<CountBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CountBadge count={150} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });
});

describe("Segmented", () => {
  it("marks the active option and reports changes", async () => {
    const onChange = vi.fn();
    render(<Segmented value="latest" onChange={onChange} options={[{ value: "latest", label: "Latest" }, { value: "top", label: "Top" }]} />);
    expect(screen.getByRole("tab", { name: "Latest" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Top" }));
    expect(onChange).toHaveBeenCalledWith("top");
  });
});

describe("EmptyState", () => {
  it("renders title, description and action", () => {
    render(<EmptyState title="Nothing yet" description="Posts will show here" action={<button>Create</button>} />);
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(screen.getByText("Posts will show here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });
});

describe("toast", () => {
  it("shows a toast pushed from outside React and dedupes repeats", () => {
    render(<Toaster />);
    act(() => {
      toast.error({ title: "Something broke", description: "Try again" });
      toast.error({ title: "Something broke", description: "Try again" });
    });
    expect(screen.getAllByText("Something broke")).toHaveLength(1);
    expect(toastStore.getSnapshot()).toHaveLength(1);
  });
});
