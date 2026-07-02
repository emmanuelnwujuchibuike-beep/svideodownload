"use client";

import { AnimatePresence } from "framer-motion";
import { BellRing, CheckCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { mutate, revalidate, useQuery } from "@/features/data";
import {
  NOTIF_GROUPED_KEY as KEY,
  NOTIF_KEY as BELL_KEY,
  loadFlatNotifications,
  loadGroupedNotifications as loadGrouped,
} from "@/features/notifications/data";
import { NotificationCard } from "@/features/notifications/notification-card";
import { PushToggle } from "@/features/notifications/push-toggle";
import type { GroupedNotificationsResult, NotificationCategory, NotificationGroup } from "@/lib/social/notifications";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Tab = "all" | "unread" | NotificationCategory;

const TAB_LABEL: Record<Tab, string> = {
  all: "All",
  unread: "Unread",
  social: "Social",
  downloads: "Downloads",
  community: "Communities",
  news: "News",
  premium: "Premium",
  security: "Security",
  system: "System",
};
const CATEGORY_ORDER: NotificationCategory[] = ["social", "downloads", "community", "news", "premium", "security", "system"];

export function NotificationCenter({ initial }: { initial: GroupedNotificationsResult }) {
  const { data } = useQuery<GroupedNotificationsResult>(KEY, loadGrouped, { initialData: initial });
  const groups = data?.groups ?? initial.groups;
  const unread = data?.unread ?? initial.unread;
  const [tab, setTab] = useState<Tab>("all");

  // Live: a new notification row for me → refresh the center (and the bell).
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    supabase.auth.getUser().then(({ data: auth }) => {
      const uid = auth.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`notif-center:${uid}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          () => {
            void revalidate(KEY, loadGrouped, 0).catch(() => {});
          },
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) void channel.unsubscribe();
    };
  }, []);

  // Tabs shown = All + Unread + whichever categories actually have notifications.
  const tabs = useMemo<Tab[]>(() => {
    const present = new Set(groups.map((g) => g.category));
    return ["all", "unread", ...CATEGORY_ORDER.filter((c) => present.has(c))];
  }, [groups]);

  const visible = useMemo(() => {
    if (tab === "all") return groups;
    if (tab === "unread") return groups.filter((g) => !g.read);
    return groups.filter((g) => g.category === tab);
  }, [groups, tab]);

  const markRead = (g: NotificationGroup) => {
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
  };

  const remove = (g: NotificationGroup) => {
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
  };

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

  return (
    <div>
      {/* Premium glass hero header */}
      <div className="relative mb-5 overflow-hidden rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm backdrop-blur-xl">
        <div aria-hidden className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-gradient-to-br from-blue-500/25 to-violet-500/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-10 h-36 w-36 rounded-full bg-gradient-to-tr from-violet-500/15 to-fuchsia-500/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-[-0.02em]">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-[0_6px_20px_-6px_rgba(124,58,237,0.7)]">
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
          </div>
        </div>
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
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 text-violet-500">
            <BellRing className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium">{tab === "unread" ? "You're all caught up 🎉" : "No notifications yet"}</p>
          <p className="mt-1 text-xs text-muted-foreground">When people interact with you, it shows up here.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence initial={false}>
            {visible.map((g) => (
              <NotificationCard key={g.id} group={g} onMarkRead={markRead} onDelete={remove} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
