/**
 * The slice of Razorpay Checkout.js the web app uses (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/).
 * The script defines `window.Razorpay`; the local stub (apps/stubs) defines the same surface.
 */
export {};

declare global {
  interface RazorpayOptions {
    key: string;
    order_id?: string;
    subscription_id?: string;
    amount?: number;
    currency?: string;
    name?: string;
    description?: string;
    image?: string;
    prefill?: { name?: string; email?: string; contact?: string };
    notes?: Record<string, string>;
    theme?: { color?: string };
    handler: (response: {
      razorpay_payment_id: string;
      razorpay_order_id?: string;
      razorpay_subscription_id?: string;
      razorpay_signature: string;
    }) => void;
    modal?: { ondismiss?: () => void; escape?: boolean; confirm_close?: boolean };
  }

  interface RazorpayInstance {
    open(): void;
    close?(): void;
    on?(event: "payment.failed", handler: (response: { error?: { code?: string; description?: string; reason?: string } }) => void): void;
  }

  type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}
