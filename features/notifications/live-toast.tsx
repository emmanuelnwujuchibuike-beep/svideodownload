"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { loadFlatNotifications } from "@/features/notifications/data";
import { iconFor, timeAgo, tintFor, verbFor } from "@/features/notifications/meta";
import { categoryForType, type NotificationItem } from "@/lib/social/notifications";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Premium in-app drop-down notification (Feature 1 spec): when a notification
 * lands while the user is inside the app, a glass card springs down from the top
 * with the actor + action, stays ~5s, and deep-links on tap. Complements — never
 * replaces — the bell (badge/list) and device push (site closed): this is the
 * "you're here right now" moment. Hidden when the tab isn't visible (push covers
 * that) and auto-collapses on rapid bursts (newest wins).
 */
export function NotificationLiveToast() {
  const [item, setItem] = useState<NotificationItem | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    supabase.auth.getUser().then(({ data: auth }) => {
      const uid = auth.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
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
                if (cancelled) return;
                const fresh = (rowId && d.items.find((i) => i.id === rowId)) || d.items[0];
                if (!fresh) return;
                setItem(fresh);
                if (hideTimer.current) clearTimeout(hideTimer.current);
                hideTimer.current = setTimeout(() => setItem(null), 5200);
              })
              .catch(() => {});
          },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (channel) void channel.unsubscribe();
    };
  }, []);

  const open = (n: NotificationItem) => {
    setItem(null);
    const href =
      n.type === "follow" && n.actor ? `/u/${n.actor.handle}` : n.postId ? `/p/${n.postId}` : "/notifications";
    router.push(href);
  };

  const Icon = item ? iconFor(item.type) : null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex justify-center px-3">
      <AnimatePresence>
        {item && Icon ? (
          <motion.button
            key={item.id}
            type="button"
            onClick={() => open(item)}
            initial={{ y: -84, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -84, opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-3xl border border-border/70 bg-card/90 p-3 text-left shadow-elevated backdrop-blur-xl transition hover:bg-card"
            aria-live="polite"
          >
            {item.actor?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.actor.avatarUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-violet-500/30"
              />
            ) : (
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", tintFor(categoryForType(item.type)))}>
                <Icon className="h-5 w-5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm leading-snug">
                <span className="font-semibold">{item.actor?.displayName ?? "Frenz"}</span>{" "}
                {verbFor(item.type)}
                {item.postTitle ? <span className="text-muted-foreground"> · {item.postTitle}</span> : null}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{timeAgo(item.createdAt)} ago</span>
            </span>
            <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", tintFor(categoryForType(item.type)))}>
              <Icon className="h-3.5 w-3.5" />
            </span>
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
