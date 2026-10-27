"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { VerifiedTick } from "@/components/badges/identity-badges";
import { PendingButton, PendingLink } from "@/features/frenz-ui/pending";
import { PersonAvatar } from "@/features/friends/ui";
import { timeAgo } from "@/features/notifications/meta";
import type { FriendItem, FriendRequestItem } from "@/lib/social/friends";
import { profilePath } from "@/lib/social/profile-url";
import { cn } from "@/lib/utils";

/**
 * "Friends & requests" — the Friends page's top-right button (owner, 2026-10-27: "replace the search button … with a list of
 * friends request sent and list of friends they have", since search lives on Add friends). Two tabs over the data the
 * hub already holds — no extra request:
 *   · Friends — each opens their profile, or a chat;
 *   · Sent    — the requests waiting on the other person, each with Cancel (the hub's own cancel, same rollback).
 * Every row that opens a server page is a spinner link (the shared PendingLink); Cancel shows the spinner while it runs.
 */
export function PeopleSheet({
  open,
  onClose,
  friends,
  outgoing,
  busyId,
  onCancel,
}: {
  open: boolean;
  onClose: () => void;
  friends: FriendItem[];
  outgoing: FriendRequestItem[];
  busyId: string | null;
  onCancel: (req: FriendRequestItem) => void;
}) {
  const [tab, setTab] = useState<"friends" | "sent">("friends");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  const rows = tab === "friends" ? friends.length : outgoing.length;

  // portalled to <body> and above the bottom nav: a fixed layer inside a transformed/blurred ancestor is positioned by it (iOS)
  return createPortal(
    <div className="frenz-ui fixed inset-0 z-[130]" role="presentation">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40 animate-in fade-in duration-200 motion-reduce:animate-none" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="people-sheet-title"
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[86vh] max-w-lg flex-col rounded-t-[28px] bg-frenz-card pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_50px_-24px_rgb(18_12_60/0.5)] animate-in slide-in-from-bottom duration-300 motion-reduce:animate-none"
      >
        <span aria-hidden className="mt-2 h-[5px] w-10 self-center rounded-full bg-frenz-ink/15" />
        <div className="flex items-center justify-between px-4 pt-2">
          <h2 id="people-sheet-title" className="font-heading text-[19px] font-bold tracking-[-0.4px]">
            Friends &amp; requests
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full bg-frenz-fill text-frenz-muted">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div role="tablist" aria-label="Friends and sent requests" className="mx-4 mt-2 flex rounded-[14px] bg-frenz-fill p-[3px]">
          {(
            [
              ["friends", `Friends · ${friends.length}`],
              ["sent", `Sent · ${outgoing.length}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn("h-10 flex-1 rounded-[11px] text-[14px] transition-colors", tab === key ? "bg-frenz-card font-extrabold text-frenz-ink shadow-[0_2px_8px_-2px_rgb(30_20_80/0.18)]" : "font-semibold text-frenz-muted")}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5">
          {rows === 0 ? (
            <p className="px-1 py-10 text-center text-[14px] text-frenz-muted">
              {tab === "friends" ? "No friends yet — Add friends is the place to start." : "No requests waiting. Requests you send show here until they're answered."}
            </p>
          ) : (
            <ul className="divide-y divide-frenz-line/70 overflow-hidden rounded-[24px] border border-frenz-line">
              {tab === "friends"
                ? friends.map((f) => (
                    <li key={f.user.id} className="flex items-center gap-3 px-3.5 py-2.5">
                      <PendingLink href={profilePath(f.user.handle)} className="min-w-0 flex-1 rounded-2xl" inner="flex min-w-0 items-center gap-3">
                        <PersonAvatar user={f.user} size={44} />
                        <span className="flex min-w-0 flex-col text-left">
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="truncate text-[15px] font-bold">{f.user.displayName}</span>
                            {f.user.isVerified ? <VerifiedTick size="sm" className="h-[14px] w-[14px] shrink-0" /> : null}
                          </span>
                          <span className="truncate text-[13px] text-frenz-muted">@{f.user.handle}</span>
                        </span>
                      </PendingLink>
                      <PendingLink href={`/messages/new/${f.user.id}`} spinnerSize={14} className="flex h-11 shrink-0 items-center rounded-full border border-frenz-line px-3.5 text-[13px] font-bold">
                        Message
                      </PendingLink>
                    </li>
                  ))
                : outgoing.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-3.5 py-2.5">
                      <PendingLink href={profilePath(r.user.handle)} className="min-w-0 flex-1 rounded-2xl" inner="flex min-w-0 items-center gap-3">
                        <PersonAvatar user={r.user} size={44} />
                        <span className="flex min-w-0 flex-col text-left">
                          <span className="truncate text-[15px] font-bold">{r.user.displayName}</span>
                          <span className="truncate text-[13px] text-frenz-muted">Sent {timeAgo(r.createdAt)} ago</span>
                        </span>
                      </PendingLink>
                      <PendingButton
                        pending={busyId === r.id}
                        onClick={() => onCancel(r)}
                        aria-label={`Cancel friend request to ${r.user.displayName}`}
                        spinnerSize={14}
                        className="flex h-11 shrink-0 items-center rounded-full bg-frenz-fill px-3.5 text-[13px] font-bold"
                      >
                        Cancel
                      </PendingButton>
                    </li>
                  ))}
            </ul>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
