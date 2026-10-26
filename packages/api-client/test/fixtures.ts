import type { AuthResult, Me } from "@open-lms/types";

export const me: Me = {
  id: "01J00000000000000000000001",
  username: "ada",
  displayName: "Ada L",
  avatarUrl: null,
  headline: null,
  role: "LEARNER",
  email: "ada@example.org",
  status: "ACTIVE",
  emailVerified: true,
  totpEnabled: false,
  suspendedUntil: null,
  bio: null,
  website: null,
  certificateName: null,
  preferredCurrency: null,
  emailPreferences: { LEARNING: true, COMMUNITY: true, BILLING_REMINDERS: true, PRODUCT_UPDATES: true },
  pushPreferences: { LEARNING: true, COMMUNITY: true, BILLING_REMINDERS: true, PRODUCT_UPDATES: false },
  deletionRequestedAt: null,
  canOpenAdmin: false,
  subscription: null,
};

export const authResult = (token: string): AuthResult => ({ accessToken: token, expiresIn: 900, user: me });

export function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
}
