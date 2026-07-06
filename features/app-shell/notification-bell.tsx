"use client";

import { IoNotifications, IoNotificationsOutline } from "react-icons/io5";
import Link from "next/link";
import { useEffect, useState } from "react";

import { mutate, revalidate, useQuery } from "@/features/data";
import {
  NOTIF_KEY as KEY,
  loadFlatNotifications as loadNotifications,
  type FlatNotifications as NotifData,
} from "@/features/notifications/data";
import { hrefFor, iconFor, tintFor, timeAgo, verbFor } from "@/features/notifications/meta";
import { categoryForType } from "@/lib/social/notifications";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  // Cached-first: the bell shows last-known notifications instantly on every page
  // (it lives in the topbar app-wide) and revalidates in the background + on focus.
  const { data } = useQuery<NotifData>(KEY, loadNotifications);
  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;
  const [open, setOpen] = useState(false);

  // App-icon badge (installed PWA): mirror the unread count on the home-screen
  // icon and clear it the moment everything is read. Badging API — silently a
  // no-op where unsupported; on iOS it works for home-screen installs (16.4+).
  useEffect(() => {
    try {
      const nav = navigator as Navigator & {
        setAppBadge?: (count?: number) => Promise<void>;
        clearAppBadge?: () => Promise<void>;
      };
      if (unread > 0) void nav.setAppBadge?.(unread).catch(() => {});
      else void nav.clearAppBadge?.().catch(() => {});
    } catch {
      /* unsupported */
    }
  }, [unread]);

  // Realtime subscription scoped to the current user.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    supabase.auth.getUser().then(({ data: auth }) => {
      const uid = auth.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`notifications:${uid}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          () => {
            // Optimistic bump, then pull the real list.
            mutate<NotifData>(KEY, (prev) => ({ items: prev?.items ?? [], unread: (prev?.unread ?? 0) + 1 }));
            void revalidate(KEY, loadNotifications, 0).catch(() => {});
          },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) void channel.unsubscribe();
    };
  }, []);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Optimistically mark everything read.
      mutate<NotifData>(KEY, (prev) => ({ items: (prev?.items ?? []).map((i) => ({ ...i, read: true })), unread: 0 }));
      try {
        await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary/50 text-foreground ring-1 ring-inset ring-border/50 transition hover:bg-secondary"
      >
        {unread > 0 ? <IoNotifications className="h-[21px] w-[21px]" /> : <IoNotificationsOutline className="h-[21px] w-[21px]" />}
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-pink-600 px-1 text-[10px] font-bold text-white shadow-sm shadow-rose-500/40 ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div className="absolute right-0 z-50 mt-2 max-h-[28rem] w-80 overflow-y-auto rounded-2xl border border-border/70 bg-card shadow-elevated">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-card px-4 py-3">
              <span className="text-sm font-semibold">Notifications</span>
              <Link href="/notifications" onClick={() => setOpen(false)} className="text-xs font-semibold text-primary hover:underline">
                See all
              </Link>
            </div>
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">You&apos;re all caught up 🎉</div>
            ) : (
              <ul>
                {items.map((n) => {
                  const Icon = iconFor(n.type);
                  const href = hrefFor(n);
                  return (
                    <li key={n.id}>
                      <Link
                        href={href}
                        onClick={() => setOpen(false)}
                        className={cn("flex items-start gap-3 px-4 py-3 transition hover:bg-secondary", !n.read && "bg-primary/[0.04]")}
                      >
                        <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", tintFor(categoryForType(n.type)))}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-sm leading-snug">
                            <span className="font-semibold">{n.actor?.displayName ?? "Someone"}</span> {verbFor(n.type)}
                            {n.postTitle ? <span className="text-muted-foreground"> · {n.postTitle}</span> : null}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">{timeAgo(n.createdAt)} ago</span>
                        </span>
                        {!n.read ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
