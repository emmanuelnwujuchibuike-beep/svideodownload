import {
  Activity,
  AlertTriangle,
  Download,
  Gauge,
  Globe,
  Server,
} from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/layout/site-header";
import { isAdmin } from "@/lib/admin";
import { fetchDownloadStats, fetchProxyUsage } from "@/lib/admin-stats";
import { PLATFORMS } from "@/lib/platforms";
import { createClient } from "@/lib/supabase/server";
import { cn, formatCompactNumber } from "@/lib/utils";
import type { PlatformId } from "@/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function AdminPage() {
  if (!hasSupabase) redirect("/login");

  // Defense-in-depth (middleware already guards this).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!isAdmin(profile?.role, user.email)) redirect("/");

  const [proxy, downloads] = await Promise.all([
    fetchProxyUsage(),
    fetchDownloadStats(),
  ]);

  const platformName = (id: string) =>
    PLATFORMS[id as PlatformId]?.name ?? id;
  const maxPlatform = downloads?.platforms[0]?.total_downloads ?? 1;

  return (
    <>
      <SiteHeader />
      <main className="container max-w-5xl pb-24 pt-28 sm:pt-36">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Admin dashboard
          </h1>
          <p className="mt-2 text-muted-foreground">
            Usage, proxy spend, and platform health at a glance.
          </p>
        </header>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            icon={Download}
            label="Total downloads"
            value={downloads ? formatCompactNumber(downloads.total) : "—"}
          />
          <StatCard
            icon={Gauge}
            label="Proxy used (mo)"
            value={proxy ? `${proxy.gbThisMonth} GB` : "—"}
            sub={proxy ? `of ${proxy.limitGb} GB` : undefined}
          />
          <StatCard
            icon={Globe}
            label="Proxy / direct"
            value={
              proxy
                ? `${formatCompactNumber(proxy.requests.proxy)} / ${formatCompactNumber(proxy.requests.direct)}`
                : "—"
            }
          />
          <StatCard
            icon={Server}
            label="Proxy status"
            value={proxy?.configured ? "Active" : "Off"}
            sub={proxy?.fallbackOnly ? "fallback-only" : undefined}
          />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* Proxy widget */}
          <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <Gauge className="h-5 w-5 text-primary" /> Residential proxy
              </h2>
              {proxy && proxy.alertLevel >= 75 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-500">
                  <AlertTriangle className="h-3 w-3" /> {proxy.alertLevel}% of budget
                </span>
              ) : null}
            </div>

            {proxy ? (
              <>
                <div className="flex items-end justify-between">
                  <p className="text-3xl font-semibold">
                    {proxy.gbThisMonth}
                    <span className="text-base font-normal text-muted-foreground">
                      {" "}
                      / {proxy.limitGb} GB
                    </span>
                  </p>
                  {proxy.estimatedCostUsd != null ? (
                    <p className="text-sm text-muted-foreground">
                      ~${proxy.estimatedCostUsd}
                    </p>
                  ) : null}
                </div>

                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      proxy.alertLevel >= 90
                        ? "bg-red-500"
                        : proxy.alertLevel >= 75
                          ? "bg-amber-500"
                          : "bg-primary",
                    )}
                    style={{ width: `${Math.min(100, proxy.percentOfLimit)}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {proxy.remainingGb} GB remaining · {proxy.percentOfLimit}% used
                </p>

                {Object.keys(proxy.perPlatform).length > 0 ? (
                  <div className="mt-5 space-y-2 border-t border-border/60 pt-4">
                    <p className="text-xs font-medium text-muted-foreground">
                      Bandwidth by platform
                    </p>
                    {Object.entries(proxy.perPlatform)
                      .sort((a, b) => b[1] - a[1])
                      .map(([p, bytes]) => (
                        <div key={p} className="flex justify-between text-sm">
                          <span>{platformName(p)}</span>
                          <span className="text-muted-foreground">
                            {(bytes / 1e6).toFixed(1)} MB
                          </span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="mt-5 border-t border-border/60 pt-4 text-sm text-muted-foreground">
                    No proxy bandwidth used yet — everything served direct. 🎉
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Proxy stats unavailable (worker unreachable or proxy not
                configured).
              </p>
            )}
          </section>

          {/* Top platforms */}
          <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
            <h2 className="mb-5 flex items-center gap-2 font-semibold">
              <Activity className="h-5 w-5 text-primary" /> Top platforms
            </h2>
            {downloads && downloads.platforms.length > 0 ? (
              <div className="space-y-3">
                {downloads.platforms.map((p) => (
                  <div key={p.platform}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium">
                        {platformName(p.platform)}
                      </span>
                      <span className="text-muted-foreground">
                        {formatCompactNumber(p.total_downloads)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400"
                        style={{
                          width: `${Math.max(4, (p.total_downloads / maxPlatform) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No downloads recorded yet. They&apos;ll appear here as people use
                the site.
              </p>
            )}
          </section>
        </div>

        {/* Recent downloads */}
        <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
          <h2 className="mb-4 font-semibold">Recent downloads</h2>
          {downloads && downloads.recent.length > 0 ? (
            <ul className="divide-y divide-border/60">
              {downloads.recent.map((d, i) => (
                <li key={i} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span className="truncate">{d.title || "Untitled"}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {platformName(d.platform)} ·{" "}
                    {new Date(d.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No recent activity.</p>
          )}
        </section>
      </main>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Download;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground">
        {label}
        {sub ? ` · ${sub}` : ""}
      </p>
    </div>
  );
}
