"use client";

import { BarChart3, Check, Eye, EyeOff, Loader2, Lock, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PollView } from "@/lib/social/polls";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Post poll ("vote"). Members cast a single choice and choose whether it's
 * PUBLIC (their avatar shows on the option) or PRIVATE (counted only). Results
 * animate in with fill bars + percentages. The creator can remove the poll.
 */
export function PostPoll({ initial, loggedIn }: { initial: PollView; loggedIn: boolean }) {
  const router = useRouter();
  const [poll, setPoll] = useState<PollView>(initial);
  const [isPublic, setIsPublic] = useState(initial.viewerVote?.isPublic ?? false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const voted = !!poll.viewerVote;
  const showResults = voted || poll.isOwner || poll.closed;

  const refetch = async () => {
    try {
      const res = await fetch(`/api/posts/${poll.postId}/poll`);
      if (res.ok) {
        const j = (await res.json()) as { poll: PollView | null };
        if (j.poll) setPoll(j.poll);
      }
    } catch {
      /* keep current */
    }
  };

  const vote = async (optionId: string, makePublic = isPublic) => {
    if (poll.closed || busy) return;
    setErr(null);
    setBusy(optionId);
    // Optimistic: move the vote to the chosen option.
    setPoll((p) => {
      const prevOption = p.viewerVote?.optionId;
      const options = p.options.map((o) => {
        let c = o.votesCount;
        if (prevOption && o.id === prevOption) c = Math.max(0, c - 1);
        if (o.id === optionId && prevOption !== optionId) c = c + 1;
        return { ...o, votesCount: c };
      });
      const total = options.reduce((n, o) => n + o.votesCount, 0);
      return { ...p, options, totalVotes: total, viewerVote: { optionId, isPublic: makePublic } };
    });
    try {
      const res = await fetch(`/api/posts/${poll.postId}/poll/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId, isPublic: makePublic }),
      });
      if (!res.ok) {
        const j = await res.json();
        setErr(j.error ?? "Couldn't vote.");
        await refetch();
        return;
      }
      await refetch();
    } catch {
      setErr("Network error.");
      await refetch();
    } finally {
      setBusy(null);
    }
  };

  const togglePublic = async () => {
    const next = !isPublic;
    setIsPublic(next);
    if (voted && poll.viewerVote) await vote(poll.viewerVote.optionId, next);
  };

  const removePoll = async () => {
    if (!confirm("Remove this poll? Votes will be cleared.")) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/posts/${poll.postId}/poll`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setRemoving(false);
    }
  };

  const pct = (n: number) => (poll.totalVotes > 0 ? Math.round((n / poll.totalVotes) * 100) : 0);

  return (
    <div className="mt-6 overflow-hidden rounded-3xl border border-border/70 bg-card p-5 shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <BarChart3 className="h-4 w-4" />
          </span>
          <h3 className="truncate text-base font-bold tracking-[-0.01em]">{poll.question || "Cast your vote"}</h3>
        </div>
        {poll.isOwner ? (
          <button type="button" onClick={removePoll} disabled={removing} aria-label="Remove poll" className="shrink-0 rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-red-400">
            {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        ) : null}
      </div>

      <div className="space-y-2">
        {poll.options.map((o) => {
          const chosen = poll.viewerVote?.optionId === o.id;
          const p = pct(o.votesCount);
          return (
            <button
              key={o.id}
              type="button"
              disabled={!loggedIn || poll.closed || busy !== null}
              onClick={() => vote(o.id)}
              className={cn(
                "relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left transition",
                chosen ? "border-primary/60 ring-1 ring-primary/40" : "border-border/70 hover:border-border",
                (!loggedIn || poll.closed) && "cursor-default",
              )}
            >
              {showResults ? (
                <span
                  aria-hidden
                  className={cn("absolute inset-y-0 left-0 transition-[width] duration-500 ease-out", chosen ? "bg-primary/15" : "bg-secondary/70")}
                  style={{ width: `${p}%` }}
                />
              ) : null}
              <span className="relative z-10 flex min-w-0 flex-1 items-center gap-2">
                {chosen ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                <span className="truncate text-sm font-semibold">{o.label}</span>
              </span>

              {/* Public voters (avatars) */}
              {showResults && o.publicVoters.length > 0 ? (
                <span className="relative z-10 flex -space-x-2">
                  {o.publicVoters.slice(0, 4).map((v, i) =>
                    v.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={v.avatarUrl} alt={v.displayName} title={v.displayName} className="h-6 w-6 rounded-full object-cover ring-2 ring-card" />
                    ) : (
                      <span key={i} title={v.displayName} className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 text-[10px] font-bold text-white ring-2 ring-card">
                        {v.displayName.charAt(0).toUpperCase()}
                      </span>
                    ),
                  )}
                </span>
              ) : null}

              {showResults ? <span className="relative z-10 shrink-0 text-sm font-bold tabular-nums text-muted-foreground">{p}%</span> : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {formatCompactNumber(poll.totalVotes)} {poll.totalVotes === 1 ? "vote" : "votes"}
          {poll.closed ? " · closed" : ""}
        </span>

        {loggedIn && !poll.closed ? (
          <button
            type="button"
            onClick={togglePublic}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition",
              isPublic ? "bg-primary/10 text-primary" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {isPublic ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {isPublic ? "Vote is public" : "Vote is private"}
          </button>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3" /> Private by default
          </span>
        )}
      </div>
      {err ? <p className="mt-2 text-xs text-red-400">{err}</p> : null}
      {!loggedIn ? <p className="mt-2 text-xs text-muted-foreground">Sign in to vote.</p> : null}
    </div>
  );
}

/** Owner-only affordance to attach a poll when the post has none. */
export function PollCreator({ postId }: { postId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setOption = (i: number, v: string) => setOptions((o) => o.map((x, idx) => (idx === i ? v : x)));
  const addOption = () => setOptions((o) => (o.length < 6 ? [...o, ""] : o));
  const removeOption = (i: number) => setOptions((o) => (o.length > 2 ? o.filter((_, idx) => idx !== i) : o));

  const create = async () => {
    const clean = options.map((o) => o.trim()).filter(Boolean);
    if (clean.length < 2) {
      setErr("Add at least two options.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/posts/${postId}/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), options: clean }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Couldn't create the poll.");
        return;
      }
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 bg-card/50 px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
      >
        <BarChart3 className="h-4 w-4" /> Add a poll — let your audience vote
      </button>
    );
  }

  return (
    <div className="mt-6 rounded-3xl border border-border/70 bg-card p-5 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold">New poll</h3>
        <button type="button" onClick={() => setOpen(false)} aria-label="Cancel" className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        maxLength={200}
        placeholder="Ask a question (optional)"
        className="mb-3 w-full rounded-xl bg-background px-3 py-2.5 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
      />
      <div className="space-y-2">
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={o}
              onChange={(e) => setOption(i, e.target.value)}
              maxLength={80}
              placeholder={`Option ${i + 1}`}
              className="flex-1 rounded-xl bg-background px-3 py-2.5 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
            />
            {options.length > 2 ? (
              <button type="button" onClick={() => removeOption(i)} aria-label="Remove option" className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-red-400">
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {options.length < 6 ? (
        <button type="button" onClick={addOption} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          <Plus className="h-4 w-4" /> Add option
        </button>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create poll
        </button>
        {err ? <span className="text-sm text-red-400">{err}</span> : null}
      </div>
    </div>
  );
}
