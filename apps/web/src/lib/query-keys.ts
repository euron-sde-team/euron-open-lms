/** Every React Query key in one place, so cache surgery (optimistic updates, invalidation) finds them. */
type F = Record<string, unknown>;

export const qk = {
  me: ["me"] as const,
  meta: ["meta"] as const,
  counts: ["counts"] as const,
  notifications: (unread: boolean) => ["notifications", unread] as const,
  notificationsAll: ["notifications"] as const,
  sessions: ["sessions"] as const,

  // Catalog
  catalog: (f: F) => ["catalog", f] as const,
  catalogAll: ["catalog"] as const,
  facets: (f: F) => ["facets", f] as const,
  featured: (currency: string) => ["featured", currency] as const,
  categories: ["categories"] as const,
  course: (slug: string, currency?: string) => ["course", slug, currency ?? ""] as const,
  courseAll: ["course"] as const,
  courseReviews: (slug: string, f?: F) => ["course-reviews", slug, f ?? {}] as const,
  bundles: ["bundles"] as const,
  bundle: (slug: string, currency?: string) => ["bundle", slug, currency ?? ""] as const,
  instructor: (username: string) => ["instructor", username] as const,
  plans: (currency: string) => ["plans", currency] as const,

  // Learning
  classroom: (slug: string) => ["classroom", slug] as const,
  classroomAll: ["classroom"] as const,
  item: (id: string) => ["item", id] as const,
  playback: (id: string) => ["playback", id] as const,
  itemAll: ["item"] as const,
  notes: (slug: string, itemId?: string) => ["notes", slug, itemId ?? ""] as const,
  notesAll: ["notes"] as const,
  myLearning: (status: string) => ["my-learning", status] as const,
  myLearningAll: ["my-learning"] as const,
  mySummary: ["my-summary"] as const,
  mySaved: ["my-saved"] as const,
  myBookmarks: ["my-bookmarks"] as const,
  myCertificates: ["my-certificates"] as const,
  certificate: (serial: string) => ["certificate", serial] as const,
  attempt: (id: string) => ["attempt", id] as const,
  submissions: (itemId: string) => ["submissions", itemId] as const,
  reviewEligibility: (courseId: string) => ["review-eligibility", courseId] as const,
  questions: (courseId: string, f?: F) => ["questions", courseId, f ?? {}] as const,
  questionsAll: ["questions"] as const,
  thread: (id: string) => ["thread", id] as const,

  // Billing
  quote: (f: F) => ["quote", f] as const,
  order: (id: string) => ["order", id] as const,
  orders: ["orders"] as const,
  invoices: ["invoices"] as const,
  subscription: ["subscription"] as const,

  // Admin
  admin: {
    session: ["admin", "session"] as const,
    all: ["admin"] as const,
    list: (area: string, f?: F) => ["admin", area, "list", f ?? {}] as const,
    detail: (area: string, id: string) => ["admin", area, "detail", id] as const,
    area: (area: string) => ["admin", area] as const,
  },
};
