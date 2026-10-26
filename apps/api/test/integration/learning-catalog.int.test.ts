import type { CatalogFacets, CourseCard, CourseDetail, Page } from "@open-lms/types";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { anon, as, createCourse, createPlan, createUser, enroll, subscribe, type TestCourse, type TestUser } from "./harness";
import { addPrice, setSettings, token, updateCourse } from "./learning-helpers";

/**
 * Four published courses and one draft, all titled with a unique word so catalog
 * queries (`q=<word>`) only see them:
 *   free  FREE, BEGINNER, en, not in plans
 *   pro   PAID USD 4900 / INR 300000, INTERMEDIATE, en, category, rated
 *   hindi PAID USD 1900, ADVANCED, hi
 *   plan  SUBSCRIPTION_ONLY, BEGINNER, en
 *   draft PAID, never listed
 */
describe("learning: catalog", () => {
  const word = token();
  let owner: TestUser;
  let free: TestCourse;
  let pro: TestCourse;
  let hindi: TestCourse;
  let plan: TestCourse;
  let draft: TestCourse;
  let categorySlug: string;

  beforeAll(async () => {
    owner = await createUser({ role: "INSTRUCTOR" });
    free = await createCourse({ owner, accessMode: "FREE", includedInSubscription: false });
    pro = await createCourse({ owner, accessMode: "PAID", price: { USD: 4900, INR: 300000 } });
    hindi = await createCourse({ owner, accessMode: "PAID", price: { USD: 1900 } });
    plan = await createCourse({ owner, accessMode: "SUBSCRIPTION_ONLY" });
    draft = await createCourse({ owner, status: "DRAFT" });
    await updateCourse(free.id, { title: `${word} free basics`, level: "BEGINNER", enrollment_count: 30, published_at: new Date(Date.now() - 4000) });
    await updateCourse(pro.id, { title: `${word} professional track`, level: "INTERMEDIATE", enrollment_count: 20, rating_count: 3, rating_sum: 13, published_at: new Date(Date.now() - 3000) });
    await updateCourse(hindi.id, { title: `${word} hindi edition`, level: "ADVANCED", language: "hi", enrollment_count: 20, published_at: new Date(Date.now() - 2000) });
    await updateCourse(plan.id, { title: `${word} plan only`, level: "BEGINNER", enrollment_count: 5, published_at: new Date(Date.now() - 1000) });
    await updateCourse(draft.id, { title: `${word} secret draft` });
    categorySlug = `cat-${word}`;
    const categoryId = newId();
    await db.insertInto("categories").values({ id: categoryId, slug: categorySlug, name: `Category ${word}` }).execute();
    await db.insertInto("course_categories").values({ course_id: pro.id, category_id: categoryId }).execute();
    await setSettings({ currencies: { enabled: ["USD", "INR"], default: "USD" } });
  });

  afterAll(async () => {
    await setSettings({ currencies: { enabled: ["USD"], default: "USD" } });
  });

  const list = async (query: string, user: TestUser | null = null) => (await as(user).get(`/api/catalog/courses?q=${word}${query}`).expect(200)).body as Page<CourseCard>;
  const ids = (p: Page<CourseCard>) => p.items.map((c) => c.id);

  test("search lists published courses only, with card details", async () => {
    const page = await list("");
    expect(new Set(ids(page))).toEqual(new Set([free.id, pro.id, hindi.id, plan.id]));
    const card = page.items.find((c) => c.id === pro.id)!;
    expect(card).toMatchObject({ accessMode: "PAID", price: { amountMinor: 4900, currency: "USD" }, rating: { average: 4.3, count: 3 }, viewer: null, categories: [{ slug: categorySlug }] });
    expect(card.instructors.map((i) => i.id)).toEqual([owner.id]);
    expect(page.items.find((c) => c.id === free.id)).toMatchObject({ price: null, rating: null });
    expect(page.items.find((c) => c.id === plan.id)!.price).toBeNull();
  });

  test("substring matches through the title trigram", async () => {
    const page = (await anon().get(`/api/catalog/courses?q=${word.slice(2)}`).expect(200)).body as Page<CourseCard>;
    expect(ids(page)).toEqual(expect.arrayContaining([free.id, pro.id]));
  });

  test("filters: level, language, category and price", async () => {
    expect(new Set(ids(await list("&level=BEGINNER")))).toEqual(new Set([free.id, plan.id]));
    expect(ids(await list("&language=hi"))).toEqual([hindi.id]);
    expect(ids(await list(`&category=${categorySlug}`))).toEqual([pro.id]);
    expect(ids(await list("&price=free"))).toEqual([free.id]);
    expect(new Set(ids(await list("&price=paid")))).toEqual(new Set([pro.id, hindi.id]));
    expect(new Set(ids(await list("&price=subscription")))).toEqual(new Set([pro.id, hindi.id, plan.id]));
  });

  test("sorts: popular, newest, rating and prices (unpriced last)", async () => {
    // popular: 30, then the two 20s by id descending, then 5.
    const tie = [pro.id, hindi.id].sort().reverse();
    expect(ids(await list("&sort=popular"))).toEqual([free.id, ...tie, plan.id]);
    expect(ids(await list("&sort=newest"))).toEqual([plan.id, hindi.id, pro.id, free.id]);
    expect(ids(await list("&sort=rating"))[0]).toBe(pro.id);
    const asc = ids(await list("&sort=price_asc"));
    expect(asc.slice(0, 2)).toEqual([hindi.id, pro.id]);
    expect(new Set(asc.slice(2))).toEqual(new Set([free.id, plan.id]));
    const desc = ids(await list("&sort=price_desc"));
    expect(desc.slice(0, 2)).toEqual([pro.id, hindi.id]);
    // INR: only `pro` has a price, so it leads either way.
    expect(ids(await list("&sort=price_asc&currency=INR"))[0]).toBe(pro.id);
  });

  test("keyset pagination walks every sort without gaps or repeats", async () => {
    for (const sort of ["popular", "newest", "rating", "price_asc", "price_desc", "relevance"]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page = (await anon().get(`/api/catalog/courses?q=${word}&sort=${sort}&limit=1${cursor ? `&cursor=${cursor}` : ""}`).expect(200)).body as Page<CourseCard>;
        seen.push(...ids(page));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen.length).toBe(4);
      expect(new Set(seen).size).toBe(4);
    }
    await anon().get("/api/catalog/courses?cursor=not-a-cursor").expect(400);
    await anon().get("/api/catalog/courses?bogus=1").expect(400);
  });

  test("display currency: ?currency= when enabled, else the viewer's preference, else the default", async () => {
    let card = (await list("&currency=INR")).items.find((c) => c.id === pro.id)!;
    expect(card.price).toEqual({ amountMinor: 300000, currency: "INR" });
    expect((await list("&currency=INR")).items.find((c) => c.id === hindi.id)!.price).toBeNull();
    card = (await list("&currency=EUR")).items.find((c) => c.id === pro.id)!;
    expect(card.price?.currency).toBe("USD");
    const indian = await createUser();
    await db.updateTable("users").set({ preferred_currency: "INR" }).where("id", "=", indian.id).execute();
    card = (await list("", indian)).items.find((c) => c.id === pro.id)!;
    expect(card.price?.currency).toBe("INR");
    expect(card.viewer).toEqual({ saved: false, enrolled: false, progressPercent: null });
  });

  test("facets count each dimension ignoring its own filter", async () => {
    const f = (await anon().get(`/api/catalog/facets?q=${word}`).expect(200)).body as CatalogFacets;
    expect(f.levels).toEqual({ BEGINNER: 2, INTERMEDIATE: 1, ADVANCED: 1, ALL_LEVELS: 0 });
    expect(f.price).toEqual({ free: 1, paid: 2, subscription: 3 });
    expect(f.languages).toEqual([{ code: "en", count: 3 }, { code: "hi", count: 1 }]);
    expect(f.categories).toEqual([{ slug: categorySlug, name: `Category ${word}`, count: 1 }]);
    const filtered = (await anon().get(`/api/catalog/facets?q=${word}&level=BEGINNER`).expect(200)).body as CatalogFacets;
    expect(filtered.levels.ADVANCED).toBe(1);
    expect(filtered.price).toEqual({ free: 1, paid: 0, subscription: 1 });
  });

  test("categories and featured shelves", async () => {
    const cats = (await anon().get("/api/catalog/categories").expect(200)).body as { slug: string; courseCount: number }[];
    expect(cats.find((c) => c.slug === categorySlug)?.courseCount).toBe(1);
    await updateCourse(hindi.id, { featured: true });
    const shelves = (await anon().get("/api/catalog/featured").expect(200)).body as Record<string, CourseCard[]>;
    expect(Object.keys(shelves).sort()).toEqual(["featured", "free", "newest", "popular"]);
    expect(shelves.featured.map((c) => c.id)).toContain(hindi.id);
    expect(shelves.free.every((c) => c.accessMode === "FREE")).toBe(true);
  });

  describe("course page access", () => {
    const detail = async (slug: string, user: TestUser | null, status = 200) => (await as(user).get(`/api/catalog/courses/${slug}`).expect(status)).body as CourseDetail;

    test("public curriculum without content, counts and description", async () => {
      const d = await detail(pro.slug, null);
      expect(d.sections[0]!.items.map((i) => i.lectureKind)).toEqual(["VIDEO", "ARTICLE", "VIDEO"]);
      expect(d.counts).toEqual({ lectures: 2, quizzes: 0, assignments: 0, articles: 1, pdfs: 0 });
      expect(d.descriptionHtml).toContain("<p>");
      expect(JSON.stringify(d)).not.toContain("media.example.test");
      expect(JSON.stringify(d)).not.toContain("Some text");
      expect(d.instructors[0]).toMatchObject({ id: owner.id, bio: null });
      expect(d.access).toEqual({ state: "SIGNED_OUT", free: false, price: { amountMinor: 4900, currency: "USD" } });
    });

    test("FREE, PURCHASABLE, SUBSCRIPTION_REQUIRED, UNAVAILABLE and INCLUDED_IN_PLAN", async () => {
      const ada = await createUser();
      await createPlan();
      expect((await detail(free.slug, ada)).access).toEqual({ state: "FREE" });
      expect((await detail(pro.slug, ada)).access).toEqual({ state: "PURCHASABLE", price: { amountMinor: 4900, currency: "USD" }, compareAt: null, subscriptionAlso: true });
      expect((await detail(plan.slug, ada)).access).toEqual({ state: "SUBSCRIPTION_REQUIRED" });
      const orphan = await createCourse({ accessMode: "PAID", includedInSubscription: false, price: {} });
      expect((await detail(orphan.slug, ada)).access).toEqual({ state: "UNAVAILABLE" });
      const subscriber = await createUser();
      const p = await createPlan();
      await subscribe(subscriber, p.id);
      expect((await detail(plan.slug, subscriber)).access).toEqual({ state: "INCLUDED_IN_PLAN" });
    });

    test("ENROLLED and LAPSED (expired, revoked, subscription ended)", async () => {
      const ada = await createUser();
      const enrollmentId = await enroll(ada, pro.id);
      expect((await detail(pro.slug, ada)).access).toMatchObject({ state: "ENROLLED", enrollmentId, progressPercent: 0, resumeItemId: pro.items[0] });
      const late = await createUser();
      await enroll(late, pro.id, { validUntil: new Date(Date.now() - 1000) });
      expect((await detail(pro.slug, late)).access).toEqual({ state: "LAPSED", reason: "EXPIRED", price: { amountMinor: 4900, currency: "USD" } });
      const gone = await createUser();
      await enroll(gone, pro.id, { status: "REVOKED" });
      expect((await detail(pro.slug, gone)).access).toMatchObject({ state: "LAPSED", reason: "REVOKED" });
      const lapsedSub = await createUser();
      await enroll(lapsedSub, plan.id, { source: "SUBSCRIPTION" });
      expect((await detail(plan.slug, lapsedSub)).access).toEqual({ state: "LAPSED", reason: "SUBSCRIPTION_ENDED", price: null });
    });

    test("drafts are 404 except to staff and admins (access STAFF)", async () => {
      await detail(draft.slug, null, 404);
      await detail(draft.slug, await createUser(), 404);
      await detail(draft.slug, await createUser({ role: "INSTRUCTOR" }), 404);
      expect((await detail(draft.slug, owner)).access).toEqual({ state: "STAFF" });
      expect((await detail(draft.slug, await createUser({ role: "ADMIN" }))).access).toEqual({ state: "STAFF" });
      await anon().get("/api/catalog/courses/no-such-course").expect(404);
    });

    test("compare-at prices only when higher", async () => {
      const c = await createCourse({ accessMode: "PAID", price: {} });
      await addPrice("COURSE", c.id, "USD", 1000, 2500);
      expect((await detail(c.slug, null)).compareAt).toEqual({ amountMinor: 2500, currency: "USD" });
    });
  });

  describe("free enrollment and the wishlist", () => {
    test("free enroll is idempotent, even when raced", async () => {
      const ada = await createUser();
      const before = (await db.selectFrom("courses").select("enrollment_count").where("id", "=", free.id).executeTakeFirstOrThrow()).enrollment_count;
      const [a, b] = await Promise.all([as(ada).post(`/api/catalog/courses/${free.slug}/enroll`).send({}), as(ada).post(`/api/catalog/courses/${free.slug}/enroll`).send({})]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.enrollmentId).toBe(b.body.enrollmentId);
      expect(a.body.resumeItemId).toBe(free.items[0]);
      const again = await as(ada).post(`/api/catalog/courses/${free.slug}/enroll`).expect(201);
      expect(again.body.enrollmentId).toBe(a.body.enrollmentId);
      const after = (await db.selectFrom("courses").select("enrollment_count").where("id", "=", free.id).executeTakeFirstOrThrow()).enrollment_count;
      expect(after).toBe(before + 1);
      const row = await db.selectFrom("enrollments").select("source").where("id", "=", a.body.enrollmentId).executeTakeFirstOrThrow();
      expect(row.source).toBe("FREE");
    });

    test("paid, plan-only and draft courses cannot be enrolled for free", async () => {
      const ada = await createUser();
      expect((await as(ada).post(`/api/catalog/courses/${pro.slug}/enroll`).expect(403)).body.code).toBe("NOT_FREE");
      expect((await as(ada).post(`/api/catalog/courses/${plan.slug}/enroll`).expect(403)).body.code).toBe("NOT_FREE");
      await as(ada).post(`/api/catalog/courses/${draft.slug}/enroll`).expect(404);
      await anon().post(`/api/catalog/courses/${free.slug}/enroll`).expect(401);
      await as(ada).post(`/api/catalog/courses/${free.slug}/enroll`).send({ userId: owner.id }).expect(400);
      const suspended = await createUser({ status: "SUSPENDED" });
      expect((await as(suspended).post(`/api/catalog/courses/${free.slug}/enroll`).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    });

    test("save and unsave", async () => {
      const ada = await createUser();
      await as(ada).put(`/api/catalog/courses/${pro.slug}/save`).expect(204);
      await as(ada).put(`/api/catalog/courses/${pro.slug}/save`).expect(204);
      expect((await list("", ada)).items.find((c) => c.id === pro.id)!.viewer?.saved).toBe(true);
      const saved = (await as(ada).get("/api/my/saved").expect(200)).body as Page<CourseCard>;
      expect(saved.items.map((c) => c.id)).toEqual([pro.id]);
      await as(ada).put(`/api/catalog/courses/${draft.slug}/save`).expect(404);
      await as(ada).delete(`/api/catalog/courses/${pro.slug}/save`).expect(204);
      expect(((await as(ada).get("/api/my/saved").expect(200)).body as Page<CourseCard>).items).toEqual([]);
    });
  });

  test("reviews: published only, rating filter, mine flag", async () => {
    const [r1, r2, r3] = [await createUser(), await createUser(), await createUser()];
    await db
      .insertInto("reviews")
      .values([
        { id: newId(), course_id: pro.id, user_id: r1.id, rating: 5, body: "Great", reply: "Thanks", replied_by: owner.id, replied_at: new Date() },
        { id: newId(), course_id: pro.id, user_id: r2.id, rating: 3, body: "Fine" },
        { id: newId(), course_id: pro.id, user_id: r3.id, rating: 1, body: "Spam", status: "HIDDEN" },
      ])
      .execute();
    const all = (await as(r2).get(`/api/catalog/courses/${pro.slug}/reviews`).expect(200)).body;
    expect(all.items.map((r: { rating: number }) => r.rating).sort()).toEqual([3, 5]);
    expect(all.items.find((r: { rating: number }) => r.rating === 3).mine).toBe(true);
    expect(all.items.find((r: { rating: number }) => r.rating === 5).reply).toMatchObject({ body: "Thanks", by: { id: owner.id } });
    const fives = (await anon().get(`/api/catalog/courses/${pro.slug}/reviews?rating=5`).expect(200)).body;
    expect(fives.items).toHaveLength(1);
    const d = (await anon().get(`/api/catalog/courses/${pro.slug}`).expect(200)).body as CourseDetail;
    expect(d.ratingBreakdown).toEqual({ "1": 0, "2": 0, "3": 1, "4": 0, "5": 1 });
    await anon().get(`/api/catalog/courses/${draft.slug}/reviews`).expect(404);
  });

  test("bundles: list, detail, separately, ownership and the course page link", async () => {
    const bundleId = newId();
    const slug = `bundle-${word}`;
    await db.insertInto("bundles").values({ id: bundleId, slug, title: `Bundle ${word}`, description: "Both", status: "ACTIVE" }).execute();
    await db.insertInto("bundle_courses").values([{ bundle_id: bundleId, course_id: pro.id, position: 0 }, { bundle_id: bundleId, course_id: hindi.id, position: 1 }, { bundle_id: bundleId, course_id: draft.id, position: 2 }]).execute();
    await addPrice("BUNDLE", bundleId, "USD", 5000);
    const page = (await anon().get("/api/catalog/bundles?limit=50").expect(200)).body;
    const card = page.items.find((b: { id: string }) => b.id === bundleId);
    expect(card).toMatchObject({ courseCount: 2, price: { amountMinor: 5000, currency: "USD" }, separately: { amountMinor: 6800, currency: "USD" } });
    const ada = await createUser();
    await enroll(ada, pro.id);
    let detail = (await as(ada).get(`/api/catalog/bundles/${slug}`).expect(200)).body;
    expect(detail.courses.map((c: { id: string }) => c.id)).toEqual([pro.id, hindi.id]);
    expect(detail.viewerOwnsAll).toBe(false);
    await enroll(ada, hindi.id);
    detail = (await as(ada).get(`/api/catalog/bundles/${slug}`).expect(200)).body;
    expect(detail.viewerOwnsAll).toBe(true);
    const inr = (await anon().get(`/api/catalog/bundles/${slug}?currency=INR`).expect(200)).body;
    expect(inr).toMatchObject({ price: null, separately: { amountMinor: 300000, currency: "INR" } });
    const course = (await anon().get(`/api/catalog/courses/${pro.slug}`).expect(200)).body as CourseDetail;
    expect(course.bundles.map((b) => b.id)).toContain(bundleId);
    await db.updateTable("bundles").set({ status: "DRAFT" }).where("id", "=", bundleId).execute();
    await anon().get(`/api/catalog/bundles/${slug}`).expect(404);
  });

  test("instructor pages: only people listed on a published course", async () => {
    const res = (await anon().get(`/api/catalog/instructors/${owner.username}`).expect(200)).body;
    expect(res.instructor).toMatchObject({ id: owner.id, username: owner.username, bio: null });
    expect(res.courses.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining([free.id, pro.id]));
    expect(res.courses.map((c: { id: string }) => c.id)).not.toContain(draft.id);
    const learner = await createUser();
    await anon().get(`/api/catalog/instructors/${learner.username}`).expect(404);
    const hidden = await createUser({ role: "INSTRUCTOR" });
    await db.insertInto("course_staff").values({ course_id: pro.id, user_id: hidden.id, role: "EDITOR", listed: false }).execute();
    await anon().get(`/api/catalog/instructors/${hidden.username}`).expect(404);
    await anon().get("/api/catalog/instructors/nobody-here-at-all").expect(404);
  });
});

/**
 * Rating and length over the stored totals, six published courses under their own word:
 *   a  4.5 (9/2)      3600 s   short   BEGINNER
 *   b  4.46 (223/50)  7200 s   medium  BEGINNER   (shows as 4.5, is below it)
 *   c  4.0 (4/1)      21600 s  medium  ADVANCED
 *   d  3.0 (3/1)      21601 s  long    BEGINNER
 *   e  unrated        7199 s   short   ADVANCED
 *   f  2.5 (5/2)      30000 s  long    BEGINNER
 * Enrollment counts give `popular` a fixed order: a, b, c, d, e, f. Lists sort by it unless a
 * test picks another sort.
 */
describe("learning: catalog rating and length filters", () => {
  const word = token();
  const courses: Record<"a" | "b" | "c" | "d" | "e" | "f", TestCourse> = {} as never;

  beforeAll(async () => {
    const rows = {
      a: { rating_sum: 9, rating_count: 2, duration_seconds: 3600, level: "BEGINNER" },
      b: { rating_sum: 223, rating_count: 50, duration_seconds: 7200, level: "BEGINNER" },
      c: { rating_sum: 4, rating_count: 1, duration_seconds: 21600, level: "ADVANCED" },
      d: { rating_sum: 3, rating_count: 1, duration_seconds: 21601, level: "BEGINNER" },
      e: { rating_sum: 0, rating_count: 0, duration_seconds: 7199, level: "ADVANCED" },
      f: { rating_sum: 5, rating_count: 2, duration_seconds: 30000, level: "BEGINNER" },
    } as const;
    let popularity = 60;
    for (const [key, row] of Object.entries(rows) as [keyof typeof rows, (typeof rows)[keyof typeof rows]][]) {
      courses[key] = await createCourse();
      await updateCourse(courses[key].id, { ...row, title: `${word} course ${key}`, enrollment_count: popularity });
      popularity -= 10;
    }
  });

  // Most popular unless the query picks a sort (a search would default to best match, where these titles tie).
  const list = async (query: string) => (await anon().get(`/api/catalog/courses?q=${word}${query}${query.includes("sort=") ? "" : "&sort=popular"}`).expect(200)).body as Page<CourseCard>;
  const keys = (p: Page<CourseCard>) => p.items.map((c) => Object.entries(courses).find(([, v]) => v.id === c.id)?.[0]);
  const walk = async (query: string) => {
    const seen: (string | undefined)[] = [];
    let cursor: string | null = null;
    do {
      const page = await list(`${query}&limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      expect(page.items.length).toBeLessThanOrEqual(1);
      seen.push(...keys(page));
      cursor = page.nextCursor;
    } while (cursor);
    return seen;
  };

  test("minRating keeps rated courses with an exact average at least that", async () => {
    expect(keys(await list("&minRating=4.5"))).toEqual(["a"]);
    expect(keys(await list("&minRating=4"))).toEqual(["a", "b", "c"]);
    expect(keys(await list("&minRating=3.5"))).toEqual(["a", "b", "c"]);
    expect(keys(await list("&minRating=3"))).toEqual(["a", "b", "c", "d"]);
  });

  test("length buckets the total duration at 2 and 6 hours", async () => {
    expect(keys(await list("&length=short"))).toEqual(["a", "e"]);
    expect(keys(await list("&length=medium"))).toEqual(["b", "c"]);
    expect(keys(await list("&length=long"))).toEqual(["d", "f"]);
  });

  test("both compose with each other and with the other filters", async () => {
    expect(keys(await list("&minRating=4&level=BEGINNER"))).toEqual(["a", "b"]);
    expect(keys(await list("&length=long&level=BEGINNER"))).toEqual(["d", "f"]);
    expect(keys(await list("&length=short&level=ADVANCED"))).toEqual(["e"]);
    expect(keys(await list("&minRating=3&length=long"))).toEqual(["d"]);
    expect(keys(await list("&minRating=4.5&length=medium"))).toEqual([]);
  });

  test("keyset pagination walks the filtered results without gaps or repeats", async () => {
    expect(await walk("&minRating=3")).toEqual(["a", "b", "c", "d"]);
    expect(await walk("&minRating=3&sort=rating")).toEqual(["a", "b", "c", "d"]);
    expect(await walk("&length=long&sort=newest")).toHaveLength(2);
    expect(await walk("&minRating=4&length=medium")).toEqual(["b", "c"]);
    expect(await walk("&length=short&level=ADVANCED")).toEqual(["e"]);
  });

  test("facets count rating and length, each ignoring its own filter", async () => {
    const all = (await anon().get(`/api/catalog/facets?q=${word}`).expect(200)).body as CatalogFacets;
    expect(all.rating).toEqual({ "3": 4, "3.5": 3, "4": 3, "4.5": 1 });
    expect(all.length).toEqual({ short: 2, medium: 2, long: 2 });
    const rated = (await anon().get(`/api/catalog/facets?q=${word}&minRating=4`).expect(200)).body as CatalogFacets;
    expect(rated.rating).toEqual(all.rating);
    expect(rated.length).toEqual({ short: 1, medium: 2, long: 0 });
    expect(rated.levels).toEqual({ BEGINNER: 2, INTERMEDIATE: 0, ADVANCED: 1, ALL_LEVELS: 0 });
    const long = (await anon().get(`/api/catalog/facets?q=${word}&length=long`).expect(200)).body as CatalogFacets;
    expect(long.length).toEqual(all.length);
    expect(long.rating).toEqual({ "3": 1, "3.5": 0, "4": 0, "4.5": 0 });
    expect(long.price.paid).toBe(2);
  });

  test("anything else is a 400", async () => {
    for (const bad of ["minRating=5", "minRating=2", "minRating=four", "minRating=", "length=huge", "length=SHORT"]) {
      await anon().get(`/api/catalog/courses?${bad}`).expect(400);
      await anon().get(`/api/catalog/facets?${bad}`).expect(400);
    }
  });
});
