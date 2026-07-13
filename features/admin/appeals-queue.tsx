"use client";

import { Loader2, MessageSquareWarning } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PendingAppeal } from "@/lib/social/appeals";
import { cn } from "@/lib/utils";

const TYPE_LABEL = { post: "Post", comment: "Comment", user: "User" } as const;

export function AppealsQueue({ appeals }: { appeals: PendingAppeal[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const resolve = async (appeal: PendingAppeal, resolution: "upheld" | "overturned") => {
    setBusy(appeal.id);
    try {
      const res = await fetch("/api/admin/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appealId: appeal.id, resolution, adminNote: notes[appeal.id]?.trim() || undefined }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <MessageSquareWarning className="h-5 w-5 text-primary" /> Appeals
        {appeals.length > 0 ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">{appeals.length}</span>
        ) : null}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Users appealing a moderation action against their own post, comment, or account. "Overturn" restores the
        content/account; "Uphold" just closes the appeal.
      </p>

      {appeals.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No open appeals.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {appeals.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  {TYPE_LABEL[a.targetType]}
                </span>
                {a.userHandle ? <span className="text-xs text-muted-foreground">@{a.userHandle}</span> : null}
              </div>
              <p className="text-sm">{a.message}</p>
              <input
                type="text"
                placeholder="Optional note (visible only to you)"
                value={notes[a.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40"
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => resolve(a, "overturned")}
                  disabled={busy !== null}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs font-medium text-emerald-500 transition hover:bg-emerald-500/10 disabled:opacity-60",
                  )}
                >
                  {busy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Overturn
                </button>
                <button
                  type="button"
                  onClick={() => resolve(a, "upheld")}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-60"
                >
                  Uphold
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
