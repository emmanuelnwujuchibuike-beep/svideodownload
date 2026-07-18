import { AlertTriangle, CheckCircle2, Clock, Network, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/layout/site-header";
import { auditGenomes, getProfiles } from "@/lib/content/genome/queries";
import { auditGraph, graphStats } from "@/lib/content/graph/traverse";
import { detectDrift } from "@/lib/content/sync/detect";
import { buildReport } from "@/lib/content/sync/impact";
import { takeSnapshot } from "@/lib/content/sync/snapshot";
import { isAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Content operations — the Living Content Platform's admin surface (RFC §ADMIN).
 *
 * Shows the three health views that already have real data behind them: the Sync
 * Engine's review queue, Product Genome integrity, and Experience Graph integrity.
 *
 * ── Why this reads the CODEBASE, not the authoring tables ──────────────────────
 *
 * The genome and graph are still authored in TS; migration 0085/0086 exist but
 * authorship has not moved yet (`content:seed` is a deliberate, separate step). So
 * this page reports on the real current source of truth rather than on empty tables.
 * When authorship moves, the queries swap and this page does not change shape —
 * which is the point of `auditGenomes()` / `auditGraph()` returning data rather
 * than printing.
 *
 * `force-dynamic` and `robots: noindex`, matching the rest of /admin: this is an
 * operator tool, it is never crawled, and it is explicitly outside the 2-second
 * budget that governs visitor-facing pages.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Content operations",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const SEVERITY_STYLE: Record<string, string> = {
  "factual-break": "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
  stale: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  cosmetic: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
};

export default async function ContentOpsPage() {
  if (!hasSupabase) redirect("/login");

  // Defense-in-depth, matching app/admin/page.tsx (middleware already guards this).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/content");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!isAdmin(profile?.role, user.email)) redirect("/");

  const report = buildReport(detectDrift(takeSnapshot(process.cwd())));
  const genomeIssues = auditGenomes();
  const graphIssues = auditGraph();
  const stats = graphStats();
  const profiles = getProfiles();

  const orphans = graphIssues.filter((i) => i.kind === "orphan");
  const structural = graphIssues.filter((i) => i.kind !== "orphan");

  return (
    <>
      <SiteHeader />
      <main className="container max-w-5xl py-10">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">Content operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drift between the product and what the site says about it.
        </p>

        {/* ---------------------------------------------------------------- */}
        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="h-4 w-4" /> Sync review queue
          </h2>

          {report.blocked ? (
            <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm font-semibold text-rose-600 dark:text-rose-300">
              Publish blocked — the site currently states something untrue.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {(["factual-break", "stale", "cosmetic"] as const).map((sev) => (
              <span key={sev} className={`rounded-full border px-3 py-1 font-semibold ${SEVERITY_STYLE[sev]}`}>
                {report.counts[sev]} {sev}
              </span>
            ))}
          </div>

          {report.findings.length === 0 ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> No drift detected.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {report.findings.map((finding) => {
                const impacted = report.impact[finding.id] ?? [];
                return (
                  <li key={finding.id} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_STYLE[finding.severity]}`}>
                        {finding.severity}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">{finding.nodeId}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium">{finding.summary}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Fix: {finding.remedy}</p>
                    {impacted.length > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {/* Grouped by cause: one broken route is one fix, not forty. */}
                        Affects {impacted.length}:{" "}
                        {impacted.slice(0, 4).map((i) => i.node.title).join(", ")}
                        {impacted.length > 4 ? ` +${impacted.length - 4} more` : ""}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <AlertTriangle className="h-4 w-4" /> Product Genome
          </h2>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2">Product</th>
                  <th>Stage</th>
                  <th>Claimable</th>
                  <th>Capabilities</th>
                  <th>Verified</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map(({ platform, genome }) => (
                  <tr key={platform.id} className="border-t border-border/60">
                    <td className="py-2 font-medium">{platform.name}</td>
                    <td className="text-muted-foreground">{platform.veracity.stage}</td>
                    <td>
                      {platform.veracity.claimable ? (
                        <span className="text-emerald-600 dark:text-emerald-400">yes</span>
                      ) : (
                        <span className="text-muted-foreground">no</span>
                      )}
                    </td>
                    <td className="text-muted-foreground">{genome.capabilities.length}</td>
                    <td className="text-muted-foreground">{platform.veracity.verifiedAt ?? "never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-sm">
            {genomeIssues.length === 0 ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> No integrity issues.
              </span>
            ) : (
              <span className="text-rose-600 dark:text-rose-300">
                {genomeIssues.length} integrity issue(s):{" "}
                {genomeIssues.map((i) => `${i.productId}.${i.field}`).join(", ")}
              </span>
            )}
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Network className="h-4 w-4" /> Experience Graph
          </h2>

          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Nodes", value: stats.nodes },
              { label: "Edges", value: stats.edges },
              { label: "Authored", value: stats.authored },
              { label: "Derived", value: stats.derived },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-3">
                <dd className="text-xl font-bold tabular-nums">{s.value}</dd>
                <dt className="text-xs text-muted-foreground">{s.label}</dt>
              </div>
            ))}
          </dl>

          <p className="mt-3 text-sm">
            {structural.length === 0 ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> No dangling edges or cycles.
              </span>
            ) : (
              <span className="text-rose-600 dark:text-rose-300">
                {structural.length} structural issue(s) — {structural[0]?.detail}
              </span>
            )}
          </p>

          {orphans.length > 0 ? (
            <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {/* Advisory per RFC §4: an orphan is a content bug, not a build breaker. */}
              {orphans.length} orphaned node(s) with no edges — content that nothing links to.
            </p>
          ) : null}
        </section>
      </main>
    </>
  );
}
