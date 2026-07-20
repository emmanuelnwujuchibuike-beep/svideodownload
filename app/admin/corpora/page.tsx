import { AlertTriangle, BarChart3, BookOpen, CheckCircle2, Globe, Info, Languages } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/layout/site-header";
import { isAdmin } from "@/lib/admin";
import {
  auditCorpora,
  corpusCounts,
  courseHealth,
  localeProgress,
  type FindingSeverity,
} from "@/lib/content/corpora";
import { completionRate, learningEngagement } from "@/lib/content/learning-analytics";
import { createClient } from "@/lib/supabase/server";

/**
 * Corpus operations — the Academy, Help/Trust and glossary corpora at a glance.
 *
 * ── Why this is separate from /admin/content ──────────────────────────────────
 *
 * That page reports on the Living Content Platform's machinery: sync drift,
 * genome integrity, graph integrity. This one reports on the CONTENT — what is
 * published, what is gated, what is orphaned, how far each locale has got. They
 * answer different questions for the same operator, and merging them would
 * produce one page nobody reads to the bottom of.
 *
 * ── An inspection console, deliberately ───────────────────────────────────────
 *
 * The corpora are compiled TypeScript, so nothing here can be edited at runtime.
 * A save button would be a lie. What this provides is the view the code does not:
 * derived state, cross-references, and the checks that are otherwise only run by
 * the test suite — where an operator never sees them.
 *
 * ── Aggregate over the personal plane, never per-user ─────────────────────────
 *
 * The personal plane (0088) knows what individuals read, and an operator needs
 * to know a lesson is orphaned rather than who read it — the screen that shows
 * the second is how that boundary gets crossed by accident.
 *
 * The Engagement section (0089) is the one place this page touches that data,
 * and it does so through a function that cannot return an identity: counts per
 * ITEM, with every bucket below five distinct readers suppressed in SQL. The
 * suppression is in the database rather than here on purpose — a filter in
 * application code is one refactor from being dropped, and by then the rows have
 * already crossed the wire. When the migration is unapplied the section says so
 * instead of failing.
 *
 * `force-dynamic` + `robots: noindex`, matching the rest of /admin: an operator
 * tool, never crawled, explicitly outside the 2-second visitor budget.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Corpus operations",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const SEVERITY_STYLE: Record<FindingSeverity, string> = {
  broken: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
  gap: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  note: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
};

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  broken: "Broken",
  gap: "Gap",
  note: "Note",
};

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4">
      <p className="text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default async function CorpusOpsPage() {
  if (!hasSupabase) redirect("/login");

  // Defense in depth — middleware already guards /admin, matching the sibling pages.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/corpora");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!isAdmin(profile?.role, user.email)) redirect("/");

  const counts = corpusCounts();
  const findings = auditCorpora();
  const locales = localeProgress();
  const courses = courseHealth();
  /*
    Awaited after the admin guard above, never before. The function refuses a
    non-admin itself, but the page should not be issuing the query at all for
    someone it is about to redirect.
  */
  const engagement = await learningEngagement();

  const broken = findings.filter((f) => f.severity === "broken");
  const rest = findings.filter((f) => f.severity !== "broken");

  return (
    <>
      <SiteHeader />
      <main className="container max-w-5xl pb-20 pt-28">
        <header className="mb-10">
          <h1 className="text-3xl font-extrabold tracking-[-0.02em]">Corpus operations</h1>
          <p className="mt-2 text-muted-foreground">
            What the Academy, Help Center, Trust Center and glossary actually contain — and
            what is claimed but unreachable.
          </p>
        </header>

        <section className="mb-12">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Schools" value={`${counts.teachableSchools}/${counts.schools} teachable`} />
            <Stat label="Courses" value={counts.courses} />
            <Stat label="Lessons" value={counts.lessons} />
            <Stat label="Glossary terms" value={counts.terms} />
            <Stat label="Help articles" value={counts.helpArticles} />
            <Stat label="Trust articles" value={counts.trustArticles} />
            <Stat label="Articles total" value={counts.articles} />
            <Stat label="Locales declared" value={locales.length} />
          </div>
        </section>

        {/* Findings — breaks first, because they are the only ones that mean a
            reader is currently hitting something wrong. */}
        <section className="mb-12">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold tracking-[-0.01em]">
            <AlertTriangle aria-hidden className="h-5 w-5 text-amber-500" />
            Findings
          </h2>

          {findings.length === 0 ? (
            <p className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 aria-hidden className="h-4 w-4" />
              Nothing outstanding across any corpus.
            </p>
          ) : (
            <ul className="space-y-3">
              {[...broken, ...rest].map((finding) => (
                <li
                  key={`${finding.area}:${finding.title}`}
                  className="rounded-xl border border-border/70 bg-card p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide ${SEVERITY_STYLE[finding.severity]}`}
                    >
                      {SEVERITY_LABEL[finding.severity]}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {finding.area}
                    </span>
                  </div>
                  <p className="mt-2 font-medium">{finding.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {finding.detail}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Curriculum — declared vs resolvable is the number that matters; they
            should be equal, and a difference is a course promising a lesson that
            does not exist. */}
        <section className="mb-12">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold tracking-[-0.01em]">
            <BookOpen aria-hidden className="h-5 w-5 text-primary" />
            Curriculum
          </h2>
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Course</th>
                  <th className="px-4 py-3 font-medium">School</th>
                  <th className="px-4 py-3 font-medium">Declared</th>
                  <th className="px-4 py-3 font-medium">Resolvable</th>
                  <th className="px-4 py-3 font-medium">Check</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.slug} className="border-t border-border/60">
                    <td className="px-4 py-3">{course.title}</td>
                    <td className="px-4 py-3 text-muted-foreground">{course.schoolId}</td>
                    <td className="px-4 py-3 tabular-nums">{course.declared}</td>
                    <td
                      className={`px-4 py-3 tabular-nums ${
                        course.resolvable < course.declared ? "font-semibold text-rose-500" : ""
                      }`}
                    >
                      {course.resolvable}
                    </td>
                    {/* Muted, not red: a course without a self-check is complete,
                        it just has no optional extra. */}
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {course.questions === null ? "—" : `${course.questions} questions`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/*
          Engagement — aggregate only, and suppressed below five readers.

          The interesting number here is not "what is popular" but the gap
          between readers and completions: an item many people open and few
          finish is a problem with the writing, and it is otherwise invisible.
        */}
        <section className="mb-12">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold tracking-[-0.01em]">
            <BarChart3 aria-hidden className="h-5 w-5 text-primary" />
            Engagement
          </h2>

          {!engagement.available ? (
            <p className="flex items-start gap-2 rounded-xl border border-border/70 bg-card p-4 text-sm leading-relaxed text-muted-foreground">
              <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {engagement.reason === "not-migrated" ? (
                  <>
                    Migration <code className="font-mono text-xs">0089</code> is not applied yet, so
                    there is nothing to aggregate. The page degrades to this rather than failing —
                    apply the migration and the table appears.
                  </>
                ) : engagement.reason === "not-authorized" ? (
                  <>The database refused the aggregate for this session.</>
                ) : (
                  <>Engagement could not be read.</>
                )}
              </span>
            </p>
          ) : engagement.rows.length === 0 ? (
            <p className="flex items-start gap-2 rounded-xl border border-border/70 bg-card p-4 text-sm leading-relaxed text-muted-foreground">
              <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {/*
                  Said explicitly, because an empty table here is ambiguous and
                  the wrong reading ("nobody reads anything") is the one an
                  operator will jump to.
                */}
                No item has yet been read by enough distinct people to be
                reportable. Counts below five readers are suppressed in the database, not here —
                on a corpus this size a small count plus knowing who the users are is a disclosure,
                not a statistic.
              </span>
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/70">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Kind</th>
                    <th className="px-4 py-3 font-medium">Readers</th>
                    <th className="px-4 py-3 font-medium">Finished</th>
                    <th className="px-4 py-3 font-medium">Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {engagement.rows.map((row) => {
                    const rate = completionRate(row);
                    return (
                      <tr key={`${row.itemKind}:${row.itemSlug}`} className="border-t border-border/60">
                        <td className="px-4 py-3 font-mono text-xs">{row.itemSlug}</td>
                        <td className="px-4 py-3 text-muted-foreground">{row.itemKind}</td>
                        <td className="px-4 py-3 tabular-nums">{row.readers}</td>
                        <td className="px-4 py-3 tabular-nums">
                          {row.completions}
                          {rate !== null && (
                            <span
                              className={
                                rate < 0.4 ? "ml-2 text-xs text-amber-600" : "ml-2 text-xs text-muted-foreground"
                              }
                            >
                              {Math.round(rate * 100)}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">{row.bookmarks}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Locales — the honest picture: declared intent, measured progress. */}
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold tracking-[-0.01em]">
            <Languages aria-hidden className="h-5 w-5 text-primary" />
            Localisation
          </h2>
          <p className="mb-4 flex items-start gap-2 rounded-xl border border-border/70 bg-card p-4 text-sm leading-relaxed text-muted-foreground">
            <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Coverage is measured from the UI string catalogue, not declared. A locale is
              offered to visitors at 90% and never below — a half-translated page switches
              language mid-sentence, which reads as broken rather than partial.
            </span>
          </p>
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Locale</th>
                  <th className="px-4 py-3 font-medium">Direction</th>
                  <th className="px-4 py-3 font-medium">Coverage</th>
                  <th className="px-4 py-3 font-medium">Strings outstanding</th>
                  <th className="px-4 py-3 font-medium">Offered</th>
                </tr>
              </thead>
              <tbody>
                {locales.map((locale) => (
                  <tr key={locale.code} className="border-t border-border/60">
                    <td className="px-4 py-3">
                      <span className="font-medium">{locale.name}</span>{" "}
                      <span className="text-muted-foreground">{locale.endonym}</span>
                    </td>
                    <td className="px-4 py-3 uppercase text-muted-foreground">
                      {locale.direction}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{Math.round(locale.coverage * 100)}%</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {locale.missing}
                    </td>
                    <td className="px-4 py-3">
                      {locale.coverage >= 0.9 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <Globe aria-hidden className="h-3.5 w-3.5" /> Yes
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
