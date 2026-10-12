"use client";

import { AnimatePresence } from "framer-motion";
import { allowWindowOpen } from "@/lib/monetization/popunder-guard";
import { Archive, ArchiveRestore, ArrowUp, BellRing, CheckCheck, CheckSquare, CircleDot, Download, History, LayoutList, MoreHorizontal, Pin, Rows3, Search, Sparkles, Tag, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { mutate, revalidate, useQuery } from "@/features/data";
import {
  NOTIF_ARCHIVED_KEY as ARCHIVED_KEY,
  NOTIF_GROUPED_KEY as KEY,
  NOTIF_KEY as BELL_KEY,
  loadArchivedNotifications as loadArchived,
  loadFlatNotifications,
  loadGroupedNotifications as loadGrouped,
  loadOlderNotifications,
} from "@/features/notifications/data";
import { verbFor } from "@/features/notifications/meta";
import { NotificationCard, type OrganizeAction } from "@/features/notifications/notification-card";
import { toast } from "@/features/ui/toast";
import { onNotificationInsert } from "@/features/notifications/notif-stream";
import { PushToggle } from "@/features/notifications/push-toggle";
import { PullToRefresh } from "@/features/ui/pull-to-refresh";
import { haptic } from "@/lib/motion/haptics";
import { cleanLabels, isEmptyQuery, matchesQuery, parseActivityQuery } from "@/lib/notifications/search";
import { SMART_CATEGORY_LABEL, SMART_CATEGORY_ORDER, smartCategoryOf, type SmartCategory } from "@/lib/notifications/smart-category";
import type { GroupedNotificationsResult, NotificationGroup } from "@/lib/social/notifications";
import { cn } from "@/lib/utils";

/*
  ═══════════════════════════════════════════════════════════════════════════
   THE ACTIVITY CENTER — Feature 20 Parts 1–4 (owner briefs 2026-10-11 / 12)
  ═══════════════════════════════════════════════════════════════════════════

  Views: All, Unread, Priority (critical + high, the push path's own table), Pinned,
  Held (kept off the lock screen by DND, a focus mode or quiet hours — the brief's
  "Scheduled"), the categories, and Archived (fetched only when opened).

  Part 3, the Universal Inbox:
   · plain-language search ("messages from chris last week") read by a small parser
     whose reading is shown as chips, filtering the loaded list instantly — and one tap
     searches the WHOLE history on the server (archive included)
   · private labels (0234), a label row to filter by, labels searchable by name
   · Select: bulk read / unread / pin / archive / label / delete, with Undo for archive
     and delete (a delete waits six seconds before it reaches the server)
   · Cards, Compact and Timeline (by day) layouts — remembered on this device only
   · Smart Cleanup: two plain suggestions, each ARCHIVES (restorable), never deletes
  Part 4 lives in the card: Smart Actions (inline Reply for chats, Accept / Decline,
  Follow back, Block), and the Details panel with the notification's own history.

  Every change is drawn on the tap and the server's answer replaces it (owner rule:
  every button responds on tap); a refusal puts it back and says so.
*/
type View = "priority" | "pinned" | "held" | "archived";
// the everyday tabs are the smart categories (Social, Content, Messages, Earnings…), premium brief 2026-10-12
type Tab = "all" | "unread" | View | SmartCategory;
type Layout = "cards" | "compact" | "timeline";

const TAB_LABEL: Record<Tab, string> = {
  all: "All",
  unread: "Unread",
  priority: "Priority",
  pinned: "Pinned",
  held: "Held",
  archived: "Archived",
  ...SMART_CATEGORY_LABEL,
};
const smartOf = (g: NotificationGroup) => smartCategoryOf(g.type, g.category);
const LAYOUT_KEY = "frenz:activity-layout";
const DELETE_GRACE_MS = 6000;

const isPriority = (g: NotificationGroup) => g.priority === "critical" || g.priority === "high";
const EMPTY: Partial<Record<Tab, string>> = { unread: "You're all caught up", priority: "Nothing urgent", pinned: "Nothing pinned", held: "Nothing held", archived: "Nothing archived" };
const EMPTY_HINT: Partial<Record<Tab, string>> = {
  priority: "Security alerts, payments, messages and requests show here.",
  pinned: "Pin a notification from its ⋯ menu to keep it at the top.",
  held: "Notifications kept off your lock screen by Do Not Disturb, a focus mode or quiet hours wait here.",
  archived: "Archive a notification from its ⋯ menu to put it away without deleting it.",
};

const empty: GroupedNotificationsResult = { groups: [], unread: 0 };
const send = (ids: string[], action: OrganizeAction, labels?: string[]) =>
  fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, action, labels }) }).then(async (r) => {
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't update that.");
  });

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

