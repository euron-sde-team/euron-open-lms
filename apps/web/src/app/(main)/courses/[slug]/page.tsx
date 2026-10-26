import type { Metadata } from "next";
import type { AcademyMeta, CourseDetail } from "@open-lms/types";
import { CoursePage } from "@/components/course/course-page";
import { jsonLd, publicOrigin, serverGet } from "@/lib/server-api";

type Props = { params: Promise<{ slug: string }> };

const enc = encodeURIComponent;

/** Plain text for meta descriptions: no tags, collapsed space, about 160 characters. */
function plain(html: string, max = 160): string {
  const t = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const course = await serverGet<CourseDetail>(`/catalog/courses/${enc(slug)}`);
  if (!course) return { title: "Course", robots: { index: false } };
  const description = course.subtitle || plain(course.descriptionHtml) || undefined;
  const url = `${await publicOrigin()}/courses/${enc(course.slug)}`;
  return {
    title: course.title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", title: course.title, description, url, images: course.coverUrl ? [{ url: course.coverUrl }] : undefined },
    twitter: { card: course.coverUrl ? "summary_large_image" : "summary", title: course.title, description },
  };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const [course, meta, origin] = await Promise.all([serverGet<CourseDetail>(`/catalog/courses/${enc(slug)}`), serverGet<AcademyMeta>("/meta", 600), publicOrigin()]);
  const ld = course ? courseJsonLd(course, meta, origin) : null;
  return (
    <>
      {ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} /> : null}
      <CoursePage slug={slug} />
    </>
  );
}

/** schema.org Course, with the price as an Offer when the course is sold. */
function courseJsonLd(c: CourseDetail, meta: AcademyMeta | null, origin: string) {
  const url = `${origin}/courses/${enc(c.slug)}`;
  const provider = { "@type": "Organization", name: meta?.academyName || "Academy", sameAs: origin };
  const price = c.access.state === "SIGNED_OUT" ? c.access.price : c.price;
  const exp = (cur: string) => new Intl.NumberFormat("en", { style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits ?? 2;
  const offers =
    c.accessMode === "FREE"
      ? { "@type": "Offer", price: 0, priceCurrency: meta?.defaultCurrency ?? "USD", category: "Free", availability: "https://schema.org/InStock", url }
      : price
        ? { "@type": "Offer", price: (price.amountMinor / 10 ** exp(price.currency)).toFixed(exp(price.currency)), priceCurrency: price.currency, category: "Paid", availability: "https://schema.org/InStock", url }
        : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "Course",
    name: c.title,
    description: c.subtitle || plain(c.descriptionHtml, 500),
    url,
    image: c.coverUrl ?? undefined,
    inLanguage: c.language,
    provider,
    instructor: c.instructors.map((i) => ({ "@type": "Person", name: i.displayName, url: `${origin}/instructors/${enc(i.username)}` })),
    educationalLevel: c.level,
    teaches: c.outcomes.length ? c.outcomes : undefined,
    coursePrerequisites: c.prerequisites.length ? c.prerequisites : undefined,
    aggregateRating: c.rating && c.rating.count > 0 ? { "@type": "AggregateRating", ratingValue: c.rating.average.toFixed(1), ratingCount: c.rating.count, bestRating: 5 } : undefined,
    offers,
    hasCourseInstance: { "@type": "CourseInstance", courseMode: "online", courseWorkload: c.durationSeconds ? `PT${Math.max(1, Math.round(c.durationSeconds / 60))}M` : undefined },
  };
}
