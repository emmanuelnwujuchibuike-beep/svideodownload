"use client";

import { Ban, Loader2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Ban / lift for one app rating (0267, owner 2026-10-22). The ban covers the account (suspended) and every
 * device identifier the rating carried — see lib/security/rating-bans.ts. A short reason is kept with it.
 * After either action the panel re-reads on the server (router.refresh) so the badge is the truth.
 */
export function RatingBanButton({ ratingId, banned, signedIn }: { ratingId: string; banned: boolean; signedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const send = async (method: "POST" | "DELETE") => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/admin/ratings/ban", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method === "POST" ? { ratingId, ...(reason.trim() ? { reason: reason.trim() } : {}) } : { ratingId }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setProblem(json?.error ?? "That didn't work. Try again.");
        return;
      }
      setAsking(false);
      setReason("");
      router.refresh();
    } catch {
      setProblem("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (banned) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-600">Banned</span>
        <button type="button" onClick={() => void send("DELETE")} disabled={busy} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border/70 px-2.5 text-[12px] font-semibold disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Undo2 className="h-3.5 w-3.5" aria-hidden />}
          Lift ban
        </button>
        {problem ? <span className="text-[11px] text-rose-600">{problem}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {asking ? (
        <>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Reason (optional)"
            aria-label="Reason for the ban"
            className="h-8 w-44 rounded-full border border-border/70 bg-background px-3 text-[12px]"
          />
          <button type="button" onClick={() => void send("POST")} disabled={busy} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-rose-600 px-3 text-[12px] font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Ban className="h-3.5 w-3.5" aria-hidden />}
            {signedIn ? "Ban account & device" : "Ban this device"}
          </button>
          <button type="button" onClick={() => setAsking(false)} className="min-h-8 px-1 text-[12px] text-muted-foreground">
            Cancel
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className={cn("inline-flex min-h-8 items-center gap-1 rounded-full border border-rose-500/40 px-2.5 text-[12px] font-semibold text-rose-600")}>
          <Ban className="h-3.5 w-3.5" aria-hidden />
          Ban
        </button>
      )}
      {problem ? <span className="text-[11px] text-rose-600">{problem}</span> : null}
    </span>
  );
}
