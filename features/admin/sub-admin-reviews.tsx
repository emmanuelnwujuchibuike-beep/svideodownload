"use client";

import { useEffect, useState } from "react";

import { usd } from "@/lib/creator/membership/engine";
import { useSensitiveAction } from "@/features/admin/use-sensitive-action";

/**
 * Exclusive money reviews (Part 12 follow-up) — inside the admin SUB panel.
 *
 *  · Refunds not applied automatically: a partial refund, or one in another currency than the charge.
 *    Shows the reference, what was charged and what was refunded (when Paystack sent it), and whether
 *    a person has looked at it. "Mark reviewed" only records that — no balance or access changes.
 *  · Disputed purchases: "Dispute won" restores the earning and the access, once (0254), after the
 *    admin confirmed the outcome in the Paystack dashboard (no provider event for it is integrated).
 */
interface RefundReview {
  id: string;
  kind: "partial" | "other_currency";
  reference: string | null;
  chargedMinor: number | null;
  chargedCurrency: string | null;
  refundedMinor: number | null;
  refundedCurrency: string | null;
  at: string;
  reviewed: { at: string } | null;
}
interface Dispute {
  id: string;
  reference: string;
  price_cents: number;
  charged_minor: number | null;
  charged_currency: string | null;
  reversed_at: string | null;
}

interface PayoutAlert {
  id: string;
  kind: "paid_after_release" | "ai_credit_returned";
  withdrawalId: string | null;
  reference: string | null;
  at: string;
}

const money = (minor: number | null, cur: string | null) => (minor != null && cur ? `${(minor / 100).toLocaleString()} ${cur}` : "not sent by Paystack");
const field = "w-40 rounded-lg border border-black/[0.08] bg-white/70 px-2 py-1 dark:border-white/10 dark:bg-white/[0.06]";

