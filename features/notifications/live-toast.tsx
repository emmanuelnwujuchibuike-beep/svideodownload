"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { loadFlatNotifications } from "@/features/notifications/data";
import { hrefFor, iconFor, timeAgo, tintFor, verbFor } from "@/features/notifications/meta";
import { loadInbox } from "@/features/social/inbox";
import { categoryForType, type NotificationItem } from "@/lib/social/notifications";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** What the drop-down can show: a social notification or an incoming DM. */
type Toast =
  | { kind: "notif"; n: NotificationItem }
  | { kind: "message"; convId: string; name: string; avatarUrl: string | null; body: string };

/**
 * Premium in-app drop-down notification (Feature 1 spec): when a notification
 * lands while the user is inside the app, a glass card springs down from the top
 * with the actor + action, stays ~5s, and deep-links on tap. Complements — never
 * replaces — the bell (badge/list) and device push (site closed): this is the
 * "you're here right now" moment. Hidden when the tab isn't visible (push covers
 * that) and auto-collapses on rapid bursts (newest wins).
 */
export function NotificationLiveToast() {
  const [item, setItem] = useState<Toast | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channels: ReturnType<typeof supabase.channel>[] = [];
    let cancelled = false;

    const show = (t: Toast) => {
      if (cancelled) return;
      setItem(t);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setItem(null), 5200);
    };

    supabase.auth.getUser().then(({ data: auth }) => {
      const uid = auth.user?.id;
      if (!uid || cancelled) return;

      // Social notifications (likes, follows, friend requests, …).
      channels.push(
        supabase
          // Distinct channel name — the topbar bell owns `notifications:{uid}`.
          .channel(`notif-toast:${uid}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
            (payload) => {
              // Tab hidden → device push / bell badge already cover it.
              if (document.visibilityState !== "visible") return;
              const rowId = (payload.new as { id?: string }).id;
              // The realtime row is bare ids; fetch the enriched item (actor, post).
              void loadFlatNotifications()
                .then((d) => {
                  const fresh = (rowId && d.items.find((i) => i.id === rowId)) || d.items[0];
                  if (fresh) show({ kind: "notif", n: fresh });
                })
                .catch(() => {});
            },
          )
          .subscribe(),
      );

      // Incoming DMs: a conversation row is touched on every message. Only
      // toast messages FROM the other side, and never while already reading
      // that conversation.
      for (const col of ["user_low", "user_high"] as const) {
        channels.push(
          supabase
            .channel(`msg-toast:${col}:${uid}`)
            .on(
              "postgres_changes",
              { event: "UPDATE", schema: "public", table: "conversations", filter: `${col}=eq.${uid}` },
              (payload) => {
                if (document.visibilityState !== "visible") return;
                const row = payload.new as { id?: string; last_sender_id?: string; last_body?: string };
                if (!row.id || !row.last_sender_id || row.last_sender_id === uid) return;
                if (window.location.pathname === `/messages/${row.id}`) return;
                void loadInbox()
                  .then((inbox) => {
                    const conv = inbox.conversations.find((c) => c.id === row.id);
                    if (!conv) return;
                    show({
                      kind: "message",
                      convId: row.id!,
                      name: conv.other.displayName,
                      avatarUrl: conv.other.avatarUrl,
                      body: row.last_body ?? "New message",
                    });
                  })
                  .catch(() => {});
              },
            )
            .subscribe(),
        );
      }
    });

    return () => {
      cancelled = true;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      for (const ch of channels) void ch.unsubscribe();
    };
  }, []);

  const open = (t: Toast) => {
    setItem(null);
    router.push(t.kind === "message" ? `/messages/${t.convId}` : hrefFor(t.n));
  };

  const Icon = item ? (item.kind === "message" ? MessageCircle : iconFor(item.n.type)) : null;

  const tint = item
    ? item.kind === "message"
      ? "bg-gradient-to-br from-blue-500/20 to-violet-500/20 text-blue-500 dark:text-blue-300"
      : tintFor(categoryForType(item.n.type))
    : "";
  const avatarUrl = item ? (item.kind === "message" ? item.avatarUrl : item.n.actor?.avatarUrl) : null;
  const key = item ? (item.kind === "message" ? `m:${item.convId}:${item.body}` : item.n.id) : "";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex justify-center px-3">
      <AnimatePresence>
        {item && Icon ? (
          <motion.button
            key={key}
            type="button"
            onClick={() => open(item)}
            initial={{ y: -84, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -84, opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-3xl border border-border/70 bg-card/90 p-3 text-left shadow-elevated backdrop-blur-xl transition hover:bg-card"
            aria-live="polite"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-violet-500/30" />
            ) : (
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", tint)}>
                <Icon className="h-5 w-5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              {item.kind === "message" ? (
                <>
                  <span className="block truncate text-sm leading-snug">
                    <span className="font-semibold">{item.name}</span>{" "}
                    <span className="text-muted-foreground">
                      · {item.body.length > 64 ? `${item.body.slice(0, 64)}…` : item.body}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">just now · tap to reply</span>
                </>
              ) : (
                <>
                  <span className="block truncate text-sm leading-snug">
                    <span className="font-semibold">{item.n.actor?.displayName ?? "Frenz"}</span>{" "}
                    {verbFor(item.n.type)}
                    {item.n.postTitle ? <span className="text-muted-foreground"> · {item.n.postTitle}</span> : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{timeAgo(item.n.createdAt)} ago</span>
                </>
              )}
            </span>
            <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", tint)}>
              <Icon className="h-3.5 w-3.5" />
            </span>
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
