import { Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { CourseCheck } from "@/features/academy/course-check";
import { assessmentQuestionCount } from "@/lib/academy/assessments";
import { courseLessons, courseMinutes, coursesForSchool } from "@/lib/academy/courses";
import { SCHOOLS, getSchoolBySlug, isTeachable } from "@/lib/academy/schools";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL as siteUrl } from "@/lib/site";

export const dynamic = "force-static";

/**
 * A school homepage — its curriculum, in teaching order.
 *
 * Only teachable schools are generated. A planned school has no page at all
 * rather than a page apologising for itself: the campus index already presents it
 * honestly, and a thin "coming soon" route would be a real URL in the sitemap
 * with nothing on it, which is exactly the thin-content pattern that costs
 * topical authority.
 *
 * Lessons link to `/learn/[slug]`, the existing lesson route. The Academy is a
 * new VIEW over that corpus, not a second copy of it — so there is one canonical
 * URL per lesson and no duplicate content.
 */
export function generateStaticParams() {
  return SCHOOLS.filter(isTeachable).map((s) => ({ school: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ school: string }>;
}): Promise<Metadata> {
  const { school: slug } = await params;
  const school = getSchoolBySlug(slug);
  if (!school) return {};

  return {
    title: `${school.name} — Frenzsave Academy`,
    description: school.summary,
    alternates: { canonical: `/academy/${school.slug}` },
  };
}

export default async function SchoolPage({
  params,
}: {
  params: Promise<{ school: string }>;
}) {
  const { school: slug } = await params;
  const school = getSchoolBySlug(slug);
  if (!school || !isTeachable(school)) notFound();

  const courses = coursesForSchool(school.id);
  const url = `${siteUrl}/academy/${school.slug}`;

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Academy", item: `${siteUrl}/academy` },
      { "@type": "ListItem", position: 2, name: school.name, item: url },
    ],
  };

  const courseLd = courses.map((course) => ({
    "@context": "https://schema.org",
    "@type": "Course",
    name: course.title,
    description: course.description,
    url,
    provider: { "@type": "Organization", name: "Frenzsave", url: siteUrl },
    teaches: course.outcomes,
  }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd([breadcrumbLd, ...courseLd]) }}
      />
      <SiteHeader />
      <main>
        <section className="border-b border-border/60 pb-12 pt-28 sm:pt-32">
          <div className="container max-w-4xl">
            {/* A real landmark, not decorative text — breadcrumbs are navigation. */}
            <nav aria-label="Breadcrumb" className="mb-6">
              <ol className="flex items-center gap-2 text-sm text-muted-foreground">
                <li>
                  <Link href="/academy" className="transition hover:text-foreground">
                    Academy
                  </Link>
                </li>
                <li aria-hidden>/</li>
                <li aria-current="page" className="text-foreground">
                  {school.name}
                </li>
              </ol>
            </nav>
            <h1 className="text-balance text-[2rem] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
              {school.name}
            </h1>
            <p className="mt-4 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              {school.summary}
            </p>
          </div>
        </section>

        <section className="py-12 sm:py-14">
          <div className="container max-w-4xl">
            <ol className="space-y-10">
              {courses.map((course) => {
                const lessons = courseLessons(course.slug);

                return (
                  <li key={course.slug}>
                    <article>
                      <header>
                        <h2 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
                          {course.title}
                        </h2>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          {course.description}
                        </p>
                        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Clock aria-hidden className="h-3.5 w-3.5" />
                          {courseMinutes(course.slug)} min · {lessons.length} lessons
                        </p>
                      </header>

                      <h3 className="mt-6 text-sm font-semibold">What you will be able to do</h3>
                      <ul className="mt-2 space-y-1.5">
                        {course.outcomes.map((outcome) => (
                          <li
                            key={outcome}
                            className="flex gap-2 text-sm leading-relaxed text-muted-foreground"
                          >
                            <span aria-hidden className="text-primary">
                              —
                            </span>
                            {outcome}
                          </li>
                        ))}
                      </ul>

                      <ol className="mt-6 space-y-3">
                        {lessons.map((lesson, i) => (
                          <li key={lesson!.slug}>
                            <Link
                              href={`/learn/${lesson!.slug}`}
                              className="group flex items-start gap-4 rounded-xl border border-border/70 bg-card p-4 transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              <span
                                aria-hidden
                                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold"
                              >
                                {i + 1}
                              </span>
                              <span className="min-w-0">
                                <span className="block font-medium group-hover:text-primary">
                                  {lesson!.title}
                                </span>
                                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                                  {lesson!.description}
                                </span>
                                <span className="mt-1.5 block text-xs text-muted-foreground">
                                  {lesson!.minutes} min read
                                </span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ol>

                      {/* The count is resolved HERE, on the server, so the
                          client never imports the question corpus just to
                          learn how many questions there are. Renders nothing
                          when the course has no check written yet. */}
                      <CourseCheck
                        courseSlug={course.slug}
                        questionCount={assessmentQuestionCount(course.slug)}
                      />
                    </article>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
