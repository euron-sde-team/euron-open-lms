import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
const acceptSession = vi.fn();
const signup = vi.fn();
let search = new URLSearchParams();
let registration: "OPEN" | "CLOSED" = "OPEN";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ acceptSession, status: "signed-out" }) }));
vi.mock("@/lib/meta", () => ({ useAcademyMeta: () => ({ data: { academyName: "Book Club", registration } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), useSearchParams: () => search }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/api", () => ({ api: () => ({ auth: { signup } }) }));

import { SignupForm } from "@/components/auth/signup-form";

async function fill() {
  await userEvent.type(screen.getByLabelText("Email"), "ada@example.org");
  await userEvent.type(screen.getByLabelText("Name"), "Ada");
  await userEvent.type(screen.getByLabelText("Username"), "ada-l");
  await userEvent.type(screen.getByLabelText("Password"), "a long enough password");
}

describe("SignupForm", () => {
  beforeEach(() => {
    signup.mockReset().mockResolvedValue({ verificationRequired: true, email: "ada@example.org" });
    search = new URLSearchParams();
    registration = "OPEN";
  });

  it("sends the details and shows the check-your-email step", async () => {
    render(<SignupForm />);
    await fill();
    await userEvent.click(screen.getByTestId("signup-submit"));
    await waitFor(() => expect(signup).toHaveBeenCalledWith(expect.objectContaining({ email: "ada@example.org", username: "ada-l", displayName: "Ada" })));
  });

  it("accepts hyphens in usernames and refuses underscores before calling the API", async () => {
    render(<SignupForm />);
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.org");
    await userEvent.type(screen.getByLabelText("Name"), "Ada");
    await userEvent.type(screen.getByLabelText("Username"), "ada_l");
    await userEvent.type(screen.getByLabelText("Password"), "a long enough password");
    await userEvent.click(screen.getByTestId("signup-submit"));
    expect(await screen.findByText(/letters, digits or hyphens/)).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();
  });

  it("says when sign-ups are closed", () => {
    registration = "CLOSED";
    render(<SignupForm />);
    expect(screen.getByText("Sign-ups are closed right now.")).toBeInTheDocument();
  });
});
