/** Types for server.mjs so the API's TypeScript tests can import the stubs. */
export interface StubConfig {
  publicUrl: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  stripeWebhookTarget: string;
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpayWebhookSecret: string;
  razorpayWebhookTarget: string;
  evsKeys: string[];
  evsWebhookSecret: string;
  evsWebhookTarget: string;
}

export interface StubDelivery {
  gateway: "stripe" | "razorpay" | "evs";
  type: string;
  target: string;
  status: number;
  at: string;
  error?: string;
}

export interface RunningStubs {
  url: string;
  port: number;
  /** Mutable: point webhooks at a test server after it starts listening. */
  config: StubConfig;
  state: { deliveries: StubDelivery[]; stripe: Record<string, Map<string, Record<string, unknown>>>; razorpay: Record<string, Map<string, Record<string, unknown>>> };
  close(): Promise<void>;
}

export declare function startStubs(options?: { port?: number; host?: string; env?: Record<string, string | undefined>; config?: Partial<StubConfig> }): Promise<RunningStubs>;
export declare function configFromEnv(env?: Record<string, string | undefined>): StubConfig;
export declare function parseForm(raw: string): Record<string, unknown>;
export declare function stripeSignature(body: string, secret: string, t?: number): string;
export declare function razorpayWebhookSignature(body: string, secret: string): string;
export declare function razorpayPaymentSignature(ids: { orderId?: string; subscriptionId?: string; paymentId: string }, keySecret: string): string;
export declare function evsSignature(body: string, secret: string, t?: number): string;