export function SubAdminReviews() {
  // Frenz Coin Part 2 (M4): money routes answer REAUTH_REQUIRED when the last password entry is stale — prompt, then replay
  const { sensitiveFetch, reauthPrompt } = useSensitiveAction();
  const [data, setData] = useState<{ refundReviews: RefundReview[]; disputes: Dispute[]; payoutAlerts?: PayoutAlert[]; ready: boolean } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    fetch("/api/admin/memberships/reviews", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d ?? { refundReviews: [], disputes: [], ready: false }))
      .catch(() => setData({ refundReviews: [], disputes: [], ready: false }));
  useEffect(() => {
    void load();
  }, []);

  const post = async (key: string, body: Record<string, unknown>, done: string) => {
    const note = (notes[key] ?? "").trim();
    if (note.length < 3) return setMsg({ ok: false, text: "Write a note of at least 3 characters first." });
    setBusy(key);
    setMsg(null);
    const res = await sensitiveFetch("/api/admin/memberships/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, note }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { error?: string; duplicate?: boolean } | null;
    setBusy(null);
    if (!res?.ok) return setMsg({ ok: false, text: j?.error ?? "Couldn't save it." });
    setMsg({ ok: true, text: j?.duplicate ? "Already done — nothing changed." : done });
    void load();
  };

  const open = (data?.refundReviews ?? []).filter((r) => !r.reviewed);
  return (
    <div className="mt-6">
      {reauthPrompt}
      <h3 className="text-sm font-semibold">Needs review</h3>
      {!data ? (
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      ) : !data.ready ? (
        <p className="mt-2 text-sm text-muted-foreground">Couldn&apos;t load the reviews.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            Refunds Paystack processed that were NOT applied automatically (partial, or in another currency). Nothing here changes a balance or access by itself: settle it with the creator, then mark it reviewed.
          </p>
          {data.refundReviews.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No refunds waiting for review.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">Recorded</th>
                    <th className="py-1.5 pr-2 font-medium">Reference</th>
                    <th className="py-1.5 pr-2 font-medium">Charged</th>
                    <th className="py-1.5 pr-2 font-medium">Refunded</th>
                    <th className="py-1.5 font-medium">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {data.refundReviews.map((r) => (
                    <tr key={r.id} className="border-t border-black/[0.06] align-top dark:border-white/[0.07]">
                      <td className="py-2 pr-2 tabular-nums">{new Date(r.at).toLocaleString()}</td>
                      <td className="py-2 pr-2 font-mono text-[11px]">{r.reference}</td>
                      <td className="py-2 pr-2 tabular-nums">{money(r.chargedMinor, r.chargedCurrency)}</td>
                      <td className="py-2 pr-2 tabular-nums">
                        {money(r.refundedMinor, r.refundedCurrency)}
                        <span className="ml-1 text-muted-foreground">{r.kind === "partial" ? "(partial)" : "(other currency)"}</span>
                      </td>
                      <td className="py-2">
                        {r.reviewed ? (
                          <span className="text-muted-foreground">Reviewed {new Date(r.reviewed.at).toLocaleDateString()}</span>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <input aria-label="Review note" placeholder="What was done" value={notes[`r${r.id}`] ?? ""} onChange={(e) => setNotes({ ...notes, [`r${r.id}`]: e.target.value })} className={field} />
                            <button type="button" disabled={busy === `r${r.id}`} onClick={() => void post(`r${r.id}`, { action: "close_refund_review", id: r.id }, "Marked reviewed. No balance or access was changed.")} className="ex-btn ex-btn--quiet ex-btn--sm">
                              Mark reviewed
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {open.length ? <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{open.length} open</p> : null}

          <h4 className="mt-5 text-xs font-semibold">Disputed purchases</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            A dispute takes the earning and the access back when it opens. If you WON it in the Paystack dashboard, restore it here: once, the earning returns (any debt first) and the access it paid for comes back.
          </p>
          {data.disputes.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No disputed purchases.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-xs">
              {data.disputes.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-black/[0.03] px-3 py-2 dark:bg-white/[0.045]">
                  <span className="font-mono text-[11px]">{d.reference}</span>
                  <span className="tabular-nums">{usd(d.price_cents)} earning · {money(d.charged_minor, d.charged_currency)} charged</span>
                  <span className="text-muted-foreground">{d.reversed_at ? `disputed ${new Date(d.reversed_at).toLocaleDateString()}` : ""}</span>
                  <input aria-label="Restore note" placeholder="Paystack dispute id / note" value={notes[`d${d.id}`] ?? ""} onChange={(e) => setNotes({ ...notes, [`d${d.id}`]: e.target.value })} className={field} />
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={!!confirmed[d.id]} onChange={(e) => setConfirmed({ ...confirmed, [d.id]: e.target.checked })} /> I confirmed it was won in Paystack
                  </label>
                  <button
                    type="button"
                    disabled={busy === `d${d.id}` || !confirmed[d.id]}
                    onClick={() => void post(`d${d.id}`, { action: "restore_dispute", reference: d.reference }, "Restored: the earning and the access are back.")}
                    className="ex-btn ex-btn--primary ex-btn--sm"
                  >
                    Dispute won — restore
                  </button>
                </li>
              ))}
            </ul>
          )}
          {data.payoutAlerts?.length ? (
            <>
              <h4 className="mt-5 text-xs font-semibold">Payouts to settle by hand</h4>
              <p className="mt-1 text-xs text-muted-foreground">Nothing moved automatically for these. Check each reference in the Paystack dashboard and recover or return the money with the creator.</p>
              <ul className="mt-2 space-y-2 text-xs">
                {data.payoutAlerts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-black/[0.03] px-3 py-2 dark:bg-white/[0.045]">
                    <span className="font-mono text-[11px]">{p.reference}</span>
                    <span className={p.kind === "paid_after_release" ? "font-medium text-rose-600 dark:text-rose-400" : ""}>
                      {p.kind === "paid_after_release" ? "Paid AFTER the withdrawal was released: the creator was paid twice" : "AI-credit payout returned by the bank: return the credits by hand"}
                    </span>
                    <span className="text-muted-foreground">{new Date(p.at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {msg ? (
            <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "mt-2 text-xs text-emerald-700 dark:text-emerald-400" : "mt-2 text-xs text-rose-600 dark:text-rose-400"}>
              {msg.text}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
