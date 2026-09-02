import { Activity, Award, Compass, Lock, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmptyNote, MeterRow, Pill, ProgressRing, StudioCard } from "@/features/studio/studio-ui";
import { UniverseMap } from "@/features/studio/universe-map";
import { getStudioPrefs } from "@/lib/creator/prefs";
import { getCreatorHome } from "@/lib/creator/studio";
import { buildCreatorUniverse } from "@/lib/creator/universe";
import { CREATOR_BAND_LABEL } from "@/lib/creator/health";
import { listCollaborators } from "@/lib/creator/collab";
import { categoryLabel } from "@/lib/social/categories";
import { listViewableCollections } from "@/lib/social/collections";
import { listMySounds } from "@/lib/social/sounds";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Journey" };

/**
 * Creator Journey™, achievements, Creator Health™ and Creator Universe™
 * (Feature 15 · Part 9).
 *
 * The journey's rule, enforced in `lib/creator/journey.ts` and visible here: a
 * reached milestone shows the DATE OF THE ROW THAT PROVES IT, and a milestone
 * the platform cannot date shows no date at all rather than a plausible one.
 * `views_count` is a running counter — it does not remember the day it passed
 * 100 — so those rungs are reached without a date, deliberately.
 */
export default async function StudioJourneyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/journey");

  const prefs = await getStudioPrefs(user.id);
  const home = await getCreatorHome(user.id, prefs.weeklyGoal);
  if (!home) {
    return <EmptyNote>The Studio can&apos;t reach your data right now.</EmptyNote>;
  }

  const universe = await buildUniverse(user.id, home);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Your journey</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every milestone here is a real event with a real date behind it.
        </p>
      </header>

      <StudioCard title="Creator Journey" icon={Compass}>
        <ol className="relative space-y-0">
          {home.journey.map((step, i) => (
            <li key={step.key} className="relative flex gap-4 pb-5 last:pb-0">
              {i < home.journey.length - 1 ? (
                <span aria-hidden className="absolute left-[15px] top-8 h-full w-px bg-border" />
              ) : null}
              <span
                className={
                  step.reached
                    ? "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    : "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
                }
              >
                {step.reached ? <Sparkles className="h-4 w-4" aria-hidden /> : <Lock className="h-3.5 w-3.5" aria-hidden />}
              </span>

              <div className="min-w-0 flex-1 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={step.reached ? "text-sm font-semibold" : "text-sm font-semibold text-muted-foreground"}>
                    {step.title}
                  </p>
                  {step.date ? (
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(step.date).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  ) : step.reached ? (
                    /* Reached, but nothing records WHEN. Said out loud rather
                       than filled in with a plausible date. */
                    <Pill tone="muted">no date recorded</Pill>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
                {!step.reached && step.progress > 0 ? (
                  <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400"
                      style={{ width: `${Math.max(2, step.progress * 100)}%` }}
                    />
                  </div>
                ) : null}
              </div>

              {step.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={step.thumbnailUrl} alt="" loading="lazy" className="h-12 w-16 shrink-0 rounded-xl object-cover" />
              ) : null}
            </li>
          ))}
        </ol>
      </StudioCard>

      <StudioCard id="health" title="Creator Health" icon={Activity} subtitle="Measured against your own past, never against other creators">
        {home.health.score === null ? (
          <EmptyNote>
            Not enough history to score yet. Every pillar here compares you to your own baseline, so a new
            account genuinely has nothing to compare — and an unscored pillar is left unscored rather than
            counted as zero.
          </EmptyNote>
        ) : (
          <>
            <div className="mb-5 flex items-center gap-4">
              <ProgressRing
                progress={home.health.score / 100}
                size={80}
                label={String(home.health.score)}
                tone={home.health.score >= 70 ? "emerald" : home.health.score >= 50 ? "amber" : "rose"}
              />
              <div>
                <p className="text-lg font-bold">{home.health.band ? CREATOR_BAND_LABEL[home.health.band] : "—"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Across {home.health.pillars.filter((p) => p.score !== null).length} measurable pillars.
                </p>
              </div>
            </div>

            <div className="space-y-3.5">
              {home.health.pillars.map((p) =>
                p.score === null ? (
                  <div key={p.key} className="flex items-start justify-between gap-3 text-xs">
                    <span className="font-medium text-muted-foreground">{p.label}</span>
                    <span className="shrink-0 text-right text-[11px] text-muted-foreground/80">{p.detail}</span>
                  </div>
                ) : (
                  <div key={p.key}>
                    <MeterRow
                      label={p.label}
                      value={p.score}
                      max={100}
                      display={String(p.score)}
                      tone={
                        p.score >= 70
                          ? "from-emerald-600 to-teal-400"
                          : p.score >= 50
                            ? "from-amber-500 to-orange-400"
                            : "from-rose-600 to-red-400"
                      }
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">{p.detail}</p>
                  </div>
                ),
              )}
            </div>

            {home.health.suggestions.length > 0 ? (
              <ul className="mt-5 space-y-2.5 border-t border-border/60 pt-4">
                {home.health.suggestions.map((s) => (
                  <li key={s.pillar} className="rounded-2xl bg-secondary/40 p-3.5">
                    <p className="text-xs font-semibold">{s.title}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{s.body}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </StudioCard>

      <StudioCard title="Creator Universe" icon={Compass} subtitle="How your work connects — every node is a real row">
        <UniverseMap graph={universe} />
      </StudioCard>

      <StudioCard title="Achievements" icon={Award} subtitle={`${home.achievements.filter((a) => a.earned).length} earned`}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {home.achievements.map((a) => (
            <li
              key={a.def.id}
              className={
                a.earned
                  ? "rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] p-3"
                  : "rounded-2xl border border-border/60 bg-card p-3 opacity-75"
              }
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-semibold">{a.def.title}</p>
                <Pill tone={a.earned ? "amber" : "muted"}>{a.def.rarity}</Pill>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{a.def.description}</p>
              {!a.earned ? (
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.max(2, a.progress * 100)}%` }} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </StudioCard>
    </div>
  );
}

/**
 * Build the universe from data this creator already has. Deliberately a handful
 * of small reads rather than one wide join: each degrades to an empty ring on
 * its own, so a missing sounds table (or an unmigrated one) costs a ring rather
 * than the page.
 */
async function buildUniverse(userId: string, home: NonNullable<Awaited<ReturnType<typeof getCreatorHome>>>) {
  const db = createAdminClient();

  const [collections, sounds, profile] = await Promise.all([
    listViewableCollections(userId, userId, false).catch(() => []),
    listMySounds(userId, 8).catch(() => []),
    db
      .from("profiles")
      .select("handle, avatar_url")
      .eq("id", userId)
      .maybeSingle()
      .then((r) => r.data as { handle: string; avatar_url: string | null } | null, () => null),
  ]);

  // Accepted collaborators across this creator's most recent posts.
  const collaborators = (
    await Promise.all(home.latest.slice(0, 6).map((p) => listCollaborators(p.id, userId).catch(() => [])))
  )
    .flat()
    .filter((c) => c.status === "accepted");

  const byHandle = new Map<string, { id: string; handle: string; avatarUrl: string | null; posts: number }>();
  for (const c of collaborators) {
    const prev = byHandle.get(c.handle);
    if (prev) prev.posts += 1;
    else byHandle.set(c.handle, { id: c.userId, handle: c.handle, avatarUrl: c.avatarUrl, posts: 1 });
  }

  return buildCreatorUniverse({
    handle: profile?.handle ?? "you",
    avatarUrl: profile?.avatar_url ?? null,
    followers: home.analytics.followers,
    categories: home.analytics.discovery.topicReach.map((t) => ({
      id: t.category,
      label: categoryLabel(t.category),
      views: t.views,
    })),
    sounds: sounds.map((s) => ({ id: s.id, title: s.title, plays: s.playsCount ?? 0 })),
    collections: collections.map((c) => ({ id: c.id, title: c.name, items: c.count })),
    surfaces: home.analytics.discovery.trafficSources.map((s) => ({
      id: s.source,
      label: s.source.replace(/_/g, " "),
      views: s.count,
    })),
    collaborators: [...byHandle.values()],
  });
}
