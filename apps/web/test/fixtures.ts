import type { Me, UserSummary } from "@open-lms/types";

export const user = (id: string, name = `User ${id}`): UserSummary => ({ id, username: `user-${id}`, displayName: name, avatarUrl: null, headline: null, role: "LEARNER" });

export const me: Me = {
  ...user("me", "Ada Lovelace"),
  email: "ada@example.org",
  status: "ACTIVE",
  suspendedUntil: null,
  emailVerified: true,
  totpEnabled: false,
  bio: null,
  website: null,
  certificateName: null,
  preferredCurrency: null,
  emailPreferences: { LEARNING: true, COMMUNITY: true, BILLING_REMINDERS: true, PRODUCT_UPDATES: true },
  deletionRequestedAt: null,
  canOpenAdmin: false,
  subscription: null,
};
