import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@open-lms/api-client";
import type { CheckoutHandoff, CheckoutQuote, Order } from "@open-lms/types";
import {
  billingFor,
  checkoutProblem,
  checkoutUrl,
  clearIdempotencyKey,
  couponView,
  ensureIdempotencyKey,
  guessCountry,
  idempotencyKeyFor,
  loadScriptOnce,
  parseCheckoutSearch,
  payLabel,
  recurringNote,
  requestFingerprint,
  runHandoff,
  taxLineLabel,
  type HandoffDeps,
  type KeyStore,
} from "@/lib/checkout";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });

function quote(over: Partial<CheckoutQuote> = {}): CheckoutQuote {
  return {
    currency: "USD",
    lines: [{ type: "COURSE", id: "c1", title: "SQL basics", unit: usd(5000), discount: usd(0), tax: usd(0), total: usd(5000) }],
    subtotal: usd(5000),
    discount: usd(0),
    tax: usd(0),
    total: usd(5000),
    taxLabel: null,
    taxMode: "EXCLUSIVE",
    coupon: null,
    couponError: null,
    gateway: "STRIPE",
    kind: "ONE_TIME",
    recurring: null,
    alreadyOwned: false,
    ...over,
  };
}

function memStore(): KeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe("checkout URL", () => {
  it("parses a course link and normalises the currency", () => {
    expect(parseCheckoutSearch(new URLSearchParams("type=course&id=c1&currency=inr"))).toEqual({ item: { type: "COURSE", id: "c1" }, currency: "INR" });
  });
  it("defaults a plan to monthly and keeps a yearly interval", () => {
    expect(parseCheckoutSearch(new URLSearchParams("type=PLAN&id=p1"))?.item).toEqual({ type: "PLAN", id: "p1", interval: "MONTH" });
    expect(parseCheckoutSearch(new URLSearchParams("type=PLAN&id=p1&interval=YEAR"))?.item.interval).toBe("YEAR");
  });
  it("rejects broken links", () => {
    expect(parseCheckoutSearch(new URLSearchParams("type=BOOK&id=x"))).toBeNull();
    expect(parseCheckoutSearch(new URLSearchParams("type=COURSE"))).toBeNull();
  });
  it("round-trips through checkoutUrl", () => {
    const url = checkoutUrl({ type: "PLAN", id: "p1", interval: "YEAR" }, "USD");
    expect(parseCheckoutSearch(new URL(url, "http://x").searchParams)).toEqual({ item: { type: "PLAN", id: "p1", interval: "YEAR" }, currency: "USD" });
  });
});

