import { Ban, Flag, Lock, MessageSquareWarning, ShieldAlert } from "lucide-react";
import Link from "next/link";

import type { OwnReport } from "@/lib/social/moderation";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<OwnReport["status"], string> = {
  open: "Under review",
  actioned: "Action taken",
  dismissed: "No violation found",
};
const STATUS_TINT: Record<OwnReport["status"], string> = {
  open: "bg-amber-500/15 text-amber-500",
  actioned: "bg-emerald-500/15 text-emerald-500",
  dismissed: "bg-secondary text-muted-foreground",
};
const TYPE_LABEL = { post: "Post", comment: "Comment", user: "Account" } as const;

const SAFETY_TIPS = [
  "Only accept friend requests from people you actually know, or check mutual friends first.",
  "Block instantly stops someone from messaging, following, or seeing your profile — they're never notified.",
  "Reporting is private: the person you report never finds out it was you.",
  "Never share passwords, verification codes, or payment details in a chat, even with a friend.",
];

export function TrustCenter({ reports }: { reports: OwnReport[] }) {
  return (
    <div className="space-y-4">
      {/* Quick links to the other two safety surfaces — kept as links, not
          duplicated UI, so blocked/muted management + appeals each stay in
          exactly one place. */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/account/privacy"
          className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-card transition hover:bg-secondary/40"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
            <Ban className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Blocked &amp; muted</span>
            <span className="block text-xs text-muted-foreground">Manage in Privacy</span>
          </span>
        </Link>
        <Link
          href="/account/appeals"
          className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-card transition hover:bg-secondary/40"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
            <MessageSquareWarning className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Appeals</span>
            <span className="block text-xs text-muted-foreground">Contest an action</span>
          </span>
        </Link>
      </div>

      <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-card">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Flag className="h-4 w-4 text-muted-foreground" /> Your reports
        </h2>
        {reports.length === 0 ? (
          <p className="text-xs text-muted-foreground">You haven't reported anything.</p>
        ) : (
          <ul className="space-y-2">
            {reports.map((r, i) => (
              <li key={`${r.targetType}:${r.targetId}:${i}`} className="flex items-center justify-between gap-2 rounded-xl bg-secondary/30 px-3 py-2 text-xs">
                <span className="min-w-0 truncate text-muted-foreground">
                  {TYPE_LABEL[r.targetType]} · {r.reason} · {new Date(r.createdAt).toLocaleDateString()}
                </span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-medium", STATUS_TINT[r.status])}>{STATUS_LABEL[r.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-card">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" /> Safety tips
        </h2>
        <ul className="space-y-2 text-xs text-muted-foreground">
          {SAFETY_TIPS.map((tip, i) => (
            <li key={i} className="flex items-start gap-2">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              {tip}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
