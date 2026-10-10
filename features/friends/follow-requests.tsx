"use client";

import { BadgeCheck, Check, ChevronDown, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ACCEPT_AS } from "@/features/friends/request-logic";
import { GlassGroup, PersonAvatar, SectionHeader, primaryPill, quietPill } from "@/features/friends/ui";
import { timeAgo } from "@/features/notifications/meta";
import { FOLLOW_SOURCE_LABELS, isFollowSource } from "@/lib/social/follow-policy";
import type { FollowRequestItem } from "@/lib/social/follows";
import { cn } from "@/lib/utils";

/**
 * Follow requests (Feature 19 · Part 3) — for an account whose follow policy is
 * "Only people I approve". Approve (optionally with a private label), Decline,
 * or Ignore (it leaves this list; they still see "Requested", which is true).
 *
 * Fetched on its own, after the hub paints: most accounts never turn approval
 * on, and the section renders nothing at all until there is a request.
 */
export function FollowRequestsSection() {
  const [items, setItems] = useState<FollowRequestItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [asOpen, setAsOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/follow-requests")
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d: { requests?: FollowRequestItem[] }) => alive && setItems(d.requests ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const answer = async (req: FollowRequestItem, action: "approve" | "decline" | "ignore", as?: string) => {
    if (busy) return;
    setBusy(req.id);
    const prev = items;
    setItems((l) => l.filter((r) => r.id !== req.id));
    try {
      const res = await fetch(`/api/follow-requests/${req.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(as ? { action, as } : { action }),
      });
      if (!res.ok) setItems(prev);
    } catch {
      setItems(prev);
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0) return null;
  return (
    <section className="mb-5" aria-labelledby="follow-requests-title">
      <SectionHeader id="follow-requests-title" title="Follow requests" count={items.length} />
      <GlassGroup label="Follow requests">
        {items.map((req) => {
          const since = req.user.memberSince ? new Date(req.user.memberSince) : null;
          const context = [
            since ? (Date.now() - since.getTime() < 30 * 86_400_000 ? "New to Frenz" : `On Frenz since ${since.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`) : null,
            isFollowSource(req.source) ? `from ${FOLLOW_SOURCE_LABELS[req.source].toLowerCase()}` : null,
          ].filter(Boolean);
          return (
            <li key={req.id} className="px-3.5 py-3">
              <div className="flex items-start gap-3">
                <PersonAvatar user={req.user} size={52} />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                    <Link href={`/u/${req.user.handle}`} className="font-semibold hover:underline">
                      {req.user.displayName}
                    </Link>
                    {req.user.isVerified ? <BadgeCheck className="h-4 w-4 text-blue-500" aria-label="Verified" /> : null}
                    <span className="text-xs text-muted-foreground">
                      @{req.user.handle} · {timeAgo(req.createdAt)} ago
                    </span>
                  </p>
                  {context.length ? <p className="mt-0.5 text-xs text-muted-foreground">{context.join(" · ")}</p> : null}
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <span className="inline-flex overflow-hidden rounded-full">
                      <button type="button" disabled={busy === req.id} onClick={() => void answer(req, "approve")} className={cn(primaryPill, "rounded-none rounded-l-full pr-3 shadow-none")}>
                        {busy === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
                      </button>
                      <button
                        type="button"
                        aria-label="Approve as…"
                        aria-expanded={asOpen === req.id}
                        onClick={() => setAsOpen((v) => (v === req.id ? null : req.id))}
                        className="inline-flex min-h-[2.5rem] items-center border-l border-white/25 bg-primary pl-2 pr-2.5 text-primary-foreground"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </span>
                    <button type="button" disabled={busy === req.id} onClick={() => void answer(req, "decline")} className={quietPill}>
                      <X className="h-4 w-4" /> Decline
                    </button>
                    <button type="button" disabled={busy === req.id} onClick={() => void answer(req, "ignore")} className={cn(quietPill, "bg-transparent dark:bg-transparent")}>
                      Ignore
                    </button>
                  </div>
                  {asOpen === req.id ? (
                    <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Approve as">
                      {ACCEPT_AS.map((a) => (
                        <button
                          key={a.key}
                          type="button"
                          onClick={() => void answer(req, "approve", a.key)}
                          className={cn(quietPill, "min-h-[2.25rem] text-[13px]")}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </GlassGroup>
    </section>
  );
}
