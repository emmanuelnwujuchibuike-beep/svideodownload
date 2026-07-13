"use client";

import { Loader2, MessageSquareWarning } from "lucide-react";
import { useEffect, useState } from "react";

import { toast } from "@/features/ui/toast";
import type { AppealableItem, AppealItem } from "@/lib/social/appeals";
import { cn } from "@/lib/utils";

const TYPE_LABEL = { post: "Post", comment: "Comment", user: "Account" } as const;
const STATUS_TINT: Record<AppealItem["status"], string> = {
  pending: "bg-amber-500/15 text-amber-500",
  upheld: "bg-secondary text-muted-foreground",
  overturned: "bg-emerald-500/15 text-emerald-500",
};

/**
 * Part 11c — appeals. Lists the viewer's own currently-hidden/removed/
 * suspended content (verified server-side, not just "what the client
 * thinks") with a one-tap "Appeal this" form, plus their appeal history.
 */
export function AppealsPanel() {
  const [appealable, setAppealable] = useState<AppealableItem[] | null>(null);
  const [history, setHistory] = useState<AppealItem[]>([]);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/appeals");
      if (res.ok) {
        const json = await res.json();
        setAppealable(json.appealable ?? []);
        setHistory(json.history ?? []);
      }
    } catch {
      setAppealable([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async (item: AppealableItem) => {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: item.targetType, targetId: item.targetId, message: message.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Couldn't submit your appeal.", "error");
        return;
      }
      toast("Appeal submitted — we'll review it soon.", "success");
      setOpenFor(null);
      setMessage("");
      void load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t border-border/60 p-5">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <MessageSquareWarning className="h-4 w-4 text-muted-foreground" /> Appeals
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        If one of your posts, comments, or your account was actioned by moderation and you think it was a mistake,
        you can ask for a second look here.
      </p>

      {appealable === null ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : appealable.length === 0 ? (
        <p className="rounded-xl bg-secondary/40 px-3.5 py-3 text-xs text-muted-foreground">Nothing of yours is currently actioned.</p>
      ) : (
        <ul className="space-y-2">
          {appealable.map((item) => {
            const key = `${item.targetType}:${item.targetId}`;
            return (
              <li key={key} className="rounded-xl border border-border/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="mr-1.5 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                      {TYPE_LABEL[item.targetType]}
                    </span>
                    <span className="truncate text-sm">{item.title}</span>
                  </div>
                  {item.hasPendingAppeal ? (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">Appeal pending</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenFor(openFor === key ? null : key);
                        setMessage("");
                      }}
                      className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition hover:bg-secondary"
                    >
                      Appeal
                    </button>
                  )}
                </div>
                {openFor === key ? (
                  <div className="mt-2.5 space-y-2">
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Explain why you think this was a mistake…"
                      rows={3}
                      maxLength={1000}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <button
                      type="button"
                      onClick={() => void submit(item)}
                      disabled={submitting || !message.trim()}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition disabled:opacity-60",
                      )}
                    >
                      {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      Submit appeal
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {history.length > 0 ? (
        <div className="mt-4 border-t border-border/40 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your appeal history</p>
          <ul className="space-y-1.5">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">{TYPE_LABEL[h.targetType]} · {new Date(h.createdAt).toLocaleDateString()}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-medium", STATUS_TINT[h.status])}>{h.status}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
