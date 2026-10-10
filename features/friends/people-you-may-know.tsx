"use client";

import { Check, Loader2, MoreHorizontal, RotateCw, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { VerifiedTick } from "@/components/badges/identity-badges";
import { FollowChip } from "@/features/friends/follow-chip";
import { GLASS, GlassGroup, iconButton, PersonAvatar, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import { usePresence } from "@/features/friends/use-presence";
import type { SuggestionFilter } from "@/lib/social/graph/suggestions";
import type { PersonSuggestion } from "@/lib/social/people/engine";
import { cn } from "@/lib/utils";

/**
 * People You May Know™ (Feature 19 · Part 6), on Add friends.
 *
 *   · Every person carries the reason they are here, from the one engine
 *     (lib/social/people/engine.ts). The reason never names or counts a
 *     connection someone kept private, and the engine's confidence never
 *     reaches the browser.
 *   · Filters are facts about the person: a connection you share, their own
 *     profile type, verification, the same public location.
 *   · Feedback is one tap and undoable: not interested, already know (which
 *     offers a friend request), remind me later (a week), hide. Reset brings
 *     everyone back. All of it is private (people_suggestion_feedback, 0221).
 *   · The last list per filter is kept for this tab, so switching filters or
 *     coming back to the page shows people at once.
 */

const FILTERS: { key: SuggestionFilter; label: string }[] = [
  { key: "all", label: "For you" },
  { key: "mutual", label: "People you know" },
  { key: "creators", label: "Creators" },
  { key: "businesses", label: "Businesses" },
  { key: "professionals", label: "Professionals" },
  { key: "verified", label: "Verified" },
  { key: "nearby", label: "Near you" },
];

type FeedbackAction = "hide" | "not_interested" | "already_know" | "later";
const FEEDBACK: { key: FeedbackAction; label: string; done: string }[] = [
  { key: "not_interested", label: "Not interested", done: "We’ll show fewer people like this." },
  { key: "already_know", label: "I already know them", done: "Got it. Add them as a friend?" },
  { key: "later", label: "Remind me later", done: "Hidden for a week." },
  { key: "hide", label: "Hide", done: "You won’t see them here again." },
];

type Lists = Partial<Record<SuggestionFilter, PersonSuggestion[]>>;
const SESSION_KEY = "frenz.pymk.v1";
function readSession(): Lists {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "{}") as Lists;
  } catch {
    return {};
  }
}
function writeSession(v: Lists) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(v));
  } catch {
    /* private mode: the list still works, only not across a reload */
  }
}

