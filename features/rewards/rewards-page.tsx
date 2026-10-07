"use client";

import { ArrowLeft, Gift, Share2, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { attributionLink, shareOrCopy } from "@/lib/referrals/share-client";
import type { RewardsSummary } from "@/lib/rewards/summary";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REWARDS — what you earned, what you can use, what you can withdraw
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner brief 2026-10-07 §7–§11, §19. The one wallet is shown as its two
 * classes, never one ambiguous number:
 *   AI Credits   — spend on any Frenz AI tool (everything not withdrawable)
 *   Withdrawable — reward credits earned AFTER qualifying; only these cash out
 * and the rule that decides between them is said in one sentence, plainly: a
 * reward earned before qualifying stays usable for AI and never becomes
 * withdrawable later (the class is fixed when the reward is granted, 0187).
 *
 * Every number is the server's (lib/rewards/summary.ts, read by the page);
 * every amount in "How to earn" is the operator's live rule. Nothing here
 * decides anything — withdrawing re-checks everything on the server.
 */
type Summary = RewardsSummary;

const LABEL: Record<string, string> = {
  account_created: "New member joined",
  download_completed: "Download",
  ai_video_completed: "AI video generated",
  ai_audio_completed: "AI audio generated",
  ai_image_completed: "AI image generated",
  ai_avatar_completed: "AI avatar generated",
  ai_video_shared: "AI video shared to AI Reels",
  post_engagement: "Post engagement",
  reel_engagement: "Reel engagement",
  profile_engagement: "Profile engagement",
  follow: "Follow",
  save: "Save",
  subscription_started: "Subscription",
  wallet_topup: "Credit top-up",
};

/** "Generate an AI video → earn 5 credits." — the brief's own form, from the live rule. */
function howToEarn(rules: Summary["rules"]): string[] {
  const ev = rules.events as Record<string, { actorCredits: number; referrerCredits: number; minDurationSeconds: number | null }>;
  const out: string[] = [];
  const v = ev.ai_video_completed;
  if (v?.actorCredits) out.push(`Generate an AI video → earn ${v.actorCredits} credits.`);
  const s = ev.ai_video_shared;
  if (s?.actorCredits) out.push(`Share a ${s.minDurationSeconds ?? 30}s+ AI video to AI Reels → earn ${s.actorCredits} credits.`);
  const referral = Object.entries(ev).filter(([, r]) => r.referrerCredits > 0);
  if (referral.length) {
    const best = Math.max(...referral.map(([, r]) => r.referrerCredits));
    out.push(`Invite friends with your link → earn up to ${best} credits each time they ${referral.length > 1 ? "download, create or subscribe" : (LABEL[referral[0]![0]] ?? "join").toLowerCase()}.`);
  }
  return out;
}

export function RewardsPage({ summary }: { summary: Summary }) {
  const { wallet, qualification: q, referrals, recentRewards, withdrawals, rules, earned } = summary;
  const withdrawRules = rules.withdrawals;
  const canWithdraw = q.qualified && !q.restricted && !!withdrawRules && wallet.withdrawableCredits >= withdrawRules.minCredits;
  const earn = howToEarn(rules);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-3">
      <Link href="/studio/ai/usage" prefetch={false} className="inline-flex min-h-[2.75rem] items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Credit Balance
      </Link>
      <h1 className="mt-1 text-2xl font-bold tracking-[-0.02em]">Rewards</h1>
      <p className="mt-1 text-[14px] text-muted-foreground">Earn credits by creating, sharing and inviting friends.</p>

      {/* ── the two classes, side by side ── */}
      <section aria-label="Your credits" className="mt-5 grid grid-cols-2 gap-3">
        <Figure icon={<Sparkles className="h-4 w-4" aria-hidden />} label="AI Credits" value={wallet.usableCredits} hint="For any Frenz AI tool" />
        <Figure icon={<Wallet className="h-4 w-4" aria-hidden />} label="Withdrawable" value={wallet.withdrawableCredits} hint={canWithdraw ? "Withdrawal available" : "Rewards you can cash out"} accent={canWithdraw} />
      </section>

      {q.restricted ? (
        <p className="mt-3 rounded-2xl bg-rose-500/10 px-4 py-3 text-[13px] text-rose-700 dark:text-rose-300">Rewards are paused on this account. Contact support if you think this is a mistake.</p>
      ) : !q.qualified ? (
        /* §8 — the pre-qualification sentence, exactly, and the rule that matters most */
        <div className="mt-3 rounded-2xl bg-secondary/70 px-4 py-3 text-[13px] leading-relaxed">
          <p>Your referral rewards can be used for AI features. Withdrawable rewards unlock after you meet the withdrawal requirements.</p>
          <p className="mt-1.5 text-muted-foreground">Rewards earned before you qualify stay usable for AI features — they don&apos;t become withdrawable later.</p>
        </div>
      ) : (
        <p className="mt-3 rounded-2xl bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-800 dark:text-emerald-200">
          You&apos;ve qualified. New rewards are withdrawable{withdrawRules ? ` — withdrawals start at ${withdrawRules.minCredits} credits` : ""}. Only withdrawable rewards can be cashed out.
        </p>
      )}

      {/* ── §7: qualification progress ── */}
      {!q.qualified && !q.restricted ? (
        <section aria-label="Withdrawal eligibility" className="mt-5 rounded-3xl bg-card p-4 ring-1 ring-inset ring-black/[0.06] dark:ring-white/10">
          <h2 className="text-[15px] font-semibold">Withdrawal eligibility</h2>
          <Progress label="Qualifying engagements" value={q.engagements} max={q.requiredEngagements} />
          <Progress label="Account age" value={q.accountAgeDays} max={q.requiredAccountAgeDays} unit="days" />
          <p className="mt-3 text-[12px] text-muted-foreground">Each rewarded action by someone you invited counts as one qualifying engagement.</p>
        </section>
      ) : null}

      {canWithdraw && withdrawRules ? <WithdrawForm max={Math.min(wallet.withdrawableCredits, withdrawRules.maxCredits)} min={withdrawRules.minCredits} creditsPerUsd={withdrawRules.creditsPerUsd} methods={withdrawRules.methods} /> : null}

      {/* ── §19: how to earn, from the live rules ── */}
      {earn.length ? (
        <section aria-label="How to earn" className="mt-5">
          <h2 className="text-[15px] font-semibold">How to earn</h2>
          <ul className="mt-2 space-y-1.5 text-[13.5px]">
            {earn.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="text-indigo-500">✦</span>
                {line}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── §11: referrals ── */}
      <section aria-label="Referrals" className="mt-6 rounded-3xl bg-card p-4 ring-1 ring-inset ring-black/[0.06] dark:ring-white/10">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Referrals</h2>
          <Gift className="h-4 w-4 text-indigo-500" aria-hidden />
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Link clicks" value={referrals.clicks} />
          <Stat label="Joined" value={referrals.referredMembers} />
          <Stat label="Qualifying" value={q.engagements} />
          <Stat label="Usable earned" value={earned.usable} />
          <Stat label="Withdrawable earned" value={earned.withdrawable} />
          <Stat label="Links" value={referrals.links} />
        </dl>
        <ShareAppButton />
      </section>

      {/* ── §10: activity ── */}
      <section aria-label="Reward activity" className="mt-6">
        <h2 className="text-[15px] font-semibold">Activity</h2>
        {recentRewards.length ? (
          <ul className="mt-2 divide-y divide-border/60 rounded-3xl bg-card ring-1 ring-inset ring-black/[0.06] dark:ring-white/10">
            {recentRewards.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium">{r.role === "referrer" ? `Referral · ${LABEL[r.event_type] ?? r.event_type}` : (LABEL[r.event_type] ?? r.event_type)}</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {r.credit_class === "withdrawable" ? "withdrawable" : "AI credits"}
                  </p>
                </div>
                <span className="shrink-0 text-[14px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">+{r.amount} credits</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">No rewards yet — create an AI video or share your link to get started.</p>
        )}
      </section>

      {withdrawals.length ? (
        <section aria-label="Withdrawals" className="mt-6">
          <h2 className="text-[15px] font-semibold">Withdrawals</h2>
          <ul className="mt-2 divide-y divide-border/60 rounded-3xl bg-card ring-1 ring-inset ring-black/[0.06] dark:ring-white/10">
            {withdrawals.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13.5px]">
                <span>
                  {w.credits} credits · ${(w.amount_usd_cents / 100).toFixed(2)}
                </span>
                <span className="text-[12px] font-semibold capitalize text-muted-foreground">{w.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Figure({ icon, label, value, hint, accent }: { icon: React.ReactNode; label: string; value: number; hint: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-3xl p-4 ring-1 ring-inset", accent ? "bg-gradient-to-br from-blue-600 via-indigo-500 to-violet-500 text-white ring-transparent" : "bg-card ring-black/[0.06] dark:ring-white/10")}>
      <p className={cn("flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em]", accent ? "text-white/85" : "text-muted-foreground")}>
        {icon}
        {label}
      </p>
      <p className="mt-1.5 text-[28px] font-bold leading-none tabular-nums tracking-[-0.02em]">{value.toLocaleString("en-US")}</p>
      <p className={cn("mt-1 text-[12px]", accent ? "text-white/85" : "text-muted-foreground")}>{hint}</p>
    </div>
  );
}

function Progress({ label, value, max, unit }: { label: string; value: number; max: number; unit?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 100;
  const shown = Math.min(value, max);
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between text-[13px]">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">
          {shown} / {max}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={shown}>
        <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-secondary/60 px-2 py-2">
      <dd className="text-[17px] font-bold tabular-nums">{value.toLocaleString("en-US")}</dd>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{label}</dt>
    </div>
  );
}

/** §11 primary CTA — the member's own Frenzsave link (one share helper, native sheet or copy). */
function ShareAppButton() {
  const [busy, setBusy] = useState(false);
  async function share() {
    if (busy) return;
    setBusy(true);
    haptic("selection");
    const url = (await attributionLink("app", "app")) ?? window.location.origin;
    const out = await shareOrCopy(url, "Join me on Frenzsave");
    if (out === "copied") toast("Your invite link is copied.", "success");
    else if (out === "failed") toast("Couldn't share the link.", "error");
    setBusy(false);
  }
  return (
    <button
      type="button"
      onClick={() => void share()}
      disabled={busy}
      className="mt-4 inline-flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 text-[14.5px] font-semibold text-white shadow-[0_12px_28px_-16px_rgb(79_70_229/0.9)] transition active:scale-[0.99] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 motion-reduce:active:scale-100"
    >
      <Share2 className="h-4 w-4" aria-hidden />
      Share Frenzsave
    </button>
  );
}

function WithdrawForm({ max, min, creditsPerUsd, methods }: { max: number; min: number; creditsPerUsd: number; methods: string[] }) {
  const [credits, setCredits] = useState(String(max));
  const [method, setMethod] = useState(methods[0] ?? "bank_transfer");
  const [details, setDetails] = useState({ account_name: "", account_number: "", bank_name: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const n = Number(credits);
  const valid = Number.isInteger(n) && n >= min && n <= max && details.account_name.trim() && details.account_number.trim() && details.bank_name.trim();

  async function submit() {
    if (!valid || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/rewards/withdrawals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credits: n, method, details }) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Couldn't request that withdrawal.");
        setState("idle");
        return;
      }
      setState("sent");
      haptic("medium");
    } catch {
      setError("Network error — try again.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return <p className="mt-4 rounded-2xl bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-800 dark:text-emerald-200">Withdrawal requested. We&apos;ll review it and notify you when it&apos;s paid.</p>;
  }
  const field = "mt-1 w-full rounded-xl bg-background px-3 py-2 text-[14px] ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-violet-500";
  return (
    <section aria-label="Withdraw" className="mt-5 rounded-3xl bg-card p-4 ring-1 ring-inset ring-black/[0.06] dark:ring-white/10">
      <h2 className="text-[15px] font-semibold">Withdraw rewards</h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        {min}–{max} credits · {creditsPerUsd} credits = $1 · reviewed by our team
      </p>
      <label className="mt-3 block text-[12.5px] font-medium">
        Credits
        <input inputMode="numeric" value={credits} onChange={(e) => setCredits(e.target.value.replace(/[^\d]/g, ""))} className={field} />
      </label>
      {Number.isInteger(n) && n > 0 ? <p className="mt-1 text-[12px] text-muted-foreground">≈ ${((n * 100) / Math.max(1, creditsPerUsd) / 100).toFixed(2)}</p> : null}
      {methods.length > 1 ? (
        <label className="mt-3 block text-[12.5px] font-medium">
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
            {methods.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(
          [
            ["account_name", "Account name"],
            ["account_number", "Account number"],
            ["bank_name", "Bank"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="block text-[12.5px] font-medium">
            {label}
            <input value={details[k]} maxLength={200} onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))} className={field} autoComplete="off" />
          </label>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] font-semibold text-rose-600">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!valid || state === "sending"}
        className="mt-3 inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-full bg-foreground text-[14px] font-semibold text-background disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        {state === "sending" ? "Requesting…" : "Request withdrawal"}
      </button>
    </section>
  );
}
