import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Order, OrderStatus } from "@open-lms/types";
import { POLL_TIMEOUT_MS, failureCopy, orderPhase, pollInterval } from "@/lib/billing";

const order = vi.fn();
const cancelOrder = vi.fn();
vi.mock("@/lib/api", () => ({ api: () => ({ checkout: { order, cancelOrder }, billing: { invoicePdf: vi.fn() } }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ reloadMe: vi.fn().mockResolvedValue(undefined) }) }));

import { OrderOutcome, useOrderPolling } from "@/components/checkout/order-status-page";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
function mk(status: OrderStatus, over: Partial<Order> = {}): Order {
  return {
    id: "o1",
    number: "ORD-1",
    kind: "ONE_TIME",
    status,
    gateway: "STRIPE",
    lines: [{ type: "COURSE", id: "c1", title: "SQL basics", slug: "sql-basics", unit: usd(5000), discount: usd(0), tax: usd(0), total: usd(5000) }],
    subtotal: usd(5000),
    discount: usd(0),
    tax: usd(0),
    total: usd(5000),
    refunded: usd(0),
    couponCode: null,
    taxLabel: null,
    failureReason: null,
    paidAt: status === "PAID" ? "2026-10-01T10:00:00Z" : null,
    createdAt: "2026-10-01T09:59:00Z",
    invoice: null,
    continueTo: "/learn/sql-basics",
    ...over,
  };
}

describe("order phase machine", () => {
  it("maps statuses to phases", () => {
    expect(orderPhase(null, 0)).toBe("loading");
    expect(orderPhase(mk("PAID"), 0)).toBe("paid");
    expect(orderPhase(mk("PARTIALLY_REFUNDED"), 0)).toBe("paid");
    expect(orderPhase(mk("FAILED"), 0)).toBe("failed");
    expect(orderPhase(mk("EXPIRED"), 0)).toBe("failed");
    expect(orderPhase(mk("CANCELED"), 0)).toBe("canceled");
    expect(orderPhase(mk("PENDING"), 1000)).toBe("pending");
    expect(orderPhase(mk("PENDING"), POLL_TIMEOUT_MS)).toBe("timeout");
  });
  it("polls every 2 s only while pending and before the timeout", () => {
    expect(pollInterval(undefined, 0)).toBe(2000);
    expect(pollInterval(mk("PENDING"), 59_000)).toBe(2000);
    expect(pollInterval(mk("PENDING"), 60_000)).toBe(false);
    expect(pollInterval(mk("PAID"), 0)).toBe(false);
    expect(pollInterval(mk("FAILED"), 0)).toBe(false);
  });
  it("words failure reasons", () => {
    expect(failureCopy(null)).toMatch(/not charged/);
    expect(failureCopy("GATEWAY_ERROR")).toMatch(/provider/);
    expect(failureCopy("Your card was declined.")).toBe("Your card was declined.");
  });
});

describe("useOrderPolling", () => {
  let client: QueryClient;
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    order.mockReset();
    cancelOrder.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    client.clear();
  });

  it("syncs once, then polls plain reads until the order is paid", async () => {
    order.mockResolvedValueOnce(mk("PENDING")).mockResolvedValueOnce(mk("PENDING")).mockResolvedValue(mk("PAID"));
    const { result } = renderHook(() => useOrderPolling("o1"), { wrapper });
    await waitFor(() => expect(result.current.phase).toBe("pending"));
    expect(order).toHaveBeenNthCalledWith(1, "o1", { sync: true });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(order).toHaveBeenNthCalledWith(2, "o1", { sync: false });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await waitFor(() => expect(result.current.phase).toBe("paid"));
    const calls = order.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(order.mock.calls.length).toBe(calls);
  });

  it("stops after a minute and says it is still processing", async () => {
    order.mockResolvedValue(mk("PENDING"));
    const { result } = renderHook(() => useOrderPolling("o1"), { wrapper });
    await waitFor(() => expect(result.current.phase).toBe("pending"));
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    await waitFor(() => expect(result.current.phase).toBe("timeout"));
    const calls = order.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(32);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(order.mock.calls.length).toBe(calls);
  });

  it("closes a still-pending order on the cancel return", async () => {
    order.mockResolvedValueOnce(mk("PENDING"));
    cancelOrder.mockResolvedValue(mk("CANCELED"));
    const { result } = renderHook(() => useOrderPolling("o1", { cancel: true }), { wrapper });
    await waitFor(() => expect(result.current.phase).toBe("canceled"));
    expect(cancelOrder).toHaveBeenCalledWith("o1");
  });
});

const withClient = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("order outcome", () => {
  it("paid: what was bought, the receipt number and Start learning to continueTo", () => {
    withClient(<OrderOutcome order={mk("PAID")} phase="paid" />);
    expect(screen.getByTestId("order-paid")).toHaveTextContent("SQL basics");
    expect(screen.getByText(/Receipt ORD-1/)).toBeInTheDocument();
    expect(screen.getByTestId("order-continue")).toHaveAttribute("href", "/learn/sql-basics");
  });
  it("paid without continueTo falls back to My learning", () => {
    withClient(<OrderOutcome order={mk("PAID", { continueTo: null })} phase="paid" />);
    expect(screen.getByTestId("order-continue")).toHaveAttribute("href", "/my-learning");
  });
  it("failed and canceled link back to the course", () => {
    const { unmount } = withClient(<OrderOutcome order={mk("FAILED", { failureReason: "Card declined." })} phase="failed" />);
    expect(screen.getByTestId("order-failed")).toHaveTextContent("Card declined.");
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/courses/sql-basics");
    unmount();
    withClient(<OrderOutcome order={mk("CANCELED")} phase="canceled" />);
    expect(screen.getByRole("link", { name: "Back to the course" })).toHaveAttribute("href", "/courses/sql-basics");
  });
  it("timeout explains the email will follow", () => {
    withClient(<OrderOutcome order={mk("PENDING")} phase="timeout" />);
    expect(screen.getByTestId("order-processing")).toHaveTextContent(/email/);
  });
});