export function NotificationCenter({ initial }: { initial: GroupedNotificationsResult }) {
  const { data } = useQuery<GroupedNotificationsResult>(KEY, loadGrouped, { initialData: initial });
  const groups = data?.groups ?? initial.groups;
  const unread = data?.unread ?? initial.unread;
  const [tab, setTab] = useState<Tab>("all");
  // read inside stable callbacks (delete-with-undo) without re-creating them on every tab change
  const tabRef = useRef<Tab>("all");
  tabRef.current = tab;
  const organizable = data?.activity ?? initial.activity ?? false;
  const labelsEnabled = data?.inbox ?? initial.inbox ?? false;
  // the held-summary push opens /notifications?view=held
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    if (v === "held" || v === "pinned" || v === "priority" || v === "archived") setTab(v);
  }, []);
  // Archived is read only while its tab is open
  const archived = useQuery<GroupedNotificationsResult>(ARCHIVED_KEY, loadArchived, { enabled: tab === "archived", revalidateOnFocus: false });
  const [query, setQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Layout: remembered on this device (a viewing preference, nothing else)
  const [layout, setLayoutRaw] = useState<Layout>("cards");
  useEffect(() => {
    try {
      const v = localStorage.getItem(LAYOUT_KEY);
      if (v === "compact" || v === "timeline" || v === "cards") setLayoutRaw(v);
    } catch {
      /* private mode */
    }
  }, []);
  const setLayout = (l: Layout) => {
    haptic("selection");
    setLayoutRaw(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* fine */
    }
  };

  // Live: a new notification row for me → refresh the center (the bell refreshes itself).
  /*
    Live (premium brief: "preserve scroll position when new notifications arrive"): near the
    top the list simply refreshes; further down a "New notifications" pill appears instead, so
    nothing shifts under someone reading. One per-user realtime stream, already shared.
  */
  const [arrived, setArrived] = useState(0);
  useEffect(
    () =>
      onNotificationInsert(() => {
        if (window.scrollY > 320) setArrived((n) => n + 1);
        else void revalidate(KEY, loadGrouped, 0).catch(() => {});
      }),
    [],
  );
  const showNew = () => {
    haptic("selection");
    setArrived(0);
    void revalidate(KEY, loadGrouped, 0).catch(() => {});
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  // Older pages, appended below; a group that spans pages keeps its first card (its ids are merged)
  const [older, setOlder] = useState<{ groups: NotificationGroup[]; next: string | null } | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  const firstNext = data?.nextBefore ?? initial.nextBefore ?? null;
  const nextCursor = older ? older.next : firstNext;
  const loadOlder = async () => {
    if (!nextCursor || olderBusy) return;
    setOlderBusy(true);
    try {
      const page = await loadOlderNotifications(nextCursor);
      // immutable: a group already on screen keeps its card; the older page only adds new ones
      setOlder((o) => {
        const have = new Set([...groups, ...(o?.groups ?? [])].map((g) => g.id));
        return { groups: [...(o?.groups ?? []), ...page.groups.filter((g) => !have.has(g.id))], next: page.nextBefore ?? null };
      });
    } catch {
      toast("Couldn't load older notifications. Try again.", "error");
    } finally {
      setOlderBusy(false);
    }
  };


  const ownLabels = useMemo(() => [...new Set(groups.flatMap((g) => g.labels))].sort((a, b) => a.localeCompare(b)), [groups]);

  // Tabs shown = All + Unread + whichever views and categories actually have notifications.
  const tabs = useMemo<Tab[]>(() => {
    const present = new Set(groups.map(smartOf));
    const views: Tab[] = [];
    if (groups.some(isPriority)) views.push("priority");
    if (groups.some((g) => g.pinned)) views.push("pinned");
    if (groups.some((g) => g.delivery === "held")) views.push("held");
    const out: Tab[] = ["all", "unread", ...SMART_CATEGORY_ORDER.filter((c) => present.has(c)), ...views];
    if (organizable) out.push("archived");
    // a tab opened from a link stays visible even when it is empty
    if (!out.includes(tab)) out.splice(2, 0, tab);
    return out;
  }, [groups, organizable, tab]);

  // the plain-language reading of the search box, shown back as chips
  const parsed = useMemo(() => parseActivityQuery(query, new Date(), ownLabels), [query, ownLabels]);
  const searching = query.trim().length > 0 && !isEmptyQuery(parsed);

  // a whole-history search ran on the server for exactly this text
  const [history, setHistory] = useState<{ q: string; groups: NotificationGroup[] } | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  useEffect(() => {
    if (history && history.q !== query) setHistory(null);
  }, [query, history]);
  const searchHistory = async () => {
    const q = query.trim();
    if (!q) return;
    setHistoryBusy(true);
    const res = await fetch(`/api/notifications?grouped=1&q=${encodeURIComponent(q)}`).catch(() => null);
    const j = res?.ok ? ((await res.json().catch(() => null)) as GroupedNotificationsResult | null) : null;
    setHistoryBusy(false);
    if (!j) return void toast("Couldn't search your history. Try again.", "error");
    setHistory({ q: query, groups: j.groups ?? [] });
  };

  const visible = useMemo(() => {
    if (history) return history.groups;
    const source = tab === "archived" ? (archived.data?.groups ?? []) : older ? [...groups, ...older.groups] : groups;
    let list =
      tab === "all" || tab === "archived"
        ? source
        : tab === "unread"
          ? source.filter((g) => !g.read)
          : tab === "priority"
            ? source.filter(isPriority)
            : tab === "pinned"
              ? source.filter((g) => g.pinned)
              : tab === "held"
                ? source.filter((g) => g.delivery === "held")
                : source.filter((g) => smartOf(g) === tab);
    if (labelFilter) list = list.filter((g) => g.labels.includes(labelFilter));
    if (searching) {
      list = list.filter((g) =>
        matchesQuery(
          {
            type: g.type,
            category: g.category,
            createdAt: g.createdAt,
            read: g.read,
            pinned: g.pinned,
            delivery: g.delivery,
            labels: g.labels,
            actors: g.actors,
            text: [g.postTitle, g.content?.title, g.content?.body, g.broadcast?.title, g.broadcast?.body, verbFor(g.type)].filter(Boolean).join(" "),
          },
          parsed,
        ),
      );
    }
    // pinned first in the inbox views; otherwise newest first, as the server sent it
    if (tab !== "archived" && tab !== "pinned") list = [...list.filter((g) => g.pinned), ...list.filter((g) => !g.pinned)];
    return list;
  }, [groups, older, archived.data, tab, labelFilter, searching, parsed, history]);

  const refresh = (archiveToo = false) => {
    void revalidate(KEY, loadGrouped, 0).catch(() => {});
    void revalidate(BELL_KEY, loadFlatNotifications, 0).catch(() => {});
    if (archiveToo || tab === "archived") void revalidate(ARCHIVED_KEY, loadArchived, 0).catch(() => {});
  };

  /*
    One path for every change, single or bulk: draw it now, send it, let the server's
    answer replace the drawing. Archive offers Undo (it is restorable anyway).
  */
  const apply = useCallback(
    (targets: NotificationGroup[], action: OrganizeAction, labels?: string[]) => {
      if (!targets.length) return;
      const ids = targets.flatMap((g) => g.notificationIds);
      const keys = new Set(targets.map((g) => g.id));
      const drawn = (x: NotificationGroup): NotificationGroup => {
        if (!keys.has(x.id)) return x;
        if (action === "pin" || action === "unpin") return { ...x, pinned: action === "pin" };
        if (action === "read" || action === "unread") return { ...x, read: action === "read" };
        if (action === "label_add") return { ...x, labels: cleanLabels([...x.labels, ...(labels ?? [])]) };
        if (action === "label_remove") return { ...x, labels: x.labels.filter((l) => !(labels ?? []).includes(l)) };
        return x;
      };
      const unreadGone = targets.filter((g) => !g.read).length;
      if (action === "archive") {
        mutate<GroupedNotificationsResult>(KEY, (prev) => ({ ...(prev ?? empty), groups: (prev?.groups ?? []).filter((x) => !keys.has(x.id)), unread: Math.max(0, (prev?.unread ?? 0) - unreadGone) }));
      } else if (action === "unarchive") {
        mutate<GroupedNotificationsResult>(ARCHIVED_KEY, (prev) => ({ ...(prev ?? empty), groups: (prev?.groups ?? []).filter((x) => !keys.has(x.id)) }));
      } else {
        mutate<GroupedNotificationsResult>(KEY, (prev) => ({ ...(prev ?? empty), groups: (prev?.groups ?? []).map(drawn) }));
        if (tab === "archived") mutate<GroupedNotificationsResult>(ARCHIVED_KEY, (prev) => ({ ...(prev ?? empty), groups: (prev?.groups ?? []).map(drawn) }));
        if (history) setHistory((h) => (h ? { ...h, groups: h.groups.map(drawn) } : h));
      }
      const n = targets.length;
      const said: Partial<Record<OrganizeAction, string>> = {
        pin: n > 1 ? `Pinned ${n}` : "Pinned",
        unpin: "Unpinned",
        archive: n > 1 ? `Archived ${n}` : "Archived",
        unarchive: n > 1 ? `Moved ${n} to your inbox` : "Moved to your inbox",
        unread: n > 1 ? `Marked ${n} unread` : "Marked unread",
        label_add: `Labelled “${labels?.[0] ?? ""}”`,
      };
      send(ids, action, labels)
        .then(() => {
          const text = said[action];
          if (!text) return;
          if (action === "archive") toast(text, "success", { action: { label: "Undo", onClick: () => apply(targets.map((g) => ({ ...g, archived: true })), "unarchive") } });
          else toast(text, "success");
        })
        .catch((e: unknown) => toast(e instanceof Error ? e.message : "Couldn't update that.", "error"))
        .finally(() => refresh(action === "archive" || action === "unarchive"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, tab],
  );

  const organize = useCallback((g: NotificationGroup, action: OrganizeAction) => apply([g], action), [apply]);
  const label = useCallback((g: NotificationGroup, l: string, add: boolean) => apply([g], add ? "label_add" : "label_remove", [l]), [apply]);

  // Stable identities so the memoized NotificationCard rows below don't all
  // re-render whenever one row's read/delete state changes.
  const markRead = useCallback((g: NotificationGroup) => {
    mutate<GroupedNotificationsResult>(KEY, (prev) => ({ ...(prev ?? empty), groups: (prev?.groups ?? []).map((x) => (x.id === g.id ? { ...x, read: true } : x)), unread: prev?.unread ?? 0 }));
    fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: g.notificationIds }) })
      .then(() => {
        void revalidate(KEY, loadGrouped, 0).catch(() => {});
        void revalidate(BELL_KEY, loadFlatNotifications, 0).catch(() => {});
      })
      .catch(() => {});
  }, []);

  /*
    Delete with Undo (Part 4 "Undo System"): the cards leave now, the DELETE waits
    six seconds. Undo cancels it and the list comes back from the server untouched.
    Leaving the page sends whatever is still pending (keepalive), so a delete the
    member meant is never lost.
  */
  const pendingDeletes = useRef(new Map<number, string[]>());
  const flushDelete = (timer: number) => {
    const ids = pendingDeletes.current.get(timer);
    if (!ids) return;
    pendingDeletes.current.delete(timer);
    void fetch("/api/notifications", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }), keepalive: true })
      .then(() => refresh())
      .catch(() => {});
  };
  useEffect(() => {
    const flushAll = () => {
      for (const t of [...pendingDeletes.current.keys()]) {
        window.clearTimeout(t);
        flushDelete(t);
      }
    };
    window.addEventListener("pagehide", flushAll);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      flushAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const removeMany = useCallback((targets: NotificationGroup[]) => {
    if (!targets.length) return;
    const keys = new Set(targets.map((g) => g.id));
    const ids = targets.flatMap((g) => g.notificationIds);
    const strip = (prev: GroupedNotificationsResult | undefined) => ({ ...(prev ?? empty), groups: (prev?.groups ?? []).filter((x) => !keys.has(x.id)), unread: Math.max(0, (prev?.unread ?? 0) - targets.filter((g) => !g.read).length) });
    mutate<GroupedNotificationsResult>(KEY, strip);
    if (tabRef.current === "archived") mutate<GroupedNotificationsResult>(ARCHIVED_KEY, strip);
    setHistory((h) => (h ? { ...h, groups: h.groups.filter((x) => !keys.has(x.id)) } : h));
    const timer = window.setTimeout(() => flushDelete(timer), DELETE_GRACE_MS);
    pendingDeletes.current.set(timer, ids);
    toast(targets.length > 1 ? `Deleted ${targets.length}` : "Deleted", "success", {
      duration: DELETE_GRACE_MS - 400,
      action: {
        label: "Undo",
        onClick: () => {
          window.clearTimeout(timer);
          pendingDeletes.current.delete(timer);
          refresh(true);
        },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const remove = useCallback((g: NotificationGroup) => removeMany([g]), [removeMany]);

  // ── Select (multi-select management) ──
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelect = useCallback((g: NotificationGroup) => {
    haptic("selection");
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(g.id)) next.delete(g.id);
      else next.add(g.id);
      return next;
    });
  }, []);
  const endSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const chosen = visible.filter((g) => selected.has(g.id));
  const bulk = (action: OrganizeAction | "delete", labels?: string[]) => {
    if (!chosen.length) return;
    haptic("selection");
    if (action === "delete") removeMany(chosen);
    else apply(chosen, action, labels);
    endSelect();
  };
  const [bulkLabel, setBulkLabel] = useState<string | null>(null);

  // ── Smart Cleanup — two plain suggestions, asked once when the center opens ──
  const [cleanup, setCleanup] = useState<{ oldRead: number; passive: number } | null>(null);
  const [cleanupHidden, setCleanupHidden] = useState(false);
  useEffect(() => {
    if (!organizable) return;
    let cancelled = false;
    void fetch("/api/notifications/cleanup")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ready?: boolean; oldRead?: number; passive?: number } | null) => {
        if (!cancelled && j?.ready) setCleanup({ oldRead: j.oldRead ?? 0, passive: j.passive ?? 0 });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [organizable]);
  const runCleanup = async (kind: "old_read" | "passive") => {
    haptic("selection");
    const res = await fetch("/api/notifications/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) }).catch(() => null);
    if (!res?.ok) return void toast("Couldn't tidy up. Try again.", "error");
    setCleanup((c) => (c ? { ...c, [kind === "old_read" ? "oldRead" : "passive"]: 0 } : c));
    toast("Archived. Find them under Archived any time.", "success");
    refresh(true);
  };

  const markAllRead = () => {
    if (unread === 0) return;
    mutate<GroupedNotificationsResult>(KEY, (prev) => ({ ...(prev ?? empty), groups: (prev?.groups ?? []).map((x) => ({ ...x, read: true })), unread: 0 }));
    fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(() => void revalidate(BELL_KEY, loadFlatNotifications, 0).catch(() => {}))
      .catch(() => {});
  };

  // Part 8 privacy controls: export (a real file download, RLS-scoped to
  // this user's own data) and clear-all (irreversible — gated behind a
  // native confirm(), the same pattern this codebase already uses for other
  // destructive actions, e.g. comments.tsx/collections-tab.tsx).
  const exportData = () => {
    setMoreOpen(false);
    allowWindowOpen();
    window.open("/api/notifications/export", "_blank");
  };

  const clearAll = () => {
    setMoreOpen(false);
    if (!window.confirm("Delete your entire notification history? This can't be undone.")) return;
    setClearing(true);
    mutate<GroupedNotificationsResult>(KEY, () => ({ ...empty }));
    fetch("/api/notifications", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) })
      .then(() => refresh(true))
      .catch(() => {})
      .finally(() => setClearing(false));
  };

  const showCleanup = !!cleanup && !cleanupHidden && tab === "all" && !query && (cleanup.oldRead >= 10 || cleanup.passive >= 10);

  const cards = (list: NotificationGroup[]) =>
    list.map((g) => (
      <NotificationCard
        key={g.id}
        group={g}
        onMarkRead={markRead}
        onDelete={remove}
        onOrganize={organizable ? organize : undefined}
        onLabel={labelsEnabled ? label : undefined}
        labelsEnabled={labelsEnabled}
        selecting={selecting}
        selected={selected.has(g.id)}
        onToggleSelect={toggleSelect}
        compact={layout === "compact"}
      />
    ));

  return (
    <PullToRefresh onRefresh={async () => { await (tab === "archived" ? revalidate(ARCHIVED_KEY, loadArchived, 0) : revalidate(KEY, loadGrouped, 0)); }}>
      {/* Premium glass hero header */}
      <div className="relative mb-5 overflow-hidden rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm backdrop-blur-xl">
        <div aria-hidden className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-gradient-to-br from-blue-500/25 to-violet-500/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-10 h-36 w-36 rounded-full bg-gradient-to-tr from-violet-500/15 to-fuchsia-500/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-[-0.02em]">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-secondary text-foreground">
                <BellRing className="h-5 w-5" />
              </span>
              Notifications
              {unread > 0 ? (
                <span className="rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-2.5 py-0.5 text-xs font-bold text-white shadow-sm shadow-violet-500/25">
                  {unread} new
                </span>
              ) : null}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">Everything that happened, in one place. Search it, pin it, label it, archive it.</p>
          </div>
          <div className="flex items-center gap-2">
            <PushToggle />
            <button
              type="button"
              onClick={markAllRead}
              disabled={unread === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/60 px-3.5 py-2 text-sm font-medium backdrop-blur transition hover:bg-secondary disabled:opacity-40"
            >
              <CheckCheck className="h-4 w-4" /> Mark all read
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-label="Notification center options"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-card/60 text-muted-foreground backdrop-blur transition hover:bg-secondary hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {moreOpen ? (
                <>
                  <button type="button" aria-label="Close menu" onClick={() => setMoreOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                  <div className="glass-strong animate-scale-in absolute right-0 top-10 z-50 w-56 overflow-hidden rounded-2xl py-1.5">
                    <button type="button" onClick={exportData} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition hover:bg-secondary">
                      <Download className="h-4 w-4 text-muted-foreground" /> Export my history
                    </button>
                    <button
                      type="button"
                      onClick={clearAll}
                      disabled={clearing}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" /> Clear all history
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Universal Inbox search — plain language, read back as chips */}
      <div className="mb-2 flex items-center gap-2 rounded-2xl border border-border/60 bg-card/60 px-3.5 py-2.5 backdrop-blur">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void searchHistory();
          }}
          placeholder="Try “messages from chris” or “security last week”"
          aria-label="Search notifications"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {query ? (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="shrink-0 rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {searching ? (
        <div className="mb-4 flex flex-wrap items-center gap-1.5" aria-live="polite">
          <span className="text-[12px] text-muted-foreground">Showing</span>
          {parsed.chips.map((c) => (
            <span key={c} className="rounded-full bg-indigo-600/10 px-2.5 py-0.5 text-[12px] font-semibold text-indigo-700 dark:text-indigo-300">
              {c}
            </span>
          ))}
          {history ? (
            <span className="text-[12px] text-muted-foreground">· across your whole history</span>
          ) : (
            <button type="button" onClick={() => void searchHistory()} disabled={historyBusy} className="ml-auto inline-flex items-center gap-1 rounded-full border border-border/70 px-3 py-1 text-[12px] font-semibold transition hover:bg-secondary disabled:opacity-50">
              <History className="h-3.5 w-3.5" aria-hidden /> {historyBusy ? "Searching…" : "Search all history"}
            </button>
          )}
        </div>
      ) : (
        <div className="mb-3" />
      )}

      {/* Tabs */}
      {!history ? (
        <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => {
            const active = tab === t;
            const count = t === "unread" ? unread : 0;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={active}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition",
                  active ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {TAB_LABEL[t]}
                {t === "unread" && count > 0 ? <span className={cn("rounded-full px-1.5 text-[10px]", active ? "bg-white/25" : "bg-rose-500 text-white")}>{count}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Labels (private) + layout + select */}
      <div className="mb-4 flex items-center gap-2">
        <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ownLabels.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLabelFilter((cur) => (cur === l ? null : l))}
              aria-pressed={labelFilter === l}
              className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[12.5px] font-semibold transition", labelFilter === l ? "bg-indigo-600 text-white" : "bg-indigo-600/10 text-indigo-700 dark:text-indigo-300")}
            >
              <Tag className="h-3 w-3" aria-hidden /> {l}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center rounded-full bg-secondary/60 p-0.5" role="group" aria-label="Layout">
          {(
            [
              ["cards", LayoutList, "Cards"],
              ["compact", Rows3, "Compact"],
              ["timeline", History, "Timeline"],
            ] as const
          ).map(([id, Icon, name]) => (
            <button key={id} type="button" onClick={() => setLayout(id)} aria-pressed={layout === id} aria-label={name} title={name} className={cn("flex h-8 w-8 items-center justify-center rounded-full transition", layout === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => (selecting ? endSelect() : setSelecting(true))}
          aria-pressed={selecting}
          className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition", selecting ? "bg-foreground text-background" : "bg-secondary/60 text-foreground")}
        >
          <CheckSquare className="h-4 w-4" aria-hidden /> {selecting ? "Done" : "Select"}
        </button>
      </div>

      {/* Smart Cleanup — suggestions only; each archives (restorable), never deletes */}
      {showCleanup && cleanup ? (
        <div className="mb-4 rounded-3xl border border-indigo-500/20 bg-indigo-500/[0.05] p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Tidy up your inbox?</p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">Archiving keeps everything searchable and restorable. Pinned notifications are never touched.</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {cleanup.oldRead >= 10 ? (
                  <button type="button" onClick={() => void runCleanup("old_read")} className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white">
                    <Archive className="h-3.5 w-3.5" aria-hidden /> Archive {cleanup.oldRead} read, over a month old
                  </button>
                ) : null}
                {cleanup.passive >= 10 ? (
                  <button type="button" onClick={() => void runCleanup("passive")} className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 px-3.5 py-1.5 text-[12.5px] font-semibold text-indigo-700 dark:text-indigo-300">
                    <Archive className="h-3.5 w-3.5" aria-hidden /> Archive {cleanup.passive} old likes and follows
                  </button>
                ) : null}
              </div>
            </div>
            <button type="button" onClick={() => setCleanupHidden(true)} aria-label="Hide suggestion" className="rounded-full p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {/* List */}
      {visible.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/70 bg-card/40 p-12 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-3xl bg-secondary text-muted-foreground">
            <BellRing className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium">{searching || labelFilter ? "No matches" : tab === "archived" && archived.data === undefined && !archived.error ? "Loading…" : (EMPTY[tab] ?? "No notifications yet")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {searching ? (history ? "Nothing in your whole history matches that." : "Nothing loaded matches. Try Search all history.") : tab === "archived" && archived.error ? "Couldn't load your archive. Pull down to try again." : (EMPTY_HINT[tab] ?? "When people interact with you, it shows up here.")}
          </p>
        </div>
      ) : layout === "timeline" ? (
        <div className="space-y-5">
          {Object.entries(
            visible.reduce<Record<string, NotificationGroup[]>>((acc, g) => {
              (acc[dayLabel(g.createdAt)] ??= []).push(g);
              return acc;
            }, {}),
          ).map(([day, list]) => (
            <section key={day} aria-label={day}>
              <h2 className="mb-2 flex items-center gap-2 px-1 text-[12.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                <span aria-hidden className="h-2 w-2 rounded-full bg-gradient-to-br from-blue-500 to-violet-500" />
                {day}
              </h2>
              <div className="space-y-2.5 border-l border-border/70 pl-3">
                <AnimatePresence initial={false}>{cards(list)}</AnimatePresence>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className={layout === "compact" ? "space-y-1.5" : "space-y-2.5"}>
          <AnimatePresence initial={false}>{cards(visible)}</AnimatePresence>
        </div>
      )}

      {/* Load older (cursor pagination) */}
      {!history && tab !== "archived" && nextCursor && visible.length > 0 ? (
        <div className="mt-5 flex justify-center">
          <button type="button" onClick={() => void loadOlder()} disabled={olderBusy} className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-border/70 bg-card px-5 text-[13.5px] font-semibold transition hover:bg-secondary disabled:opacity-60">
            {olderBusy ? "Loading…" : "Load older"}
          </button>
        </div>
      ) : null}

      {/* New arrivals while scrolled down — a pill, never a jump */}
      {arrived > 0 ? (
        <button type="button" onClick={showNew} className="fixed left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-[13px] font-semibold text-white shadow-lg motion-safe:animate-scale-in" style={{ top: "calc(var(--frenz-header-bottom, 4rem) + 0.75rem)" }}>
          <ArrowUp className="h-4 w-4" aria-hidden /> {arrived === 1 ? "New notification" : `${arrived} new notifications`}
        </button>
      ) : null}

      {/* Bulk actions — above the bottom nav while selecting */}
      {selecting ? (
        <div className="fixed inset-x-3 z-40 mx-auto max-w-xl rounded-3xl border border-border/70 bg-card p-2.5 shadow-elevated" style={{ bottom: "calc(var(--frenz-bottom-nav, 4.5rem) + 0.75rem)" }} role="toolbar" aria-label="Selected notifications">
          {bulkLabel !== null ? (
            <div className="flex items-center gap-1.5">
              <input autoFocus value={bulkLabel} onChange={(e) => setBulkLabel(e.target.value.slice(0, 24))} placeholder="Label, e.g. Review later" aria-label="Label for the selected notifications" className="min-w-0 flex-1 rounded-full bg-secondary/60 px-3.5 py-2 text-[13px] outline-none" />
              <button type="button" disabled={!cleanLabels([bulkLabel]).length || !chosen.length} onClick={() => { bulk("label_add", cleanLabels([bulkLabel])); setBulkLabel(null); }} className="rounded-full bg-indigo-600 px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                Add
              </button>
              <button type="button" onClick={() => setBulkLabel(null)} aria-label="Cancel label" className="rounded-full p-2 text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
              <span className="shrink-0 px-2 text-[13px] font-semibold tabular-nums">{chosen.length} selected</span>
              <BulkButton icon={CheckCheck} label="Read" onClick={() => bulk("read")} disabled={!chosen.length} />
              <BulkButton icon={CircleDot} label="Unread" onClick={() => bulk("unread")} disabled={!chosen.length} />
              {organizable ? <BulkButton icon={Pin} label="Pin" onClick={() => bulk("pin")} disabled={!chosen.length || tab === "archived"} /> : null}
              {organizable ? (tab === "archived" ? <BulkButton icon={ArchiveRestore} label="Restore" onClick={() => bulk("unarchive")} disabled={!chosen.length} /> : <BulkButton icon={Archive} label="Archive" onClick={() => bulk("archive")} disabled={!chosen.length} />) : null}
              {labelsEnabled ? <BulkButton icon={Tag} label="Label" onClick={() => setBulkLabel("")} disabled={!chosen.length} /> : null}
              <BulkButton icon={Trash2} label="Delete" onClick={() => bulk("delete")} disabled={!chosen.length} danger />
            </div>
          )}
        </div>
      ) : null}
    </PullToRefresh>
  );
}

function BulkButton({ icon: Icon, label, onClick, disabled, danger }: { icon: typeof Pin; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn("flex min-w-[3.5rem] shrink-0 flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 text-[11px] font-semibold transition hover:bg-secondary disabled:opacity-40", danger && "text-rose-600")}>
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}
