"use client";

import { Archive, ArchiveRestore, ArrowLeft, BellOff, CalendarHeart, Hourglass, MessageCircle, UserPlus, Tag } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { AmbientWash, GLASS, GlassGroup, PersonAvatar, quietPill, SectionHeader } from "@/features/friends/ui";
import { STAGE_COPY, STAGE_ORDER, type RelationshipStage } from "@/lib/social/intelligence/stage";
import type { IntelRelationship, RelationshipIntelligence } from "@/lib/social/intelligence/server";
import { cn } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";

/**
 * Your connections — the private Social Intelligence dashboard (Feature 19 · Part 8).
 *
 * Only the member sees it, and it is written in words: a stage, a sentence,
 * a person. No score, no percentage, no level, no streak to defend (the brief
 * forbids every one of them). Every nudge has "Not now" and "Don't suggest",
 * and archiving someone is undoable from the same page.
 */

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });

type Pref = "archive" | "unarchive" | "snooze_reconnect" | "reconnect_off" | "reconnect_on";
async function savePref(friendId: string, action: Pref): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/social/relationship-prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ friendId, action }) }).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  return { ok: !!res?.ok, error: j?.error };
}

export function InsightsPage({ intel }: { intel: RelationshipIntelligence }) {
  const [rels, setRels] = useState(intel.relationships);
  const [note, setNote] = useState<string | null>(intel.ready.prefs ? null : "Archiving and quieting nudges arrive with the next update.");

  const act = async (r: IntelRelationship, action: Pref) => {
    const prev = rels;
    setRels((l) =>
      l.map((x) => {
        if (x.person.id !== r.person.id) return x;
        if (action === "archive") return { ...x, archived: true, stage: "archived" as RelationshipStage, stageLabel: STAGE_COPY.archived.label, stageLine: STAGE_COPY.archived.line, reconnect: null };
        if (action === "unarchive") return { ...x, archived: false };
        return { ...x, reconnect: null };
      }),
    );
    const out = await savePref(r.person.id, action);
    if (!out.ok) {
      setRels(prev);
      setNote(out.error ?? "Couldn’t save that.");
    } else if (action === "unarchive") {
      // the stage it returns to is recomputed on the next visit
      setNote("Restored. They’re back on your Friends list.");
    }
  };

  const live = rels.filter((r) => !r.archived);
  const archived = rels.filter((r) => r.archived);
  const reconnect = live.filter((r) => r.reconnect);
  const byStage = useMemo(() => {
    const m = new Map<RelationshipStage, IntelRelationship[]>();
    for (const r of live) m.set(r.stage, [...(m.get(r.stage) ?? []), r]);
    return STAGE_ORDER.filter((s) => s !== "archived" && m.get(s)?.length).map((s) => [s, m.get(s)!] as const);
  }, [live]);

  return (
    <div className="relative isolate">
      <AmbientWash />
      <header className="mb-5 flex items-start gap-2 pt-1">
        <Link href="/friends" aria-label="Back to Friends" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="text-[clamp(1.6rem,7vw,2rem)] font-extrabold leading-none tracking-[-0.04em]">Your connections</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">Only you see this page. Nothing here is a score.</p>
        </div>
      </header>

      {note ? <p className={cn("mb-4 rounded-2xl px-3.5 py-2.5 text-[13px]", GLASS)}>{note}</p> : null}

      {/* AI Memory Surface: this week */}
      {intel.moments.length ? (
        <section className="mb-6" aria-labelledby="in-moments">
          <SectionHeader id="in-moments" title="This week" />
          <GlassGroup label="This week">
            {intel.moments.map((m) => (
              <li key={`${m.kind}-${m.friendId}-${m.at}`} className="flex items-center gap-3 px-3.5 py-3">
                <span aria-hidden className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", m.kind === "anniversary" ? "bg-rose-500/10 text-rose-500" : "bg-primary/10 text-primary")}>
                  {m.kind === "anniversary" ? <CalendarHeart className="h-[18px] w-[18px]" /> : <Hourglass className="h-[18px] w-[18px]" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold leading-snug">{m.title}</p>
                  <p className="text-[12px] text-muted-foreground">{fmtDay(m.at)}</p>
                </div>
                {m.person ? (
                  <Link href={`/friends/with/${m.person.handle}`} prefetch={false} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                    Our story
                  </Link>
                ) : null}
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      {/* AI Reconnect: optional, dismissible, never a guilt trip */}
      {reconnect.length ? (
        <section className="mb-6" aria-labelledby="in-reconnect">
          <SectionHeader id="in-reconnect" title="Reconnect" />
          <GlassGroup label="Reconnect">
            {reconnect.map((r) => (
              <li key={r.person.id} className="px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <PersonAvatar user={r.person} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-semibold">{r.person.displayName}</p>
                    <p className="text-[12.5px] text-muted-foreground">{r.reconnect}</p>
                  </div>
                  <Link href={`/messages/new/${r.person.id}`} prefetch={false} aria-label={`Message ${r.person.displayName}`} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <MessageCircle className="h-[18px] w-[18px]" aria-hidden />
                  </Link>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 pl-14">
                  <button type="button" onClick={() => void act(r, "snooze_reconnect")} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                    Not now
                  </button>
                  <button type="button" onClick={() => void act(r, "reconnect_off")} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                    <BellOff className="h-3.5 w-3.5" aria-hidden /> Don’t suggest
                  </button>
                </div>
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      {/* Relationship Evolution */}
      {intel.evolutions.length ? (
        <section className="mb-6" aria-labelledby="in-evolve">
          <SectionHeader id="in-evolve" title="Changes you might make" />
          <GlassGroup label="Relationship changes">
            {intel.evolutions.map(({ person, evolution }) => (
              <li key={`${person.id}-${evolution.kind}`} className="flex items-center gap-3 px-3.5 py-3">
                <PersonAvatar user={person} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-semibold">{person.displayName}</p>
                  <p className="text-[12.5px] leading-snug text-muted-foreground">{evolution.reason}</p>
                </div>
                {evolution.kind === "follow_to_friend" ? (
                  <Link href={`${profilePath(person.handle)}`} prefetch={false} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px] text-primary")}>
                    <UserPlus className="h-4 w-4" aria-hidden /> <span className="max-[359px]:sr-only">Profile</span>
                  </Link>
                ) : (
                  <Link href="/friends/circles" prefetch={false} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px] text-primary")}>
                    <Tag className="h-4 w-4" aria-hidden /> <span className="max-[359px]:sr-only">Label</span>
                  </Link>
                )}
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      {/* Relationship Strength, as words */}
      <section className="mb-6" aria-labelledby="in-stages">
        <SectionHeader id="in-stages" title="Your friendships" />
        {byStage.length === 0 ? (
          <p className={cn("rounded-[22px] p-4 text-[13.5px] text-muted-foreground", GLASS)}>When you make friends on Frenz, you’ll see how each friendship is going here.</p>
        ) : (
          <div className="space-y-3">
            {byStage.map(([stage, list]) => (
              <div key={stage} className={cn("rounded-[22px] p-3.5", GLASS)}>
                <p className="text-[14px] font-semibold">{STAGE_COPY[stage].label}</p>
                <p className="mb-2.5 text-[12.5px] text-muted-foreground">{STAGE_COPY[stage].line}</p>
                <ul className="flex flex-wrap gap-x-3 gap-y-2.5">
                  {list.map((r) => (
                    <li key={r.person.id} className="w-16 text-center">
                      <Link href={`/friends/with/${r.person.handle}`} prefetch={false} className="block" aria-label={`${r.person.displayName}: our story`}>
                        <span className="mx-auto block w-fit">
                          <PersonAvatar user={r.person} size={52} />
                        </span>
                        <span className="mt-1 block truncate text-[11.5px] font-medium">{r.person.displayName.split(" ")[0]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Relationship Archive */}
      <section className="mb-4" aria-labelledby="in-archive">
        <SectionHeader id="in-archive" title="Archived" />
        <p className="mb-2 px-1 text-[12.5px] text-muted-foreground">
          Archived friends leave your Friends list and reminders. Your history together stays, they aren’t told, and you can restore them anytime.
        </p>
        {archived.length ? (
          <GlassGroup label="Archived friends">
            {archived.map((r) => (
              <li key={r.person.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <PersonAvatar user={r.person} size={44} />
                <Link href={`/friends/with/${r.person.handle}`} prefetch={false} className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">
                  {r.person.displayName}
                </Link>
                <button type="button" onClick={() => void act(r, "unarchive")} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                  <ArchiveRestore className="h-4 w-4" aria-hidden /> Restore
                </button>
              </li>
            ))}
          </GlassGroup>
        ) : (
          <p className="flex items-center gap-2 px-1 text-[12.5px] text-muted-foreground">
            <Archive className="h-4 w-4" aria-hidden /> No one is archived. Archive a friend from their menu on the Friends page.
          </p>
        )}
      </section>
    </div>
  );
}
