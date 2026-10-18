"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ArrowUpRight, Banknote, Bookmark, CalendarDays, Check, ChevronRight, Clapperboard, Crown, Download, Gem, Heart, Music4, Send, Sun, UserPlus, Video, Lightbulb } from "lucide-react";
import Link from "next/link";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { TapOnceLink } from "@/features/ui/tap-once-link";
import { haptic } from "@/lib/motion/haptics";
import type { QuestBoard, QuestEvent, QuestView } from "@/lib/rewards/quests";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EARN CREDITS — balance, what credits are for, the week, and the quests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Redesign, owner brief 2026-10-11 ("premium Earn Credits page"). The first
 * screen answers three things in order: how many credits you have, what they
 * are for, and which quests earn more. Everything is the server's:
 *
 *   · the balance arrives WITH the board (/api/quests, same parallel read) —
 *     no second request, no realtime channel, no polling
 *   · quests are credited by SQL (`quest_record`) the moment the action
 *     counts — once per quest per period, under the weekly cap — so there is
 *     no "Claim" button: a claim step would be invented
 *   · a "just earned" highlight and the balance pulse fire only when a re-read
 *     shows a quest newly completed / the balance higher — never optimistically
 *
 * ── Never a reload for nothing (unchanged, owner 2026-10-07) ───────────────
 * The board is kept in memory (and in sessionStorage across a PWA resume).
 * Entry and back-swipe paint it at once; a quiet re-check runs only when it is
 * older than STALE_MS, when a period has just ended, or when the app comes back
 * to the foreground — and the screen changes only if the answer differs.
 * The reset countdowns tick once a minute inside their own tiny component, so
 * the page itself never re-renders on a timer.
 */
const STALE_MS = 45_000;
// v2: the board now carries the wallet; a v1 copy would paint a balance-less hero
const STORE_KEY = "frenz:quests:v2";

type Wallet = { credits: number; withdrawable: number } | null;
type Board = QuestBoard & { wallet?: Wallet };

let memory: { board: Board; at: number } | null = null;

function readStore(): { board: Board; at: number } | null {
  if (memory) return memory;
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) memory = JSON.parse(raw) as { board: Board; at: number };
  } catch {
    /* no storage — the first read fills memory */
  }
  return memory;
}

function writeStore(board: Board) {
  memory = { board, at: Date.now() };
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(memory));
  } catch {
    /* fine */
  }
}

/** One icon, one plain sentence and one place to do it, per event the quest engine counts. */
const QUEST_META: Record<QuestEvent, { icon: LucideIcon; hint: string; href: string; go: string }> = {
  download_completed: { icon: Download, hint: "Save videos with the Frenzsave downloader.", href: "/", go: "Download" },
  post_engagement: { icon: Heart, hint: "Like or comment on posts in your feed.", href: "/feed", go: "Open feed" },
  ai_video_completed: { icon: Video, hint: "Generate videos with Frenz AI.", href: "/ai", go: "Create" },
  ai_audio_completed: { icon: Music4, hint: "Create voices or audio with Frenz AI.", href: "/ai", go: "Create" },
  ai_video_shared: { icon: Clapperboard, hint: "Share one of your AI videos to AI Reels.", href: "/ai", go: "Open AI" },
  follow: { icon: UserPlus, hint: "Follow people whose posts you enjoy.", href: "/explore", go: "Explore" },
  save: { icon: Bookmark, hint: "Save posts you want to come back to.", href: "/feed", go: "Open feed" },
};

/**
 * What a credit is for — only uses that exist (owner 2026-10-08): every AI tool
 * charges credits, AI plans are paid with them, they move between wallets by
 * wallet number, and only credits earned after approval can be cashed out.
 */
const CREDIT_USES: { icon: LucideIcon; title: string; body: string; href: string }[] = [
  { icon: Lightbulb, title: "Create with Frenz AI", body: "Videos, audio and more.", href: "/ai" },
  { icon: Crown, title: "Explore AI plans", body: "Unlock more each month.", href: "/ai/usage" },
  { icon: Send, title: "Send credits", body: "To a friend's wallet number.", href: "/ai/usage" },
  { icon: Banknote, title: "Withdraw earnings", body: "After approval, earned credits only.", href: "/rewards#withdraw" },
];

const card = "rounded-[1.25rem] bg-card ring-1 ring-inset ring-black/[0.06] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(49,46,129,0.35)] dark:ring-white/10 dark:shadow-none";

