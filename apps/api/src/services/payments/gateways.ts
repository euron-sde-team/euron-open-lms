/** Gateway name to implementation, with a test override. */
import type { PaidGateway, PaymentGateway } from "./gateway";
import { razorpayGateway } from "./razorpay";
import { stripeGateway } from "./stripe";

const overrides = new Map<PaidGateway, PaymentGateway>();

export function gatewayOf(name: PaidGateway): PaymentGateway {
  return overrides.get(name) ?? (name === "STRIPE" ? stripeGateway : razorpayGateway);
}

/** Tests: swap one gateway for a fake (null restores the real client). */
export function setGatewayForTests(name: PaidGateway, gateway: PaymentGateway | null): void {
  if (gateway) overrides.set(name, gateway);
  else overrides.delete(name);
}
