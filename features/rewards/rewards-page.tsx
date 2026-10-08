"use client";

import { ArrowLeft, Check, Clock, Coins, Gift, Lock, Share2, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { TapOnceLink } from "@/features/ui/tap-once-link";
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
 * Owner brief 2026-10-07 §7–§11, §19, and the follow-ups the same day: the
 * withdrawal section is ALWAYS visible and greyed out until each step is met —
 * thresholds → apply → an admin approves → withdraw (0191) — and the whole
 * page is the Frenz AI glass system (`ai-glass` panels on a quiet wash).
 *
 * The one wallet is shown as its two classes, never one ambiguous number:
 *   AI Credits   — spend on any Frenz AI tool (everything not withdrawable)
 *   Withdrawable — reward credits earned AFTER approval; only these cash out
 * A reward earned before approval stays usable for AI and never becomes
 * withdrawable later (the class is fixed when the reward is granted).
 *
 * Every number is the server's (lib/rewards/summary.ts, read by the page);
 * every amount is the operator's live rule. Withdrawing and applying are
 * re-checked on the server.
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
  quest_completed: "Quest completed",
};

/** "Generate an AI video → earn 5 credits." — the brief's own form, from the live rule. */
function howToEarn(rules: Summary["rules"]): string[] {
  const ev = rules.events as Record<string, { actorCredits: number; referrerCredits: number; minDurationSeconds: number | null }>;
  const out: string[] = [];
  // 2026-10-07 (owner): referrals are the main source — each paying event said with its own amount
  const signup = ev.account_created?.referrerCredits ?? 0;
  const topup = ev.wallet_topup?.referrerCredits ?? 0;
  const sub = ev.subscription_started?.referrerCredits ?? 0;
  if (signup) out.push(`Invite a friend with your link → earn ${signup} credits when they sign up.`);
  if (topup) out.push(`Earn ${topup} credits every time a friend you invited tops up.`);
  if (sub) out.push(`Earn ${sub} credits every time a friend you invited subscribes.`);
  out.push("Finish your daily and weekly quests → earn credits (they reset at 1:00 AM and on Sunday, Lagos time).");
  const v = ev.ai_video_completed;
  if (v?.actorCredits) out.push(`Generate an AI video → earn ${v.actorCredits} credits.`);
  const s = ev.ai_video_shared;
  if (s?.actorCredits) out.push(`Share a ${s.minDurationSeconds ?? 30}s+ AI video to AI Reels → earn ${s.actorCredits} credits.`);
  return out;
}

const panel = "ai-glass rounded-[1.6rem] p-4 text-slate-900 ring-1 ring-inset ring-white/70 shadow-[0_18px_48px_-30px_rgba(49,46,129,0.45)]";