export function QuestsPage() {
  // null on the server AND in the first client render (no hydration mismatch); the kept board is painted before the browser shows a frame
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [guest, setGuest] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // server-confirmed news since the last board this screen showed — drives one short highlight
  const [justEarned, setJustEarned] = useState<{ ids: Set<string>; balanceUp: boolean } | null>(null);
  const shown = useRef<Board | null>(null);

  const revalidate = useCallback(async (force = false) => {
    const cached = readStore();
    const periodOver = cached && [cached.board.dayEndsAt, cached.board.weekEndsAt].some((t) => t && Date.parse(t) <= Date.now());
    if (!force && cached && Date.now() - cached.at < STALE_MS && !periodOver) return;
    try {
      const res = await fetch("/api/quests", { cache: "no-store" });
      if (res.status === 401) {
        setGuest(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as Board;
      // only a real change touches the screen
      if (!cached || JSON.stringify(cached.board) !== JSON.stringify(next)) setBoard(next);
      writeStore(next);
      setFailed(false);
    } catch {
      if (!readStore()) setFailed(true);
    }
  }, []);

  useLayoutEffect(() => {
    const kept = readStore();
    if (kept) setBoard(kept.board);
  }, []);

  useEffect(() => {
    void revalidate();
    const onVisible = () => {
      if (document.visibilityState === "visible") void revalidate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [revalidate]);

  // compare against what this screen last showed: a quest that flipped to done, or a balance that rose
  useEffect(() => {
    if (!board) return;
    const prev = shown.current;
    shown.current = board;
    if (!prev) return;
    const was = new Set([...prev.daily, ...prev.weekly].filter((q) => q.completed).map((q) => q.id));
    const ids = new Set([...board.daily, ...board.weekly].filter((q) => q.completed && !was.has(q.id)).map((q) => q.id));
    const balanceUp = !!(prev.wallet && board.wallet && board.wallet.credits > prev.wallet.credits);
    if (!ids.size && !balanceUp) return;
    setJustEarned({ ids, balanceUp });
    haptic("medium");
    const t = window.setTimeout(() => setJustEarned(null), 1600);
    return () => window.clearTimeout(t);
  }, [board]);

  const onPeriodEnd = useCallback(() => void revalidate(true), [revalidate]);
  const retry = async () => {
    setRetrying(true);
    await revalidate(true);
    setRetrying(false);
  };

  const capReached = !!board && board.weeklyCreditCap > 0 && board.weekEarned >= board.weeklyCreditCap;

  return (
    <div className="relative min-h-[100dvh]">
      {/* one static wash — no animation, no blur */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(60%_55%_at_12%_0%,rgba(59,130,246,0.13),transparent_70%),radial-gradient(50%_50%_at_95%_6%,rgba(124,58,237,0.12),transparent_70%)]" />
      <div className="mx-auto max-w-2xl px-4 pt-2" style={{ paddingBottom: "calc(var(--frenz-bottom-nav, 5rem) + 1.5rem)" }}>
        <TapOnceLink href="/rewards" className="-ml-1 inline-flex min-h-[2.75rem] items-center gap-1 rounded-full pl-1 pr-3 text-[14px] font-semibold text-muted-foreground transition-colors hover:text-foreground data-[pending]:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
          <ArrowLeft className="h-[18px] w-[18px]" aria-hidden />
          Rewards
        </TapOnceLink>

        {/* ── Hero: the balance, compact ── */}
        <section aria-labelledby="earn-title" className="mt-1">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-300">Your rewards</p>
          <h1 id="earn-title" className="mt-1 font-brand text-[clamp(1.75rem,8vw,2.15rem)] font-extrabold leading-[1.05] tracking-[-0.04em]">
            Earn more with Frenz.
          </h1>
          <p className="mt-1.5 max-w-md text-[14.5px] leading-snug text-muted-foreground">Complete simple quests, collect credits, and unlock more possibilities.</p>
          <BalanceCard guest={guest} wallet={board ? (board.wallet ?? null) : undefined} pulse={!!justEarned?.balanceUp} />
        </section>

        <CreditUses />

        {guest ? (
          <div className={cn(card, "mt-7 p-5")}>
            <p className="text-[15px] font-semibold">Sign in to see your quests.</p>
            <p className="mt-1 text-[13.5px] text-muted-foreground">Quests earn credits for your account, every day and every week.</p>
            <Link href={`/login?next=${encodeURIComponent("/quests")}`} prefetch={false} className="mt-3 inline-flex min-h-[2.75rem] items-center rounded-full bg-indigo-600 px-5 text-[14px] font-semibold text-white transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:active:scale-100">
              Sign in
            </Link>
          </div>
        ) : !board ? (
          failed ? (
            <div role="alert" className={cn(card, "mt-7 p-5")}>
              <p className="text-[15px] font-semibold">Couldn&apos;t load your quests.</p>
              <p className="mt-1 text-[13.5px] text-muted-foreground">Check your connection and try again. Your credits are safe.</p>
              <button type="button" onClick={() => void retry()} disabled={retrying} className="mt-3 inline-flex min-h-[2.75rem] items-center rounded-full bg-indigo-600 px-5 text-[14px] font-semibold text-white transition disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                {retrying ? "Trying…" : "Try again"}
              </button>
            </div>
          ) : (
            <div className="mt-7 space-y-2.5" aria-busy="true" aria-label="Loading quests">
              <div className="h-[92px] animate-pulse rounded-[1.25rem] bg-slate-900/[0.05] motion-reduce:animate-none dark:bg-white/[0.06]" />
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[104px] animate-pulse rounded-[1.25rem] bg-slate-900/[0.05] motion-reduce:animate-none dark:bg-white/[0.06]" />
              ))}
            </div>
          )
        ) : !board.enabled ? (
          <div className={cn(card, "mt-7 p-5")}>
            <p className="text-[15px] font-semibold">Quests are coming soon.</p>
            <p className="mt-1 text-[13.5px] text-muted-foreground">Meanwhile, earn credits by creating AI videos, sharing them to AI Reels and inviting friends.</p>
            <Link href="/rewards" prefetch={false} className="mt-2 inline-flex min-h-[2.75rem] items-center text-[14px] font-semibold text-indigo-700 dark:text-indigo-300">
              See how to earn
            </Link>
          </div>
        ) : (
          <>
            {board.weeklyCreditCap > 0 ? <WeeklyProgress board={board} reached={capReached} /> : null}
            <QuestSection icon={Sun} title="Daily quests" endsAt={board.dayEndsAt} weekly={false} quests={board.daily} capReached={capReached} justEarned={justEarned?.ids} onPeriodEnd={onPeriodEnd} />
            <QuestSection icon={CalendarDays} title="Weekly quests" endsAt={board.weekEndsAt} weekly quests={board.weekly} capReached={capReached} justEarned={justEarned?.ids} onPeriodEnd={onPeriodEnd} />
            <p className="mt-7 text-[12.5px] leading-relaxed text-muted-foreground">
              Credits are added automatically when a quest is complete, once per quest per period, up to the weekly limit. Quest credits pay for Frenz AI and AI plans. Once your account is approved for withdrawals, credits you earn after that can also be withdrawn.{" "}
              <Link href="/rewards" prefetch={false} className="font-semibold text-indigo-700 dark:text-indigo-300">
                Rewards and withdrawals
              </Link>
            </p>
          </>
        )}
      </div>
      <style>{`
        .earn-pop{animation:earn-pop .9s cubic-bezier(.2,.8,.2,1) both}
        @keyframes earn-pop{0%{transform:scale(1)}30%{transform:scale(1.06)}100%{transform:scale(1)}}
        .earn-glow{animation:earn-glow 1.4s ease-out both}
        @keyframes earn-glow{0%{box-shadow:0 0 0 0 rgba(16,185,129,.45)}100%{box-shadow:0 0 0 14px rgba(16,185,129,0)}}
        @media (prefers-reduced-motion: reduce){.earn-pop,.earn-glow{animation:none}}
        :root[data-a11y-motion="reduce"] .earn-pop,:root[data-a11y-motion="reduce"] .earn-glow{animation:none}
      `}</style>
    </div>
  );
}

/** The balance, from the board. `undefined` = still loading (skeleton), `null` = the read failed (said, never a made-up 0). */
function BalanceCard({ wallet, guest, pulse }: { wallet: Wallet | undefined; guest: boolean; pulse: boolean }) {
  if (guest) return null;
  return (
    <div className="relative mt-4 overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 p-4 text-white shadow-[0_18px_40px_-24px_rgba(67,56,202,0.85)] sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex items-center gap-3.5">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-inset ring-white/25">
          <Gem className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1" aria-live="polite">
          {wallet === undefined ? (
            <>
              <span className="block h-8 w-24 animate-pulse rounded-lg bg-white/20 motion-reduce:animate-none" />
              <span className="mt-1.5 block h-3.5 w-28 animate-pulse rounded bg-white/15 motion-reduce:animate-none" />
              <span className="sr-only">Loading your balance</span>
            </>
          ) : wallet === null ? (
            <>
              <p className="text-[15px] font-semibold">Balance unavailable right now</p>
              <p className="text-[12.5px] text-white/80">Your credits are safe. Check again in a moment.</p>
            </>
          ) : (
            <>
              <p className={cn("font-brand text-[2rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums", pulse && "earn-pop")}>{wallet.credits.toLocaleString("en-US")}</p>
              <p className="mt-1 text-[13px] font-semibold text-white/90">Available credits</p>
            </>
          )}
        </div>
      </div>
      {wallet ? (
        <p className="relative mt-3 border-t border-white/15 pt-2.5 text-[12.5px] leading-snug text-white/85">
          {wallet.withdrawable > 0 ? `${wallet.withdrawable.toLocaleString("en-US")} of these can be withdrawn. The rest pay for Frenz AI.` : "Spend them on any Frenz AI tool or an AI plan."}
        </p>
      ) : null}
    </div>
  );
}

function CreditUses() {
  return (
    <section aria-labelledby="credit-uses" className="mt-7">
      <h2 id="credit-uses" className="text-[16px] font-semibold tracking-[-0.01em]">
        Put your credits to work
      </h2>
      <ul className="mt-3 grid grid-cols-2 gap-2.5 max-[339px]:grid-cols-1">
        {CREDIT_USES.map(({ icon: Icon, title, body, href }) => (
          <li key={title}>
            <Link
              href={href}
              prefetch={false}
              className={cn(card, "group flex h-full min-h-[5.5rem] flex-col gap-2 p-3.5 transition-[transform,box-shadow] duration-150 hover:ring-indigo-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:active:scale-100 dark:hover:ring-indigo-400/30")}
            >
              <span className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-violet-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 dark:from-indigo-500/15 dark:to-violet-500/10 dark:text-indigo-300 dark:ring-indigo-400/20" aria-hidden>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground/70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
              </span>
              <span>
                <span className="block text-[14px] font-semibold leading-tight">{title}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// the weekly quests' own countdown asks for the re-check; this one only shows the time
const noop = () => {};

function WeeklyProgress({ board, reached }: { board: Board; reached: boolean }) {
  const cap = board.weeklyCreditCap;
  const earned = Math.min(board.weekEarned, cap);
  const pct = Math.min(100, Math.round((earned / cap) * 100));
  return (
    <section aria-labelledby="weekly-progress" className={cn(card, "mt-7 p-4")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="weekly-progress" className="text-[16px] font-semibold tracking-[-0.01em]">
          Your weekly progress
        </h2>
        <span className="text-[12px] text-muted-foreground">
          Resets in <Countdown iso={board.weekEndsAt} onEnd={noop} />
        </span>
      </div>
      <p className="mt-2 text-[14px]">
        <span className="font-brand text-[1.35rem] font-bold tabular-nums tracking-[-0.03em]">{earned}</span>
        <span className="text-muted-foreground"> of {cap} credits earned this week</span>
      </p>
      <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-slate-900/[0.07] dark:bg-white/10" role="progressbar" aria-label="Quest credits this week" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={earned} aria-valuetext={`${earned} of ${cap} credits`}>
        {/* mounts at its real width (no fill-from-zero on entry); only a later change animates */}
        <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", reached ? "bg-emerald-500" : "bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500")} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
        {reached ? (
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> Weekly limit reached. Quests pay again after the reset.
          </span>
        ) : (
          `Up to ${cap - earned} more quest credits this week.`
        )}
      </p>
    </section>
  );
}

function QuestSection({ icon: Icon, title, endsAt, weekly, quests, capReached, justEarned, onPeriodEnd }: { icon: LucideIcon; title: string; endsAt: string | null; weekly: boolean; quests: QuestView[]; capReached: boolean; justEarned?: Set<string>; onPeriodEnd: () => void }) {
  if (!quests.length) return null;
  const done = quests.filter((q) => q.completed).length;
  const open = quests.filter((q) => !q.completed).reduce((s, q) => s + q.credits, 0);
  return (
    <section aria-label={title} className="mt-7">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="inline-flex items-center gap-1.5 text-[16px] font-semibold tracking-[-0.01em]">
            <Icon className="h-[18px] w-[18px] text-indigo-600 dark:text-indigo-300" aria-hidden />
            {title}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground/80">
              {done} of {quests.length} done
            </span>
            {open > 0 && !capReached ? ` · ${open} credits left to earn` : ""}
          </p>
        </div>
        <ResetLabel iso={endsAt} weekly={weekly} onEnd={onPeriodEnd} />
      </div>
      <ul className="mt-3 space-y-2.5">
        {quests.map((q) => (
          <QuestCard key={q.id} q={q} capReached={capReached} fresh={!!justEarned?.has(q.id)} />
        ))}
      </ul>
    </section>
  );
}

const QuestCard = memo(function QuestCard({ q, capReached, fresh }: { q: QuestView; capReached: boolean; fresh: boolean }) {
  const meta = QUEST_META[q.event] ?? { icon: Lightbulb, hint: "", href: "/", go: "Open" };
  const Icon = meta.icon;
  const pct = q.target > 0 ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0;
  const blocked = !q.completed && capReached;
  return (
    <li className={cn(card, "p-3.5", q.completed && "bg-emerald-50/70 ring-emerald-500/25 dark:bg-emerald-500/[0.07]", fresh && "earn-glow")}>
      <div className="flex items-start gap-3">
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", q.completed ? "bg-emerald-500 text-white" : "bg-gradient-to-br from-blue-50 to-violet-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 dark:from-indigo-500/15 dark:to-violet-500/10 dark:text-indigo-300 dark:ring-indigo-400/20")} aria-hidden>
          {q.completed ? <Check className="h-5 w-5" strokeWidth={3} /> : <Icon className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className={cn("text-[14.5px] font-semibold leading-snug", q.completed && "text-foreground/70")}>{q.title}</h3>
            {/* a completed quest shows no amount: under the weekly cap SQL may have paid less than the list price (0194 quest_record) */}
            {q.completed ? null : (
              <span className="shrink-0 rounded-full bg-indigo-600/10 px-2 py-0.5 text-[12px] font-bold tabular-nums text-indigo-700 dark:text-indigo-300">
                +{q.credits} {q.credits === 1 ? "credit" : "credits"}
              </span>
            )}
          </div>
          {meta.hint ? <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{meta.hint}</p> : null}
          <div className="mt-2.5 flex items-center gap-2.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-900/[0.07] dark:bg-white/10" role="progressbar" aria-label={`${q.title} progress`} aria-valuemin={0} aria-valuemax={q.target} aria-valuenow={q.progress} aria-valuetext={`${q.progress} of ${q.target}`}>
              <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", q.completed ? "bg-emerald-500" : "bg-gradient-to-r from-blue-600 to-violet-500")} style={{ width: `${q.completed ? 100 : pct}%` }} />
            </div>
            <span className="shrink-0 text-[12px] font-semibold tabular-nums text-muted-foreground">
              {q.progress}/{q.target}
            </span>
          </div>
          <div className="mt-2 flex min-h-[2rem] items-center justify-between gap-2">
            {q.completed ? (
              <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> Completed
              </span>
            ) : blocked ? (
              <span className="text-[12.5px] font-medium text-muted-foreground">Weekly limit reached. Available again after the reset.</span>
            ) : (
              <>
                <span className="text-[12.5px] text-muted-foreground">{q.progress > 0 ? `${q.target - q.progress} to go` : "Not started"}</span>
                <Link href={meta.href} prefetch={false} className="-mr-1 inline-flex min-h-[2.25rem] items-center gap-0.5 rounded-full px-2.5 text-[13px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-600/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-indigo-300">
                  {meta.go}
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
});

/** "Resets 1:00 AM" in the viewer's OWN clock (the server's period end, formatted locally), plus the countdown. */
function ResetLabel({ iso, weekly, onEnd }: { iso: string | null; weekly: boolean; onEnd: () => void }) {
  if (!iso) return null;
  const at = new Date(iso);
  const when = Number.isNaN(at.getTime()) ? "" : weekly ? at.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <span className="shrink-0 text-right text-[12px] leading-tight text-muted-foreground">
      Resets in <Countdown iso={iso} onEnd={onEnd} />
      {when ? <span className="block text-[11.5px]">{when}</span> : null}
    </span>
  );
}

/** Its own once-a-minute tick, so only this text re-renders; asks the page to re-check once when the period ends. */
function Countdown({ iso, onEnd }: { iso: string | null; onEnd: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const end = iso ? Date.parse(iso) : NaN;
  useEffect(() => {
    if (Number.isFinite(end) && end <= now && !fired.current) {
      fired.current = true;
      onEnd();
    }
    if (Number.isFinite(end) && end > now) fired.current = false;
  }, [end, now, onEnd]);
  if (!Number.isFinite(end)) return null;
  const ms = end - now;
  if (ms <= 0) return <span className="font-semibold tabular-nums text-foreground/80">now</span>;
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return <span className="font-semibold tabular-nums text-foreground/80">{d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${Math.max(1, mm)}m`}</span>;
}
