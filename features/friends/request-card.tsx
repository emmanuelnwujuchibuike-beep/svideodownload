"use client";

import { BadgeCheck, Check, ChevronDown, Loader2, MoreHorizontal, ShieldOff, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ACCEPT_AS, requestContextLine } from "@/features/friends/request-logic";
import { iconButton, PersonAvatar, primaryPill, quietPill } from "@/features/friends/ui";
import { timeAgo } from "@/features/notifications/meta";
import { ReportButton } from "@/features/social/report-button";
import type { FriendRequestItem } from "@/lib/social/friends";
import { cn } from "@/lib/utils";

/**
 * One incoming friend request (Feature 19 · Part 2 — the Friend Request Card).
 *
 *   context     mutual friends (counted only over people who allow it), when
 *               they joined, and where the request came from — so the receiver
 *               can tell a classmate from a stranger at a glance
 *   accept as   Relationship Categorization™: one tap files them as a close
 *               friend, family, a colleague… (built-in relationship labels)
 *   ignore      silent: it leaves YOUR list and the sender is never told
 *   more        follow instead (follow them, set the request aside), block,
 *               report — the honest exits for a request you do not want
 *
 * Every control is a real button with a text label and a 40–44 px target;
 * nothing depends on colour or motion alone. Two buttons show (Accept, Decline);
 * the rest wait under "More" so the row stays light.
 */
export function RequestCard({
  req,
  busy,
  onRespond,
  onFollowInstead,
  onBlock,
}: {
  req: FriendRequestItem;
  busy: boolean;
  onRespond: (action: "accept" | "decline" | "ignore", as?: string) => void;
  onFollowInstead: () => void;
  onBlock: () => void;
}) {
  const [asOpen, setAsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const context = requestContextLine(req);

  // 2026-10-10 redesign: a ROW in the grouped glass list (features/friends/ui.tsx), not a separate bordered card
  return (
    <li className="px-3.5 py-3">
      <div className="flex items-start gap-3">
        <Link href={`/u/${req.user.handle}`} prefetch={false} aria-label={`${req.user.displayName}'s profile`}>
          <PersonAvatar user={req.user} size={52} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5">
            <Link href={`/u/${req.user.handle}`} prefetch={false} className="truncate text-[15px] font-semibold hover:underline">
              {req.user.displayName}
            </Link>
            {req.user.isVerified ? <BadgeCheck className="h-4 w-4 shrink-0 text-blue-500" aria-label="Verified" /> : null}
            <span className="shrink-0 text-[12px] text-muted-foreground">· {timeAgo(req.createdAt)}</span>
          </p>
          <p className="truncate text-[12.5px] text-muted-foreground">{context.length ? context.join(" · ") : `@${req.user.handle}`}</p>
          {req.note ? <p className="mt-1.5 rounded-2xl bg-black/[0.035] px-3 py-2 text-[13.5px] leading-relaxed dark:bg-white/[0.05]">“{req.note}”</p> : null}
        </div>
      </div>
      {/* full width under the person, so Accept never clips at 320 px */}
      <div className="mt-2.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex min-w-0 flex-1 overflow-hidden rounded-full">
              <button type="button" onClick={() => onRespond("accept")} disabled={busy} className={cn(primaryPill, "min-w-0 flex-1 justify-center rounded-none rounded-l-full pr-3 shadow-none")}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Accept
              </button>
              <button
                type="button"
                onClick={() => setAsOpen((v) => !v)}
                disabled={busy}
                aria-expanded={asOpen}
                aria-label="Accept as…"
                className="inline-flex min-h-[2.5rem] items-center border-l border-white/25 bg-primary pl-2 pr-2.5 text-primary-foreground disabled:opacity-60"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", asOpen && "rotate-180")} aria-hidden />
              </button>
            </span>
            <button type="button" onClick={() => onRespond("decline")} disabled={busy} className={quietPill}>
              Decline
            </button>
            <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} aria-label="More options" className={cn(iconButton, "h-10 w-10")}>
              <MoreHorizontal className="h-5 w-5" aria-hidden />
            </button>
          </div>

          {asOpen ? (
            <div className="mt-2.5" role="group" aria-label="Accept as">
              <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Accept as</p>
              <div className="flex flex-wrap gap-1.5">
                {ACCEPT_AS.map((a) => (
                  <button key={a.key} type="button" disabled={busy} onClick={() => onRespond("accept", a.key)} className={cn(quietPill, "min-h-[2.25rem] text-[13px]")}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {moreOpen ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => onRespond("ignore")} disabled={busy} className={cn(quietPill, "min-h-[2.25rem] text-[13px]")}>
                <X className="h-4 w-4" aria-hidden /> Ignore
              </button>
              <button type="button" onClick={onFollowInstead} disabled={busy} className={cn(quietPill, "min-h-[2.25rem] text-[13px]")}>
                <UserPlus className="h-4 w-4" aria-hidden /> Follow instead
              </button>
              {confirmBlock ? (
                <button type="button" onClick={onBlock} disabled={busy} className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-full bg-rose-600 px-3.5 text-[13px] font-semibold text-white">
                  <ShieldOff className="h-4 w-4" aria-hidden /> Block @{req.user.handle}
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmBlock(true)} className={cn(quietPill, "min-h-[2.25rem] text-[13px] text-rose-600 dark:text-rose-400")}>
                  <ShieldOff className="h-4 w-4" aria-hidden /> Block
                </button>
              )}
              <ReportButton targetType="user" targetId={req.user.id} />
            </div>
          ) : null}
      </div>
    </li>
  );
}
