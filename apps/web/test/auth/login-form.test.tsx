import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@open-lms/api-client";

const login = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ login, status: "signed-out" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), useSearchParams: () => search }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
const resendVerification = vi.fn(async () => undefined);
vi.mock("@/lib/api", () => ({ api: () => ({ auth: { resendVerification } }) }));

import { LoginForm } from "@/components/auth/login-form";

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText("Email or username"), "ada@example.org");
  await userEvent.type(screen.getByLabelText("Password"), "correct horse");
  await userEvent.click(screen.getByTestId("login-submit"));
}

describe("LoginForm", () => {
  beforeEach(() => {
    login.mockReset();
    replace.mockReset();
    search = new URLSearchParams();
  });

  it("signs in and goes to a safe next path", async () => {
    search = new URLSearchParams({ next: "/c/books" });
    login.mockResolvedValue({ ok: true, user: {} });
    render(<LoginForm />);
    await fillAndSubmit();
    expect(login).toHaveBeenCalledWith("ada@example.org", "correct horse", undefined);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/c/books"));
  });

  it("ignores an external next param", async () => {
    search = new URLSearchParams({ next: "https://evil.example" });
    login.mockResolvedValue({ ok: true, user: {} });
    render(<LoginForm />);
    await fillAndSubmit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("asks for a TOTP code when required and resubmits with it", async () => {
    login.mockResolvedValueOnce({ ok: false, totpRequired: true }).mockResolvedValueOnce({ ok: true, user: {} });
    render(<LoginForm />);
    await fillAndSubmit();
    const code = await screen.findByTestId("totp-input");
    expect(screen.getByTestId("login-submit")).toBeDisabled();
    await userEvent.type(code, "12a3456");
    expect(code).toHaveValue("123456");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(login).toHaveBeenLastCalledWith("ada@example.org", "correct horse", "123456");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("shows the human message for a wrong code and clears it", async () => {
    login.mockResolvedValueOnce({ ok: false, totpRequired: true }).mockRejectedValueOnce(new ApiError({ status: 401, code: "INVALID_TOTP", message: "bad" }));
    render(<LoginForm />);
    await fillAndSubmit();
    await userEvent.type(await screen.findByTestId("totp-input"), "000000");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/code did not work/i);
    expect(screen.getByTestId("totp-input")).toHaveValue("");
  });

  it("maps wrong credentials and offers a resend for unverified email", async () => {
    login.mockRejectedValueOnce(new ApiError({ status: 401, code: "INVALID_CREDENTIALS", message: "x" }));
    render(<LoginForm />);
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/not right/i);

    login.mockRejectedValueOnce(new ApiError({ status: 403, code: "EMAIL_NOT_VERIFIED", message: "x" }));
    await userEvent.click(screen.getByTestId("login-submit"));
    await userEvent.click(await screen.findByRole("button", { name: /resend the verification email/i }));
    expect(resendVerification).toHaveBeenCalledWith("ada@example.org");
  });

  it("switches the second step to a recovery code and sends it instead of a TOTP code", async () => {
    login.mockResolvedValueOnce({ ok: false, totpRequired: true }).mockResolvedValueOnce({ ok: true, user: {} });
    render(<LoginForm />);
    await fillAndSubmit();
    await screen.findByTestId("totp-input");
    await userEvent.click(screen.getByTestId("recovery-toggle"));
    expect(screen.queryByTestId("totp-input")).not.toBeInTheDocument();
    await userEvent.type(screen.getByTestId("recovery-code-input"), " abcd-efgh ");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(login).toHaveBeenLastCalledWith("ada@example.org", "correct horse", { recoveryCode: "abcd-efgh" });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("shows throttling copy on 429 and never mentions a locked account", async () => {
    login.mockRejectedValueOnce(new ApiError({ status: 429, code: "RATE_LIMITED", message: "x" }));
    render(<LoginForm />);
    await fillAndSubmit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Too many attempts. Try again in a few minutes.");
    expect(alert).not.toHaveTextContent(/locked/i);
  });

  it("validates empty fields without calling the API", async () => {
    render(<LoginForm />);
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByText("Enter your email or username")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });
});
