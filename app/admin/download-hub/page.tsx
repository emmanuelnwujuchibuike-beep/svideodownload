import { Ban, Bell, CalendarDays, CheckCircle2, Clock, Download, Eye, Image as ImageIcon, Music, Sparkles, Video } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/layout/site-header";
import { isAdmin } from "@/lib/admin";
import { fetchDownloadStats } from "@/lib/admin-stats";
import { GATEWAY_ACTIONS } from "@/lib/download-hub/actions";
import { resolveAvailability } from "@/lib/download-hub/recommend";
import { LESSON_CATALOG } from "@/lib/learning/catalog";
import { PLATFORMS } from "@/lib/platforms";
import { createClient } from "@/lib/supabase/server";
import { formatCompactNumber } from "@/lib/utils";
import type { PlatformId } from "@/types";

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

  /*
    Downloads come from the real, always-populated `downloads` table (the same
    source the dashboard's Traffic section uses), NOT the Hub's own
    `download_events` log — that table is part of migration 0087 (the Discovery
    Gateway funnel) and reads empty until it's applied, which is why every
    counter here showed zero. The funnel/waitlist figures still depend on 0087;
    the download totals no longer do, so this page is live regardless.
  */
  const [stats, shown, waitlistRows] = await Promise.all([
    fetchDownloadStats(),
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

  // The Gateway funnel tables (0087). Downloads above are unaffected by this.
  const gatewayApplied = shown !== null;
  const platformName = (id: string) => PLATFORMS[id as PlatformId]?.name ?? id;
  const maxPlatform = stats?.platforms[0]?.total_downloads ?? 1;
  const kinds = stats?.byKind ?? { video: 0, audio: 0, image: 0 };

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
      <main className="container max-w-5xl pb-24 pt-[calc(var(--frenz-safe-top)+7rem)] sm:pt-[calc(var(--frenz-safe-top)+8rem)]">
        <h1 className="text-3xl font-extrabold tracking-[-0.02em]">Download Hub operations</h1>
        <p className="mt-2 text-muted-foreground">
          Live download activity, the Discovery Gateway funnel, action catalogue and Learning
          Academy inventory.
        </p>

        {/* Live download totals — the real `downloads` table, always populated. */}
        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <Stat icon={Download} label="Downloads · all time" value={stats?.total ?? 0} accent />
          <Stat icon={Sparkles} label="Today" value={stats?.today ?? 0} />
          <Stat icon={CalendarDays} label="Last 7 days" value={stats?.last7 ?? 0} />
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border/60 p-5">
            <h2 className="font-semibold">Downloads by platform</h2>
            {stats && stats.platforms.length > 0 ? (
              <div className="mt-4 space-y-3">
                {stats.platforms.map((p) => (
                  <div key={p.platform}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium">{platformName(p.platform)}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatCompactNumber(p.total_downloads)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400"
                        style={{ width: `${Math.max(4, (p.total_downloads / maxPlatform) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No downloads recorded yet — they appear here live as people use the site.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border/60 p-5">
            <h2 className="font-semibold">By media type</h2>
            <div className="mt-4 space-y-3">
              <KindRow icon={Video} label="Video" value={kinds.video} />
              <KindRow icon={Music} label="Audio" value={kinds.audio} />
              <KindRow icon={ImageIcon} label="Photos" value={kinds.image} />
            </div>
            <h3 className="mt-6 text-sm font-semibold">Recent downloads</h3>
            {stats && stats.recent.length > 0 ? (
              <ul className="mt-2 divide-y divide-border/50">
                {stats.recent.slice(0, 6).map((d, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="truncate">{d.title || "Untitled"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {platformName(d.platform)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No recent activity.</p>
            )}
          </div>
        </section>

        {/* Discovery Gateway funnel — the Hub's own metrics (migration 0087). */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Discovery Gateway funnel</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Post-download recommendation impressions and the waitlist for unbuilt products.
          </p>
          {!gatewayApplied ? (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="text-sm">
                <p className="font-semibold">Migration 0087 not applied</p>
                <p className="mt-1 text-muted-foreground">
                  The impression and waitlist tables are missing, so the two counters below read
                  zero. The Gateway itself works — recording is best-effort and fails silently
                  rather than breaking a download. The download totals above are live regardless.
                </p>
              </div>
            </div>
          ) : null}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Stat icon={Eye} label="Recommendations shown" value={shown ?? 0} />
            <Stat icon={Bell} label="Waitlist signups" value={waitlistRows?.length ?? 0} />
          </div>
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
  accent,
}: {
  icon: typeof Download;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-2xl border border-primary/30 bg-primary/[0.03] p-5 ring-1 ring-primary/15"
          : "rounded-2xl border border-border/60 p-5"
      }
    >
      <Icon className={accent ? "h-5 w-5 text-primary" : "h-5 w-5 text-muted-foreground"} />
      <p className="mt-3 text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function KindRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Download;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 font-medium">
        <Icon className="h-4 w-4 text-muted-foreground" /> {label}
      </span>
      <span className="tabular-nums text-muted-foreground">{formatCompactNumber(value)}</span>
    </div>
  );
}
