"use client";

import {
  Archive,
  ArrowLeft,
  Bookmark,
  CalendarDays,
  Check,
  Download,
  Flag,
  History,
  Loader2,
  MapPin,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
  X,
  Lightbulb,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AmbientWash, GLASS, GlassGroup, PersonAvatar, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { useStickyState } from "@/features/ui/use-sticky-state";
import { FEELINGS, MEMORY_CATEGORIES, VISIBILITY, suggestCategory, type MemoryCategory, type MemoryVisibility } from "@/lib/social/memories/engine";
import type { Memory, MemoryLibrary, MemorySuggestion, PersonLite } from "@/lib/social/memories/server";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";

/**
 * Shared Memories™ and Life Journey™ (Feature 19 · Part 14).
 *
 * Private by default, and nothing is filed without a tap: the engine's
 * suggestions (moments other parts of Frenz already know about) wait for
 * "Keep", collections wait for "Create", and every "AI" grouping says why it
 * was made. Every button answers on the tap and is put back if the server
 * refuses (owner, 2026-10-11). The library survives a back-swipe (sticky state).
 */

async function post(body: Record<string, unknown>): Promise<{ error: string | null; data: Record<string, unknown> | null }> {
  const res = await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as Record<string, unknown> | null;
  if (res?.ok) return { error: null, data };
  return { error: (data?.error as string | undefined) ?? (res ? "Couldn't save that." : "You're offline."), data: null };
}

const fmt = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
const FIELD = "min-h-[2.75rem] w-full rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const CHIP = "inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition active:scale-95 motion-reduce:active:scale-100";

type Tab = "journey" | "memories" | "collections" | "people" | "shared";
const TABS: [Tab, string][] = [
  ["journey", "Journey"],
  ["memories", "Memories"],
  ["collections", "Collections"],
  ["people", "People"],
  ["shared", "Shared with you"],
];

export function MemoriesPage({ initial, friends, circles, joinedAt }: { initial: MemoryLibrary; friends: PersonLite[]; circles: { id: string; name: string }[]; joinedAt: string | null }) {
  const [lib, setLib] = useStickyState("memories-lib", initial.loadedAt, initial);
  const libRef = useRef(lib);
  libRef.current = lib;
  const [tab, setTab] = useState<Tab>("journey");
  const [note, setNote] = useState<string | null>(initial.ready ? null : "Memories arrive with the next update.");
  const [editing, setEditing] = useState<Partial<Memory> | null>(null);
  const [open, setOpen] = useState<Memory | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ q: string; ids: string[]; understood: string[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const byId = useMemo(() => new Map(lib.memories.map((m) => [m.id, m])), [lib.memories]);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/memories").then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (r) setLib(r as MemoryLibrary);
  }, [setLib]);

  /** Draw, send, put back on refusal. */
  const act = async (draw: ((x: MemoryLibrary) => MemoryLibrary) | null, body: Record<string, unknown>, after?: () => void) => {
    const before = libRef.current;
    haptic("selection");
    if (draw) setLib(draw(before));
    setNote(null);
    const out = await post(body);
    if (out.error) {
      setLib(before);
      setNote(out.error);
      return out;
    }
    after?.();
    return out;
  };

  const runSearch = async (text: string) => {
    const t = text.trim();
    if (!t) return setResults(null);
    setSearching(true);
    const r = (await fetch(`/api/memories?view=search&q=${encodeURIComponent(t)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null)) as { results: Memory[]; understood: { terms: string[]; personIds: string[]; categories: MemoryCategory[]; sourceKinds: string[]; year: number | null } } | null;
    setSearching(false);
    if (!r) return setNote("Couldn't search right now.");
    const people = new Map(friends.map((f) => [f.id, f.name]));
    for (const m of lib.memories) for (const p of m.people) people.set(p.id, p.name);
    const u = r.understood;
    const understood = [
      ...u.personIds.map((id) => `with ${people.get(id) ?? "someone"}`),
      ...u.categories.map((c) => MEMORY_CATEGORIES[c]),
      ...u.sourceKinds.map((k) => (k === "first_message" ? "first conversation" : k.replace("_", " "))),
      ...(u.year ? [String(u.year)] : []),
      ...u.terms.map((t) => `“${t}”`),
    ];
    setResults({ q: t, ids: r.results.map((m) => m.id), understood });
  };

  const shown = results ? results.ids.map((id) => byId.get(id)).filter((m): m is Memory => !!m) : lib.memories;

  return (
    <div className="relative isolate">
      <AmbientWash />
      <header className="mb-4 flex items-start gap-2 pt-1">
        <Link href="/friends" prefetch={false} aria-label="Back" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] active:bg-black/[0.08]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-[clamp(1.6rem,7vw,2rem)] font-extrabold leading-none tracking-[-0.04em]">Memories</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">Moments you keep, with the people in them. Private unless you share.</p>
        </div>
        <button type="button" onClick={() => setEditing({})} disabled={!lib.ready} className={cn(primaryPill, "shrink-0")}>
          <Plus className="h-4 w-4" aria-hidden /> New
        </button>
      </header>

      <form
        role="search"
        className={cn("mb-3 flex items-center gap-2 rounded-2xl px-3", GLASS)}
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(q);
        }}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input aria-label="Search your memories" value={q} onChange={(e) => (setQ(e.target.value), e.target.value ? null : setResults(null))} placeholder="“the beach trip”, “the project with Sarah”" className="min-h-[2.75rem] min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
        {searching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden /> : null}
      </form>
      {results ? (
        <p className="-mt-1 mb-3 px-1 text-[12.5px] text-muted-foreground">
          {results.ids.length} found{results.understood.length ? ` · understood: ${results.understood.join(", ")}` : ""}{" "}
          <button type="button" className="font-semibold text-primary" onClick={() => (setResults(null), setQ(""))}>
            Clear
          </button>
        </p>
      ) : null}

      <div aria-live="polite">{note ? <p className={cn("mb-3 rounded-2xl px-3.5 py-2.5 text-[13px]", GLASS)}>{note}</p> : null}</div>

      {!results ? (
        <>
          <OnThisDay lib={lib} byId={byId} onOpen={setOpen} onDismiss={(id) => void act((x) => ({ ...x, onThisDay: x.onThisDay.filter((o) => o.id !== id) }), { op: "dismiss", key: `otd:${id}:${new Date().toISOString().slice(0, 4)}` })} />
          <Suggestions ready={lib.ready} onKept={refresh} setNote={setNote} />
        </>
      ) : null}

      <div role="tablist" aria-label="Memories" className={cn("mb-4 flex gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none]", GLASS)}>
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("min-h-[2.5rem] shrink-0 rounded-full px-3.5 text-[13.5px] font-semibold transition active:scale-[0.97] motion-reduce:active:scale-100", tab === k ? "bg-foreground text-background" : "text-foreground/70")}>
            {l}
          </button>
        ))}
      </div>

      {tab === "journey" ? <Journey memories={shown} joinedAt={joinedAt} important={lib.important} onOpen={setOpen} /> : null}
      {tab === "memories" ? <Grid memories={shown} onOpen={setOpen} duplicates={results ? [] : lib.duplicates} byId={byId} onDismissDup={(k) => void act((x) => ({ ...x, duplicates: x.duplicates.filter((d) => [d.a, d.b].sort().join("|") !== k) }), { op: "dismiss", key: `dup:${k}` })} /> : null}
      {tab === "collections" ? <Collections lib={lib} byId={byId} act={act} refresh={refresh} onOpen={setOpen} /> : null}
      {tab === "people" ? <PeopleMap memories={lib.memories} /> : null}
      {tab === "shared" ? <Shared onOpen={setOpen} /> : null}

      {!results && tab !== "shared" && lib.memories.length ? <Insights lib={lib} /> : null}

      <section className="mb-8 mt-6 flex flex-wrap gap-2">
        <button type="button" onClick={() => setArchiveOpen(true)} className={quietPill}>
          <Archive className="h-4 w-4" aria-hidden /> Archive and trash{lib.archived + lib.trash ? ` (${lib.archived + lib.trash})` : ""}
        </button>
        <a href="/api/memories?view=export" download className={quietPill}>
          <Download className="h-4 w-4" aria-hidden /> Export
        </a>
      </section>

      {editing ? (
        <Composer
          initial={editing}
          friends={friends}
          circles={circles}
          onClose={() => setEditing(null)}
          onSaved={(m) => {
            setLib((x) => ({ ...x, memories: [m, ...x.memories.filter((y) => y.id !== m.id)].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)) }));
            setEditing(null);
            setOpen(null);
            void refresh();
          }}
        />
      ) : null}
      {open ? (
        <Detail
          memory={open}
          mine={!!byId.get(open.id)}
          onClose={() => setOpen(null)}
          onEdit={() => setEditing(open)}
          onState={(action) => {
            const id = open.id;
            setOpen(null);
            void act(
              (x) =>
                action === "pin" || action === "unpin"
                  ? { ...x, memories: x.memories.map((m) => (m.id === id ? { ...m, pinned: action === "pin" } : m)) }
                  : { ...x, memories: x.memories.filter((m) => m.id !== id), archived: x.archived + (action === "archive" ? 1 : 0), trash: x.trash + (action === "delete" ? 1 : 0) },
              { op: "state", id, action },
            );
          }}
          onRestored={(m) => {
            setLib((x) => ({ ...x, memories: x.memories.map((y) => (y.id === m.id ? m : y)) }));
            setOpen(m);
          }}
        />
      ) : null}
      {archiveOpen ? <ArchiveSheet onClose={() => setArchiveOpen(false)} onChanged={refresh} /> : null}
    </div>
  );
}

// ─── On this day ────────────────────────────────────────────────────────────

function OnThisDay({ lib, byId, onOpen, onDismiss }: { lib: MemoryLibrary; byId: Map<string, Memory>; onOpen: (m: Memory) => void; onDismiss: (id: string) => void }) {
  if (!lib.onThisDay.length) return null;
  return (
    <section aria-label="On this day" className="mb-4 space-y-2">
      {lib.onThisDay.slice(0, 3).map((o) => {
        const m = byId.get(o.id);
        if (!m) return null;
        return (
          <div key={o.id} className="flex items-center gap-3 overflow-hidden rounded-[22px] bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 px-4 py-3 text-white">
            <CalendarDays className="h-5 w-5 shrink-0 text-white/80" aria-hidden />
            <button type="button" onClick={() => onOpen(m)} className="min-w-0 flex-1 text-left">
              <span className="block text-[12px] font-semibold uppercase tracking-wide text-white/70">{o.yearsAgo === 1 ? "One year ago today" : `${o.yearsAgo} years ago today`}</span>
              <span className="block truncate text-[15px] font-bold">{m.title}</span>
            </button>
            <button type="button" aria-label="Dismiss" onClick={() => onDismiss(o.id)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 transition active:scale-90">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </section>
  );
}

// ─── Suggestions (the Shared Memory Engine) ─────────────────────────────────

function Suggestions({ ready, onKept, setNote }: { ready: boolean; onKept: () => void; setNote: (s: string | null) => void }) {
  const [items, setItems] = useState<MemorySuggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void fetch("/api/memories?view=suggestions")
      .then((r) => (r.ok ? r.json() : { suggestions: [] }))
      .then((j: { suggestions: MemorySuggestion[] }) => live && setItems(j.suggestions))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [ready]);
  if (!items?.length) return null;
  const key = (s: MemorySuggestion) => `${s.sourceKind}|${s.sourceRef}`;
  const keep = async (s: MemorySuggestion) => {
    haptic("selection");
    setBusy(key(s));
    const before = items;
    setItems((x) => (x ?? []).filter((y) => key(y) !== key(s)));
    const out = await post({ op: "keep", sourceKind: s.sourceKind, sourceRef: s.sourceRef });
    setBusy(null);
    if (out.error) {
      setItems(before);
      setNote(out.error);
    } else onKept();
  };
  const notNow = (s: MemorySuggestion) => {
    haptic("selection");
    setItems((x) => (x ?? []).filter((y) => key(y) !== key(s)));
    void post({ op: "dismiss", key: `sugg:${s.sourceKind}|${s.sourceRef}` });
  };
  return (
    <section className="mb-5" aria-labelledby="mem-sugg">
      <SectionHeader id="mem-sugg" title="Moments worth keeping" count={items.length} />
      <p className="-mt-1 mb-2 px-1 text-[12.5px] text-muted-foreground">From things that already happened on Frenz. Nothing is saved until you keep it.</p>
      <div className="flex snap-x gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {items.slice(0, 12).map((s) => (
          <div key={key(s)} className={cn("flex w-[15.5rem] shrink-0 snap-start flex-col rounded-[22px] p-3.5", GLASS)}>
            <div className="flex items-center gap-2.5">
              {s.person ? <PersonAvatar user={{ displayName: s.person.name, avatarUrl: s.person.avatarUrl }} size={36} /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500/12 text-indigo-600"><Flag className="h-4 w-4" aria-hidden /></span>}
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold">{s.title}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{s.person ? `${s.person.name} · ` : ""}{fmt(s.occurredOn)}</span>
              </span>
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">{s.why}</p>
            <div className="mt-auto flex gap-1.5 pt-3">
              <button type="button" onClick={() => void keep(s)} disabled={busy === key(s)} className={cn(primaryPill, "min-h-[2.25rem] flex-1 justify-center px-3 text-[12.5px]")}>
                <Bookmark className="h-3.5 w-3.5" aria-hidden /> Keep
              </button>
              <button type="button" onClick={() => notNow(s)} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                Not now
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Journey ────────────────────────────────────────────────────────────────

function Journey({ memories, joinedAt, important, onOpen }: { memories: Memory[]; joinedAt: string | null; important: { id: string; reasons: string[] }[]; onOpen: (m: Memory) => void }) {
  const years = useMemo(() => {
    const by = new Map<string, Memory[]>();
    for (const m of memories) by.set(m.occurredOn.slice(0, 4), [...(by.get(m.occurredOn.slice(0, 4)) ?? []), m]);
    return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [memories]);
  const star = new Map(important.map((i) => [i.id, i.reasons]));
  if (!memories.length)
    return (
      <p className={cn("rounded-[22px] px-4 py-5 text-center text-[13.5px] text-muted-foreground", GLASS)}>
        Your journey starts with one memory. Keep a moment above, or tap New.
      </p>
    );
  return (
    <ol className="relative ml-3 space-y-6 border-l-2 border-indigo-500/20 pl-5" aria-label="Life journey">
      {years.map(([year, ms]) => (
        <li key={year}>
          <p className="-ml-[1.95rem] mb-2 inline-flex items-center gap-2 text-[13px] font-extrabold tracking-wide">
            <span aria-hidden className="h-3 w-3 rounded-full bg-gradient-to-br from-blue-600 to-violet-600 ring-4 ring-background" /> {year}
          </p>
          <ul className="space-y-2">
            {ms.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => onOpen(m)} className={cn("flex w-full items-start gap-3 rounded-[20px] px-3.5 py-3 text-left transition active:scale-[0.99]", GLASS)}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[14.5px] font-semibold">
                      {m.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-amber-500" aria-label="Pinned" /> : null}
                      <span className="truncate">{m.title}</span>
                    </span>
                    <span className="block text-[12.5px] text-muted-foreground">
                      {fmt(m.occurredOn)} · {MEMORY_CATEGORIES[m.category]}
                      {m.people.length ? ` · with ${m.people.map((p) => p.name).slice(0, 2).join(", ")}${m.people.length > 2 ? ` +${m.people.length - 2}` : ""}` : ""}
                    </span>
                    {star.get(m.id) ? <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-amber-600 dark:text-amber-300"><Lightbulb className="h-3 w-3" aria-hidden /> {star.get(m.id)![0]}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
      {joinedAt ? (
        <li>
          <p className="-ml-[1.95rem] inline-flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            <span aria-hidden className="h-3 w-3 rounded-full bg-muted-foreground/40 ring-4 ring-background" /> Joined Frenzsave · {fmt(joinedAt.slice(0, 10))}
          </p>
        </li>
      ) : null}
    </ol>
  );
}

// ─── Grid ───────────────────────────────────────────────────────────────────

function Grid({ memories, onOpen, duplicates, byId, onDismissDup }: { memories: Memory[]; onOpen: (m: Memory) => void; duplicates: { a: string; b: string; why: string }[]; byId: Map<string, Memory>; onDismissDup: (key: string) => void }) {
  const [cat, setCat] = useState<MemoryCategory | "">("");
  const cats = useMemo(() => [...new Set(memories.map((m) => m.category))], [memories]);
  const list = cat ? memories.filter((m) => m.category === cat) : memories;
  return (
    <div>
      {duplicates.length ? (
        <div className={cn("mb-3 rounded-[20px] px-3.5 py-3", GLASS)}>
          <p className="text-[13.5px] font-semibold">These look like the same memory</p>
          <ul className="mt-1.5 space-y-1.5">
            {duplicates.slice(0, 3).map((d) => {
              const k = [d.a, d.b].sort().join("|");
              return (
                <li key={k} className="flex items-center gap-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    “{byId.get(d.a)?.title}” and “{byId.get(d.b)?.title}” · {d.why}
                  </span>
                  <button type="button" className="shrink-0 font-semibold text-primary" onClick={() => onDismissDup(k)}>
                    They differ
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {cats.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={!cat} onClick={() => setCat("")} className={cn(CHIP, !cat ? "bg-foreground text-background" : "bg-black/[0.05] dark:bg-white/[0.08]")}>
            All
          </button>
          {cats.map((c) => (
            <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)} className={cn(CHIP, cat === c ? "bg-foreground text-background" : "bg-black/[0.05] dark:bg-white/[0.08]")}>
              {MEMORY_CATEGORIES[c]}
            </button>
          ))}
        </div>
      ) : null}
      {list.length ? (
        <ul className="grid grid-cols-2 gap-2.5">
          {list.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => onOpen(m)} className={cn("flex h-full w-full flex-col rounded-[20px] p-3 text-left transition active:scale-[0.98]", GLASS)}>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{MEMORY_CATEGORIES[m.category]}</span>
                <span className="mt-1 line-clamp-2 text-[14px] font-semibold leading-snug">{m.title}</span>
                <span className="mt-auto pt-2 text-[12px] text-muted-foreground">{fmt(m.occurredOn)}</span>
                {m.people.length ? (
                  <span className="mt-1.5 flex -space-x-2">
                    {m.people.slice(0, 4).map((p) => (
                      <PersonAvatar key={p.id} user={{ displayName: p.name, avatarUrl: p.avatarUrl }} size={36} />
                    ))}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={cn("rounded-[22px] px-4 py-5 text-center text-[13.5px] text-muted-foreground", GLASS)}>Nothing here yet.</p>
      )}
    </div>
  );
}

// ─── Collections ────────────────────────────────────────────────────────────

type Act = (draw: ((x: MemoryLibrary) => MemoryLibrary) | null, body: Record<string, unknown>, after?: () => void) => Promise<{ error: string | null; data: Record<string, unknown> | null }>;

function Collections({ lib, byId, act, refresh, onOpen }: { lib: MemoryLibrary; byId: Map<string, Memory>; act: Act; refresh: () => Promise<void>; onOpen: (m: Memory) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const create = (t: string, ids: string[], key: string | null) =>
    void act(
      (x) => ({ ...x, collections: [{ id: `tmp-${Date.now()}`, title: t, description: null, visibility: "private", memoryIds: ids, suggestionKey: key }, ...x.collections], collectionSuggestions: x.collectionSuggestions.filter((s) => s.key !== key) }),
      { op: "collection", title: t, memoryIds: ids, suggestionKey: key },
      () => void refresh(),
    );
  return (
    <div className="space-y-5">
      {lib.collectionSuggestions.length ? (
        <section aria-labelledby="col-sugg">
          <SectionHeader id="col-sugg" title="Suggested collections" />
          <GlassGroup label="Suggested collections">
            {lib.collectionSuggestions.map((s) => (
              <li key={s.key} className="flex items-center gap-3 px-3.5 py-3">
                <Lightbulb className="h-[18px] w-[18px] shrink-0 text-violet-500" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{s.title}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">{s.memoryIds.length} memories · {s.why}</span>
                </span>
                <button type="button" onClick={() => create(s.title, s.memoryIds, s.key)} className={cn(primaryPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                  Create
                </button>
                <button type="button" aria-label={`Not now: ${s.title}`} onClick={() => void act((x) => ({ ...x, collectionSuggestions: x.collectionSuggestions.filter((y) => y.key !== s.key) }), { op: "dismiss", key: `col:${s.key}` })} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition active:bg-black/[0.06]">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}
      <section aria-labelledby="col-mine">
        <SectionHeader id="col-mine" title="Your collections" count={lib.collections.length} />
        <form
          className={cn("mb-2 flex gap-2 rounded-[20px] p-2", GLASS)}
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            create(title.trim(), [], null);
            setTitle("");
          }}
        >
          <input aria-label="New collection" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="New collection, e.g. University life" className={cn(FIELD, "border-0 bg-transparent")} />
          <button type="submit" disabled={!title.trim()} className={cn(primaryPill, "shrink-0")}>
            <Plus className="h-4 w-4" aria-hidden /> Add
          </button>
        </form>
        {lib.collections.length ? (
          <GlassGroup label="Your collections">
            {lib.collections.map((c) => {
              const expanded = openId === c.id;
              const items = c.memoryIds.map((id) => byId.get(id)).filter((m): m is Memory => !!m);
              return (
                <li key={c.id}>
                  <button type="button" aria-expanded={expanded} onClick={() => setOpenId(expanded ? null : c.id)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition active:bg-black/[0.04]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold">{c.title}</span>
                      <span className="block text-[12.5px] text-muted-foreground">{items.length} memories · {VISIBILITY[c.visibility as MemoryVisibility] ?? "Only me"}</span>
                    </span>
                  </button>
                  {expanded ? (
                    <div className="space-y-2 border-t border-black/[0.06] px-3.5 py-3 dark:border-white/[0.07]">
                      {items.length ? (
                        <ul className="space-y-1">
                          {items.map((m) => (
                            <li key={m.id} className="flex items-center gap-2">
                              <button type="button" onClick={() => onOpen(m)} className="min-w-0 flex-1 truncate text-left text-[13.5px] font-medium">
                                {m.title}
                              </button>
                              <button type="button" aria-label={`Remove ${m.title}`} onClick={() => void act((x) => ({ ...x, collections: x.collections.map((y) => (y.id === c.id ? { ...y, memoryIds: y.memoryIds.filter((i) => i !== m.id) } : y)) }), { op: "collection", id: c.id, title: c.title, memoryIds: c.memoryIds.filter((i) => i !== m.id) })} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground">
                                <X className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[12.5px] text-muted-foreground">Empty. Add memories from a memory&apos;s page.</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <select aria-label="Who can see this collection" value={c.visibility} onChange={(e) => void act((x) => ({ ...x, collections: x.collections.map((y) => (y.id === c.id ? { ...y, visibility: e.target.value } : y)) }), { op: "collection", id: c.id, title: c.title, visibility: e.target.value })} className="min-h-[2.25rem] rounded-full border border-border bg-background px-3 text-[13px]">
                          <option value="private">Only me</option>
                          <option value="people">People in it</option>
                          <option value="friends">Friends</option>
                        </select>
                        <button type="button" onClick={() => void act((x) => ({ ...x, collections: x.collections.filter((y) => y.id !== c.id) }), { op: "collection_delete", id: c.id })} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px] text-rose-600")}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete collection
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </GlassGroup>
        ) : null}
      </section>
    </div>
  );
}

// ─── People (Social History Map) ───────────────────────────────────────────

function PeopleMap({ memories }: { memories: Memory[] }) {
  const people = useMemo(() => {
    const by = new Map<string, { p: Memory["people"][number]; count: number; cats: Set<MemoryCategory>; first: string; last: string }>();
    for (const m of memories)
      for (const p of m.people) {
        const e = by.get(p.id) ?? { p, count: 0, cats: new Set<MemoryCategory>(), first: m.occurredOn, last: m.occurredOn };
        e.count++;
        e.cats.add(m.category);
        if (m.occurredOn < e.first) e.first = m.occurredOn;
        if (m.occurredOn > e.last) e.last = m.occurredOn;
        by.set(p.id, e);
      }
    return [...by.values()].sort((a, b) => b.count - a.count).slice(0, 18);
  }, [memories]);
  if (!people.length) return <p className={cn("rounded-[22px] px-4 py-5 text-center text-[13.5px] text-muted-foreground", GLASS)}>Add friends to your memories and your map appears here.</p>;
  const max = people[0]!.count;
  // a calm constellation: you in the middle, the people you share most with closest
  const R = 120;
  return (
    <div>
      <div className={cn("relative mx-auto mb-4 aspect-square w-full max-w-[22rem] rounded-[28px]", GLASS)} role="img" aria-label={`Your memories map: ${people.map((e) => `${e.p.name}, ${e.count}`).join("; ")}`}>
        <svg viewBox="-160 -160 320 320" className="absolute inset-0 h-full w-full" aria-hidden>
          {[0.45, 0.75, 1].map((r) => (
            <circle key={r} r={R * r} fill="none" stroke="currentColor" className="text-indigo-500/15" strokeDasharray="3 5" />
          ))}
          {people.map((e, i) => {
            const ring = 0.45 + (1 - e.count / max) * 0.55;
            const a = (i / people.length) * Math.PI * 2 - Math.PI / 2;
            return <line key={e.p.id} x1={0} y1={0} x2={Math.cos(a) * R * ring} y2={Math.sin(a) * R * ring} stroke="currentColor" className="text-indigo-500/25" strokeWidth={1 + (e.count / max) * 2} />;
          })}
        </svg>
        {people.map((e, i) => {
          const ring = 0.45 + (1 - e.count / max) * 0.55;
          const a = (i / people.length) * Math.PI * 2 - Math.PI / 2;
          const x = 50 + (Math.cos(a) * R * ring * 50) / 160;
          const y = 50 + (Math.sin(a) * R * ring * 50) / 160;
          return (
            <span key={e.p.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }} title={`${e.p.name}: ${e.count}`}>
              <PersonAvatar user={{ displayName: e.p.name, avatarUrl: e.p.avatarUrl }} size={36} />
            </span>
          );
        })}
        <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-[12px] font-bold text-white">You</span>
      </div>
      <GlassGroup label="People in your memories">
        {people.map((e) => (
          <li key={e.p.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <PersonAvatar user={{ displayName: e.p.name, avatarUrl: e.p.avatarUrl }} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{e.p.name}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {e.count} {e.count === 1 ? "memory" : "memories"} · {[...e.cats].map((c) => MEMORY_CATEGORIES[c]).slice(0, 3).join(", ")} · since {e.first.slice(0, 4)}
              </span>
            </span>
            <Link href={`/friends/with/${e.p.handle}`} prefetch={false} className="text-[12.5px] font-semibold text-primary">
              Our story
            </Link>
          </li>
        ))}
      </GlassGroup>
    </div>
  );
}

// ─── Shared with you ────────────────────────────────────────────────────────

function Shared({ onOpen }: { onOpen: (m: Memory) => void }) {
  const [items, setItems] = useState<(Memory & { owner: PersonLite | null })[] | null>(null);
  useEffect(() => {
    let live = true;
    void fetch("/api/memories?view=shared")
      .then((r) => (r.ok ? r.json() : { memories: [] }))
      .then((j: { memories: (Memory & { owner: PersonLite | null })[] }) => live && setItems(j.memories))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, []);
  if (!items) return <div className="h-24 animate-pulse rounded-[22px] bg-black/[0.04] motion-reduce:animate-none" aria-busy="true" />;
  if (!items.length) return <p className={cn("rounded-[22px] px-4 py-5 text-center text-[13.5px] text-muted-foreground", GLASS)}>When a friend adds you to a memory they share, it appears here.</p>;
  return (
    <GlassGroup label="Shared with you">
      {items.map((m) => (
        <li key={m.id}>
          <button type="button" onClick={() => onOpen(m)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition active:bg-black/[0.04]">
            {m.owner ? <PersonAvatar user={{ displayName: m.owner.name, avatarUrl: m.owner.avatarUrl }} size={36} /> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{m.title}</span>
              <span className="block truncate text-[12.5px] text-muted-foreground">
                {m.owner ? `${m.owner.name} · ` : ""}
                {fmt(m.occurredOn)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </GlassGroup>
  );
}

// ─── Insights ───────────────────────────────────────────────────────────────

function Insights({ lib }: { lib: MemoryLibrary }) {
  const i = lib.insights;
  const rows = [
    ["Memories", i.total.toLocaleString()],
    i.topPerson ? ["Most shared with", `${i.topPerson.name} (${i.topPerson.count})`] : null,
    i.busiestMonth ? ["Busiest month", `${i.busiestMonth.label} (${i.busiestMonth.count})`] : null,
    i.span ? ["Your journey so far", `${Math.max(1, Math.round(i.span.days / 30))} months`] : null,
  ].filter((x): x is string[] => !!x);
  return (
    <section className="mt-6" aria-labelledby="mem-ins">
      <SectionHeader id="mem-ins" title="Your memories, privately" />
      <div className={cn("grid grid-cols-2 gap-3 rounded-[22px] px-3.5 py-3", GLASS)}>
        {rows.map(([l, v]) => (
          <div key={l} className="min-w-0">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{l}</p>
            <p className="truncate text-[15px] font-bold">{v}</p>
          </div>
        ))}
        {i.categories.length ? <p className="col-span-2 text-[12.5px] text-muted-foreground">{i.categories.slice(0, 4).map((c) => `${c.label} ${c.count}`).join(" · ")}</p> : null}
      </div>
    </section>
  );
}

// ─── Composer ───────────────────────────────────────────────────────────────

function Composer({ initial, friends, circles, onClose, onSaved }: { initial: Partial<Memory>; friends: PersonLite[]; circles: { id: string; name: string }[]; onClose: () => void; onSaved: (m: Memory) => void }) {
  const [f, setF] = useState({
    title: initial.title ?? "",
    note: initial.note ?? "",
    category: (initial.category ?? "") as MemoryCategory | "",
    occurredOn: initial.occurredOn ?? new Date().toISOString().slice(0, 10),
    place: initial.place ?? "",
    feeling: initial.feeling ?? "",
    linkUrl: initial.linkUrl ?? "",
    visibility: (initial.visibility ?? "private") as MemoryVisibility,
    circleId: initial.circleId ?? "",
    pinned: initial.pinned ?? false,
    people: (initial.people ?? []).map((p) => p.id),
  });
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const guess = !f.category ? suggestCategory(`${f.title} ${f.note}`) : null;
  const matches = find.trim() ? friends.filter((p) => !f.people.includes(p.id) && `${p.name} ${p.handle}`.toLowerCase().includes(find.trim().toLowerCase().replace(/^@/, ""))).slice(0, 6) : [];
  const save = async () => {
    haptic("selection");
    setBusy(true);
    setErr(null);
    const out = await post({
      op: "save",
      memory: {
        ...(initial.id ? { id: initial.id } : {}),
        title: f.title,
        note: f.note || null,
        category: f.category || guess?.category || "friendship",
        occurredOn: f.occurredOn,
        place: f.place || null,
        feeling: f.feeling || null,
        linkUrl: f.linkUrl || null,
        visibility: f.visibility,
        circleId: f.visibility === "circle" ? f.circleId || null : null,
        pinned: f.pinned,
        peopleIds: f.people,
      },
    });
    setBusy(false);
    if (out.error) return setErr(out.error);
    onSaved(out.data?.memory as Memory);
  };
  const byId = new Map(friends.map((p) => [p.id, p]));
  for (const p of initial.people ?? []) byId.set(p.id, p);
  return (
    <GlassSheetShell open onClose={onClose} title={initial.id ? "Edit memory" : "New memory"} defaultHeightVh={88}>
      <form
        className="space-y-3 px-4 pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input aria-label="Title" required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What happened?" className={FIELD} />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[12.5px] text-muted-foreground">
            Date
            <input type="date" value={f.occurredOn} onChange={(e) => setF({ ...f, occurredOn: e.target.value })} className={cn(FIELD, "mt-1")} />
          </label>
          <label className="text-[12.5px] text-muted-foreground">
            Category
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as MemoryCategory })} className={cn(FIELD, "mt-1")}>
              <option value="">{guess ? `${MEMORY_CATEGORIES[guess.category]} (suggested)` : "Choose"}</option>
              {(Object.keys(MEMORY_CATEGORIES) as MemoryCategory[]).map((c) => (
                <option key={c} value={c}>
                  {MEMORY_CATEGORIES[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {guess ? <p className="-mt-1 text-[12px] text-muted-foreground">Suggested {MEMORY_CATEGORIES[guess.category]} because you wrote “{guess.because}”.</p> : null}
        <textarea aria-label="Note" rows={3} maxLength={4000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="A few words to remember it by (optional)" className={cn(FIELD, "resize-y py-2")} />
        <div>
          <p className="text-[12.5px] text-muted-foreground">With</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {f.people.map((id) => {
              const p = byId.get(id);
              return (
                <button key={id} type="button" onClick={() => setF({ ...f, people: f.people.filter((x) => x !== id) })} className={cn(CHIP, "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300")}>
                  {p?.name ?? "Friend"} <X className="h-3 w-3" aria-hidden />
                </button>
              );
            })}
          </div>
          <input aria-label="Add a friend" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Add a friend" className={cn(FIELD, "mt-1.5")} />
          {matches.length ? (
            <ul className="mt-1 overflow-hidden rounded-xl border border-border">
              {matches.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => (setF({ ...f, people: [...f.people, p.id] }), setFind(""))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] transition hover:bg-black/[0.03]">
                    <PersonAvatar user={{ displayName: p.name, avatarUrl: p.avatarUrl }} size={36} /> {p.name} <span className="text-muted-foreground">@{p.handle}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1 text-[11.5px] text-muted-foreground">Only friends can be added.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[12.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden /> Place (optional)</span>
            <input maxLength={120} value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} className={cn(FIELD, "mt-1")} />
          </label>
          <label className="text-[12.5px] text-muted-foreground">
            Feeling (optional)
            <select value={f.feeling} onChange={(e) => setF({ ...f, feeling: e.target.value })} className={cn(FIELD, "mt-1")}>
              <option value="">None</option>
              {(Object.keys(FEELINGS) as (keyof typeof FEELINGS)[]).map((k) => (
                <option key={k} value={k}>
                  {FEELINGS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input aria-label="Link (optional)" type="url" maxLength={600} value={f.linkUrl} onChange={(e) => setF({ ...f, linkUrl: e.target.value })} placeholder="https:// link (optional)" className={FIELD} />
        <fieldset>
          <legend className="text-[12.5px] text-muted-foreground">Who can see it</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(Object.keys(VISIBILITY) as MemoryVisibility[]).map((v) => (
              <button key={v} type="button" aria-pressed={f.visibility === v} onClick={() => setF({ ...f, visibility: v })} disabled={v === "circle" && !circles.length} className={cn(CHIP, f.visibility === v ? "bg-foreground text-background" : "bg-black/[0.05] dark:bg-white/[0.08]", "disabled:opacity-40")}>
                {VISIBILITY[v]}
              </button>
            ))}
          </div>
          {f.visibility === "circle" ? (
            <select aria-label="Circle" value={f.circleId} onChange={(e) => setF({ ...f, circleId: e.target.value })} className={cn(FIELD, "mt-2")}>
              <option value="">Choose a circle</option>
              {circles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : null}
        </fieldset>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} className="h-4 w-4" /> Pin it to the top of your journey
        </label>
        {err ? <p className="text-[13px] font-medium text-rose-600">{err}</p> : null}
        <button type="submit" disabled={busy || !f.title.trim()} className={cn(primaryPill, "w-full justify-center")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
          {busy ? "Saving…" : "Save memory"}
        </button>
      </form>
    </GlassSheetShell>
  );
}

// ─── One memory ─────────────────────────────────────────────────────────────

function Detail({ memory: m, mine, onClose, onEdit, onState, onRestored }: { memory: Memory; mine: boolean; onClose: () => void; onEdit: () => void; onState: (a: "archive" | "delete" | "pin" | "unpin") => void; onRestored: (m: Memory) => void }) {
  const [versions, setVersions] = useState<{ version: number; snapshot: Record<string, unknown>; at: string }[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const loadVersions = async () => {
    const r = await fetch(`/api/memories?view=versions&id=${m.id}`).then((x) => (x.ok ? x.json() : { versions: [] })).catch(() => ({ versions: [] }));
    setVersions(r.versions);
  };
  const restore = async (v: number) => {
    haptic("selection");
    setBusy(v);
    const out = await post({ op: "restore_version", id: m.id, version: v });
    setBusy(null);
    if (!out.error && out.data?.memory) onRestored(out.data.memory as Memory);
  };
  return (
    <GlassSheetShell open onClose={onClose} title={m.title} defaultHeightVh={80} fitContent>
      <div className="space-y-3 px-4 pb-6">
        <p className="text-[13px] text-muted-foreground">
          {fmt(m.occurredOn)} · {MEMORY_CATEGORIES[m.category]}
          {m.place ? ` · ${m.place}` : ""}
          {m.feeling ? ` · ${FEELINGS[m.feeling as keyof typeof FEELINGS] ?? ""}` : ""}
        </p>
        {m.note ? <p className="whitespace-pre-line text-[15px] leading-relaxed">{m.note}</p> : null}
        {m.people.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
            {m.people.map((p) => (
              <Link key={p.id} href={`${profilePath(p.handle)}`} prefetch={false} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold">
                <PersonAvatar user={{ displayName: p.name, avatarUrl: p.avatarUrl }} size={36} /> {p.name}
              </Link>
            ))}
          </div>
        ) : null}
        {m.linkUrl ? (
          <a href={m.linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-[13.5px] font-semibold text-primary">
            {m.linkUrl}
          </a>
        ) : null}
        <p className="text-[12px] text-muted-foreground">{VISIBILITY[m.visibility]} · version {m.version}</p>
        {mine ? (
          <>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onEdit} className={quietPill}>
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </button>
              <button type="button" onClick={() => onState(m.pinned ? "unpin" : "pin")} className={quietPill}>
                <Pin className="h-4 w-4" aria-hidden /> {m.pinned ? "Unpin" : "Pin"}
              </button>
              <button type="button" onClick={() => onState("archive")} className={quietPill}>
                <Archive className="h-4 w-4" aria-hidden /> Archive
              </button>
              <button type="button" onClick={() => onState("delete")} className={cn(quietPill, "text-rose-600")}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete
              </button>
            </div>
            {m.version > 1 ? (
              versions ? (
                <div>
                  <p className="text-[13px] font-semibold">Earlier versions</p>
                  <ul className="mt-1 space-y-1">
                    {versions.map((v) => (
                      <li key={v.version} className="flex items-center gap-2 text-[13px]">
                        <span className="min-w-0 flex-1 truncate">
                          v{v.version} · {String(v.snapshot.title)} <span className="text-muted-foreground">· {new Date(v.at).toLocaleDateString()}</span>
                        </span>
                        <button type="button" disabled={busy === v.version} onClick={() => void restore(v.version)} className="inline-flex items-center gap-1 font-semibold text-primary">
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <button type="button" onClick={() => void loadVersions()} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary">
                  <History className="h-4 w-4" aria-hidden /> Version history
                </button>
              )
            ) : null}
            <p className="text-[11.5px] text-muted-foreground">Deleted memories stay in the trash for 30 days.</p>
          </>
        ) : null}
      </div>
    </GlassSheetShell>
  );
}

// ─── Archive and trash ──────────────────────────────────────────────────────

function ArchiveSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<{ archived: Memory[]; trash: Memory[] } | null>(null);
  useEffect(() => {
    void fetch("/api/memories?view=archive")
      .then((r) => (r.ok ? r.json() : { archived: [], trash: [] }))
      .then(setData)
      .catch(() => setData({ archived: [], trash: [] }));
  }, []);
  const act = async (id: string, action: "unarchive" | "restore" | "purge", from: "archived" | "trash") => {
    haptic("selection");
    const before = data;
    setData((d) => (d ? { ...d, [from]: d[from].filter((m) => m.id !== id) } : d));
    const out = await post({ op: "state", id, action });
    if (out.error) setData(before);
    else void onChanged();
  };
  const row = (m: Memory, from: "archived" | "trash") => (
    <li key={m.id} className="flex items-center gap-2 px-3.5 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{m.title}</span>
        <span className="block text-[12px] text-muted-foreground">{fmt(m.occurredOn)}</span>
      </span>
      <button type="button" onClick={() => void act(m.id, from === "archived" ? "unarchive" : "restore", from)} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore
      </button>
      {from === "trash" ? (
        <button type="button" onClick={() => void act(m.id, "purge", from)} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px] text-rose-600")}>
          Delete forever
        </button>
      ) : null}
    </li>
  );
  return (
    <GlassSheetShell open onClose={onClose} title="Archive and trash" defaultHeightVh={75}>
      <div className="space-y-4 px-4 pb-6">
        {!data ? (
          <div className="h-24 animate-pulse rounded-2xl bg-black/[0.04] motion-reduce:animate-none" aria-busy="true" />
        ) : (
          <>
            <section>
              <SectionHeader title="Archived" count={data.archived.length} />
              {data.archived.length ? <GlassGroup label="Archived">{data.archived.map((m) => row(m, "archived"))}</GlassGroup> : <p className="text-[13px] text-muted-foreground">Nothing archived.</p>}
            </section>
            <section>
              <SectionHeader title="Trash" count={data.trash.length} />
              <p className="-mt-1 mb-2 text-[12px] text-muted-foreground">Kept for 30 days, then deleted for good.</p>
              {data.trash.length ? <GlassGroup label="Trash">{data.trash.map((m) => row(m, "trash"))}</GlassGroup> : <p className="text-[13px] text-muted-foreground">The trash is empty.</p>}
            </section>
          </>
        )}
      </div>
    </GlassSheetShell>
  );
}