export function PeopleYouMayKnow({ initial }: { initial: PersonSuggestion[] }) {
  const [filter, setFilter] = useState<SuggestionFilter>("all");
  const [lists, setLists] = useState<Lists>({ all: initial });
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [undo, setUndo] = useState<{ person: PersonSuggestion; action: FeedbackAction; filter: SuggestionFilter; index: number } | null>(null);
  const [resetState, setResetState] = useState<"idle" | "armed" | "busy" | "done">("idle");

  // the server's fresh "For you" list wins; the other filters come back from this tab
  useEffect(() => {
    const kept = { ...readSession(), all: initial };
    setLists(kept);
    writeSession(kept);
  }, [initial]);

  const update = (fn: (m: Lists) => Lists) =>
    setLists((m) => {
      const next = fn(m);
      writeSession(next);
      return next;
    });

  const load = async (f: SuggestionFilter, force = false) => {
    setFilter(f);
    setFailed(false);
    if (!force && lists[f]) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/people/suggestions?filter=${f}`);
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { people?: PersonSuggestion[] };
      update((m) => ({ ...m, [f]: j.people ?? [] }));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const list = lists[filter] ?? [];

  const answer = (person: PersonSuggestion, action: FeedbackAction) => {
    const index = list.findIndex((p) => p.id === person.id);
    // the same person leaves every filter at once
    update((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, (v ?? []).filter((p) => p.id !== person.id)])) as Lists);
    setUndo({ person, action, filter, index });
    void fetch("/api/people/suggestions/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectId: person.id, action }),
    }).catch(() => {});
  };

  const undoLast = () => {
    if (!undo) return;
    const { person, index, filter: from } = undo;
    setUndo(null);
    update((m) => {
      const cur = [...(m[from] ?? [])];
      cur.splice(Math.max(0, Math.min(index, cur.length)), 0, person);
      return { ...m, [from]: cur };
    });
    void fetch(`/api/people/suggestions/feedback?subjectId=${person.id}`, { method: "DELETE" }).catch(() => {});
  };

  const reset = async () => {
    if (resetState !== "armed") {
      setResetState("armed");
      return;
    }
    setResetState("busy");
    const res = await fetch("/api/people/suggestions/feedback", { method: "DELETE" }).catch(() => null);
    setResetState(res?.ok ? "done" : "idle");
    setUndo(null);
    update(() => ({}));
    void load(filter, true);
  };

  return (
    <section aria-labelledby="pymk-title">
      <SectionHeader id="pymk-title" title="People you may know" />
      <div role="tablist" aria-label="Filter suggestions" className="-mx-3 mb-3 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:-mx-4 sm:px-4 [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => void load(f.key)}
            className={cn(
              "min-h-[2.25rem] shrink-0 rounded-full px-3.5 text-[13px] font-semibold transition",
              filter === f.key ? "bg-foreground text-background" : "bg-black/[0.04] text-foreground/75 dark:bg-white/[0.07]",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {undo ? (
        <div role="status" className={cn("mb-3 flex items-center gap-2 rounded-2xl px-3.5 py-2", GLASS)}>
          <span className="min-w-0 flex-1 text-[13px] leading-snug">{FEEDBACK.find((x) => x.key === undo.action)?.done}</span>
          {undo.action === "already_know" ? <AddFriendChip id={undo.person.id} name={undo.person.displayName} /> : null}
          <button type="button" onClick={undoLast} className="min-h-[2.5rem] shrink-0 px-1 text-[13px] font-semibold text-primary">
            Undo
          </button>
        </div>
      ) : null}

      {loading && !list.length ? (
        <ul role="status" aria-live="polite" className={cn("divide-y divide-black/[0.06] overflow-hidden rounded-[22px] dark:divide-white/[0.07]", GLASS)}>
          <li className="sr-only">Loading suggestions…</li>
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-3.5 py-2.5" aria-hidden>
              <span className="h-[52px] w-[52px] shrink-0 rounded-full bg-secondary shimmer" />
              <span className="flex-1 space-y-2 py-1">
                <span className="block h-3.5 w-32 rounded bg-secondary shimmer" />
                <span className="block h-3 w-40 rounded bg-secondary shimmer" />
              </span>
              <span className="h-9 w-[84px] shrink-0 rounded-full bg-secondary shimmer" />
            </li>
          ))}
        </ul>
      ) : failed ? (
        <div role="alert" className={cn("flex flex-col items-center rounded-[22px] px-6 py-12 text-center", GLASS)}>
          <p className="text-[15.5px] font-semibold">Couldn&rsquo;t load suggestions</p>
          <button type="button" onClick={() => void load(filter, true)} className={cn(primaryPill, "mt-4")}>
            <RotateCw className="h-4 w-4" aria-hidden /> Try again
          </button>
        </div>
      ) : list.length === 0 ? (
        <div className={cn("flex flex-col items-center rounded-[22px] px-6 py-12 text-center", GLASS)}>
          <span aria-hidden className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Users className="h-6 w-6" />
          </span>
          <p className="text-[15.5px] font-semibold">{filter === "all" ? "No suggestions right now" : "No one here yet"}</p>
          <p className="mt-1.5 max-w-xs text-[13.5px] text-muted-foreground">
            {filter === "all"
              ? "Suggestions come from your friends, the people you follow and your contacts. Inviting friends is the fastest way."
              : "As more people join, they’ll show up here."}
          </p>
        </div>
      ) : (
        <GlassGroup label="Suggested people">
          {list.map((p) => (
            <SuggestionRow key={p.id} person={p} onAnswer={(a) => answer(p, a)} />
          ))}
        </GlassGroup>
      )}

      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={() => void reset()}
          disabled={resetState === "busy"}
          className="min-h-[2.75rem] rounded-full px-3 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          {resetState === "armed" ? "Tap again to bring back everyone you hid" : resetState === "done" ? "Suggestions reset" : resetState === "busy" ? "Resetting…" : "Reset suggestions"}
        </button>
      </div>
    </section>
  );
}

function SuggestionRow({ person, onAnswer }: { person: PersonSuggestion; onAnswer: (a: FeedbackAction) => void }) {
  const online = usePresence();
  const isOnline = online.has(person.id);
  const [menu, setMenu] = useState(false);
  return (
    <li className="px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <Link href={`/u/${person.handle}`} prefetch={false} aria-label={isOnline ? `${person.displayName}, online` : person.displayName} className="shrink-0">
          <PersonAvatar user={person} size={52} online={isOnline} />
        </Link>
        <Link href={`/u/${person.handle}`} prefetch={false} className="min-w-0 flex-1 py-0.5">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">{person.displayName}</span>
            {person.isVerified ? <VerifiedTick size="sm" className="h-[15px] w-[15px] shrink-0" /> : null}
          </span>
          {/* the reason: true, and never naming or counting a private connection */}
          <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">{person.reason}</span>
        </Link>
        {/* someone you already follow is suggested as a FRIEND - there is evidence you know each other */}
        {person.isFollowing ? <AddFriendChip id={person.id} name={person.displayName} /> : <FollowChip id={person.id} name={person.displayName} initial={false} />}
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          aria-expanded={menu}
          aria-label={`Options for ${person.displayName}`}
          className={cn(iconButton, "-mr-2 h-10 w-9")}
        >
          <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </div>
      {menu ? (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-[62px]" role="group" aria-label={`About suggesting ${person.displayName}`}>
          {FEEDBACK.map((f) => (
            <button key={f.key} type="button" onClick={() => onAnswer(f.key)} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/** A friend request from a suggestion (source "suggestion"), through the same route as everywhere else. */
function AddFriendChip({ id, name }: { id: string; name: string }) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "failed">("idle");
  const send = async () => {
    if (state === "busy" || state === "sent") return;
    setState("busy");
    const res = await fetch(`/api/friends/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "request", source: "suggestion" }),
    }).catch(() => null);
    setState(res?.ok ? "sent" : "failed");
  };
  return (
    <button
      type="button"
      onClick={() => void send()}
      disabled={state === "busy"}
      aria-label={state === "sent" ? `Friend request sent to ${name}` : `Add ${name} as a friend`}
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold max-[359px]:px-2.5",
        state === "sent" ? "bg-black/[0.05] text-foreground/80 dark:bg-white/[0.08]" : "bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_hsl(var(--primary)/0.7)]",
      )}
    >
      {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : state === "sent" ? <Check className="h-4 w-4" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />}
      <span className="max-[359px]:sr-only">{state === "sent" ? "Sent" : state === "failed" ? "Retry" : "Add"}</span>
    </button>
  );
}
