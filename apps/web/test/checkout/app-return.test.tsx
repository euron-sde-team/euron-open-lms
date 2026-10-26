import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { appReturnLink, DEFAULT_APP_SCHEMES, isAllowedScheme, parseAppReturn } from "@/lib/app-return";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { AppReturn } from "@/components/checkout/app-return";

const ORDER = "01JBZ8Q2R3S4T5V6W7X8Y9Z0AB";

describe("app return: scheme validation", () => {
  it("links into an allowed app with the order id, and the cancel flag", () => {
    expect(appReturnLink(parseAppReturn({ app: "openlms", orderId: ORDER, session_id: "cs_1" }), DEFAULT_APP_SCHEMES)).toBe(`openlms://checkout/return?orderId=${ORDER}`);
    expect(appReturnLink(parseAppReturn({ app: "OpenLMS", orderId: ORDER, canceled: "1" }), ["openlms"])).toBe(`openlms://checkout/return?orderId=${ORDER}&canceled=1`);
    expect(appReturnLink(parseAppReturn({ app: "academy-app", orderId: ORDER }), ["openlms", "academy-app"])).toBe(`academy-app://checkout/return?orderId=${ORDER}`);
  });

  it("never links to a scheme the API does not allow, a web or script scheme, or without a valid order", () => {
    for (const app of ["otherapp", "https", "http", "javascript", "data", "openlms://evil", "open lms", "", undefined]) {
      expect(appReturnLink(parseAppReturn({ app, orderId: ORDER }), ["openlms", "https", "javascript"]), String(app)).toBeNull();
    }
    expect(isAllowedScheme("openlms", [])).toBe(false);
    expect(appReturnLink(parseAppReturn({ app: "openlms", orderId: "not-an-id" }), ["openlms"])).toBeNull();
    expect(appReturnLink(parseAppReturn({ app: "openlms" }), ["openlms"])).toBeNull();
    // A repeated parameter: only the first value counts.
    expect(parseAppReturn({ app: ["openlms", "evil"], orderId: [ORDER] })).toEqual({ app: "openlms", orderId: ORDER, canceled: false });
  });
});

describe("app return: the page", () => {
  const replace = vi.fn();
  const original = window.location;
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: original });
    replace.mockReset();
  });
  function stubLocation() {
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, replace } });
  }

  it("opens the app at once and offers both ways back", () => {
    stubLocation();
    const link = `openlms://checkout/return?orderId=${ORDER}`;
    render(<AppReturn academyName="Northwind Academy" orderId={ORDER} canceled={false} appLink={link} />);
    expect(replace).toHaveBeenCalledWith(link);
    expect(screen.getByText("Northwind Academy")).toBeInTheDocument();
    expect(screen.getByTestId("app-return-title")).toHaveTextContent("Payment received");
    expect(screen.getByRole("link", { name: "Return to the app" })).toHaveAttribute("href", link);
    expect(screen.getByRole("link", { name: "Continue on the website" })).toHaveAttribute("href", `/checkout/orders/${ORDER}`);
  });

  it("without an allowed app link: no redirect and no app button, only the website", () => {
    stubLocation();
    render(<AppReturn academyName="Northwind Academy" orderId={ORDER} canceled appLink={null} />);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByTestId("app-return-title")).toHaveTextContent("Payment canceled");
    expect(screen.queryByRole("link", { name: "Return to the app" })).toBeNull();
    expect(screen.getByRole("link", { name: "Continue on the website" })).toHaveAttribute("href", `/checkout/orders/${ORDER}?canceled=1`);
  });
});
