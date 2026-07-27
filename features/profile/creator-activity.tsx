"use client";

import {
  Bookmark,
  Heart,
  type LucideIcon,
  MessageCircle,
  Megaphone,
  Repeat2,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";

import { loadFlatNotifications } from "@/features/notifications/data";
import { type ActivityRow, notificationsToActivity } from "@/features/profile/activity-map";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Recent Activity for the creator rail — REAL notifications, and genuinely live.
 * The server hands in the first page (`initial`) so it paints instantly with no
 * flash; then this subscribes to the owner's `notifications` inserts (the same
 * realtime stream the bell + live-toast use) and refreshes the list the moment a
 * new follow / Wow / comment / announcement lands. No fabricated data, no
 * "coming soon" — every row is something that actually happened on the account.
 */

const ICON: Record<string, { icon: LucideIcon; tint: string }> = {
  follow: { icon: UserPlus, tint: "text-emerald-500" },
  friend_request: { icon: UserPlus, tint: "text-emerald-500" },
  friend_accepted: { icon: UserPlus, tint: "text-emerald-500" },
  like: { icon: Heart, tint: "text-rose-500" },
  comment: { icon: MessageCircle, tint: "text-sky-500" },
  reply: { icon: MessageCircle, tint: "text-sky-500" },
  mention: { icon: MessageCircle, tint: "text-sky-500" },
  message: { icon: MessageCircle, tint: "text-sky-500" },
  message_reaction: { icon: Heart, tint: "text-rose-500" },
  repost: { icon: Repeat2, tint: "text-violet-500" },
  save: { icon: Bookmark, tint: "text-amber-500" },
  admin_broadcast: { icon: Megaphone, tint: "text-amber-500" },
};

function meta(kind: string): { icon: LucideIcon; tint: string } {
  return ICON[kind] ?? { icon: Sparkles, tint: "text-violet-500" };
}

export function CreatorActivity({ initial }: { initial: ActivityRow[] }) {
  const [rows, setRows] = useState<ActivityRow[]>(initial);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const refresh = () => {
      void loadFlatNotifications()
        .then((d) => {
          if (!cancelled) setRows(notificationsToActivity(d.items));
        })
        .catch(() => {});
    };

    supabase.auth.getUser().then(({ data: auth }) => {
      const uid = auth.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`creator-activity:${uid}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          () => refresh(),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED" && !cancelled) setLive(true);
        });
    });

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  if (rows.length === 0) {
    return (
      <p className="py-1 text-sm text-muted-foreground">
        No recent activity yet — follows, Wows and comments on your posts will show up here.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {rows.map((r) => {
          const { icon: Icon, tint } = meta(r.kind);
          return (
            <li key={r.id} className="flex items-start gap-3">
              <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/70", tint)}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm leading-snug">{r.text}</span>
                <span className="block text-xs text-muted-foreground">{r.time}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {live ? (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live
        </p>
      ) : null}
    </>
  );
}
