import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EMAIL_CATEGORIES, type Me } from "@open-lms/types";
import { me as baseMe } from "../fixtures";

let current: Me = baseMe;
const setUser = vi.fn((m: Me) => {
  current = m;
});
const updateMe = vi.fn();
vi.mock("@/lib/auth", () => ({ useMe: () => current, useAuth: () => ({ user: current, setUser, reloadMe: vi.fn(), logout: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ api: () => ({ users: { updateMe } }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/account/orders/01ABC", useRouter: () => ({ push: vi.fn() }) }));

import { AccountShell, sectionOf } from "@/components/account/account-shell";
import { EMAIL_CATEGORY_COPY, NotificationsSection } from "@/components/account/notifications-section";
import { certificateNameFor } from "@/components/account/profile-section";

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("account sections", () => {
  beforeEach(() => {
    current = baseMe;
    setUser.mockClear();
    updateMe.mockReset();
  });

  it("maps paths to sections, with nested order pages under Orders", () => {
    expect(sectionOf("/account/orders/01ABC")).toBe("orders");
    expect(sectionOf("/account/security")).toBe("security");
    expect(sectionOf("/account")).toBe("profile");
    expect(sectionOf("/account/nope")).toBe("profile");
  });

  it("marks the active section and shows the pending-deletion banner", () => {
    current = { ...baseMe, deletionRequestedAt: "2026-10-20T10:00:00Z" };
    wrap(<AccountShell>body</AccountShell>);
    expect(screen.getByTestId("account-nav-orders")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("account-nav-profile")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("deletion-pending")).toHaveTextContent(/scheduled for deletion/);
  });

  it("certificates print the certificate name, else the display name", () => {
    expect(certificateNameFor({ certificateName: "  ", displayName: "Ada" })).toBe("Ada");
    expect(certificateNameFor({ certificateName: "Augusta Ada King", displayName: "Ada" })).toBe("Augusta Ada King");
  });

  it("explains every email category and saves a switch optimistically", async () => {
    updateMe.mockImplementation(async (patch: { emailPreferences: Record<string, boolean> }) => ({ ...current, emailPreferences: { ...current.emailPreferences, ...patch.emailPreferences } }));
    wrap(<NotificationsSection />);
    for (const c of EMAIL_CATEGORIES) expect(screen.getByText(EMAIL_CATEGORY_COPY[c].title)).toBeInTheDocument();
    expect(screen.getByText(/Receipts, invoices and security emails/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("email-pref-PRODUCT_UPDATES"));
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ emailPreferences: expect.objectContaining({ PRODUCT_UPDATES: false }) }));
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ emailPreferences: { PRODUCT_UPDATES: false } }));
  });
});
