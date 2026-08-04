import { Info, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RelationshipPrivacyPanel } from "@/features/account/relationship-privacy";
import { SettingsPage } from "@/features/account/settings-page";
import { GRAPH_EDGES, plannedEdges } from "@/lib/social/graph/edges";
import { CIRCLE_PERMISSIONS } from "@/lib/social/graph/circles";
import { listCircles, relationshipPrivacy } from "@/lib/social/graph/store";
import { TRUSTED_CAPABILITIES, TRUSTED_NO_ACCESS_NOTICE } from "@/lib/social/graph/trusted";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relationships", robots: { index: false, follow: false } };

/**
 * /account/relationships — relationship privacy, circles and trusted contacts
 * (Feature 18 · Part 17).
 *
 * The lower half of this page is deliberately a list of what is NOT built. A
 * settings screen that quietly omits the unavailable options leaves a member
 * assuming the platform can do things it cannot — which for "account recovery
 * through a trusted contact" would mean relying on a safety net that does not
 * exist.
 */
export default async function RelationshipsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/relationships");

  const [privacy, circles] = await Promise.all([relationshipPrivacy(user.id), listCircles(user.id)]);
  const plannedCircle = CIRCLE_PERMISSIONS.filter((p) => !p.live);
  const unavailableTrusted = TRUSTED_CAPABILITIES.filter((c) => !c.live);
  const unobservable = plannedEdges();

  return (
    <SettingsPage
      title="Relationships"
      description="Who can see your connections, and how you organise them."
      bare
    >
      <RelationshipPrivacyPanel initial={privacy} />

      {/* ── Circles ─────────────────────────────────────────────── */}
      <section className="mt-7">
        <h2 className="px-0.5 text-sm font-bold">Circles</h2>
        <p className="mt-0.5 px-0.5 text-xs text-muted-foreground">
          Private groups. Nobody is ever told they&apos;re in one.
        </p>
        <Link
          href="/friends/circles"
          prefetch
          className="mt-2 flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-3 shadow-sm transition hover:bg-secondary/40"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 ring-1 ring-inset ring-violet-500/20 dark:text-violet-400">
            <Users className="h-[19px] w-[19px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Manage your circles</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {circles.length === 0
                ? "You haven't made any yet."
                : `${circles.length} circle${circles.length === 1 ? "" : "s"}`}
            </span>
          </span>
        </Link>

        {plannedCircle.length > 0 ? (
          <div className="mt-2 rounded-2xl border border-dashed border-border/70 px-3.5 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              What circles can&apos;t do yet
            </p>
            <ul className="mt-2 space-y-2">
              {plannedCircle.map((p) => (
                <li key={p.key} className="text-xs leading-snug text-muted-foreground">
                  <span className="font-semibold text-foreground">{p.label}</span> — {p.needs}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* ── Trusted contacts ────────────────────────────────────── */}
      <section className="mt-7">
        <h2 className="px-0.5 text-sm font-bold">Trusted contacts</h2>
        <p className="mt-0.5 flex items-start gap-1.5 px-0.5 text-xs leading-snug text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {TRUSTED_NO_ACCESS_NOTICE}
        </p>
        <div className="mt-2 rounded-2xl border border-dashed border-border/70 px-3.5 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Not available</p>
          <ul className="mt-2 space-y-2">
            {unavailableTrusted.map((c) => (
              <li key={c.key} className="text-xs leading-snug text-muted-foreground">
                <span className="font-semibold text-foreground">{c.label}</span> — {c.needs}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Relationship types the platform can't observe ───────── */}
      <section className="mt-7">
        <h2 className="px-0.5 text-sm font-bold">Connection types</h2>
        <p className="mt-0.5 px-0.5 text-xs text-muted-foreground">
          Frenz tracks {GRAPH_EDGES.length - unobservable.length} kinds of connection today.
        </p>
        <div className="mt-2 rounded-2xl border border-dashed border-border/70 px-3.5 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Not tracked yet</p>
          <ul className="mt-2 space-y-2">
            {unobservable.map((e) => (
              <li key={e.key} className="text-xs leading-snug text-muted-foreground">
                <span className="font-semibold text-foreground">{e.label}</span> — {e.needs}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </SettingsPage>
  );
}
