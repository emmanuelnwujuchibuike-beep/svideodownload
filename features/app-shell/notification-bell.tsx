"use client";

import { Bell, Heart, MessageCircle, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { NotificationItem, NotificationType } from "@/lib/social/notifications";
import { cn } from "@/lib/utils";

const ICON: Record<NotificationType, typeof Heart> = {
  like: Heart,
  comment: MessageCircle,
  follow: UserPlus,
};
const TINT: Record<NotificationType, string> = {
  like: "bg-rose-500/15 text-rose-500",
  comment: "bg-blue-500/15 text-blue-500",
  follow: "bg-violet-500/15 text-violet-500",
};

function verb(t: NotificationType): string {
  return t === "follow" ? "started following you" : t === "like" ? "liked your post" : "commented on your post";
}
function ago(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = (await res.json()) as { items: NotificationItem[]; unread: number };
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      /* ignore */
    }
  }, []);

  // Initial load + realtime subscription scoped to the current user.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void load();

    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`notifications:${uid}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          () => {
            setUnread((n) => n + 1);
            void load();
          },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) void channel.unsubscribe();
    };
  }, [load]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
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
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div className="absolute right-0 z-50 mt-2 max-h-[28rem] w-80 overflow-y-auto rounded-2xl border border-border/70 bg-card shadow-elevated">
            <div className="sticky top-0 border-b border-border/60 bg-card px-4 py-3 text-sm font-semibold">Notifications</div>
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">You&apos;re all caught up 🎉</div>
            ) : (
              <ul>
                {items.map((n) => {
                  const Icon = ICON[n.type];
                  const href = n.type === "follow" && n.actor ? `/u/${n.actor.handle}` : n.postId ? `/p/${n.postId}` : "#";
                  return (
                    <li key={n.id}>
                      <Link
                        href={href}
                        onClick={() => setOpen(false)}
                        className={cn("flex items-start gap-3 px-4 py-3 transition hover:bg-secondary", !n.read && "bg-primary/[0.04]")}
                      >
                        <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", TINT[n.type])}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-sm leading-snug">
                            <span className="font-semibold">{n.actor?.displayName ?? "Someone"}</span> {verb(n.type)}
                            {n.postTitle ? <span className="text-muted-foreground"> · {n.postTitle}</span> : null}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">{ago(n.createdAt)} ago</span>
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
