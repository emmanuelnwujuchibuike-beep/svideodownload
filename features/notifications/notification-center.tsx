"use client";

import { AnimatePresence } from "framer-motion";
import { allowWindowOpen } from "@/lib/monetization/popunder-guard";
import { BellRing, CheckCheck, Download, MoreHorizontal, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { mutate, revalidate, useQuery } from "@/features/data";
import {
  NOTIF_ARCHIVED_KEY as ARCHIVED_KEY,
  NOTIF_GROUPED_KEY as KEY,
  NOTIF_KEY as BELL_KEY,
  loadArchivedNotifications as loadArchived,
  loadFlatNotifications,
  loadGroupedNotifications as loadGrouped,
} from "@/features/notifications/data";
import { verbFor } from "@/features/notifications/meta";
import { NotificationCard, type OrganizeAction } from "@/features/notifications/notification-card";
import { toast } from "@/features/ui/toast";
import { onNotificationInsert } from "@/features/notifications/notif-stream";
import { PushToggle } from "@/features/notifications/push-toggle";
import { PullToRefresh } from "@/features/ui/pull-to-refresh";
import type { GroupedNotificationsResult, NotificationCategory, NotificationGroup } from "@/lib/social/notifications";
import { cn } from "@/lib/utils";

/*
  Feature 20 Activity Center views (owner brief 2026-10-11): Priority (critical + high, the
  push path's own table), Pinned, Held (kept off the lock screen by DND, a focus mode or
  quiet hours — "Scheduled" in the brief) and Archived (fetched only when opened).
*/
type View = "priority" | "pinned" | "held" | "archived";
type Tab = "all" | "unread" | View | NotificationCategory;

const TAB_LABEL: Record<Tab, string> = {
  all: "All",
  unread: "Unread",
  priority: "Priority",
  pinned: "Pinned",
  held: "Held",
  archived: "Archived",
  social: "Social",
  downloads: "Downloads",
  community: "Communities",
  news: "News",
  premium: "Premium",
  security: "Security",
  system: "System",
};
const CATEGORY_ORDER: NotificationCategory[] = ["social", "downloads", "community", "news", "premium", "security", "system"];

const isPriority = (g: NotificationGroup) => g.priority === "critical" || g.priority === "high";
const EMPTY: Partial<Record<Tab, string>> = { unread: "You're all caught up", priority: "Nothing urgent", pinned: "Nothing pinned", held: "Nothing held", archived: "Nothing archived" };
const EMPTY_HINT: Partial<Record<Tab, string>> = {
  priority: "Security alerts, payments, messages and requests show here.",
  pinned: "Pin a notification from its ⋯ menu to keep it at the top.",
  held: "Notifications kept off your lock screen by Do Not Disturb, a focus mode or quiet hours wait here.",
  archived: "Archive a notification from its ⋯ menu to put it away without deleting it.",
};

export function NotificationCenter({ initial }: { initial: GroupedNotificationsResult }) {
  const { data } = useQuery<GroupedNotificationsResult>(KEY, loadGrouped, { initialData: initial });
  const groups = data?.groups ?? initial.groups;
  const unread = data?.unread ?? initial.unread;
  const [tab, setTab] = useState<Tab>("all");
  const organizable = data?.activity ?? initial.activity ?? false;
  // the held-summary push opens /notifications?view=held
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    if (v === "held" || v === "pinned" || v === "priority" || v === "archived") setTab(v);
  }, []);
  // Archived is read only while its tab is open
  const archived = useQuery<GroupedNotificationsResult>(ARCHIVED_KEY, loadArchived, { enabled: tab === "archived", revalidateOnFocus: false });
  const [query, setQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Live: a new notification row for me → refresh the center (the bell refreshes itself).
  useEffect(() => onNotificationInsert(() => void revalidate(KEY, loadGrouped, 0).catch(() => {})), []);

  // Tabs shown = All + Unread + whichever categories actually have notifications.
  const tabs = useMemo<Tab[]>(() => {
    const present = new Set(groups.map((g) => g.category));
    const views: Tab[] = [];
    if (groups.some(isPriority)) views.push("priority");
    if (groups.some((g) => g.pinned)) views.push("pinned");
    if (groups.some((g) => g.delivery === "held")) views.push("held");
    const out: Tab[] = ["all", "unread", ...views, ...CATEGORY_ORDER.filter((c) => present.has(c))];
    if (organizable) out.push("archived");
    // a tab opened from a link stays visible even when it is empty
    if (!out.includes(tab)) out.splice(2, 0, tab);
    return out;
  }, [groups, organizable, tab]);

  const visible = useMemo(() => {
    const source = tab === "archived" ? (archived.data?.groups ?? []) : groups;
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
                : source.filter((g) => g.category === tab);
    const q = query.trim().toLowerCase();
    if (q) {
      // the Universal Inbox: who, the post, the notification's own words, and what kind it is
      list = list.filter((g) =>
        [g.postTitle, g.content?.title, g.content?.body, g.broadcast?.title, g.broadcast?.body, verbFor(g.type), ...g.actors.flatMap((a) => [a.displayName, a.handle])].some((t) => (t ?? "").toLowerCase().includes(q)),
      );
    }
    // pinned first in the inbox views; otherwise newest first, as the server sent it
    if (tab !== "archived" && tab !== "pinned") list = [...list.filter((g) => g.pinned), ...list.filter((g) => !g.pinned)];
    return list;
  }, [groups, archived.data, tab, query]);

  /*
    Pin / archive: drawn on the tap, the server confirms, put back if it refuses (owner
    rule: every button responds on tap). Archiving also marks read on the server, so the
    unread count drops with it.
  */
  const organize = useCallback((g: NotificationGroup, action: OrganizeAction) => {
    const flip = (x: NotificationGroup): NotificationGroup => (x.id !== g.id ? x : { ...x, pinned: action === "pin" });
    if (action === "archive") {
      mutate<GroupedNotificationsResult>(KEY, (prev) => ({ ...(prev ?? { groups: [], unread: 0 }), groups: (prev?.groups ?? []).filter((x) => x.id !== g.id), unread: Math.max(0, (prev?.unread ?? 0) - (g.read ? 0 : 1)) }));
    } else if (action === "unarchive") {
      mutate<GroupedNotificationsResult>(ARCHIVED_KEY, (prev) => ({ ...(prev ?? { groups: [], unread: 0 }), groups: (prev?.groups ?? []).filter((x) => x.id !== g.id) }));
    } else {
      mutate<GroupedNotificationsResult>(KEY, (prev) => ({ ...(prev ?? { groups: [], unread: 0 }), groups: (prev?.groups ?? []).map(flip) }));
    }
    const done = action === "pin" ? "Pinned" : action === "unpin" ? "Unpinned" : action === "archive" ? "Archived" : "Moved to your inbox";
    fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: g.notificationIds, action }) })
      .then(async (r) => {
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? "Couldn't update that.");
        }
        toast(done, "success");
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : "Couldn't update that.", "error"))
      .finally(() => {
        // the server's answer replaces the drawn one either way — a refusal puts it back
        void revalidate(KEY, loadGrouped, 0).catch(() => {});
        if (action === "archive" || action === "unarchive") void revalidate(ARCHIVED_KEY, loadArchived, 0).catch(() => {});
        if (action === "archive") void revalidate(BELL_KEY, loadFlatNotifications, 0).catch(() => {});
      });
  }, []);

  // Stable identities so the memoized NotificationCard rows below don't all
  // re-render whenever one row's read/delete state changes.
  const markRead = useCallback((g: NotificationGroup) => {
    mutate<GroupedNotificationsResult>(KEY, (prev) => ({
      groups: (prev?.groups ?? []).map((x) => (x.id === g.id ? { ...x, read: true } : x)),
      unread: prev?.unread ?? 0,
    }));
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: g.notificationIds }),
    })
      .then(() => {
        void revalidate(KEY, loadGrouped, 0).catch(() => {});
        void revalidate(BELL_KEY, loadFlatNotifications, 0).catch(() => {});
      })
      .catch(() => {});
  }, []);

  const remove = useCallback((g: NotificationGroup) => {
    mutate<GroupedNotificationsResult>(KEY, (prev) => ({
      groups: (prev?.groups ?? []).filter((x) => x.id !== g.id),
      unread: prev?.unread ?? 0,
    }));
    fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: g.notificationIds }),
    })
      .then(() => {
        void revalidate(KEY, loadGrouped, 0).catch(() => {});
        if (!g.read) void revalidate(BELL_KEY, loadFlatNotifications, 0).catch(() => {});
      })
      .catch(() => {});
  }, []);

  const markAllRead = () => {
    if (unread === 0) return;
    mutate<GroupedNotificationsResult>(KEY, (prev) => ({
      groups: (prev?.groups ?? []).map((x) => ({ ...x, read: true })),
      unread: 0,
    }));
    fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(() => void revalidate(BELL_KEY, undefined as never, 0).catch(() => {}))
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
    mutate<GroupedNotificationsResult>(KEY, () => ({ groups: [], unread: 0 }));
    fetch("/api/notifications", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) })
      .then(() => {
        void revalidate(KEY, loadGrouped, 0).catch(() => {});
        void revalidate(BELL_KEY, loadFlatNotifications, 0).catch(() => {});
      })
      .catch(() => {})
      .finally(() => setClearing(false));
  };

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
            <p className="mt-1.5 text-sm text-muted-foreground">
              Everything happening around you — grouped smartly, delivered live.
            </p>
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
                aria-label="More options"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-card/60 text-muted-foreground backdrop-blur transition hover:bg-secondary hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {moreOpen ? (
                <>
                  <button type="button" aria-label="Close menu" onClick={() => setMoreOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                  <div className="glass-strong animate-scale-in absolute right-0 top-10 z-50 w-56 overflow-hidden rounded-2xl py-1.5">
                    <button type="button" onClick={exportData} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition hover:bg-secondary">
                      <Download className="h-4 w-4 text-muted-foreground" /> Export my data
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

      {/* Search — filters by who's involved or the post it's about, within the active tab. */}
      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-border/60 bg-card/60 px-3.5 py-2.5 backdrop-blur">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notifications"
          aria-label="Search notifications"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {query ? (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="shrink-0 rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {/* Tabs */}
      <div className="-mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const active = tab === t;
          const count = t === "unread" ? unread : 0;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition",
                active
                  ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25"
                  : "bg-secondary/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABEL[t]}
              {t === "unread" && count > 0 ? (
                <span className={cn("rounded-full px-1.5 text-[10px]", active ? "bg-white/25" : "bg-rose-500 text-white")}>{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/70 bg-card/40 p-12 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-3xl bg-secondary text-muted-foreground">
            <BellRing className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium">{query ? "No matches" : tab === "archived" && archived.data === undefined && !archived.error ? "Loading…" : (EMPTY[tab] ?? "No notifications yet")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{query ? "Try a different name or search term." : tab === "archived" && archived.error ? "Couldn't load your archive. Pull down to try again." : (EMPTY_HINT[tab] ?? "When people interact with you, it shows up here.")}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence initial={false}>
            {visible.map((g) => (
              <NotificationCard key={g.id} group={g} onMarkRead={markRead} onDelete={remove} onOrganize={organizable ? organize : undefined} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </PullToRefresh>
  );
}
