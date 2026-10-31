"use client";

import { IoNotifications, IoNotificationsOutline } from "react-icons/io5";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FEED_HEADER_CIRCLE } from "@/features/ui/floating-glass";

import { IconTile } from "@/components/icons/icon-tile";
import { mutate, revalidate, useQuery } from "@/features/data";
import {
  NOTIF_KEY as KEY,
  loadFlatNotifications as loadNotifications,
  type FlatNotifications as NotifData,
} from "@/features/notifications/data";
import { hrefFor, iconFor, tintFor, timeAgo, verbFor } from "@/features/notifications/meta";
import { announceNotificationSync, onNotificationInsert, onNotificationSync } from "@/features/notifications/notif-stream";
import { INBOX_KEY, loadInbox, type Inbox } from "@/features/social/inbox";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { categoryForType } from "@/lib/platform/notifications-registry";
import { CloseWhenOpened, TapPending } from "@/features/wallet/tap-pending";
import { cn } from "@/lib/utils";

/** `glass`: the feed's floating glass circle (features/ui/floating-glass.ts, owner 2026-10-23). */
export function NotificationBell({ glass = false }: { glass?: boolean } = {}) {
  // Cached-first: the bell shows last-known notifications instantly on every page
  // (it lives in the topbar app-wide) and revalidates in the background + on focus.
  const { data } = useQuery<NotifData>(KEY, loadNotifications);
  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;
  // Messages have their own dedicated badge (FloatingMessages/bottom-nav Inbox
  // tab) — the bell's own count deliberately excludes them (see
  // lib/social/notifications.ts) — but the single OS-level PWA app icon badge
  // has no room for two numbers, so it's the union of both.
  const { data: inbox } = useQuery<Inbox>(INBOX_KEY, loadInbox);
  const inboxUnread = inbox?.unread ?? 0;
  const [open, setOpen] = useState(false);

  // App-icon badge (installed PWA): mirror the unread count on the home-screen
  // icon and clear it the moment everything is read. Badging API — silently a
  // no-op where unsupported; on iOS it works for home-screen installs (16.4+).
  useEffect(() => {
    const total = unread + inboxUnread;
    try {
      const nav = navigator as Navigator & {
        setAppBadge?: (count?: number) => Promise<void>;
        clearAppBadge?: () => Promise<void>;
      };
      if (total > 0) void nav.setAppBadge?.(total).catch(() => {});
      else void nav.clearAppBadge?.().catch(() => {});
    } catch {
      /* unsupported */
    }
  }, [unread, inboxUnread]);

  // Realtime: the shared notifications stream (one channel app-wide).
  useEffect(
    () =>
      onNotificationInsert(({ type }) => {
        // message/message_reaction don't count toward the bell's own badge
        // (they have their own dedicated inbox badge — see
        // lib/social/notifications.ts's listNotifications) — skip the
        // optimistic bump for those so the count never even flashes up.
        if (type !== "message" && type !== "message_reaction") {
          // Optimistic bump, then pull the real list.
          mutate<NotifData>(KEY, (prev) => ({ items: prev?.items ?? [], unread: (prev?.unread ?? 0) + 1 }));
        }
        void revalidate(KEY, loadNotifications, 0).catch(() => {});
      }),
    [],
  );
  // Part 6: read on another of my devices → this badge catches up
  useEffect(() => onNotificationSync(() => void revalidate(KEY, loadNotifications, 0).catch(() => {})), []);

  const toggle = async () => {
    haptic("light");
    playSound("tap");
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Optimistically mark everything read.
      mutate<NotifData>(KEY, (prev) => ({ items: (prev?.items ?? []).map((i) => ({ ...i, read: true })), unread: 0 }));
      try {
        const r = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (r.ok) announceNotificationSync();
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
        className={cn("relative inline-flex h-11 w-11 items-center justify-center", glass && FEED_HEADER_CIRCLE)}
      >
        {/* Owner correction (2026-07-13): unread used to also swap this tile
            to the dark brand tint — the mockup's own unread state is just the
            red count badge below, the bell icon itself never changes color. */}
        <IconTile>
          {unread > 0 ? <IoNotifications className="h-[26px] w-[26px]" /> : <IoNotificationsOutline className="h-[26px] w-[26px]" />}
        </IconTile>
        {unread > 0 ? (
          // keyed by the count: a new arrival re-mounts it, so it pops once (never on a timer; reduced motion skips it)
          <span key={unread} className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-[#E5484D] px-[5px] text-[11px] font-bold text-white motion-safe:animate-scale-in">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* pointer-events-auto: on the feed this sits in the glass header, which lets taps pass through (pointer-events-none);
              without it the panel was visible but every tap — "See all" included — fell through to the page beneath. */}
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="pointer-events-auto fixed inset-0 z-40 cursor-default" />
          <div className="pointer-events-auto absolute right-0 z-50 mt-2 max-h-[28rem] w-80 overflow-y-auto rounded-2xl border border-border/70 bg-card shadow-elevated">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-card px-4 py-3">
              <span className="text-sm font-semibold">Notifications</span>
              {/* owner, 2026-10-27: "Notification see all button is not pressing" — it was 12px text with no padding (a tiny target)
                  and the panel closed on the tap, so a slow open looked like nothing happened. Now a 44px target that spins from
                  the tap and closes the panel only once the page has opened; a main button, so it prefetches. */}
              <Link href="/notifications" className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-primary hover:underline">
                <TapPending size={14}>See all</TapPending>
                <CloseWhenOpened onOpened={() => setOpen(false)} />
              </Link>
            </div>
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">You&apos;re all caught up</div>
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
                        {/* a person → their photo; a system notification → the Frenz logo (owner 2026-10-12) */}
                        <span className="relative mt-0.5 shrink-0">
                          {n.actor?.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={n.actor.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                          ) : n.actor ? (
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xs font-bold text-white">{n.actor.displayName.replace(/^@/, "").charAt(0).toUpperCase()}</span>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src="/icon.png" alt="" className="h-8 w-8 rounded-xl object-cover" />
                          )}
                          <span className={cn("absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-card", tintFor(categoryForType(n.type), n.type))}>
                            <Icon className="h-2.5 w-2.5" />
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-sm leading-snug">
                            {n.actor ? (
                              <>
                                <span className="font-semibold">{n.actor.displayName}</span> {verbFor(n.type)}
                              </>
                            ) : (
                              <span className="font-semibold">{n.content?.title ?? n.broadcast?.title ?? verbFor(n.type)}</span>
                            )}
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
