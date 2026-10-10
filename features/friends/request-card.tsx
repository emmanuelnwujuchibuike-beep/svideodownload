"use client";

import { BadgeCheck, Check, ChevronDown, Loader2, MoreHorizontal, ShieldOff, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ACCEPT_AS, requestContextLine } from "@/features/friends/request-logic";
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
 * Every control is a real button with a text label and a 44 px target; nothing
 * depends on colour or motion alone.
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
  const btn = "inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-60";

  return (
    <li className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-gradient-to-br from-blue-500/15 to-violet-500/15 blur-2xl" />
      <div className="flex items-start gap-3">
        {req.user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={req.user.avatarUrl} alt="" className="block h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-violet-500/20" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-base font-bold text-white">
            {req.user.displayName.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5">
            <Link href={`/u/${req.user.handle}`} className="font-semibold hover:underline">
              {req.user.displayName}
            </Link>
            {req.user.isVerified ? <BadgeCheck className="h-4 w-4 text-blue-500" aria-label="Verified" /> : null}
            <span className="text-xs text-muted-foreground">
              @{req.user.handle} · {timeAgo(req.createdAt)} ago
            </span>
          </p>
          {context.length ? <p className="mt-0.5 text-xs text-muted-foreground">{context.join(" · ")}</p> : null}
          {req.note ? (
            <p className="mt-1.5 rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] px-3 py-2 text-sm leading-relaxed">“{req.note}”</p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap gap-2">
            <span className="inline-flex overflow-hidden rounded-xl shadow-md shadow-violet-500/25">
              <button
                type="button"
                onClick={() => onRespond("accept")}
                disabled={busy}
                className={cn(btn, "rounded-none bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:opacity-95")}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Accept
              </button>
              <button
                type="button"
                onClick={() => setAsOpen((v) => !v)}
                disabled={busy}
                aria-expanded={asOpen}
                aria-label="Accept as…"
                className="inline-flex min-h-[2.75rem] items-center border-l border-white/25 bg-violet-600 px-2.5 text-white transition hover:opacity-95 disabled:opacity-60"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", asOpen && "rotate-180")} />
              </button>
            </span>
            <button type="button" onClick={() => onRespond("decline")} disabled={busy} className={cn(btn, "border border-border bg-card text-muted-foreground hover:bg-secondary")}>
              <X className="h-4 w-4" /> Decline
            </button>
            <button type="button" onClick={() => onRespond("ignore")} disabled={busy} className={cn(btn, "px-3 text-muted-foreground hover:bg-secondary")}>
              Ignore
            </button>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-label="More options"
              className="inline-flex min-h-[2.75rem] min-w-[2.75rem] items-center justify-center rounded-xl text-muted-foreground transition hover:bg-secondary"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>

          {asOpen ? (
            <div className="mt-2.5" role="group" aria-label="Accept as">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Accept as</p>
              <div className="flex flex-wrap gap-1.5">
                {ACCEPT_AS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    disabled={busy}
                    onClick={() => onRespond("accept", a.key)}
                    className="min-h-[2.5rem] rounded-full border border-violet-500/30 bg-violet-500/[0.06] px-3.5 text-sm font-medium transition hover:bg-violet-500/15 disabled:opacity-60"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {moreOpen ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button type="button" onClick={onFollowInstead} disabled={busy} className={cn(btn, "border border-border px-3 text-muted-foreground hover:bg-secondary")}>
                <UserPlus className="h-4 w-4" /> Follow instead
              </button>
              {confirmBlock ? (
                <button type="button" onClick={onBlock} disabled={busy} className={cn(btn, "bg-rose-600 px-3 text-white hover:bg-rose-700")}>
                  <ShieldOff className="h-4 w-4" /> Yes, block @{req.user.handle}
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmBlock(true)} className={cn(btn, "border border-border px-3 text-rose-600 hover:bg-rose-500/10")}>
                  <ShieldOff className="h-4 w-4" /> Block
                </button>
              )}
              <ReportButton targetType="user" targetId={req.user.id} />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
