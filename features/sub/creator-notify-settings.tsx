"use client";

import { BellRing, Eye, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { EX_CARD } from "@/features/sub/ui";
import { ALERT_OPTIONS, Segmented, type AlertMode } from "@/features/sub/segmented";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * The creator's Exclusive notifications (Frenz Exclusive Part 6): what goes to whom, said plainly,
 * and the one choice that is the creator's own — how they hear about a new subscriber. Saved on
 * the creator's own settings row through /api/members (op settings: the session user is always
 * the creator). The other notifications are each MEMBER's choice and are explained, not editable.
 */

type Mode = AlertMode;

export function CreatorNotifySettings({ initial }: { initial: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setMode(initial), [initial]);

  const choose = (next: Mode) => {
    if (next === mode) return;
    haptic("selection");
    const prev = mode;
    setMode(next);
    setNote(null);
    void fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "settings", notifySubscribed: next }) })
      .then(async (r) => {
        if (r.ok) return;
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setMode(prev);
        setNote(j.error ?? "Couldn't save that.");
      })
      .catch(() => {
        setMode(prev);
        setNote("Couldn't save that.");
      });
  };

  return (
    <section aria-labelledby="cns-title" className={cn("mb-3 rounded-[22px] p-3.5", EX_CARD)}>
      <h2 id="cns-title" className="flex items-center gap-2 text-[14.5px] font-semibold">
        <BellRing className="h-4 w-4 text-primary" aria-hidden /> Notifications
      </h2>
      <ul className="mt-2.5 space-y-2.5 text-[12.5px]">
        <li className="flex gap-2.5">
          <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Users className="h-3.5 w-3.5" />
          </span>
          <span>
            <span className="block font-semibold">Subscribers</span>
            <span className="text-muted-foreground">Your announcements, and new posts (locked or hidden) if they turned post alerts on. Only while subscribed.</span>
          </span>
        </li>
        <li className="flex gap-2.5">
          <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Eye className="h-3.5 w-3.5" />
          </span>
          <span>
            <span className="block font-semibold">Followers and visitors</span>
            <span className="text-muted-foreground">Only those with alerts on, and only for locked posts: that you posted, never what. Hidden posts and announcements stay private.</span>
          </span>
        </li>
      </ul>
      <div className="mt-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]">
        <p className="mb-2 text-[13.5px] font-semibold">When someone subscribes, tell me by</p>
        <Segmented label="How to tell you about a new subscriber" value={mode} options={ALERT_OPTIONS} onChange={choose} />
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">It always appears in your notifications. Push also follows your general notification settings.</p>
      </div>
      {note ? (
        <p role="alert" className="mt-2 text-[12.5px] text-rose-600 dark:text-rose-400">
          {note}
        </p>
      ) : null}
    </section>
  );
}
