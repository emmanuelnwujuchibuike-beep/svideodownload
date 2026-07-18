import { Ban, Bell, CheckCircle2, Clock, Download, Eye } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/layout/site-header";
import { isAdmin } from "@/lib/admin";
import { GATEWAY_ACTIONS } from "@/lib/download-hub/actions";
import { resolveAvailability } from "@/lib/download-hub/recommend";
import { LESSON_CATALOG } from "@/lib/learning/catalog";
import { createClient } from "@/lib/supabase/server";

/**
 * Download Hub operations — the admin surface from `docs/DOWNLOAD_HUB_RFC.md` §6.
 *
 * Shows the Gateway funnel (impressions → acceptance), the action catalogue with
 * its DERIVED availability, waitlist demand for unbuilt products, and the
 * Learning Academy inventory.
 *
 * The waitlist table is the genuinely useful one: it is a real, ranked signal of
 * which unbuilt product people actually want, gathered at the exact moment they
 * wanted it. That is a far better roadmap input than a survey.
 *
 * Availability is deliberately NOT editable here. An admin toggle would let a
 * human mark a product that does not exist as "live", which is precisely the
 * failure the Reality Ledger exists to prevent.
 *
 * `force-dynamic` + noindex, matching the rest of /admin: an operator tool,
 * never crawled, explicitly outside the 2-second visitor budget.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Download Hub operations",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const AVAILABILITY_STYLE: Record<string, string> = {
  live: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  preview: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  planned: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
};

/** Missing tables (migration 0087 unapplied) must degrade, not crash the page. */
async function safeCount(
  run: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  try {
    const { count, error } = await run();
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

export default async function DownloadHubOpsPage() {
  if (!hasSupabase) redirect("/login");

  // Defense-in-depth, matching app/admin/content/page.tsx (middleware guards too).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/download-hub");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!isAdmin(profile?.role, user.email)) redirect("/");

  const [downloads, shown, waitlistRows] = await Promise.all([
    safeCount(() =>
      supabase.from("download_events").select("*", { count: "exact", head: true }),
    ),
    safeCount(() =>
      supabase
        .from("gateway_impressions")
        .select("*", { count: "exact", head: true })
        .eq("outcome", "shown"),
    ),
    (async () => {
      try {
        const { data, error } = await supabase.from("product_waitlist").select("action_id");
        return error ? null : (data as { action_id: string }[]);
      } catch {
        return null;
      }
    })(),
  ]);

  const migrationApplied = downloads !== null;

  const waitlistByAction = new Map<string, number>();
  for (const row of waitlistRows ?? []) {
    waitlistByAction.set(row.action_id, (waitlistByAction.get(row.action_id) ?? 0) + 1);
  }

  const catalogue = GATEWAY_ACTIONS.map((action) => ({
    action,
    availability: resolveAvailability(action),
    waitlist: waitlistByAction.get(action.id) ?? 0,
  })).sort((a, b) => b.action.base - a.action.base);

  const plannedDemand = catalogue
    .filter((c) => c.availability === "planned" && c.waitlist > 0)
    .sort((a, b) => b.waitlist - a.waitlist);

  return (
    <>
      <SiteHeader />
      <main className="container max-w-5xl pb-24 pt-28 sm:pt-32">
        <h1 className="text-3xl font-extrabold tracking-[-0.02em]">Download Hub operations</h1>
        <p className="mt-2 text-muted-foreground">
          Discovery Gateway funnel, action catalogue and Learning Academy inventory.
        </p>

        {!migrationApplied ? (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm">
              <p className="font-semibold">Migration 0087 not applied</p>
              <p className="mt-1 text-muted-foreground">
                Event, impression and waitlist tables are missing, so the counters below read
                zero. The Gateway itself works — recording is best-effort by design and fails
                silently rather than breaking a download.
              </p>
            </div>
          </div>
        ) : null}

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <Stat icon={Download} label="Downloads recorded" value={downloads ?? 0} />
          <Stat icon={Eye} label="Recommendations shown" value={shown ?? 0} />
          <Stat icon={Bell} label="Waitlist signups" value={waitlistRows?.length ?? 0} />
        </section>

        {plannedDemand.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Demand for unbuilt products</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Who asked to be told, captured at the moment they wanted the thing. The best
              roadmap signal in here.
            </p>
            <ul className="mt-4 space-y-2">
              {plannedDemand.map(({ action, waitlist }) => (
                <li
                  key={action.id}
                  className="flex items-center justify-between rounded-xl border border-border/60 px-4 py-3"
                >
                  <span className="text-sm font-medium">{action.label}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{waitlist}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Action catalogue</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Availability is derived from the Product Genome and is not editable — that is
            deliberate. See RFC §6.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Action</th>
                  <th className="pb-2 pr-4 font-medium">Product</th>
                  <th className="pb-2 pr-4 font-medium">Availability</th>
                  <th className="pb-2 pr-4 font-medium">Weight</th>
                  <th className="pb-2 font-medium">Waitlist</th>
                </tr>
              </thead>
              <tbody>
                {catalogue.map(({ action, availability, waitlist }) => (
                  <tr key={action.id} className="border-b border-border/40">
                    <td className="py-2.5 pr-4 font-medium">{action.label}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{action.productId}</td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${AVAILABILITY_STYLE[availability]}`}
                      >
                        {availability}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                      {action.base}
                    </td>
                    <td className="py-2.5 tabular-nums text-muted-foreground">
                      {waitlist || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Learning Academy</h2>
          <ul className="mt-4 space-y-2">
            {LESSON_CATALOG.map((lesson) => {
              const orphaned = lesson.relatedActionIds.length === 0;
              return (
                <li
                  key={lesson.slug}
                  className="flex items-center justify-between gap-4 rounded-xl border border-border/60 px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{lesson.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {lesson.topic} · {lesson.minutes} min
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {orphaned ? (
                      <span className="inline-flex items-center gap-1">
                        <Ban className="h-3.5 w-3.5" /> not linked to an action
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> surfaced by the Gateway
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Download;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-border/60 p-5">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <p className="mt-3 text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
