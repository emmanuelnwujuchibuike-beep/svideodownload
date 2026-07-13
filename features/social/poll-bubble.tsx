"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import { haptic } from "@/lib/motion/haptics";
import type { PollResults } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** A poll message bubble (owner mockup completion) — fetches results on
 *  mount, live-updates the tally via the poll's own realtime channel
 *  (`message_poll_votes` is in the realtime publication, migration 0071),
 *  and lets the viewer tap an option to vote/change their vote. */
export function PollBubble({ pollId, mine }: { pollId: string; mine: boolean }) {
  const [results, setResults] = useState<PollResults | null>(null);
  const [voting, setVoting] = useState(false);

  const refresh = () => {
    void fetch(`/api/messages/polls/${pollId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setResults(d));
  };

  useEffect(() => {
    refresh();
    const supabase = createClient();
    const channel = supabase
      .channel(`poll:${pollId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_poll_votes", filter: `poll_id=eq.${pollId}` }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollId]);

  const vote = async (optionIndex: number) => {
    if (voting || !results) return;
    haptic("light");
    setVoting(true);
    const prev = results;
    // Optimistic tally update.
    setResults((r) => {
      if (!r) return r;
      const votesByOption = [...r.votesByOption];
      if (r.viewerOptionIndex !== null) votesByOption[r.viewerOptionIndex] = Math.max(0, votesByOption[r.viewerOptionIndex]! - 1);
      votesByOption[optionIndex]! += 1;
      const totalVotes = r.viewerOptionIndex === null ? r.totalVotes + 1 : r.totalVotes;
      return { ...r, votesByOption, totalVotes, viewerOptionIndex: optionIndex };
    });
    try {
      const res = await fetch(`/api/messages/polls/${pollId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionIndex }),
      });
      if (!res.ok) setResults(prev);
    } catch {
      setResults(prev);
    } finally {
      setVoting(false);
    }
  };

  if (!results) {
    return <div className="h-16 w-56 animate-pulse rounded-2xl bg-secondary/40" />;
  }

  return (
    <div className={cn("w-64 space-y-2 rounded-2xl border p-3", mine ? "border-white/20 bg-white/10" : "border-border/50 bg-secondary/30")}>
      <p className="text-sm font-semibold">{results.question}</p>
      <div className="space-y-1.5">
        {results.options.map((opt, i) => {
          const count = results.votesByOption[i] ?? 0;
          const pct = results.totalVotes > 0 ? Math.round((count / results.totalVotes) * 100) : 0;
          const chosen = results.viewerOptionIndex === i;
          return (
            <button
              key={i}
              type="button"
              disabled={voting}
              onClick={() => void vote(i)}
              className={cn(
                "relative flex w-full items-center justify-between overflow-hidden rounded-xl border px-3 py-2 text-left text-xs font-medium transition",
                mine ? "border-white/25" : "border-border/60",
              )}
            >
              <span
                aria-hidden
                className={cn("absolute inset-y-0 left-0 transition-all", mine ? "bg-white/15" : "bg-primary/15")}
                style={{ width: `${pct}%` }}
              />
              <span className="relative flex items-center gap-1.5">
                {chosen ? <Check className="h-3.5 w-3.5" /> : null}
                {opt}
              </span>
              <span className="relative shrink-0 opacity-70">{pct}%</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] opacity-70">{results.totalVotes} {results.totalVotes === 1 ? "vote" : "votes"}</p>
    </div>
  );
}
