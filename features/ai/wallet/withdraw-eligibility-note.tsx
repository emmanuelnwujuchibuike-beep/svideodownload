"use client";

import { Info } from "lucide-react";
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
  accountAgeDays: number;
  requiredAccountAgeDays: number;
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

  const steps = [
    q.requiredEngagements > 0 ? `${Math.min(q.engagements, q.requiredEngagements).toLocaleString("en-US")} of ${q.requiredEngagements.toLocaleString("en-US")} engagements` : null,
    q.requiredAccountAgeDays > 0 ? `${Math.min(q.accountAgeDays, q.requiredAccountAgeDays)} of ${q.requiredAccountAgeDays} days account age` : null,
  ].filter(Boolean);

  return (
    <div role="note" className="relative mt-3 flex gap-2.5 rounded-2xl bg-white/[0.14] px-3.5 py-3 ring-1 ring-inset ring-white/25 backdrop-blur-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-white/90" aria-hidden />
      <div className="min-w-0 text-[12.5px] leading-snug">
        <p className="font-semibold">Cashable credits unlock once your account meets the withdrawal requirements.</p>
        <p className="mt-0.5 text-white/85">
          {q.status === "applied"
            ? "Your application is being reviewed. Until it's approved, your credits can be used for AI creation and AI plans only."
            : "Until then, your credits can be used for AI creation and AI plans only."}
        </p>
        {steps.length && q.status !== "applied" ? <p className="mt-1.5 text-[11.5px] font-medium text-white/75">Your progress: {steps.join(" · ")}</p> : null}
        <Link href="/rewards" className="mt-1.5 inline-block text-[12px] font-semibold text-white underline decoration-white/50 underline-offset-2">
          See the requirements
        </Link>
      </div>
    </div>
  );
}
