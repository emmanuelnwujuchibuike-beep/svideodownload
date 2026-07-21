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
              const row = payload.new as { id?: string; type?: string };
              // message/message_reaction already have their own richer toast
              // below (actual message preview, not just "sent you a message")
              // driven by the conversation_members touch — skip here so a new
              // message doesn't produce two toasts.
              if (row.type === "message" || row.type === "message_reaction") return;
              const rowId = row.id;
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

      // Incoming messages: every active `conversation_members` row you have
      // is touched on every message/edit/delete/rename in that conversation
      // (direct or group — see features/social/inbox.ts's matching fix), so
      // one channel filtered on `user_id` covers both kinds, replacing the
      // old 2-channel user_low/user_high hack. The touch doesn't say WHO
      // sent it or WHEN the underlying message actually landed, so after
      // refetching the inbox we only toast if the latest message is genuinely
      // fresh (not from me, within the last few seconds) — guards against a
      // stale re-toast from e.g. merely opening an old unread thread (which
      // also touches this same row to advance the read cursor).
      channels.push(
        supabase
          .channel(`msg-toast:${uid}`)
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "conversation_members", filter: `user_id=eq.${uid}` },
            (payload) => {
              if (document.visibilityState !== "visible") return;
              const row = payload.new as { conversation_id?: string };
              if (!row.conversation_id) return;
              if (window.location.pathname === `/messages/${row.conversation_id}`) return;
              void loadInbox()
                .then((inbox) => {
                  const conv = inbox.conversations.find((c) => c.id === row.conversation_id);
                  if (!conv || conv.fromMe) return;
                  if (Date.now() - new Date(conv.lastAt).getTime() > 8000) return;
                  show({
                    kind: "message",
                    convId: conv.id,
                    name: conv.type === "group" ? conv.title ?? "Group chat" : (conv.other?.displayName ?? "Someone"),
                    avatarUrl: conv.type === "group" ? conv.avatarUrl : (conv.other?.avatarUrl ?? null),
                    body: conv.lastBody ?? "New message",
                  });
                })
                .catch(() => {});
            },
          )
          .subscribe(),
      );
    });

    return () => {
      cancelled = true;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      for (const ch of channels) void supabase.removeChannel(ch);
    };
  }, []);

  const open = (t: Toast) => {
    setItem(null);
    router.push(t.kind === "message" ? `/messages/${t.convId}` : hrefFor(t.n));
  };

  const Icon = item ? (item.kind === "message" ? MessageCircle : iconFor(item.n.type)) : null;

  const tint = item
    ? item.kind === "message"
      ? "bg-secondary text-foreground"
      : tintFor(categoryForType(item.n.type), item.n.type)
    : "";
  const avatarUrl = item ? (item.kind === "message" ? item.avatarUrl : item.n.actor?.avatarUrl) : null;
  const key = item ? (item.kind === "message" ? `m:${item.convId}:${item.body}` : item.n.id) : "";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(0.75rem+var(--frenz-safe-top))] z-[80] flex justify-center px-3">
      <AnimatePresence>
        {item && Icon ? (
          <motion.button
            key={key}
            type="button"
            onClick={() => open(item)}
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 38, mass: 0.9 }}
            style={{ willChange: "transform, opacity" }}
            className="pointer-events-auto flex w-full max-w-sm transform-gpu items-center gap-3 rounded-3xl border border-border/70 bg-card p-3 text-left shadow-elevated transition-colors hover:bg-secondary/60"
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
