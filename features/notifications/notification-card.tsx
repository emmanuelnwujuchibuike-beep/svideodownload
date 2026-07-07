"use client";

import { motion } from "framer-motion";
import { Check, MoreHorizontal, Trash2, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { memo, useState } from "react";

import { iconFor, isActorType, tintFor, timeAgo, verbFor } from "@/features/notifications/meta";
import type { NotificationGroup } from "@/lib/social/notifications";
import { cn } from "@/lib/utils";

/** "John, Emma and 27 others" style summary of who triggered a grouped notification. */
function actorSummary(g: NotificationGroup): string {
  const names = g.actors.map((a) => a.displayName);
  if (g.totalActors <= 1) return names[0] ?? "Someone";
  if (g.totalActors === 2) return `${names[0]} and ${names[1]}`;
  if (g.totalActors === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${g.totalActors - 2} others`;
}

function hrefFor(g: NotificationGroup): string | null {
  if (g.postId) return `/p/${g.postId}`;
  if (g.type === "friend_request") return "/friends";
  const first = g.actors[0];
  if (
    (g.type === "follow" || g.type === "friend_accepted" || g.type === "friend_reminder") &&
    g.totalActors === 1 &&
    first
  ) {
    return `/u/${first.handle}`;
  }
  return null;
}

function NotificationCardImpl({
  group,
  onMarkRead,
  onDelete,
}: {
  group: NotificationGroup;
  onMarkRead: (g: NotificationGroup) => void;
  onDelete: (g: NotificationGroup) => void;
}) {
  const [menu, setMenu] = useState(false);
  const Icon = iconFor(group.type);
  const actor = group.actors[0] ?? null;
  const href = hrefFor(group);
  const summary = actorSummary(group);
  const actorLed = isActorType(group.type);

  const body = (
    <div className="flex items-start gap-3.5">
      {/* Avatar + type badge (or a plain icon tile for system notifications) */}
      <div className="relative shrink-0">
        {actorLed ? (
          actor?.avatarUrl ? (
            <Image src={actor.avatarUrl} alt="" width={48} height={48} className="h-12 w-12 rounded-full object-cover ring-1 ring-border/60" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-base font-bold text-white">
              {actor?.displayName?.charAt(0).toUpperCase() ?? <UserRound className="h-5 w-5" />}
            </span>
          )
        ) : (
          <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", tintFor(group.category))}>
            <Icon className="h-5 w-5" />
          </span>
        )}
        {actorLed ? (
          <span className={cn("absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-card", tintFor(group.category))}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1 pr-1">
        <p className="text-sm leading-snug text-foreground">
          {actorLed ? <span className="font-semibold">{summary}</span> : null}{" "}
          <span className={cn(actorLed ? "text-muted-foreground" : "font-semibold")}>{verbFor(group.type)}</span>
          {group.postTitle ? <span className="text-muted-foreground"> · {group.postTitle}</span> : null}
        </p>
        {/* Relative time differs by a second between server render + hydration. */}
        <p className="mt-1 text-[11px] font-medium text-muted-foreground" suppressHydrationWarning>
          {timeAgo(group.createdAt)} ago
        </p>
      </div>

      {/* Unread dot */}
      {!group.read ? (
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 shadow-[0_0_10px_theme(colors.violet.500)]" />
      ) : null}
    </div>
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -24, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className={cn(
        "group relative overflow-hidden rounded-3xl border p-3.5 transition-colors",
        group.read
          ? "border-border/60 bg-card/60"
          : "border-violet-500/25 bg-gradient-to-br from-blue-500/[0.06] to-violet-500/[0.06] shadow-[0_0_0_1px_rgba(124,58,237,0.06)]",
      )}
      onMouseLeave={() => setMenu(false)}
    >
      {/* Unread left accent */}
      {!group.read ? <span className="absolute inset-y-3 left-0 w-1 rounded-full bg-gradient-to-b from-blue-500 to-violet-500" /> : null}

      {href ? (
        <Link href={href} onClick={() => !group.read && onMarkRead(group)} className="block">
          {body}
        </Link>
      ) : (
        <div>{body}</div>
      )}

      {/* Quick actions (hover / focus) */}
      <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
        <button
          type="button"
          aria-label="More"
          onClick={() => setMenu((m) => !m)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-muted-foreground backdrop-blur transition hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {menu ? (
        <div className="absolute right-2 top-11 z-10 w-40 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elevated">
          {!group.read ? (
            <button
              type="button"
              onClick={() => {
                onMarkRead(group);
                setMenu(false);
              }}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm transition hover:bg-secondary"
            >
              <Check className="h-4 w-4" /> Mark read
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onDelete(group);
              setMenu(false);
            }}
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm text-rose-500 transition hover:bg-rose-500/10"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      ) : null}
    </motion.div>
  );
}

// Notification lists re-render on every mark-read/delete/live-insert; memoizing
// keeps unaffected rows from re-rendering their motion wrapper each time.
export const NotificationCard = memo(NotificationCardImpl);
