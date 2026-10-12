"use client";

import { motion } from "framer-motion";
import { Archive, ArchiveRestore, Check, Info, Loader2, MoreHorizontal, Pin, PinOff, Trash2, UserPlus, UserRound, UserX, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { memo, useState } from "react";
import { createPortal } from "react-dom";

import { iconFor, isActorType, tintFor, timeAgo, verbFor } from "@/features/notifications/meta";
import { haptic } from "@/lib/motion/haptics";
import { explainDelivery } from "@/lib/notifications/explain";
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

/**
 * 🔴 NEVER NULL (owner, 2026-08-26: "make all notification in notification page
 * to open the page to the notification, and security too").
 *
 * This used to return null for anything that was not a conversation, a post, a
 * friend request or a single-actor follow — and the card renders a plain
 * `<div>` instead of a `<Link>` on null. So security alerts, payments,
 * download outcomes, streaks and moderation decisions were not tappable at all.
 *
 * The specific cases below still come first, because they resolve to the exact
 * post/profile/conversation involved and a stored url cannot know which actor a
 * COLLAPSED group ended up with. Everything else falls through to
 * `g.href`, which the server already resolved from the notification's own
 * `data.url` or its type — see lib/notifications/destinations.ts.
 */
function hrefFor(g: NotificationGroup): string {
  if ((g.type === "message" || g.type === "message_reaction") && g.conversationId) return `/messages/${g.conversationId}`;
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
  return g.href;
}

/** Feature 20 (0233): pin / archive. Absent until the migration is live — the menu then offers neither. */
export type OrganizeAction = "pin" | "unpin" | "archive" | "unarchive";

function NotificationCardImpl({
  group,
  onMarkRead,
  onDelete,
  onOrganize,
}: {
  group: NotificationGroup;
  onMarkRead: (g: NotificationGroup) => void;
  onDelete: (g: NotificationGroup) => void;
  onOrganize?: (g: NotificationGroup, action: OrganizeAction) => void;
}) {
  const [menu, setMenu] = useState(false);
  // "Why this?" — the Attention Engine's reason, private to this member, opened from the menu
  const [why, setWhy] = useState(false);
  // Portal-rendered + position computed on open, not a plain `absolute right-2
  // top-11` sibling — a card near the bottom of the Notification Center's
  // scrollable list had this menu clipped by the list's own overflow, same
  // class of bug as conversation-list.tsx's row menu.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const MENU_WIDTH = 184;
  const toggleMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (menu) {
      setMenu(false);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const margin = 8;
    const menuHeight = ((group.read ? 2 : 3) + (onOrganize ? 2 : 0)) * 44 + 8;
    const left = Math.min(Math.max(rect.right - MENU_WIDTH, margin), window.innerWidth - MENU_WIDTH - margin);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= menuHeight + margin ? rect.bottom + 4 : Math.max(margin, rect.top - menuHeight - 4);
    setMenuPos({ top, left });
    setMenu(true);
  };
  const Icon = iconFor(group.type);
  const actor = group.actors[0] ?? null;
  const href = hrefFor(group);
  const summary = actorSummary(group);
  const actorLed = isActorType(group.type);

  // Direct actions ON the card (owner bug 2026-07-12: "users can't even
  // accept request or follow back") — a friend_request used to only LINK to
  // /friends, and a follow notification offered no way to follow back at
  // all. Single-actor cards act right here; grouped cards still link out.
  const [actionState, setActionState] = useState<"idle" | "busy" | "accepted" | "declined" | "followed" | "blocked">("idle");
  const canActInline = group.totalActors === 1 && !!actor;
  const respondToRequest = async (e: React.MouseEvent, action: "accept" | "decline") => {
    e.preventDefault();
    e.stopPropagation();
    if (!actor || actionState === "busy") return;
    haptic("selection");
    setActionState("busy");
    try {
      const res = await fetch(`/api/friends/${actor.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setActionState(action === "accept" ? "accepted" : "declined");
        if (!group.read) onMarkRead(group);
      } else setActionState("idle");
    } catch {
      setActionState("idle");
    }
  };
  const followBack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!actor || actionState === "busy") return;
    haptic("selection");
    setActionState("busy");
    try {
      const res = await fetch(`/api/follow/${actor.id}`, { method: "POST" });
      if (res.ok) {
        setActionState("followed");
        if (!group.read) onMarkRead(group);
      } else setActionState("idle");
    } catch {
      setActionState("idle");
    }
  };

  /*
    A screenshot of a SUB post (0227, owner 2026-10-11: "then they decide to block
    or ignore"). Block answers on the tap and is put back if the server refuses;
    a block also ends the viewer's SUB access (lib/sub/server.ts hasActiveSub).
    Ignore simply clears the alert.
  */
  const blockActor = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!actor || actionState === "blocked") return;
    haptic("selection");
    setActionState("blocked");
    if (!group.read) onMarkRead(group);
    const res = await fetch(`/api/block/${actor.id}`, { method: "POST" }).catch(() => null);
    if (!res?.ok) setActionState("idle");
  };
  const ignore = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    haptic("selection");
    onDelete(group);
  };

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
          <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", tintFor(group.category, group.type))}>
            <Icon className="h-5 w-5" />
          </span>
        )}
        {actorLed ? (
          <span className={cn("absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-card", tintFor(group.category, group.type))}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1 pr-7 [@media(hover:hover)]:pr-1">
        {group.broadcast ? (
          /* An admin broadcast / AD shows its OWN content + a clear "Ad" label,
             never a generic "Frenz announcement" that reads like a message. */
          <>
            <p className="flex items-center gap-1.5 text-sm leading-snug text-foreground">
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                {group.broadcast.sponsored ? "Ad" : "News"}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{group.broadcast.title}</span>
            </p>
            {group.broadcast.body ? <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{group.broadcast.body}</p> : null}
          </>
        ) : !actorLed && group.content ? (
          /*
            An actor-less notification that carries the push's own words —
            every admin alert, security alert, support reply and digest since
            2026-08-26. Showing `verbFor(type)` here instead would reduce
            "Sign-in · Chris · Lagos · iPhone/Safari" to the bare label
            "New sign-in", which is exactly the detail the owner wants to be
            able to act on.
          */
          <>
            <p className="truncate text-sm font-semibold leading-snug text-foreground">{group.content.title}</p>
            {group.content.body ? (
              <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{group.content.body}</p>
            ) : null}
          </>
        ) : (
          <p className="text-sm leading-snug text-foreground">
            {actorLed ? <span className="font-semibold">{summary}</span> : null}{" "}
            <span className={cn(actorLed ? "text-muted-foreground" : "font-semibold")}>{verbFor(group.type)}</span>
            {group.postTitle ? <span className="text-muted-foreground"> · {group.postTitle}</span> : null}
          </p>
        )}
        {/* Relative time differs by a second between server render + hydration. */}
        <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground" suppressHydrationWarning>
          {group.pinned ? (
            <span className="inline-flex items-center gap-0.5 font-semibold text-indigo-600 dark:text-indigo-300">
              <Pin className="h-3 w-3" aria-hidden /> Pinned ·
            </span>
          ) : null}
          {group.delivery === "held" ? <span className="font-semibold text-amber-700 dark:text-amber-400">Held ·</span> : null}
          {timeAgo(group.createdAt)} ago
        </p>
        {why ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-secondary/70 px-2.5 py-2 text-[12px] leading-snug text-muted-foreground" role="note">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {explainDelivery(group.delivery, group.deliveryReason ? [group.deliveryReason] : [])}
              {group.notificationIds.length > 1 ? ` Grouped with ${group.notificationIds.length - 1} similar ${group.notificationIds.length === 2 ? "notification" : "notifications"}.` : ""}
            </span>
          </p>
        ) : null}

        {group.type === "friend_request" && canActInline ? (
          <div className="mt-2 flex items-center gap-2">
            {actionState === "accepted" ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-500">
                <Check className="h-3.5 w-3.5" /> Friends
              </span>
            ) : actionState === "declined" ? (
              <span className="text-xs font-medium text-muted-foreground">Request declined</span>
            ) : (
              <>
                <button
                  type="button"
                  disabled={actionState === "busy"}
                  onClick={(e) => respondToRequest(e, "accept")}
                  className="bg-brand flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-95 disabled:opacity-50"
                >
                  {actionState === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Accept
                </button>
                <button
                  type="button"
                  disabled={actionState === "busy"}
                  onClick={(e) => respondToRequest(e, "decline")}
                  className="flex items-center gap-1.5 rounded-full border border-border/70 px-4 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> Decline
                </button>
              </>
            )}
          </div>
        ) : null}

        {group.type === "sub_capture" && canActInline ? (
          <div className="mt-2 flex items-center gap-2">
            {actionState === "blocked" ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-rose-600">
                <UserX className="h-3.5 w-3.5" /> Blocked · their SUB access has ended
              </span>
            ) : (
              <>
                <button type="button" onClick={blockActor} className="flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-95 active:scale-[0.97]">
                  <UserX className="h-3.5 w-3.5" /> Block
                </button>
                <button type="button" onClick={ignore} className="flex items-center gap-1.5 rounded-full border border-border/70 px-4 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground active:scale-[0.97]">
                  <X className="h-3.5 w-3.5" /> Ignore
                </button>
              </>
            )}
          </div>
        ) : null}

        {group.type === "follow" && canActInline ? (
          <div className="mt-2">
            {actionState === "followed" ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-500">
                <Check className="h-3.5 w-3.5" /> Following
              </span>
            ) : (
              <button
                type="button"
                disabled={actionState === "busy"}
                onClick={followBack}
                className="bg-brand flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-95 disabled:opacity-50"
              >
                {actionState === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                Follow back
              </button>
            )}
          </div>
        ) : null}
      </div>

      {/* Unread dot */}
      {!group.read ? (
        <span className="mt-11 h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 shadow-[0_0_10px_theme(colors.violet.500)] [@media(hover:hover)]:mt-1.5" aria-label="Unread" />
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
    >
      {/* Unread left accent */}
      {!group.read ? <span className="absolute inset-y-3 left-0 w-1 rounded-full bg-gradient-to-b from-blue-500 to-violet-500" /> : null}

      {/* Always a link now — `hrefFor` no longer returns null, so the
          non-tappable `<div>` branch this used to fall into is gone. That
          branch is also what silently swallowed the mark-as-read, since it
          carried no onClick: an un-linkable notification could never be
          marked read by opening it. */}
      <Link href={href} onClick={() => !group.read && onMarkRead(group)} className="block">
        {body}
      </Link>

      {/* Quick actions (hover / focus) */}
      {/* Always reachable on touch (there is no hover on a phone — it used to be invisible there);
          on a mouse it appears on hover or keyboard focus. */}
      <div className="absolute right-2 top-2 flex items-center gap-1 transition [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-within:pointer-events-auto [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:hover)]:group-hover:pointer-events-auto [@media(hover:hover)]:group-hover:opacity-100">
        <button
          type="button"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={toggleMenu}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-muted-foreground backdrop-blur transition hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {menu && menuPos
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenu(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div
                style={{ top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
                role="menu"
                className="fixed z-50 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elevated"
              >
                {onOrganize ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        haptic("selection");
                        onOrganize(group, group.pinned ? "unpin" : "pin");
                        setMenu(false);
                      }}
                      className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm transition hover:bg-secondary"
                    >
                      {group.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />} {group.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        haptic("selection");
                        onOrganize(group, group.archived ? "unarchive" : "archive");
                        setMenu(false);
                      }}
                      className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm transition hover:bg-secondary"
                    >
                      {group.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />} {group.archived ? "Move to inbox" : "Archive"}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setWhy((v) => !v);
                    setMenu(false);
                  }}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm transition hover:bg-secondary"
                >
                  <Info className="h-4 w-4" /> {why ? "Hide why" : "Why this?"}
                </button>
                {!group.read ? (
                  <button
                    type="button"
                    role="menuitem"
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
                  role="menuitem"
                  onClick={() => {
                    onDelete(group);
                    setMenu(false);
                  }}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm text-rose-500 transition hover:bg-rose-500/10"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            </>,
            document.body,
          )
        : null}
    </motion.div>
  );
}

// Notification lists re-render on every mark-read/delete/live-insert; memoizing
// keeps unaffected rows from re-rendering their motion wrapper each time.
export const NotificationCard = memo(NotificationCardImpl);
