"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BadgeCheck,
  Check,
  ChevronDown,
  Download,
  ListPlus,
  Loader2,
  Search,
  Sparkles,
  Star,
  Tag,
  Undo2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { CircleGlyph } from "@/features/friends/circle-icon";
import { usePresence } from "@/features/friends/use-presence";
import { useStickyState } from "@/features/ui/use-sticky-state";
import { AmbientWash, GLASS, GlassGroup, PersonAvatar, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import { haptic } from "@/lib/motion/haptics";
import { circleColorClasses } from "@/lib/social/graph/circles";
import {
  exportCsv,
  inSmartList,
  listInsights,
  listTree,
  organizationSuggestions,
  parseHandles,
  RULE_KINDS,
  RULE_LABEL,
  ruleCandidates,
  searchPeople,
  SMART_LISTS,
  tagCounts,
  type DirectoryPerson,
  type ListNode,
  type ListRule,
  type OrgSuggestion,
  type RuleKind,
  type SmartListKey,
} from "@/lib/social/lists/engine";
import type { RelationshipDirectory } from "@/lib/social/lists/server";
import { cn } from "@/lib/utils";

/**
 * Relationship Manager™ (Feature 19 · Part 10).
 *
 * Every connection in one place — friends, followers, following — with your
 * lists (circles), smart lists, private tags, rules and bulk actions. Only the
 * member sees it. Every bulk action can be undone from the bar that confirms
 * it, and every suggestion waits for a tap.
 *
 * The whole directory arrives once from the server, so search, filters and
 * smart lists are instant and cost no request per keystroke.
 */

type BulkAction = "add_to_list" | "remove_from_list" | "tag" | "untag" | "favorite" | "unfavorite" | "archive" | "unarchive";
const OPPOSITE: Record<BulkAction, BulkAction> = { add_to_list: "remove_from_list", remove_from_list: "add_to_list", tag: "untag", untag: "tag", favorite: "unfavorite", unfavorite: "favorite", archive: "unarchive", unarchive: "archive" };

type Undo = { label: string; run: () => Promise<void> } | null;

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; data: T | null; error?: string }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as (T & { error?: string }) | null;
  return { ok: !!res?.ok, data, error: data?.error ?? (res ? undefined : "You're offline.") };
}

