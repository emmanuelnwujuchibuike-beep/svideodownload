import { AlertTriangle, MessageCircle, MessagesSquare, Smile, Users } from "lucide-react";

import type { MessagingStats } from "@/lib/social/messaging-stats";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Real messaging health, computed directly from `messages` /
 * `message_send_failures` / `user_presence_status` — genuine numbers for a
 * brand-new feature (Part 3), not placeholder cards. Server component (pure
 * presentation over already-fetched data), matching the rest of the admin
 * page's section pattern.
 */
export function MessagingMonitor({ stats }: { stats: MessagingStats }) {
  const failureTone =
    stats.failureRate7d >= 5 ? "text-red-500" : stats.failureRate7d >= 1 ? "text-amber-500" : "text-emerald-500";

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
      <h2 className="mb-5 flex items-center gap-2 font-semibold">
        <MessagesSquare className="h-5 w-5 text-primary" /> Messaging health
      </h2>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Mini icon={MessageCircle} label="Messages today" value={formatCompactNumber(stats.messagesToday)} />
        <Mini icon={MessageCircle} label="Messages (7d)" value={formatCompactNumber(stats.messages7d)} />
        <Mini icon={Users} label="Active chats (7d)" value={formatCompactNumber(stats.activeConversations7d)} />
        <Mini icon={Smile} label="Reactions (7d)" value={formatCompactNumber(stats.reactions7d)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-secondary/25 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" /> Send failure rate (7d)
            </span>
            <span className={cn("text-lg font-bold tracking-tight", failureTone)}>{stats.failureRate7d}%</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatCompactNumber(stats.failures7d)} exhausted retries out of ~{formatCompactNumber(stats.messages7d + stats.failures7d)} send
            attempts.
          </p>
          {stats.topFailureReasons.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-border/60 pt-3">
              {stats.topFailureReasons.map((r) => (
                <li key={r.reason} className="flex items-center justify-between text-xs">
                  <span className="truncate font-mono text-muted-foreground">{r.reason}</span>
                  <span className="shrink-0 font-medium">{formatCompactNumber(r.count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">No failures logged in the last 7 days.</p>
          )}
        </div>

        <div className="rounded-2xl border border-border/60 bg-secondary/25 p-4">
          <p className="mb-3 text-sm font-medium">Conversations &amp; presence</p>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Direct</span>
            <span className="font-medium">{formatCompactNumber(stats.conversationsByType.direct)}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Group</span>
            <span className="font-medium">{formatCompactNumber(stats.conversationsByType.group)}</span>
          </div>
          <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
            <PresenceRow label="Away" value={stats.presenceCounts.away} dot="bg-amber-400" />
            <PresenceRow label="Busy" value={stats.presenceCounts.busy} dot="bg-rose-500" />
            <PresenceRow label="Do Not Disturb" value={stats.presenceCounts.dnd} dot="bg-violet-500" />
            <PresenceRow label="Invisible" value={stats.presenceCounts.invisible} dot="bg-muted-foreground/50" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Mini({ icon: Icon, label, value }: { icon: typeof MessageCircle; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-secondary/25 p-4">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <p className="mt-2 text-xl font-bold tracking-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function PresenceRow({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className={cn("h-2 w-2 rounded-full", dot)} /> {label}
      </span>
      <span className="font-medium">{formatCompactNumber(value)}</span>
    </div>
  );
}
