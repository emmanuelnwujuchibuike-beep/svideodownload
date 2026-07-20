import * as Icons from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { RecommendedNext } from "@/features/personal/recommended-next";
import { coursesForSchool, courseMinutes, schoolCurriculumState } from "@/lib/academy/courses";
import { schoolViews } from "@/lib/academy/schools";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL as siteUrl } from "@/lib/site";

/*
 * Static by contract, not by inference — the same rule the rest of the marketing
 * tree follows. Vercel once built `/` dynamic while this repo built it static,
 * silently costing ~800-4700ms of TTFB. This page reads no cookies, no headers and
 * no searchParams; it says so rather than hoping the builder agrees.
 *
 * The whole campus is a typed array, so there is no DB read here at all and the
 * page costs nothing against the 2-second entry budget. ISR still applies via
 * `revalidate` in app/layout.tsx (lowest in the tree wins — set it there).
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Frenzsave Academy — learn to save, create, share and build",
  description:
    "Structured schools covering downloading, editing craft, community, privacy and the developer API. Practical guides, written to be used.",
  alternates: { canonical: "/academy" },
};

export default function AcademyPage() {
  const schools = schoolViews();
  const ready = schools.filter((s) => schoolCurriculumState(s.id) === "ready");
  const upcoming = schools.filter((s) => schoolCurriculumState(s.id) !== "ready");

  /*
    Only schools that can actually be studied become schema.org entities.
    Publishing a `Course` for an unbuilt product would teach search engines and AI
    crawlers a false entity, and that damage propagates into third-party knowledge
    bases and outlives the fix. `productJsonLd` applies the same rule to products.
  */
  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Frenzsave Academy",
    description: metadata.description,
    url: `${siteUrl}/academy`,
    hasPart: ready.flatMap((school) =>
      coursesForSchool(school.id).map((course) => ({
        "@type": "Course",
        name: course.title,
        description: course.description,
        url: `${siteUrl}/academy/${school.slug}`,
        provider: { "@type": "Organization", name: "Frenzsave", url: siteUrl },
      })),
    ),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(collectionLd) }}
      />
      <SiteHeader />
      <main>
        <section className="border-b border-border/60 pb-14 pt-28 sm:pt-32">
          <div className="container max-w-5xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Knowledge Campus
            </p>
            <h1 className="max-w-3xl text-balance text-[2.2rem] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-5xl">
              Frenzsave Academy
            </h1>
            <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              Schools covering how to save and publish media, edit without wrecking it,
              share without oversharing, stay private, and build on the API. Written to
              be used, not skimmed.
            </p>
          </div>
        </section>

        {/*
          The personal plane's payoff, as a client island so this page stays
          statically prerendered — the ranking's input is the reader's completed
          lessons, which live behind a no-store endpoint.
        */}
        <section className="pt-12">
          <div className="container max-w-5xl">
            <RecommendedNext />
          </div>
        </section>

        <section className="py-14 sm:py-16">
          <div className="container max-w-5xl">
            <h2 className="mb-8 text-2xl font-semibold tracking-[-0.02em]">Open now</h2>
            <ul className="grid gap-5 sm:grid-cols-2">
              {ready.map((school) => {
                const courses = coursesForSchool(school.id);
                const minutes = courses.reduce((t, c) => t + courseMinutes(c.slug), 0);
                const lessons = courses.reduce((t, c) => t + c.lessonSlugs.length, 0);
                /* Icons are named in the registry so it stays render-free; resolve
                   here, and fall back rather than crashing on a bad name. */
                const Icon =
                  (Icons[school.icon as keyof typeof Icons] as Icons.LucideIcon) ??
                  Icons.GraduationCap;

                return (
                  <li key={school.id}>
                    <Link
                      href={`/academy/${school.slug}`}
                      className="group flex h-full flex-col rounded-2xl border border-border/70 bg-card p-6 transition hover:border-primary/40 hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Icon aria-hidden className="mb-4 h-6 w-6 text-primary" />
                      <h3 className="text-lg font-semibold tracking-[-0.01em] group-hover:text-primary">
                        {school.name}
                      </h3>
                      <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                        {school.tagline}
                      </p>
                      <p className="mt-4 text-xs font-medium text-muted-foreground">
                        {courses.length} {courses.length === 1 ? "course" : "courses"} ·{" "}
                        {lessons} lessons · {minutes} min
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {upcoming.length > 0 ? (
          <section className="border-t border-border/60 py-14 sm:py-16">
            <div className="container max-w-5xl">
              <h2 className="mb-3 text-2xl font-semibold tracking-[-0.02em]">In development</h2>
              <p className="mb-8 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {/*
                  Stated plainly rather than dressed up. These schools teach products
                  that are not built yet, so writing their lessons would mean
                  documenting software that does not exist — which would mislead
                  readers and poison the assistant that answers from this corpus.
                */}
                These schools open as the products they teach become available. We would
                rather show you the shape of the campus than write guides for software
                you cannot use yet.
              </p>
              <ul className="grid gap-4 sm:grid-cols-3">
                {upcoming.map((school) => {
                  const Icon =
                    (Icons[school.icon as keyof typeof Icons] as Icons.LucideIcon) ??
                    Icons.GraduationCap;
                  const state = schoolCurriculumState(school.id);

                  return (
                    <li
                      key={school.id}
                      className="rounded-2xl border border-dashed border-border/70 p-5"
                    >
                      <Icon aria-hidden className="mb-3 h-5 w-5 text-muted-foreground" />
                      <h3 className="text-sm font-semibold">{school.name}</h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                        {school.tagline}
                      </p>
                      <p className="mt-3 text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        {state === "in-progress" ? "Lessons in progress" : "Planned"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}