const PAGE = 50;
const NO_ONE: ReadonlySet<string> = new Set();
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function RelationshipManager({ initial }: { initial: RelationshipDirectory }) {
  // sticky: a back-swipe replays the cached payload, and the member's changes must survive it
  const [people, setPeople] = useStickyState("rm-people", initial.loadedAt, initial.people);
  const [lists, setLists] = useStickyState("rm-lists", initial.loadedAt, initial.lists);
  const [rules, setRules] = useStickyState("rm-rules", initial.loadedAt, initial.rules);
  // Undo runs LATER, from a closure made earlier: it must read the people and lists as they are now
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const [q, setQ] = useState("");
  const [smart, setSmart] = useState<SmartListKey | null>(null);
  const [listFilter, setListFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(initial.capped ? "You have more connections than this page shows at once. Friends come first." : null);
  const [undo, setUndo] = useState<Undo>(null);
  const [openList, setOpenList] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const liveOnline = usePresence();
  // the live online set exists only in the browser: use it after mount so the server HTML and hydration match
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const online = mounted ? liveOnline : NO_ONE;
  // one clock per page view, so the memos below hold (and server and browser agree)
  const [now] = useState(() => Date.now());

  const byId = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const visible = useMemo(() => searchPeople(people, { q, smart, listId: listFilter, tag: tagFilter }, now, online), [people, q, smart, listFilter, tagFilter, now, online]);
  const tags = useMemo(() => tagCounts(people), [people]);
  const tree = useMemo(() => listTree(lists.filter((l) => !l.archived)), [lists]);
  const archivedLists = lists.filter((l) => l.archived);
  const suggestions = useMemo(() => organizationSuggestions({ lists, people, rules, now }).filter((s) => !dismissed.includes(s.id)), [lists, people, rules, now, dismissed]);
  const addedAt = useMemo(() => new Map(Object.entries(initial.addedAt)), [initial.addedAt]);
  const insights = useMemo(() => listInsights(lists, people, addedAt, now), [lists, people, addedAt, now]);
  const waiting = useMemo(() => ruleCandidates(rules, people, now), [rules, people, now]);

  const counts = {
    friends: people.filter((p) => inSmartList("friends", p, now)).length,
    followers: people.filter((p) => p.follower).length,
    following: people.filter((p) => p.following).length,
    creators: people.filter((p) => inSmartList("creators", p, now)).length,
    businesses: people.filter((p) => inSmartList("businesses", p, now)).length,
  };

  // ── local state after a write ──
  const applyLocal = (action: BulkAction, ids: string[], opts: { listId?: string; tag?: string }) => {
    const set = new Set(ids);
    setPeople((ps) =>
      ps.map((p) => {
        if (!set.has(p.id)) return p;
        switch (action) {
          case "add_to_list":
            return p.listIds.includes(opts.listId!) ? p : { ...p, listIds: [...p.listIds, opts.listId!] };
          case "remove_from_list":
            return { ...p, listIds: p.listIds.filter((x) => x !== opts.listId) };
          case "tag":
            return p.tags.some((t) => t.toLowerCase() === opts.tag!.toLowerCase()) ? p : { ...p, tags: [...p.tags, opts.tag!] };
          case "untag":
            return { ...p, tags: p.tags.filter((t) => t.toLowerCase() !== opts.tag!.toLowerCase()) };
          case "favorite":
            return { ...p, favorite: true };
          case "unfavorite":
            return { ...p, favorite: false };
          case "archive":
            return { ...p, archived: true };
          case "unarchive":
            return { ...p, archived: false };
        }
      }),
    );
    if (action === "add_to_list" || action === "remove_from_list") {
      setLists((ls) => ls.map((l) => (l.id === opts.listId ? { ...l, memberCount: l.memberCount + (action === "add_to_list" ? ids.length : -ids.length) } : l)));
    }
  };

  /** Who an action would change, worked out from what is on screen - so the screen can change on the tap. */
  const predict = (action: BulkAction, ids: string[], opts: { listId?: string; tag?: string }): string[] => {
    const set = new Set(ids);
    const t = opts.tag?.toLowerCase();
    return peopleRef.current
      .filter((p) => set.has(p.id))
      .filter((p) => {
        switch (action) {
          case "add_to_list":
            return !p.listIds.includes(opts.listId!);
          case "remove_from_list":
            return p.listIds.includes(opts.listId!);
          case "tag":
            return !p.tags.some((x) => x.toLowerCase() === t);
          case "untag":
            return p.tags.some((x) => x.toLowerCase() === t);
          case "favorite":
            return p.friend && !p.favorite;
          case "unfavorite":
            return p.favorite;
          case "archive":
            return p.friend && !p.archived;
          case "unarchive":
            return p.archived;
        }
      })
      .map((p) => p.id);
  };

  /**
   * Owner, 2026-10-11: "all button must respond on tap instantly". The change is
   * drawn on the tap; the server answers after. Whatever it did NOT change (not
   * a connection, a full list, an error) is put back, and the note says why.
   */
  const bulk = async (action: BulkAction, ids: string[], opts: { listId?: string; tag?: string } = {}, label?: string): Promise<string[] | null> => {
    const predicted = predict(action, ids, opts);
    if (!predicted.length) {
      // the tap still answers: nothing here needed changing
      setNote(action === "favorite" || action === "archive" ? "Only friends can be favourites or archived, and these already are." : "Nothing to change for the people selected.");
      return [];
    }
    haptic("selection");
    applyLocal(action, predicted, opts);
    setBusy(action);
    setNote(null);
    const out = await post<{ changed: string[]; note?: string }>("/api/graph/bulk", { action, ids: predicted, ...opts });
    setBusy(null);
    if (!out.ok || !out.data) {
      applyLocal(OPPOSITE[action], predicted, opts);
      setNote(out.error ?? "Couldn't save that.");
      return null;
    }
    const changed = out.data.changed;
    const kept = new Set(changed);
    const notChanged = predicted.filter((id) => !kept.has(id));
    if (notChanged.length) applyLocal(OPPOSITE[action], notChanged, opts);
    if (out.data.note) setNote(out.data.note);
    if (label && changed.length) {
      setUndo({ label: `${label}: ${plural(changed.length, "person", "people")}.`, run: async () => void (await bulk(OPPOSITE[action], changed, opts)) });
    }
    return changed;
  };

  const listOp = async <T,>(body: Record<string, unknown>): Promise<(T & { changed?: string[]; id?: string; note?: string; skipped?: string[] }) | null> => {
    setBusy(String(body.op));
    setNote(null);
    const out = await post<T & { changed?: string[]; id?: string; note?: string; skipped?: string[] }>("/api/graph/lists", body);
    setBusy(null);
    if (!out.ok || !out.data) {
      setNote(out.error ?? "Couldn't save that.");
      return null;
    }
    if (out.data.note) setNote(out.data.note);
    return out.data;
  };

  /** A list change drawn on the tap, put back if the server says no. */
  const patchList = async (listId: string, patch: Partial<ListNode>, body: Record<string, unknown>): Promise<boolean> => {
    const before = listsRef.current.find((l) => l.id === listId);
    if (!before) return false;
    haptic("selection");
    setLists((ls) => ls.map((l) => (l.id === listId ? { ...l, ...patch } : l)));
    const out = await listOp({ op: "meta", listId, ...body });
    if (!out) {
      setLists((ls) => ls.map((l) => (l.id === listId ? before : l)));
      return false;
    }
    return true;
  };

  // ── suggestions ──
  const runSuggestion = async (s: OrgSuggestion) => {
    setDismissed((d) => [...d, s.id]);
    if (s.kind === "apply_rules") {
      const changed = await bulk("add_to_list", s.ids, { listId: s.listId }, `Added to ${byId.get(s.listId)?.name ?? "the list"}`);
      if (changed === null) setDismissed((d) => d.filter((x) => x !== s.id));
    } else if (s.kind === "merge") {
      // drawn on the tap: the smaller list's people join the larger one, and it is archived
      haptic("selection");
      const moving = predict("add_to_list", people.filter((p) => p.listIds.includes(s.from)).map((p) => p.id), { listId: s.into });
      applyLocal("add_to_list", moving, { listId: s.into });
      setLists((ls) => ls.map((l) => (l.id === s.from ? { ...l, archived: true } : l)));
      const out = await listOp<{ changed: string[] }>({ op: "merge", from: s.from, into: s.into });
      if (!out) {
        applyLocal("remove_from_list", moving, { listId: s.into });
        setLists((ls) => ls.map((l) => (l.id === s.from ? { ...l, archived: false } : l)));
        setDismissed((d) => d.filter((x) => x !== s.id));
        return;
      }
      const kept = new Set(out.changed ?? []);
      const notMoved = moving.filter((id) => !kept.has(id));
      if (notMoved.length) applyLocal("remove_from_list", notMoved, { listId: s.into });
      setUndo({
        label: `Merged ${byId.get(s.from)?.name} into ${byId.get(s.into)?.name}.`,
        run: async () => {
          await patchList(s.from, { archived: false }, { archived: false });
          if (out.changed?.length) await bulk("remove_from_list", out.changed, { listId: s.into });
        },
      });
    } else if (s.kind === "archive_empty") {
      await setArchived(s.listId, true);
    } else if (s.kind === "sub_list") {
      // the new list appears on the tap with a temporary id, swapped for the real one
      haptic("selection");
      const parent = byId.get(s.listId);
      const temp = `pending-${s.id}`;
      setLists((ls) => [...ls, { id: temp, name: s.name, color: parent?.color ?? "blue", icon: "circle", kind: "custom", memberCount: 0, parentId: s.listId, archived: false, description: null, createdAt: new Date().toISOString() }]);
      const out = await listOp<{ id: string }>({ op: "sub_list", parentId: s.listId, name: s.name, ids: s.ids });
      if (!out?.id) {
        setLists((ls) => ls.filter((l) => l.id !== temp));
        setDismissed((d) => d.filter((x) => x !== s.id));
        return;
      }
      const realId = out.id;
      setLists((ls) => ls.map((l) => (l.id === temp ? { ...l, id: realId } : l)));
      applyLocal("add_to_list", out.changed ?? [], { listId: realId });
      setUndo({
        label: `Made ${s.name} inside ${parent?.name}.`,
        run: async () => {
          const before = { lists: listsRef.current, people: peopleRef.current };
          setLists((ls) => ls.filter((l) => l.id !== realId));
          setPeople((ps) => ps.map((p) => ({ ...p, listIds: p.listIds.filter((x) => x !== realId) })));
          const res = await fetch(`/api/graph/circles/${realId}`, { method: "DELETE" }).catch(() => null);
          if (!res?.ok) {
            setLists(before.lists);
            setPeople(before.people);
            setNote("Couldn't undo that.");
          }
        },
      });
    } else if (s.kind === "sort_unsorted") {
      setSmart("unsorted");
      setListFilter(null);
      setTagFilter(null);
      document.getElementById("rm-people")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // ── list settings (each drawn on the tap) ──
  const setArchived = async (listId: string, archived: boolean) => {
    const ok = await patchList(listId, { archived }, { archived });
    if (ok && archived) setUndo({ label: `Archived ${byId.get(listId)?.name}.`, run: async () => void (await setArchived(listId, false)) });
  };
  const setParent = (listId: string, parentId: string | null) => void patchList(listId, { parentId }, { parentId });
  const setDescription = (listId: string, description: string) => void patchList(listId, { description: description || null }, { description: description || null });
  const addListRule = async (listId: string, rule: RuleKind, value: string | null) => {
    haptic("selection");
    const temp = `pending-${Date.now()}`;
    setRules((rs) => [...rs, { id: temp, circleId: listId, rule, value }]);
    const out = await listOp<{ id: string }>({ op: "add_rule", listId, rule, value });
    setRules((rs) => (out?.id ? rs.map((r) => (r.id === temp ? { ...r, id: out.id! } : r)) : rs.filter((r) => r.id !== temp)));
  };
  const removeListRule = async (r: ListRule) => {
    haptic("selection");
    setRules((rs) => rs.filter((x) => x.id !== r.id));
    if (r.id.startsWith("pending-")) return;
    const out = await listOp({ op: "remove_rule", ruleId: r.id });
    if (!out) setRules((rs) => [...rs, r]);
  };

  // ── selection ──
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const sel = [...selected];
  const selectAllShown = () => setSelected(new Set(visible.slice(0, shown).map((p) => p.id)));

  // ── export ──
  const download = (name: string, type: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportPeople = (who: DirectoryPerson[], format: "csv" | "json") => {
    if (format === "csv") download("frenz-relationships.csv", "text/csv", exportCsv(who, lists));
    else {
      const name = new Map(lists.map((l) => [l.id, l.name]));
      download(
        "frenz-relationships.json",
        "application/json",
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            lists: lists.map((l) => ({ name: l.name, parent: l.parentId ? name.get(l.parentId) ?? null : null, archived: l.archived, description: l.description })),
            people: who.map((p) => ({ handle: p.handle, name: p.displayName, friend: p.friend, following: p.following, follower: p.follower, label: p.label, tags: p.tags, lists: p.listIds.map((id) => name.get(id)).filter(Boolean) })),
          },
          null,
          2,
        ),
      );
    }
  };

  const activeFilter = smart ? SMART_LISTS.find((s) => s.key === smart)?.label : listFilter ? byId.get(listFilter)?.name : tagFilter ? `#${tagFilter}` : null;

  return (
    <div className="relative isolate pb-24">
      <AmbientWash />
      <header className="mb-5 flex items-start gap-2 pt-1">
        <Link href="/friends" aria-label="Back to Friends" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="text-[clamp(1.6rem,7vw,2rem)] font-extrabold leading-none tracking-[-0.04em]">Manage people</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">Every connection, your lists and tags. Only you see this.</p>
        </div>
      </header>

      <div aria-live="polite">{note ? <p className={cn("mb-4 rounded-2xl px-3.5 py-2.5 text-[13px]", GLASS)}>{note}</p> : null}</div>

      {/* Social Dashboard */}
      <section aria-label="Your network" className="mb-6 grid grid-cols-3 gap-2 min-[560px]:grid-cols-6">
        {(
          [
            ["friends", "Friends", counts.friends],
            ["followers", "Followers", counts.followers],
            ["following", "Following", counts.following],
            ["creators", "Creators", counts.creators],
            ["businesses", "Businesses", counts.businesses],
          ] as const
        ).map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            aria-pressed={smart === key}
            onClick={() => {
              setSmart(smart === key ? null : key);
              setListFilter(null);
              setTagFilter(null);
              setShown(PAGE);
            }}
            className={cn("rounded-2xl px-3 py-2.5 text-left transition active:scale-[0.98] motion-reduce:active:scale-100", GLASS, smart === key && "ring-2 ring-primary/50")}
          >
            <span className="block text-[20px] font-extrabold tabular-nums leading-tight">{n.toLocaleString()}</span>
            <span className="block truncate text-[12px] font-medium text-muted-foreground">{label}</span>
          </button>
        ))}
        <a href="#rm-lists" className={cn("rounded-2xl px-3 py-2.5 text-left", GLASS)}>
          <span className="block text-[20px] font-extrabold tabular-nums leading-tight">{lists.filter((l) => !l.archived).length}</span>
          <span className="block truncate text-[12px] font-medium text-muted-foreground">Lists</span>
        </a>
      </section>

      {/* AI Organization Engine */}
      {suggestions.length ? (
        <section className="mb-6" aria-labelledby="rm-suggest">
          <SectionHeader id="rm-suggest" title="Tidy up" />
          <GlassGroup label="Suggestions">
            {suggestions.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-3.5 py-3">
                <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Wand2 className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold leading-snug">{s.title}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">{s.line}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button type="button" className={cn(primaryPill, "min-h-[2.25rem] px-3.5 text-[12.5px]")} onClick={() => void runSuggestion(s)} disabled={(s.kind !== "apply_rules" && s.kind !== "sort_unsorted" && !initial.ready.nesting)}>
                      {s.kind === "sort_unsorted" ? "Show them" : s.kind === "merge" ? "Merge" : s.kind === "archive_empty" ? "Archive" : s.kind === "sub_list" ? "Make it" : "Add them"}
                    </button>
                    <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")} onClick={() => setDismissed((d) => [...d, s.id])}>
                      Not now
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      {/* Lists: smart lists, then the member's own tree */}
      <section id="rm-lists" className="mb-6 scroll-mt-20" aria-labelledby="rm-lists-h">
        <SectionHeader
          id="rm-lists-h"
          title="Lists"
          action={
            <Link href="/friends/circles" prefetch={false} className="text-[13px] font-semibold text-primary">
              New list
            </Link>
          }
        />
        <div className="-mx-3 mb-2.5 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:-mx-4 sm:px-4" role="group" aria-label="Smart lists">
          {SMART_LISTS.filter((s) => !["friends", "followers", "following", "creators", "businesses"].includes(s.key)).map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={smart === s.key}
              title={s.blurb}
              onClick={() => {
                setSmart(smart === s.key ? null : s.key);
                setListFilter(null);
                setTagFilter(null);
                setShown(PAGE);
              }}
              className={cn(quietPill, "min-h-[2.25rem] shrink-0 px-3 text-[12.5px]", smart === s.key && "bg-primary/10 text-primary dark:bg-primary/20")}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> {s.label}
            </button>
          ))}
        </div>
        {tree.length ? (
          <GlassGroup label="Your lists">
            {tree.map(({ list, depth }) => (
              <ListRow
                key={list.id}
                list={list}
                depth={depth}
                open={openList === list.id}
                onToggle={() => setOpenList(openList === list.id ? null : list.id)}
                lists={lists}
                rules={rules.filter((r) => r.circleId === list.id)}
                waiting={waiting.get(list.id)?.length ?? 0}
                ready={initial.ready}
                busy={busy}
                onFilter={() => {
                  setListFilter(list.id);
                  setSmart(null);
                  setTagFilter(null);
                  setShown(PAGE);
                  document.getElementById("rm-people")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                onArchive={() => void setArchived(list.id, true)}
                onParent={(p) => void setParent(list.id, p)}
                onDescription={(d) => void setDescription(list.id, d)}
                onAddRule={(r, v) => void addListRule(list.id, r, v)}
                onRemoveRule={(r) => void removeListRule(r)}
                onApplyRules={() => void bulk("add_to_list", waiting.get(list.id) ?? [], { listId: list.id }, `Added to ${list.name}`)}
              />
            ))}
          </GlassGroup>
        ) : (
          <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>
            No lists yet.{" "}
            <Link href="/friends/circles" prefetch={false} className="font-semibold text-primary">
              Make your first one
            </Link>
            , then sort people into it here.
          </p>
        )}
        {archivedLists.length ? (
          <details className="mt-2">
            <summary className="cursor-pointer px-1 py-2 text-[13px] font-semibold text-muted-foreground">Archived lists ({archivedLists.length})</summary>
            <GlassGroup label="Archived lists">
              {archivedLists.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <CircleGlyph icon={l.icon} className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[14px]">{l.name}</span>
                  <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")} onClick={() => void setArchived(l.id, false)}>
                    <ArchiveRestore className="h-4 w-4" aria-hidden /> Restore
                  </button>
                </li>
              ))}
            </GlassGroup>
          </details>
        ) : null}
      </section>

      {/* List Analytics (private) */}
      {insights.length ? (
        <section className="mb-6" aria-labelledby="rm-insights">
          <SectionHeader id="rm-insights" title="Your lists at a glance" />
          <div className="grid gap-2 min-[480px]:grid-cols-2">
            {insights.map((i) => (
              <div key={i.key} className={cn("rounded-2xl px-3.5 py-3", GLASS)}>
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{i.title}</p>
                <p className="mt-0.5 text-[14px] font-medium leading-snug">{i.line}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* People: search, filters, selection */}
      <section id="rm-people" className="mb-6 scroll-mt-20" aria-labelledby="rm-people-h">
        <SectionHeader id="rm-people-h" title="People" count={visible.length} />
        <div className={cn("mb-2 flex items-center gap-2 rounded-2xl px-3", GLASS)}>
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <label htmlFor="rm-q" className="sr-only">
            Search people
          </label>
          <input id="rm-q" type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Name, @handle, label or tag" className="min-h-[2.75rem] min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
        </div>
        {activeFilter || tags.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {activeFilter ? (
              <button type="button" className={cn(quietPill, "min-h-[2.25rem] bg-primary/10 px-3 text-[12.5px] text-primary dark:bg-primary/20")} onClick={() => { setSmart(null); setListFilter(null); setTagFilter(null); }}>
                {activeFilter} <X className="h-3.5 w-3.5" aria-label="Clear filter" />
              </button>
            ) : null}
            {tags.slice(0, 12).map((t) => (
              <button key={t.tag} type="button" aria-pressed={tagFilter === t.tag} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]", tagFilter === t.tag && "bg-primary/10 text-primary")} onClick={() => { setTagFilter(tagFilter === t.tag ? null : t.tag); setSmart(null); setListFilter(null); setShown(PAGE); }}>
                <Tag className="h-3.5 w-3.5" aria-hidden /> {t.tag}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mb-2 flex items-center justify-between px-1 text-[12.5px] text-muted-foreground">
          <span>{selected.size ? `${selected.size} selected` : "Tap people to select them"}</span>
          <span className="flex gap-3">
            <button type="button" className="font-semibold text-primary" onClick={selectAllShown}>
              Select shown
            </button>
            {selected.size ? (
              <button type="button" className="font-semibold" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            ) : null}
          </span>
        </div>
        {visible.length ? (
          <GlassGroup label="People">
            {visible.slice(0, shown).map((p) => (
              <PersonRow key={p.id} p={p} lists={byId} online={online.has(p.id)} selected={selected.has(p.id)} onToggle={() => toggle(p.id)} />
            ))}
          </GlassGroup>
        ) : (
          <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>{people.length ? "Nobody matches." : "When you add friends or follow people, they appear here."}</p>
        )}
        {visible.length > shown ? (
          <button type="button" className={cn(quietPill, "mt-2 w-full justify-center")} onClick={() => setShown((n) => n + PAGE)}>
            Show more ({(visible.length - shown).toLocaleString()})
          </button>
        ) : null}
      </section>

      {/* Import & export */}
      <ImportExport lists={lists.filter((l) => !l.archived)} busy={busy} onExport={(f) => exportPeople(visible, f)} onImport={async (listId, handles) => {
        const out = await listOp<{ changed: string[]; skipped: string[] }>({ op: "import", listId, handles });
        if (!out) return;
        applyLocal("add_to_list", out.changed ?? [], { listId });
        setNote(`Added ${plural(out.changed?.length ?? 0, "person", "people")}.${out.skipped?.length ? ` Not added (not found, or not one of your connections): ${out.skipped.slice(0, 8).map((h) => `@${h}`).join(", ")}${out.skipped.length > 8 ? "…" : ""}` : ""}`);
        if (out.changed?.length) {
          const changed = out.changed;
          setUndo({ label: `Imported ${plural(changed.length, "person", "people")}.`, run: async () => void (await bulk("remove_from_list", changed, { listId })) });
        }
      }} />

      {/* Bulk bar + undo */}
      <div className="pointer-events-none fixed inset-x-0 z-30 flex flex-col items-center gap-2 px-3" style={{ bottom: "calc(var(--frenz-bottom-nav, 0px) + 0.75rem)" }}>
        {undo ? (
          <div role="status" className={cn("pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[13.5px]", GLASS)}>
            <span className="min-w-0 flex-1 truncate">{undo.label}</span>
            <button type="button" className="inline-flex min-h-[2.25rem] items-center gap-1 font-semibold text-primary" onClick={async () => { const u = undo; setUndo(null); await u.run(); }}>
              <Undo2 className="h-4 w-4" aria-hidden /> Undo
            </button>
            <button type="button" aria-label="Dismiss" className="inline-flex h-9 w-9 items-center justify-center rounded-full" onClick={() => setUndo(null)}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : null}
        {selected.size ? (
          <BulkBar
            count={selected.size}
            lists={lists.filter((l) => !l.archived)}
            listFilter={listFilter}
            busy={busy}
            tagsReady={initial.ready.tags}
            onAdd={(listId) => void bulk("add_to_list", sel, { listId }, `Added to ${byId.get(listId)?.name}`)}
            onRemove={() => listFilter && void bulk("remove_from_list", sel, { listId: listFilter }, `Removed from ${byId.get(listFilter)?.name}`)}
            onTag={(tag) => void bulk("tag", sel, { tag }, `Tagged ${tag}`)}
            allFavorite={people.filter((p) => selected.has(p.id)).every((p) => p.favorite)}
            allArchived={people.filter((p) => selected.has(p.id)).every((p) => p.archived)}
            onFavorite={(on) => void bulk(on ? "favorite" : "unfavorite", sel, {}, on ? "Favourited" : "Unfavourited")}
            onArchive={(on) => void bulk(on ? "archive" : "unarchive", sel, {}, on ? "Archived" : "Restored")}
            onExport={() => exportPeople(people.filter((p) => selected.has(p.id)), "csv")}
            onClear={() => setSelected(new Set())}
          />
        ) : null}
      </div>
    </div>
  );
}

// ─── A person ────────────────────────────────────────────────────────────────

function PersonRow({ p, lists, online, selected, onToggle }: { p: DirectoryPerson; lists: Map<string, ListNode>; online: boolean; selected: boolean; onToggle: () => void }) {
  const rel = p.friend ? (p.archived ? "Archived friend" : "Friend") : p.following && p.follower ? "Follow each other" : p.following ? "You follow" : "Follows you";
  return (
    <li>
      <button type="button" role="checkbox" aria-checked={selected} onClick={onToggle} className={cn("flex w-full touch-manipulation items-center gap-3 px-3.5 py-2.5 text-left transition active:bg-primary/[0.1]", selected && "bg-primary/[0.06]")}>
        <span aria-hidden className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors", selected ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
          {selected ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
        <PersonAvatar user={p} size={44} online={online} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className="truncate text-[14.5px] font-semibold">{p.displayName}</span>
            {p.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified" /> : null}
            {p.favorite ? <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Favourite" /> : null}
          </span>
          <span className="block truncate text-[12.5px] text-muted-foreground">
            @{p.handle} · {rel}
            {p.label ? ` · ${p.label}` : ""}
          </span>
          {p.tags.length || p.listIds.length ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {p.listIds.slice(0, 3).map((id) => {
                const l = lists.get(id);
                if (!l) return null;
                return (
                  <span key={id} className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium", circleColorClasses(l.color).chip)}>
                    <CircleGlyph icon={l.icon} className="h-3 w-3" /> {l.name}
                  </span>
                );
              })}
              {p.tags.slice(0, 3).map((t) => (
                <span key={t} className="rounded-full bg-black/[0.05] px-1.5 py-px text-[11px] font-medium text-foreground/70 dark:bg-white/[0.08]">
                  #{t}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

// ─── A list, with its settings ───────────────────────────────────────────────

function ListRow(props: {
  list: ListNode;
  depth: number;
  open: boolean;
  onToggle: () => void;
  lists: ListNode[];
  rules: ListRule[];
  waiting: number;
  ready: RelationshipDirectory["ready"];
  busy: string | null;
  onFilter: () => void;
  onArchive: () => void;
  onParent: (parentId: string | null) => void;
  onDescription: (d: string) => void;
  onAddRule: (r: RuleKind, v: string | null) => void;
  onRemoveRule: (r: ListRule) => void;
  onApplyRules: () => void;
}) {
  const { list, depth, open } = props;
  const [desc, setDesc] = useState(list.description ?? "");
  const [rule, setRule] = useState<RuleKind>("creator");
  const [ruleTag, setRuleTag] = useState("");
  const colors = circleColorClasses(list.color);
  // a list cannot sit inside itself or any list inside it
  const descendants = new Set<string>();
  const walk = (id: string) => props.lists.filter((l) => l.parentId === id).forEach((l) => (descendants.add(l.id), walk(l.id)));
  walk(list.id);
  const parents = props.lists.filter((l) => l.id !== list.id && !descendants.has(l.id) && !l.archived);
  return (
    <li>
      <div className="flex items-center gap-2 py-1 pr-2" style={{ paddingLeft: `${0.875 + depth * 1.25}rem` }}>
        <button type="button" onClick={props.onFilter} className="flex min-h-[2.75rem] min-w-0 flex-1 touch-manipulation items-center gap-2.5 rounded-xl text-left transition active:opacity-70">
          <span aria-hidden className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", colors.chip)}>
            <CircleGlyph icon={list.icon} className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[14.5px] font-semibold">{list.name}</span>
            <span className="block truncate text-[12px] text-muted-foreground">
              {plural(list.memberCount, "person", "people")}
              {props.rules.length ? ` · ${plural(props.rules.length, "rule", "rules")}` : ""}
              {props.waiting ? ` · ${props.waiting} waiting` : ""}
            </span>
          </span>
        </button>
        <button type="button" aria-expanded={open} aria-label={`${list.name} settings`} onClick={props.onToggle} className="inline-flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full hover:bg-black/[0.04] active:bg-black/[0.08] dark:hover:bg-white/[0.06] dark:active:bg-white/[0.1]">
          <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      {open ? (
        <div className="space-y-3 border-t border-black/[0.06] px-3.5 py-3 dark:border-white/[0.07]">
          {!props.ready.nesting ? <p className="text-[12.5px] text-muted-foreground">Nesting, descriptions, archiving and rules arrive with the next update.</p> : null}
          <label className="block text-[12.5px] text-muted-foreground">
            About this list
            <span className="mt-1 flex gap-2">
              <input className="min-h-[2.5rem] min-w-0 flex-1 rounded-xl border border-border bg-background px-2.5 text-[14px] text-foreground" maxLength={140} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="One line, only for you" disabled={!props.ready.nesting} />
              <button type="button" className={cn(quietPill, "min-h-[2.5rem]")} disabled={!props.ready.nesting || desc === (list.description ?? "")} onClick={() => props.onDescription(desc.trim())}>
                Save
              </button>
            </span>
          </label>
          <label className="block text-[12.5px] text-muted-foreground">
            Inside
            <select className="mt-1 block min-h-[2.5rem] w-full rounded-xl border border-border bg-background px-2.5 text-[14px] text-foreground" value={list.parentId ?? ""} onChange={(e) => props.onParent(e.target.value || null)} disabled={!props.ready.nesting}>
              <option value="">Nothing (a top-level list)</option>
              {parents.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <p className="text-[12.5px] text-muted-foreground">Rules: people who match are offered for this list. Nothing is added until you say so.</p>
            {props.rules.length ? (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {props.rules.map((r) => (
                  <li key={r.id} className="inline-flex items-center gap-1 rounded-full bg-black/[0.05] py-1 pl-2.5 pr-1 text-[12.5px] dark:bg-white/[0.08]">
                    {RULE_LABEL[r.rule]}
                    {r.value ? ` #${r.value}` : ""}
                    <button type="button" aria-label={`Remove rule ${RULE_LABEL[r.rule]}`} onClick={() => props.onRemoveRule(r)} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/[0.06]">
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <label className="sr-only" htmlFor={`rule-${list.id}`}>
                Rule
              </label>
              <select id={`rule-${list.id}`} className="min-h-[2.5rem] rounded-xl border border-border bg-background px-2.5 text-[14px]" value={rule} onChange={(e) => setRule(e.target.value as RuleKind)} disabled={!props.ready.rules}>
                {RULE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {RULE_LABEL[k]}
                  </option>
                ))}
              </select>
              {rule === "tag" ? <input aria-label="Tag" className="min-h-[2.5rem] w-32 rounded-xl border border-border bg-background px-2.5 text-[14px]" value={ruleTag} onChange={(e) => setRuleTag(e.target.value)} placeholder="Tag" maxLength={24} /> : null}
              <button type="button" className={cn(quietPill, "min-h-[2.5rem]")} disabled={!props.ready.rules || (rule === "tag" && !ruleTag.trim())} onClick={() => props.onAddRule(rule, rule === "tag" ? ruleTag.trim() : null)}>
                Add rule
              </button>
            </div>
            {props.waiting ? (
              <button type="button" className={cn(primaryPill, "mt-2")} onClick={props.onApplyRules}>
                Add {plural(props.waiting, "person", "people")} who match
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]">
            <button type="button" className={cn(quietPill, "min-h-[2.5rem]")} onClick={props.onFilter}>
              Show its people
            </button>
            <Link href="/friends/circles" prefetch={false} className={cn(quietPill, "min-h-[2.5rem]")}>
              Name, colour and icon
            </Link>
            {list.kind === "custom" ? (
              <button type="button" className={cn(quietPill, "min-h-[2.5rem]")} disabled={!props.ready.nesting} onClick={props.onArchive}>
                <Archive className="h-4 w-4" aria-hidden /> Archive
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

// ─── Bulk actions ────────────────────────────────────────────────────────────

function BulkBar(props: {
  count: number;
  lists: ListNode[];
  listFilter: string | null;
  busy: string | null;
  tagsReady: boolean;
  onAdd: (listId: string) => void;
  onRemove: () => void;
  onTag: (tag: string) => void;
  /** every selected person already is - the button turns the other way */
  allFavorite: boolean;
  allArchived: boolean;
  onFavorite: (on: boolean) => void;
  onArchive: (on: boolean) => void;
  onExport: () => void;
  onClear: () => void;
}) {
  const [mode, setMode] = useState<"none" | "list" | "tag">("none");
  const [tag, setTag] = useState("");
  return (
    <div role="toolbar" aria-label={`${props.count} selected`} className={cn("pointer-events-auto w-full max-w-xl rounded-[22px] px-3 py-2.5", GLASS)}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 pl-1 pt-2 text-[13px] font-bold tabular-nums">{props.count}</span>
        {/* wraps instead of scrolling sideways: every action is visible and whole at 320 px */}
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]", mode === "list" && "bg-primary/10 text-primary")} onClick={() => setMode(mode === "list" ? "none" : "list")}>
            <ListPlus className="h-4 w-4" aria-hidden /> Add to list
          </button>
          {props.listFilter ? (
            <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")} onClick={props.onRemove}>
              <X className="h-4 w-4" aria-hidden /> Remove from list
            </button>
          ) : null}
          <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]", mode === "tag" && "bg-primary/10 text-primary")} onClick={() => setMode(mode === "tag" ? "none" : "tag")} disabled={!props.tagsReady} title={props.tagsReady ? undefined : "Tags arrive with the next update."}>
            <Tag className="h-4 w-4" aria-hidden /> Tag
          </button>
          <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")} onClick={() => props.onFavorite(!props.allFavorite)}>
            <Star className={cn("h-4 w-4", props.allFavorite && "fill-amber-400 text-amber-400")} aria-hidden /> {props.allFavorite ? "Unfavourite" : "Favourite"}
          </button>
          <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")} onClick={() => props.onArchive(!props.allArchived)}>
            {props.allArchived ? <ArchiveRestore className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />} {props.allArchived ? "Restore" : "Archive"}
          </button>
          <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")} onClick={props.onExport}>
            <Download className="h-4 w-4" aria-hidden /> Export
          </button>
        </div>
        {props.busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Saving" /> : null}
        <button type="button" aria-label="Clear selection" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" onClick={props.onClear}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {mode === "list" ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {props.lists.length ? (
            props.lists.map((l) => (
              <button key={l.id} type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")} onClick={() => { props.onAdd(l.id); setMode("none"); }}>
                <CircleGlyph icon={l.icon} className="h-3.5 w-3.5" /> {l.name}
              </button>
            ))
          ) : (
            <Link href="/friends/circles" prefetch={false} className="text-[13px] font-semibold text-primary">
              Make a list first
            </Link>
          )}
        </div>
      ) : null}
      {mode === "tag" ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tag.trim()) return;
            props.onTag(tag.trim());
            setTag("");
            setMode("none");
          }}
        >
          <label htmlFor="rm-bulk-tag" className="sr-only">
            Tag
          </label>
          <input id="rm-bulk-tag" autoFocus className="min-h-[2.5rem] min-w-0 flex-1 rounded-xl border border-border bg-background px-2.5 text-[15px]" maxLength={24} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Investor, Designer, Client…" />
          <button type="submit" className={primaryPill} disabled={!tag.trim()}>
            Tag
          </button>
        </form>
      ) : null}
    </div>
  );
}

// ─── Import & export ─────────────────────────────────────────────────────────

function ImportExport({ lists, busy, onExport, onImport }: { lists: ListNode[]; busy: string | null; onExport: (format: "csv" | "json") => void; onImport: (listId: string, handles: string[]) => Promise<void> }) {
  const [text, setText] = useState("");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const handles = useMemo(() => parseHandles(text), [text]);
  return (
    <section className="mb-6" aria-labelledby="rm-io">
      <SectionHeader id="rm-io" title="Import and export" />
      <div className={cn("space-y-3 rounded-[22px] px-3.5 py-3", GLASS)}>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={quietPill} onClick={() => onExport("csv")}>
            <Download className="h-4 w-4" aria-hidden /> Export as CSV
          </button>
          <button type="button" className={quietPill} onClick={() => onExport("json")}>
            <Download className="h-4 w-4" aria-hidden /> Export as JSON
          </button>
        </div>
        <p className="text-[12.5px] text-muted-foreground">Exports the people shown above, with your labels, tags and lists. It stays on your device.</p>
        <div className="border-t border-black/[0.06] pt-3 dark:border-white/[0.07]">
          <label htmlFor="rm-import" className="text-[13.5px] font-semibold">
            Add people to a list from handles
          </label>
          <textarea id="rm-import" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={"@ada\n@bayo\nOr paste a CSV with handles in the first column"} className="mt-1.5 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="rm-import-list">
              List
            </label>
            <select id="rm-import-list" className="min-h-[2.5rem] min-w-0 flex-1 rounded-xl border border-border bg-background px-2.5 text-[14px]" value={listId} onChange={(e) => setListId(e.target.value)} disabled={!lists.length}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={primaryPill}
              disabled={!handles.length || !listId || !!busy}
              onClick={async () => {
                await onImport(listId, handles);
                setText("");
              }}
            >
              {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />} {busy === "import" ? "Importing…" : `Import ${handles.length || ""}`}
            </button>
          </div>
          <p className="mt-1.5 text-[12px] text-muted-foreground">Only people you&apos;re connected to are added. Nobody is told.</p>
        </div>
      </div>
    </section>
  );
}