export function RewardsPage({ summary }: { summary: Summary }) {
  const { wallet, qualification: q, referrals, recentRewards, withdrawals, rules, earned } = summary;
  const earn = howToEarn(rules);

  return (
    <div className="relative min-h-[100dvh]">
      {/* a quiet wash behind the glass — static, no animation, no blur cost beyond the panels' own */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_50%_at_15%_0%,rgba(99,102,241,0.16),transparent_70%),radial-gradient(50%_45%_at_95%_10%,rgba(139,92,246,0.14),transparent_70%)]" />
      <div className="mx-auto max-w-2xl px-4 pb-16 pt-3">
        <Link href="/studio/ai/usage" prefetch={false} className="inline-flex min-h-[2.75rem] items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Credit Balance
        </Link>
        <h1 className="mt-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-[28px] font-bold tracking-[-0.03em] text-transparent">Rewards</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">Earn credits by creating, sharing and inviting friends.</p>
        {/* 2026-10-07 (owner): the daily and weekly quests */}
        <TapOnceLink href="/quests" className="mt-3 inline-flex min-h-[2.75rem] items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 px-4 text-[13.5px] font-bold text-white shadow-[0_10px_22px_-12px_rgba(249,115,22,0.9)] transition-[transform,opacity] duration-200 active:scale-95 data-[pending]:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 motion-reduce:active:scale-100">
          <Coins className="h-4 w-4" aria-hidden />
          Earn credits · daily &amp; weekly quests
        </TapOnceLink>

        {/* ── the two classes, side by side ── */}
        <section aria-label="Your credits" className="mt-5 grid grid-cols-2 gap-3">
          <Figure icon={<Sparkles className="h-4 w-4" aria-hidden />} label="Non-withdrawable" value={wallet.usableCredits} hint="For any Frenz AI tool — not cashable" />
          <Figure icon={<Wallet className="h-4 w-4" aria-hidden />} label="Withdrawable" value={wallet.withdrawableCredits} hint="Rewards you can cash out" accent={wallet.withdrawableCredits > 0} />
        </section>

        {q.restricted ? (
          <p className="mt-3 rounded-2xl bg-rose-500/10 px-4 py-3 text-[13px] text-rose-700 dark:text-rose-300">Rewards are paused on this account. Contact support if you think this is a mistake.</p>
        ) : !q.qualified ? (
          /* §8 — the pre-qualification sentence, exactly, and the rule that matters most */
          <div className={cn(panel, "mt-3 text-[13px] leading-relaxed")}>
            <p>Your referral rewards can be used for AI features. Withdrawable rewards unlock after you meet the withdrawal requirements.</p>
            <p className="mt-1.5 text-slate-500">Rewards earned before you&apos;re approved stay usable for AI features — they don&apos;t become withdrawable later.</p>
          </div>
        ) : null}

        <WithdrawSection summary={summary} />

        {/* ── §19: how to earn, from the live rules ── */}
        {earn.length ? (
          <section aria-label="How to earn" className={cn(panel, "mt-4")}>
            <h2 className="text-[15px] font-semibold">How to earn</h2>
            <ul className="mt-2 space-y-2 text-[13.5px]">
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
        <section aria-label="Referrals" className={cn(panel, "mt-4")}>
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
        <section aria-label="Reward activity" className="mt-5">
          <h2 className="px-1 text-[15px] font-semibold">Activity</h2>
          {recentRewards.length ? (
            <ul className={cn(panel, "mt-2 divide-y divide-slate-900/[0.06] p-0")}>
              {recentRewards.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">{r.role === "referrer" ? `Referral · ${LABEL[r.event_type] ?? r.event_type}` : (LABEL[r.event_type] ?? r.event_type)}</p>
                    <p className="text-[11.5px] text-slate-500">
                      {new Date(r.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {r.credit_class === "withdrawable" ? "withdrawable" : "AI credits"}
                    </p>
                  </div>
                  <span className="shrink-0 text-[14px] font-semibold tabular-nums text-emerald-700">+{r.amount} credits</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 px-1 text-[13px] text-muted-foreground">No rewards yet — create an AI video or share your link to get started.</p>
          )}
        </section>

        {withdrawals.length ? (
          <section aria-label="Withdrawals" className="mt-5">
            <h2 className="px-1 text-[15px] font-semibold">Withdrawals</h2>
            <ul className={cn(panel, "mt-2 divide-y divide-slate-900/[0.06] p-0")}>
              {withdrawals.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13.5px]">
                  <span>
                    {w.credits} credits · ${(w.amount_usd_cents / 100).toFixed(2)}
                  </span>
                  <span className="text-[12px] font-semibold capitalize text-slate-500">{w.status}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The withdrawal path, always on screen, one step lit at a time (owner,
 * 2026-10-07: "it should be greyed out when a user hasn't reached
 * requirements"): requirements → apply → under review → approved → withdraw.
 */
function WithdrawSection({ summary }: { summary: Summary }) {
  const { wallet, qualification: q, rules } = summary;
  const w = rules.withdrawals;
  const [status, setStatus] = useState(q.status);
  const [busy, setBusy] = useState(false);
  const metAge = q.accountAgeDays >= q.requiredAccountAgeDays;
  const metEng = q.engagements >= q.requiredEngagements;
  const approved = q.qualified || status === "approved";
  const canWithdraw = approved && !q.restricted && !!w && wallet.withdrawableCredits >= w.minCredits;

  async function apply() {
    if (busy) return;
    setBusy(true);
    haptic("selection");
    try {
      const res = await fetch("/api/rewards/qualification", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast(json.error ?? "Couldn't send your application.", "error");
      else {
        setStatus("applied");
        haptic("medium");
        toast("Application sent — we'll let you know.", "success");
      }
    } catch {
      toast("Network error — try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Withdraw rewards" className={cn(panel, "mt-4", !canWithdraw && "opacity-[0.97]")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Withdraw rewards</h2>
        {canWithdraw ? (
          <span className="rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-[11.5px] font-semibold text-emerald-700">Available</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/[0.06] px-2.5 py-0.5 text-[11.5px] font-semibold text-slate-500">
            <Lock className="h-3 w-3" aria-hidden />
            Locked
          </span>
        )}
      </div>
      {w ? (
        <p className="mt-0.5 text-[12px] text-slate-500">
          Withdrawal rate: {w.creditsPerUsd} credits = $1 (separate from the top-up rate) · from {w.minCredits} credits
        </p>
      ) : (
        <p className="mt-0.5 text-[12px] text-slate-500">Withdrawals open soon.</p>
      )}

      {/* step 1 — the requirements */}
      <div className="mt-3 space-y-3">
        <Progress label="Account age" value={q.accountAgeDays} max={q.requiredAccountAgeDays} unit="days" done={metAge || approved} />
        <Progress label="Qualifying engagements" value={q.engagements} max={q.requiredEngagements} done={metEng || approved} />
        <p className="text-[11.5px] text-slate-500">Each rewarded action by someone you invited counts as one qualifying engagement.</p>
        {/* the operator's own requirements (admin-editable) — checked by the team at review */}
        {rules.qualification.extraRequirements?.length ? (
          <div>
            <p className="text-[12.5px] font-medium">Also checked by our team</p>
            <ul className="mt-1 space-y-1 text-[12.5px] text-slate-600">
              {rules.qualification.extraRequirements.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden className="text-indigo-500">•</span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* step 2 — apply, then review */}
      <div className="mt-4">
        {approved ? (
          <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700">
            <Check className="h-4 w-4" aria-hidden />
            Approved — rewards you earn now are withdrawable.
          </p>
        ) : status === "applied" ? (
          <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-indigo-700">
            <Clock className="h-4 w-4" aria-hidden />
            Application under review — we&apos;ll notify you.
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void apply()}
              disabled={busy || !q.canApply || q.restricted}
              className="inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 text-[14px] font-semibold text-white shadow-[0_12px_28px_-16px_rgba(79,70,229,0.9)] transition disabled:cursor-not-allowed disabled:bg-none disabled:bg-slate-900/[0.08] disabled:text-slate-400 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              {busy ? "Sending…" : "Apply for withdrawals"}
            </button>
            <p className="mt-1.5 text-[11.5px] text-slate-500">
              {status === "rejected"
                ? "Your last application wasn't approved. You can apply again once you meet the requirements."
                : q.canApply
                  ? "You meet the requirements. Our team reviews every application."
                  : "Unlocks when both requirements above are met. Our team then reviews your account."}
            </p>
          </>
        )}
      </div>

      {/* step 3 — withdraw (greyed until approved and above the minimum) */}
      {w ? <WithdrawForm enabled={canWithdraw} max={Math.min(wallet.withdrawableCredits, w.maxCredits)} min={w.minCredits} creditsPerUsd={w.creditsPerUsd} methods={w.methods} withdrawable={wallet.withdrawableCredits} approved={approved} /> : null}
    </section>
  );
}

function Figure({ icon, label, value, hint, accent }: { icon: React.ReactNode; label: string; value: number; hint: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-[1.6rem] p-4 ring-1 ring-inset", accent ? "bg-gradient-to-br from-blue-600 via-indigo-500 to-violet-500 text-white ring-transparent shadow-[0_18px_40px_-22px_rgba(79,70,229,0.8)]" : panel)}>
      <p className={cn("flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em]", accent ? "text-white/85" : "text-slate-500")}>
        {icon}
        {label}
      </p>
      <p className="mt-1.5 text-[28px] font-bold leading-none tabular-nums tracking-[-0.02em]">{value.toLocaleString("en-US")}</p>
      <p className={cn("mt-1 text-[12px]", accent ? "text-white/85" : "text-slate-500")}>{hint}</p>
    </div>
  );
}

function Progress({ label, value, max, unit, done }: { label: string; value: number; max: number; unit?: string; done: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 100;
  const shown = Math.min(value, max);
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="inline-flex items-center gap-1.5">
          {done ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : null}
          {label}
        </span>
        <span className="font-semibold tabular-nums">
          {shown} / {max}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-900/[0.07]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={shown}>
        <div className={cn("h-full rounded-full", done ? "bg-emerald-500" : "bg-gradient-to-r from-blue-600 to-violet-500")} style={{ width: `${done ? 100 : pct}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/60 px-2 py-2 ring-1 ring-inset ring-white/80">
      <dd className="text-[17px] font-bold tabular-nums">{value.toLocaleString("en-US")}</dd>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-500">{label}</dt>
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

function WithdrawForm({ enabled, max, min, creditsPerUsd, methods, withdrawable, approved }: { enabled: boolean; max: number; min: number; creditsPerUsd: number; methods: string[]; withdrawable: number; approved: boolean }) {
  const [credits, setCredits] = useState(String(Math.max(min, max)));
  const [method, setMethod] = useState(methods[0] ?? "bank_transfer");
  // the keys the server validates (lib/rewards/withdrawals.ts validatePayoutDetails)
  const [details, setDetails] = useState({ accountName: "", accountNumber: "", bankName: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const n = Number(credits);
  const valid = enabled && Number.isInteger(n) && n >= min && n <= max && details.accountName.trim().length >= 2 && /^[0-9A-Za-z -]{4,40}$/.test(details.accountNumber.trim()) && details.bankName.trim().length >= 2;

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
    return <p className="mt-4 rounded-2xl bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-800">Withdrawal requested. We&apos;ll review it and notify you when it&apos;s paid.</p>;
  }
  const field = "mt-1 w-full rounded-xl bg-white/80 px-3 py-2 text-[14px] text-slate-900 ring-1 ring-inset ring-slate-900/10 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:cursor-not-allowed disabled:bg-slate-900/[0.04] disabled:text-slate-400";
  return (
    <fieldset disabled={!enabled} aria-disabled={!enabled} className={cn("mt-4 border-t border-slate-900/[0.07] pt-4", !enabled && "opacity-55")}>
      <legend className="sr-only">Withdrawal request</legend>
      {!enabled ? (
        <p className="mb-2 text-[12px] text-slate-500">
          {approved ? `You need at least ${min} withdrawable credits (you have ${withdrawable}).` : "Available after your account is approved for withdrawals."}
        </p>
      ) : null}
      <label className="block text-[12.5px] font-medium">
        Credits
        <input inputMode="numeric" value={credits} onChange={(e) => setCredits(e.target.value.replace(/[^\d]/g, ""))} className={field} />
      </label>
      {enabled && Number.isInteger(n) && n > 0 ? <p className="mt-1 text-[12px] text-slate-500">≈ ${((n * 100) / Math.max(1, creditsPerUsd) / 100).toFixed(2)}</p> : null}
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
            ["accountName", "Account name"],
            ["accountNumber", "Account number"],
            ["bankName", "Bank"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="block text-[12.5px] font-medium">
            {label}
            <input value={details[k]} maxLength={k === "accountNumber" ? 40 : 120} onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))} className={field} autoComplete="off" />
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
        className="mt-3 inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-full bg-slate-900 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-900/[0.1] disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        {state === "sending" ? "Requesting…" : "Request withdrawal"}
      </button>
    </fieldset>
  );
}
