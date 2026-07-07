"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ModAction, ReportedTarget } from "@/lib/social/moderation";
import { cn } from "@/lib/utils";

const TYPE_LABEL = { post: "Post", comment: "Comment", user: "User" } as const;

export function ModerationQueue({ targets }: { targets: ReportedTarget[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (t: ReportedTarget, action: ModAction) => {
    const key = `${t.targetType}:${t.targetId}:${action}`;
    setBusy(key);
    try {
      const res = await fetch("/api/admin/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: t.targetType, targetId: t.targetId, action }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const actionsFor = (t: ReportedTarget): { label: string; action: ModAction; danger?: boolean }[] => {
    if (t.targetType === "user") {
      return t.currentStatus === "suspended"
        ? [{ label: "Unsuspend", action: "unsuspend" }, { label: "Dismiss", action: "dismiss" }]
        : [{ label: "Suspend", action: "suspend", danger: true }, { label: "Dismiss", action: "dismiss" }];
    }
    const live = t.currentStatus === "published" || t.currentStatus === "visible";
    return [
      { label: "Remove", action: "remove", danger: true },
      ...(!live ? ([{ label: "Restore", action: "restore" }] as const) : []),
      { label: "Dismiss", action: "dismiss" },
    ];
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <ShieldAlert className="h-5 w-5 text-primary" /> Moderation
        {targets.length > 0 ? (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-500">{targets.length}</span>
        ) : null}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Open reports, grouped by item. Items hit by 3+ distinct reporters are
        auto-hidden for review.
      </p>

      {targets.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing to review.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {targets.map((t) => (
            <li key={`${t.targetType}:${t.targetId}`} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                    {TYPE_LABEL[t.targetType]}
                  </span>
                  {t.currentStatus && t.currentStatus !== "published" && t.currentStatus !== "active" ? (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                      {t.currentStatus}
                    </span>
                  ) : null}
                  <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-500">
                    {t.count} report{t.count > 1 ? "s" : ""}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm font-medium">
                  {t.targetType === "post" ? (
                    <Link href={`/p/${t.targetId}`} className="hover:underline">{t.title}</Link>
                  ) : t.targetType === "user" && t.handle ? (
                    <Link href={`/u/${t.handle}`} className="hover:underline">{t.title}</Link>
                  ) : (
                    t.title
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.sublabel ? `${t.sublabel} · ` : ""}{t.reasons.join(", ")}
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {actionsFor(t).map((a) => {
                  const key = `${t.targetType}:${t.targetId}:${a.action}`;
                  return (
                    <button
                      key={a.action}
                      type="button"
                      onClick={() => act(t, a.action)}
                      disabled={busy !== null}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-60",
                        a.danger
                          ? "border-red-500/30 text-red-500 hover:bg-red-500/10"
                          : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      {busy === key ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