describe("idempotency key", () => {
  const item = { type: "COURSE" as const, id: "c1" };
  const req = { item, currency: "USD", billing: { name: "Ada", country: "GB" } };

  it("makes one key per page view and a reload reuses it", () => {
    const store = memStore();
    const gen = vi.fn().mockReturnValueOnce("k1").mockReturnValueOnce("k2");
    expect(ensureIdempotencyKey(item, store, gen)).toBe("k1");
    expect(ensureIdempotencyKey(item, store, gen)).toBe("k1");
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it("the Pay click uses that key, and a retried click with the same request gets it again", () => {
    const store = memStore();
    ensureIdempotencyKey(item, store, () => "k1");
    const fp = requestFingerprint(req);
    expect(idempotencyKeyFor(item, fp, store, () => "new")).toBe("k1");
    expect(idempotencyKeyFor(item, fp, store, () => "new")).toBe("k1");
  });

  it("a changed request (coupon, currency, country) gets a fresh key", () => {
    const store = memStore();
    ensureIdempotencyKey(item, store, () => "k1");
    idempotencyKeyFor(item, requestFingerprint(req), store);
    const withCoupon = requestFingerprint({ ...req, couponCode: "SAVE20" });
    expect(idempotencyKeyFor(item, withCoupon, store, () => "k2")).toBe("k2");
    expect(idempotencyKeyFor(item, withCoupon, store, () => "k3")).toBe("k2");
  });

  it("keys are per item and can be cleared", () => {
    const store = memStore();
    ensureIdempotencyKey(item, store, () => "a");
    ensureIdempotencyKey({ type: "PLAN", id: "p", interval: "YEAR" }, store, () => "b");
    expect(store.map.size).toBe(2);
    clearIdempotencyKey(item, store);
    expect(ensureIdempotencyKey(item, store, () => "c")).toBe("c");
  });

  it("survives corrupt storage", () => {
    const store = memStore();
    store.setItem("lms:checkout-key:COURSE:c1:-", "{not json");
    expect(ensureIdempotencyKey(item, store, () => "fresh")).toBe("fresh");
  });
});

describe("coupon view", () => {
  it("is quiet until a code is asked for", () => {
    expect(couponView(quote(), null)).toEqual({ state: "none" });
  });
  it("shows an applied percent coupon as CODE · 20% off", () => {
    const q = quote({ discount: usd(1000), coupon: { code: "SAVE20", description: null, kind: "PERCENT", percentOff: 20, amountOff: null } });
    expect(couponView(q, "SAVE20")).toEqual({ state: "applied", code: "SAVE20", label: "SAVE20 · 20% off" });
  });
  it("shows a fixed coupon with its amount", () => {
    const q = quote({ discount: usd(500), coupon: { code: "FIVE", description: null, kind: "FIXED", percentOff: null, amountOff: usd(500) } });
    expect(couponView(q, "FIVE")).toMatchObject({ state: "applied", label: expect.stringMatching(/^FIVE · \$5\.00 off$/) });
  });
  it.each([
    ["NOT_FOUND", /could not find/],
    ["EXPIRED", /expired/],
    ["EXHAUSTED", /used up/],
    ["CURRENCY_MISMATCH", /another currency/],
    ["ALREADY_USED", /already used/],
  ] as const)("explains %s", (code, copy) => {
    const v = couponView(quote({ couponError: code }), "BAD");
    expect(v.state).toBe("error");
    expect(v.state === "error" && v.message).toMatch(copy);
  });
});

describe("summary copy", () => {
  it("reads the tax rate back from the amounts", () => {
    expect(taxLineLabel(quote({ subtotal: usd(10000), discount: usd(2000), tax: usd(1440), total: usd(9440), taxLabel: "GST" }))).toBe("GST (18%)");
    expect(taxLineLabel(quote({ subtotal: usd(12000), tax: usd(2000), total: usd(12000), taxLabel: "VAT", taxMode: "INCLUSIVE" }))).toBe("VAT (20%, included)");
    expect(taxLineLabel(quote())).toBeNull();
  });
  it("labels the button by what happens", () => {
    expect(payLabel(quote())).toBe("Pay $50.00");
    expect(payLabel(quote({ recurring: { price: usd(2000), interval: "MONTH", trialDays: 7 }, total: usd(0) }))).toBe("Start free trial");
    expect(payLabel(quote({ gateway: "FREE", total: usd(0) }))).toBe("Get access");
  });
  it("explains renewals", () => {
    expect(recurringNote(quote())).toBeNull();
    expect(recurringNote(quote({ recurring: { price: usd(2000), interval: "MONTH", trialDays: 14 } }))).toMatch(/Free for 14 days, then \$20\.00 a month/);
    expect(recurringNote(quote({ total: usd(1000), recurring: { price: usd(2000), interval: "YEAR", trialDays: 0 } }))).toMatch(/^Then \$20\.00 a year/);
  });
  it("needs a name and a country for billing", () => {
    expect(billingFor({ name: " Ada ", country: "", taxId: "" })).toBeUndefined();
    expect(billingFor({ name: " Ada ", country: "IN", taxId: " 22AAAAA0000A1Z5 " })).toEqual({ name: "Ada", country: "IN", taxId: "22AAAAA0000A1Z5" });
  });
  it("guesses the country from the browser language", () => {
    expect(guessCountry(null, ["en-IN", "en"])).toBe("IN");
    expect(guessCountry(null, ["fr"])).toBe("");
    // Paying in a single-country currency wins over the browser language.
    expect(guessCountry("INR", ["en-US"])).toBe("IN");
    expect(guessCountry("USD", ["en-GB"])).toBe("GB");
  });
});

describe("checkout problems", () => {
  const err = (code: string) => new ApiError({ status: 409, code, message: "x" });
  it("sends owners to My learning and subscribers to their subscription", () => {
    expect(checkoutProblem(err("ALREADY_OWNED"))?.link?.href).toBe("/my-learning");
    expect(checkoutProblem("ALREADY_OWNED")?.link?.href).toBe("/my-learning");
    expect(checkoutProblem(err("SUBSCRIPTION_EXISTS"))?.link?.href).toBe("/account/subscription");
  });
  it("offers a currency switch when payments are not configured", () => {
    const p = checkoutProblem(err("PAYMENT_NOT_CONFIGURED"), { currency: "EUR" });
    expect(p).toMatchObject({ currencyFix: true });
    expect(p?.body).toMatch(/EUR/);
    expect(checkoutProblem(err("CURRENCY_NOT_PAYABLE"))?.currencyFix).toBe(true);
  });
  it("leaves unknown errors to the generic copy", () => {
    expect(checkoutProblem(err("SERVER_ERROR"))).toBeNull();
    expect(checkoutProblem(new Error("x"))).toBeNull();
  });
});

describe("handoff", () => {
  const paidOrder = { id: "o1" } as Order;
  function deps(over: Partial<HandoffDeps> = {}): HandoffDeps {
    return {
      assign: vi.fn(),
      navigate: vi.fn(),
      loadScript: vi.fn().mockResolvedValue(undefined),
      getRazorpay: () => undefined,
      confirm: vi.fn().mockResolvedValue(paidOrder),
      onDismiss: vi.fn(),
      onFailed: vi.fn(),
      onConfirmError: vi.fn(),
      ...over,
    };
  }

  it("REDIRECT sends the browser to the hosted page", async () => {
    const d = deps();
    await runHandoff({ type: "REDIRECT", orderId: "o1", orderNumber: "ORD-1", url: "https://pay.example/s/1" }, d);
    expect(d.assign).toHaveBeenCalledWith("https://pay.example/s/1");
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it("FULFILLED goes straight to the order page", async () => {
    const d = deps();
    await runHandoff({ type: "FULFILLED", orderId: "o 1", orderNumber: "ORD-1" }, d);
    expect(d.navigate).toHaveBeenCalledWith("/checkout/orders/o%201");
    expect(d.loadScript).not.toHaveBeenCalled();
  });

  const modal: CheckoutHandoff = {
    type: "RAZORPAY_MODAL",
    orderId: "o1",
    orderNumber: "ORD-1",
    keyId: "rzp_test",
    scriptUrl: "http://stub/checkout.js",
    razorpayOrderId: "order_9",
    subscriptionId: null,
    amountMinor: 49900,
    currency: "INR",
    name: "Academy",
    description: "SQL basics",
    prefill: { name: "Ada", email: "ada@example.org" },
  };

  function fakeRazorpay() {
    const instances: { options: RazorpayOptions; open: ReturnType<typeof vi.fn>; failed?: (r: { error?: { description?: string } }) => void }[] = [];
    class FakeRazorpay {
      options: RazorpayOptions;
      open = vi.fn();
      constructor(options: RazorpayOptions) {
        this.options = options;
        instances.push(this as never);
      }
      on(_event: string, fn: (r: { error?: { description?: string } }) => void) {
        (this as unknown as { failed: typeof fn }).failed = fn;
      }
    }
    return { Ctor: FakeRazorpay as unknown as RazorpayConstructor, instances };
  }

  it("RAZORPAY_MODAL loads the script, opens the modal with the order, and confirms on success", async () => {
    const { Ctor, instances } = fakeRazorpay();
    const d = deps({ getRazorpay: () => Ctor });
    await runHandoff(modal, d);
    expect(d.loadScript).toHaveBeenCalledWith("http://stub/checkout.js");
    expect(instances).toHaveLength(1);
    const rz = instances[0]!;
    expect(rz.open).toHaveBeenCalled();
    expect(rz.options).toMatchObject({ key: "rzp_test", order_id: "order_9", amount: 49900, currency: "INR", prefill: { email: "ada@example.org" } });
    rz.options.handler({ razorpay_payment_id: "pay_1", razorpay_order_id: "order_9", razorpay_signature: "sig" });
    await vi.waitFor(() => expect(d.navigate).toHaveBeenCalledWith("/checkout/orders/o1"));
    expect(d.confirm).toHaveBeenCalledWith({ orderId: "o1", razorpay_payment_id: "pay_1", razorpay_order_id: "order_9", razorpay_signature: "sig" });
  });

  it("uses subscription_id for plans and reports dismiss and failure", async () => {
    const { Ctor, instances } = fakeRazorpay();
    const d = deps({ getRazorpay: () => Ctor });
    await runHandoff({ ...modal, razorpayOrderId: null, subscriptionId: "sub_1" }, d);
    const rz = instances[0]!;
    expect(rz.options.subscription_id).toBe("sub_1");
    expect(rz.options.order_id).toBeUndefined();
    rz.options.modal?.ondismiss?.();
    expect(d.onDismiss).toHaveBeenCalled();
    rz.failed?.({ error: { description: "Card declined." } });
    expect(d.onFailed).toHaveBeenCalledWith("Card declined.");
  });

  it("a failed confirm is handed back with the order id", async () => {
    const { Ctor, instances } = fakeRazorpay();
    const boom = new ApiError({ status: 400, code: "PAYMENT_NOT_VERIFIED", message: "x" });
    const d = deps({ getRazorpay: () => Ctor, confirm: vi.fn().mockRejectedValue(boom) });
    await runHandoff(modal, d);
    instances[0]!.options.handler({ razorpay_payment_id: "p", razorpay_signature: "s" });
    await vi.waitFor(() => expect(d.onConfirmError).toHaveBeenCalledWith(boom, "o1"));
  });

  it("throws a readable error when the script did not define Razorpay", async () => {
    await expect(runHandoff(modal, deps())).rejects.toThrow(/could not load/);
  });

  it("loads a script tag only once per URL", async () => {
    const append = vi.spyOn(document.head, "appendChild");
    const a = loadScriptOnce("http://stub/once.js");
    const b = loadScriptOnce("http://stub/once.js");
    expect(a).toBe(b);
    const tag = append.mock.calls[0]![0] as HTMLScriptElement;
    tag.onload?.(new Event("load"));
    await a;
    expect(append).toHaveBeenCalledTimes(1);
    append.mockRestore();
  });
});
