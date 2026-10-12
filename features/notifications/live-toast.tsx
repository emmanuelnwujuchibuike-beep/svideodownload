"use client";

import { MessageCircle, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { bannerFor, clip, type Banner } from "@/features/notifications/banner";
import { onNotificationInsert } from "@/features/notifications/notif-stream";
import { loadInbox } from "@/features/social/inbox";
import { avatarSrc } from "@/lib/media/avatar-url";
import { haptic } from "@/lib/motion/haptics";
import type { NotificationItem } from "@/lib/social/notifications";
import { createClient } from "@/lib/supabase/client";
import { getClientAuthUser } from "@/lib/supabase/client-user";
import { cn } from "@/lib/utils";

/**
 * THE INCOMING BANNER — what lands at the top while someone is using Frenz
 * (Notifications Part 1 brief, 2026-10-12, with Instagram's banner as the
 * reference): the sender's real round avatar wearing a small Frenz badge, their
 * name on its own line, the message under it, "now" top right, and the post's
 * thumbnail where there is one. One component — the same mount the old
 * drop-down used — never a second banner system.
 *
 * Behaviour:
 *   · tap → the destination; swipe up → gone; nonessential ones leave after
 *     ~5 s, a friend request stays ~9 s with "View request"
 *   · a burst never stacks a pile of cards: the newest shows, and the cards
 *     behind it are drawn as Instagram's stacked edge with a count
 *   · the same notification never shows twice (a realtime reconnect can replay)
 *   · held by Do Not Disturb, a focus mode or quiet hours → no banner (the row
 *     is still in the Activity Center and the badge still counts it)
 *   · a message from the conversation already on screen → no banner
 *   · reads ONE small page (the newest five) to describe the new row — never
 *     the history; no polling, listeners and timers cleaned up
 *   · CSS transitions only (no animation library); reduced motion → no slide
 *
 * Device push (the app closed) is the service worker's job and unaffected.
 */
const SHOW_MS = 5200;
const STICKY_MS = 9000;
const LEAVE_MS = 220;

export function NotificationLiveToast() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [shown, setShown] = useState(false);
  const [behind, setBehind] = useState(0);
  const [dragY, setDragY] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seen = useRef<string[]>([]);
  const current = useRef<Banner | null>(null);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const router = useRouter();

  const dismiss = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShown(false);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      current.current = null;
      setBanner(null);
      setBehind(0);
      setDragY(0);
    }, LEAVE_MS);
  };

  useEffect(() => {
    const supabase = createClient();
    const channels: ReturnType<typeof supabase.channel>[] = [];
    let cancelled = false;

    const show = (b: Banner) => {
      if (cancelled || document.visibilityState !== "visible") return;
      // never the same one twice — a realtime reconnect can replay an insert
      if (seen.current.includes(b.key)) return;
      seen.current = [b.key, ...seen.current].slice(0, 60);
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      // a burst: the newest takes the front, the rest become the stacked edge behind it
      const showing = !!current.current;
      setBehind((n) => (showing ? Math.min(n + 1, 99) : 0));
      current.current = b;
      setBanner(b);
      setDragY(0);
      requestAnimationFrame(() => requestAnimationFrame(() => !cancelled && setShown(true)));
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(dismiss, b.sticky ? STICKY_MS : SHOW_MS);
    };

    const offNotif = onNotificationInsert((row) => {
      if (document.visibilityState !== "visible") return;
      // a new message has its own banner below (the message text, not "sent you a message")
      if (row.type === "message" || row.type === "message_reaction") return;
      const rowId = row.id;
      if (rowId && seen.current.includes(rowId)) return;
      // the newest five only — enough to find the row that just arrived, never the history
      void fetch("/api/notifications?limit=5", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ items?: NotificationItem[] }>) : null))
        .then((d) => {
          const fresh = (rowId && d?.items?.find((i) => i.id === rowId)) || null;
          const b = fresh ? bannerFor(fresh) : null;
          if (b) show(b);
        })
        .catch(() => {});
    });

    getClientAuthUser(supabase).then(({ data: auth }) => {
      const uid = auth.user?.id;
      if (!uid || cancelled) return;
      // Incoming messages: every conversation_members row of mine is touched on each new
      // message (direct or group), so one channel filtered on user_id covers both. The
      // touch doesn't say who or when, so the inbox decides: not from me, and fresh.
      channels.push(
        supabase
          .channel(`msg-toast:${uid}`)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_members", filter: `user_id=eq.${uid}` }, (payload) => {
            if (document.visibilityState !== "visible") return;
            const row = payload.new as { conversation_id?: string };
            if (!row.conversation_id) return;
            // already reading that conversation — nothing to announce
            if (window.location.pathname === `/messages/${row.conversation_id}`) return;
            void loadInbox()
              .then((inbox) => {
                const conv = inbox.conversations.find((c) => c.id === row.conversation_id);
                if (!conv || conv.fromMe) return;
                if (Date.now() - new Date(conv.lastAt).getTime() > 8000) return;
                const group = conv.type === "group";
                show({
                  key: `m:${conv.id}:${conv.lastAt}`,
                  name: group ? (conv.title ?? "Group chat") : (conv.other?.displayName ?? "Someone"),
                  text: clip(conv.lastBody ?? "New message", 120),
                  avatarUrl: group ? conv.avatarUrl : (conv.other?.avatarUrl ?? null),
                  system: false,
                  thumb: null,
                  href: `/messages/${conv.id}`,
                  action: null,
                  sticky: false,
                  Icon: MessageCircle,
                  tint: "bg-secondary text-foreground",
                });
              })
              .catch(() => {});
          })
          .subscribe(),
      );
    });

    return () => {
      cancelled = true;
      offNotif();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      for (const ch of channels) void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one subscription for the life of the shell
  }, []);

  const open = (b: Banner) => {
    haptic("light");
    dismiss();
    router.push(b.href);
  };

  if (!banner) return null;
  const b = banner;
  const Icon = b.Icon;
  const lift = Math.min(0, dragY);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(0.5rem+var(--frenz-safe-top))] z-[80] flex justify-center px-3" aria-live="polite">
      <div
        className={cn(
          "pointer-events-auto relative w-full max-w-md transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-opacity",
          shown ? "opacity-100" : "opacity-0",
          !shown && "-translate-y-[120%] motion-reduce:translate-y-0",
        )}
        style={shown && lift ? { transform: `translateY(${lift}px)`, transition: "none" } : undefined}
      >
        {/* Instagram's stacked edge: the cards that arrived behind this one */}
        {behind > 0 ? (
          <>
            <span aria-hidden className="absolute inset-x-3 -bottom-1.5 h-6 rounded-b-[22px] bg-card/80 shadow-sm ring-1 ring-inset ring-black/[0.05] dark:ring-white/[0.06]" />
            {behind > 1 ? <span aria-hidden className="absolute inset-x-6 -bottom-3 h-6 rounded-b-[22px] bg-card/60 ring-1 ring-inset ring-black/[0.04] dark:ring-white/[0.05]" /> : null}
          </>
        ) : null}
        <div
          role="button"
          tabIndex={0}
          aria-label={`${b.name}: ${b.text}`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open(b);
            } else if (e.key === "Escape") dismiss();
          }}
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, moved: false };
            if (hideTimer.current) clearTimeout(hideTimer.current);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const dy = e.clientY - drag.current.y;
            if (Math.abs(dy) > 6) drag.current.moved = true;
            if (drag.current.moved) setDragY(dy);
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (d?.moved) {
              if (dragY < -28) dismiss();
              else {
                setDragY(0);
                hideTimer.current = setTimeout(dismiss, b.sticky ? STICKY_MS : SHOW_MS);
              }
              return;
            }
            open(b);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragY(0);
            hideTimer.current = setTimeout(dismiss, SHOW_MS);
          }}
          className="relative flex touch-none select-none items-center gap-3 rounded-[22px] bg-card/95 px-3.5 py-3 text-left shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)] ring-1 ring-inset ring-black/[0.06] backdrop-blur-xl outline-none focus-visible:ring-2 focus-visible:ring-primary dark:ring-white/10"
        >
          {/* the sender, wearing a small Frenz badge — or the Frenz logo for a system notice */}
          <span className="relative shrink-0">
            {b.system ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/icon.png" alt="" width={44} height={44} className="h-11 w-11 rounded-[14px] object-cover" />
            ) : b.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarSrc(b.avatarUrl, 44)} alt="" width={44} height={44} className="h-11 w-11 rounded-full object-cover" />
            ) : (
              <span className={cn("flex h-11 w-11 items-center justify-center rounded-full", b.tint)}>
                <Icon className="h-5 w-5" aria-hidden />
              </span>
            )}
            {!b.system ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/icon.png" alt="" width={18} height={18} className="absolute -bottom-0.5 -right-0.5 h-[18px] w-[18px] rounded-[5px] object-cover ring-2 ring-card" />
            ) : null}
            {behind > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10.5px] font-bold text-primary-foreground ring-2 ring-card">{behind + 1}</span>
            ) : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold leading-tight text-foreground">{b.name}</span>
              <span className="shrink-0 text-[12px] text-muted-foreground">now</span>
            </span>
            <span className="mt-0.5 line-clamp-2 text-[13.5px] leading-snug text-foreground/85">{b.text}</span>
            {b.action ? (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-semibold text-primary">
                <UserPlus className="h-3.5 w-3.5" aria-hidden /> {b.action}
              </span>
            ) : null}
          </span>
          {b.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.thumb} alt="" width={44} height={44} loading="eager" decoding="async" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
