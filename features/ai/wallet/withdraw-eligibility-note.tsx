"use client";

import { Check, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The note on the credits dashboard for a member who has not qualified for withdrawals yet
 * (owner, 2026-10-14: "put a label in the dashboard on users who have not qualified for
 * withdraw that they can earn cashable credit after their account has reached withdrawal
 * requirements, and right now their credit can only be used for AI creation and AI plans").
 *
 * The member's own standing, from /api/rewards/summary (lib/rewards/summary.ts) — read once per
 * tab and kept. The progress shown is the server's real count against the admin's thresholds,
 * never an estimate. Fails open: no answer, no note (the wallet itself is unaffected).
 */
interface Qualification {
  qualified: boolean;
  status: "none" | "applied" | "approved" | "rejected";
  restricted: boolean;
  activeDays: number;
  requiredActiveDays: number;
  engagements: number;
  requiredEngagements: number;
}

let kept: { uid: string; q: Qualification } | null = null;

export function WithdrawEligibilityNote({ uid }: { uid: string | null | undefined }) {
  const [q, setQ] = useState<Qualification | null>(() => (uid && kept?.uid === uid ? kept.q : null));

  useEffect(() => {
    if (!uid || (kept?.uid === uid && kept.q)) return;
    let live = true;
    fetch("/api/rewards/summary", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ qualification?: Qualification }>) : null))
      .then((d) => {
        if (!live || !d?.qualification) return;
        kept = { uid, q: d.qualification };
        setQ(d.qualification);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uid]);

  // qualified members, and an unknown or restricted standing, get no note
  if (!q || q.qualified || q.restricted) return null;

  const bars = [
    q.requiredEngagements > 0 ? { label: "Engagements", have: Math.min(q.engagements, q.requiredEngagements), need: q.requiredEngagements } : null,
    q.requiredActiveDays > 0 ? { label: "Active days", have: Math.min(q.activeDays, q.requiredActiveDays), need: q.requiredActiveDays } : null,
  ].filter((x): x is { label: string; have: number; need: number } => !!x);

  // design/Credits.dc.html (2026-10-20): a white card under the balance, not text inside it
  return (
    <div role="note" className="frenz-ui mt-3 flex flex-col gap-3 rounded-[22px] border border-frenz-line bg-frenz-card p-3.5 text-frenz-ink">
      <div className="flex gap-3">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-frenz-violet/10 text-frenz-violet">
          <Lock className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-[15px] font-bold">Unlock withdrawals</p>
          <p className="m-0 mt-0.5 text-[13px] leading-snug text-frenz-muted">
            {q.status === "applied"
              ? "Your application is being reviewed. Until it is approved, credits work for AI creation and AI plans only."
              : "Until then, credits work for AI creation and AI plans only."}
          </p>
        </div>
      </div>
      {q.status !== "applied"
        ? bars.map((x) => (
            <div key={x.label} className="flex flex-col gap-1.5">
              <span className="flex justify-between text-[13px] font-semibold">
                <span>{x.label}</span>
                {x.have >= x.need ? (
                  <span className="flex items-center gap-1 text-emerald-700">
                    <Check className="h-3.5 w-3.5" aria-hidden /> {x.have.toLocaleString("en-US")} / {x.need.toLocaleString("en-US")}
                  </span>
                ) : (
                  <span className="tabular-nums text-frenz-muted">
                    {x.have.toLocaleString("en-US")} / {x.need.toLocaleString("en-US")}
                  </span>
                )}
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-frenz-fill">
                <span className="block h-full rounded-full bg-frenz-gradient-x" style={{ width: `${Math.max(1, Math.round((x.have / x.need) * 100))}%` }} />
              </span>
            </div>
          ))
        : null}
      <Link href="/rewards" className="text-[14px] font-bold text-frenz-blue no-underline">
        See all requirements
      </Link>
    </div>
  );
}
