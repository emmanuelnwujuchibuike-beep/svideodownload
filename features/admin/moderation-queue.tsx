"use client";

import { Eye, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ModAction, ReportedTarget } from "@/lib/social/moderation";
import { cn } from "@/lib/utils";

const TYPE_LABEL = { post: "Post", comment: "Comment", user: "User", sub_post: "Exclusive post", sub_comment: "Exclusive comment" } as const;
const isSub = (t: ReportedTarget) => t.targetType === "sub_post" || t.targetType === "sub_comment";

function severityTint(severity: number): string {
  if (severity >= 70) return "bg-red-500/15 text-red-500";
  if (severity >= 35) return "bg-amber-500/15 text-amber-500";
  return "bg-emerald-500/15 text-emerald-500";
}

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
    // exclusive content: a takedown archives the post / hides the comment; nothing is deleted
    if (isSub(t)) {
      return [
        ...(live ? ([{ label: "Take down", action: "remove", danger: true }] as const) : ([{ label: "Restore", action: "restore" }] as const)),
        { label: "Dismiss", action: "dismiss" },
      ];
    }
    return [
      { label: "Remove", action: "remove", danger: true },
      ...(!live ? ([{ label: "Restore", action: "restore" }] as const) : []),
      { label: "Dismiss", action: "dismiss" },
    ];
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card px-3 py-6 sm:px-6 shadow-card">
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
                {t.aiAssessment ? (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs">
                    <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-violet-500" />
                    <span>
                      <span className={cn("mr-1.5 rounded-full px-1.5 py-0.5 font-semibold", severityTint(t.aiAssessment.severity))}>
                        {t.aiAssessment.category} · {t.aiAssessment.severity}/100
                      </span>
                      <span className="text-muted-foreground">{t.aiAssessment.rationale}</span>
                    </span>
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {isSub(t) ? <SubReviewButton t={t} /> : null}
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

interface SubReviewData {
  status: string;
  caption: string | null;
  comment: string | null;
  creatorHandle: string | null;
  media: { kind: "image" | "video"; url: string }[];
  expiresAt: string;
  reports: { reason: string; note: string | null; status: string; createdAt: string }[];
}

/**
 * Frenz Exclusive Part 2 — an admin looks at a reported exclusive post or comment. The links
 * come from the admin-only /api/admin/moderation/sub-review, expire in five minutes, and every
 * opening is written to the security audit log. Nothing is fetched until Review is pressed.
 */
export function SubReviewButton({ t }: { t: Pick<ReportedTarget, "targetType" | "targetId"> }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SubReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/moderation/sub-review?type=${t.targetType}&id=${t.targetId}`, { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as (SubReviewData & { error?: string }) | null;
      if (!res.ok || !j) setError(j?.error ?? "Couldn't load it.");
      else setData(j);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} Review
      </button>
      {open ? (
        <div className="basis-full rounded-2xl border border-border bg-background p-3 text-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {data?.creatorHandle ? `@${data.creatorHandle} · ` : ""}
              {data ? `${data.status} · links expire ${new Date(data.expiresAt).toLocaleTimeString()} · this review is logged` : "Loading…"}
            </p>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
          </div>
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
          {data?.comment ? <p className="mb-2 rounded-xl bg-secondary px-3 py-2">Comment: “{data.comment}”</p> : null}
          {data?.caption ? <p className="mb-2 whitespace-pre-line text-muted-foreground">Caption: {data.caption}</p> : null}
          {data?.media.length ? (
            <div className="grid grid-cols-3 gap-1.5">
              {data.media.map((m, i) =>
                m.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a five-minute private link, never cached
                  <img key={i} src={m.url} alt="" className="aspect-square w-full rounded-lg object-cover" />
                ) : (
                  <video key={i} src={m.url} controls preload="metadata" className="aspect-square w-full rounded-lg bg-black object-contain" />
                ),
              )}
            </div>
          ) : null}
          {data?.reports.length ? (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {data.reports.map((r, i) => (
                <li key={i}>
                  {new Date(r.createdAt).toLocaleString()} · {r.reason}
                  {r.note ? ` — ${r.note}` : ""} · {r.status}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
