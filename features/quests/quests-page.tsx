"use client";

import { ArrowLeft, Bookmark, CalendarDays, Check, Clapperboard, Download, Heart, Music4, Sparkles, Sun, Trophy, UserPlus, Video } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import type { QuestBoard, QuestEvent, QuestView } from "@/lib/rewards/quests";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EARN CREDITS — daily and weekly quests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07: "professional, fast, never reloads unless there is a
 * change in the data and needs revalidation … never reload on backswipe or
 * entry … light but glass design … 10% like a game quest."
 *
 * ── Never a reload for nothing ─────────────────────────────────────────────
 * The board is kept in memory (and in sessionStorage across a PWA resume).
 * Entry and back-swipe paint it at once; a quiet re-check runs only when it is
 * older than STALE_MS, when a period has just ended, or when the app comes back
 * to the foreground after a while — and the screen changes only if the answer
 * differs. No spinner after the first visit, ever.
 *
 * ── 10% game ───────────────────────────────────────────────────────────────
 * Segmented progress, a credit chip per quest, a trophy for a finished one and
 * the week's cap as a meter — and otherwise the Frenz AI glass system, quiet.
 */
const STALE_MS = 45_000;
const STORE_KEY = "frenz:quests:v1";

let memory: { board: QuestBoard; at: number } | null = null;

function readStore(): { board: QuestBoard; at: number } | null {
  if (memory) return memory;
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) memory = JSON.parse(raw) as { board: QuestBoard; at: number };
  } catch {
    /* no storage — the first read fills memory */
  }
  return memory;
}

function writeStore(board: QuestBoard) {
  memory = { board, at: Date.now() };
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(memory));
  } catch {
    /* fine */
  }
}

const ICON: Record<QuestEvent, typeof Download> = {
  download_completed: Download,
  ai_video_completed: Video,
  ai_audio_completed: Music4,
  ai_video_shared: Clapperboard,
  post_engagement: Heart,
  follow: UserPlus,
  save: Bookmark,
};

function until(iso: string | null, now: number): string {
  if (!iso) return "";
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${Math.max(1, mm)}m`;
}

export function QuestsPage() {
  // null on the server AND in the first client render (no hydration mismatch); the kept board is painted before the browser shows a frame
  const [board, setBoard] = useState<QuestBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [guest, setGuest] = useState(false);
  const [now, setNow] = useState(() => Date.now());

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
      const next = (await res.json()) as QuestBoard;
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
    // the countdowns move once a minute — no per-second render
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(tick);
    };
  }, [revalidate]);

  // a period that ends while the page is open is a real change — ask once
  useEffect(() => {
    if (!board) return;
    if ([board.dayEndsAt, board.weekEndsAt].some((t) => t && Date.parse(t) <= now)) void revalidate(true);
  }, [board, now, revalidate]);

  return (
    <div className="relative min-h-[100dvh]">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[460px] bg-[radial-gradient(55%_50%_at_10%_0%,rgba(59,130,246,0.15),transparent_70%),radial-gradient(50%_45%_at_95%_8%,rgba(139,92,246,0.15),transparent_70%)]" />
      <div className="mx-auto max-w-2xl px-4 pb-16 pt-3">
        <Link href="/rewards" prefetch={false} className="inline-flex min-h-[2.75rem] items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Rewards
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <span className="quest-badge flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 via-orange-400 to-rose-400 text-white shadow-[0_10px_24px_-12px_rgba(249,115,22,0.9)]">
            <Trophy className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-[26px] font-bold leading-tight tracking-[-0.03em] text-transparent">Earn credits</h1>
            <p className="text-[13px] text-muted-foreground">Finish quests to earn AI credits.</p>
          </div>
        </div>

        {guest ? (
          <div className="ai-glass mt-6 rounded-[1.6rem] p-5 text-slate-900 ring-1 ring-inset ring-white/70">
            <p className="text-[15px] font-semibold">Sign in to see your quests.</p>
            <p className="mt-1 text-[13px] text-slate-500">Quests earn credits for your account — daily and weekly.</p>
            <Link href={`/login?next=${encodeURIComponent("/quests")}`} prefetch={false} className="mt-3 inline-flex text-[13px] font-semibold text-indigo-700">Sign in</Link>
          </div>
        ) : !board ? (
          failed ? (
            <p className="mt-6 text-[13.5px] text-muted-foreground">Couldn&apos;t load your quests. Check your connection and try again.</p>
          ) : (
            <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading quests">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[84px] animate-pulse rounded-[1.4rem] bg-slate-900/[0.05] motion-reduce:animate-none" />
              ))}
            </div>
          )
        ) : !board.enabled ? (
          <div className="ai-glass mt-6 rounded-[1.6rem] p-5 text-slate-900 ring-1 ring-inset ring-white/70">
            <p className="text-[15px] font-semibold">Quests are coming soon.</p>
            <p className="mt-1 text-[13px] text-slate-500">Meanwhile, earn credits by creating AI videos, sharing them to AI Reels and inviting friends.</p>
            <Link href="/rewards" prefetch={false} className="mt-3 inline-flex text-[13px] font-semibold text-indigo-700">See how to earn</Link>
          </div>
        ) : (
          <>
            {/* the week's limit, as a meter */}
            {board.weeklyCreditCap > 0 ? (
              <div className="ai-glass mt-5 rounded-[1.4rem] px-4 py-3 text-slate-900 ring-1 ring-inset ring-white/70">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="font-semibold">This week&apos;s quest credits</span>
                  <span className="tabular-nums font-semibold">
                    {Math.min(board.weekEarned, board.weeklyCreditCap)} / {board.weeklyCreditCap}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-900/[0.07]" role="progressbar" aria-label="Quest credits this week" aria-valuemin={0} aria-valuemax={board.weeklyCreditCap} aria-valuenow={Math.min(board.weekEarned, board.weeklyCreditCap)}>
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${Math.min(100, Math.round((board.weekEarned / board.weeklyCreditCap) * 100))}%` }} />
                </div>
              </div>
            ) : null}

            <QuestSection icon={<Sun className="h-4 w-4" aria-hidden />} title="Daily quests" resets={`Resets in ${until(board.dayEndsAt, now)} · 1:00 AM Lagos`} quests={board.daily} />
            <QuestSection icon={<CalendarDays className="h-4 w-4" aria-hidden />} title="Weekly quests" resets={`Resets in ${until(board.weekEndsAt, now)} · Sunday 1:00 AM Lagos`} quests={board.weekly} />

            <p className="mt-6 text-[12.5px] leading-relaxed text-muted-foreground">
              Quest credits pay for AI videos, AI audio and AI plans. Once your account is approved for withdrawals, the credits you earn after that can also be withdrawn.{" "}
              <Link href="/rewards" prefetch={false} className="font-semibold text-indigo-700">Rewards</Link>
            </p>
          </>
        )}
      </div>
      <style>{`
        .quest-badge{animation:quest-badge-in .5s cubic-bezier(.2,.9,.3,1.4) both}
        @keyframes quest-badge-in{from{transform:scale(.7) rotate(-10deg);opacity:0}to{transform:none;opacity:1}}
        @media (prefers-reduced-motion: reduce){.quest-badge{animation:none}}
        :root[data-a11y-motion="reduce"] .quest-badge{animation:none}
      `}</style>
    </div>
  );
}

function QuestSection({ icon, title, resets, quests }: { icon: React.ReactNode; title: string; resets: string; quests: QuestView[] }) {
  if (!quests.length) return null;
  const done = quests.filter((q) => q.completed).length;
  return (
    <section aria-label={title} className="mt-6">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="inline-flex items-center gap-1.5 text-[15px] font-semibold">
          {icon}
          {title}
          <span className="ml-1 rounded-full bg-slate-900/[0.06] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
            {done}/{quests.length}
          </span>
        </h2>
        <span className="text-[11.5px] text-muted-foreground">{resets}</span>
      </div>
      <ul className="mt-2 space-y-2.5">
        {quests.map((q) => (
          <QuestCard key={q.id} q={q} />
        ))}
      </ul>
    </section>
  );
}

function QuestCard({ q }: { q: QuestView }) {
  const Icon = ICON[q.event] ?? Sparkles;
  const segments = Math.min(q.target, 10);
  const filled = q.target <= 10 ? q.progress : Math.round((q.progress / q.target) * 10);
  return (
    <li className={cn("ai-glass flex items-center gap-3 rounded-[1.4rem] p-3.5 text-slate-900 ring-1 ring-inset", q.completed ? "ring-emerald-400/40" : "ring-white/70")}>
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", q.completed ? "bg-emerald-500 text-white" : "bg-gradient-to-br from-blue-600/10 to-violet-600/10 text-indigo-600")}>
        {q.completed ? <Check className="h-5 w-5" strokeWidth={3} aria-hidden /> : <Icon className="h-5 w-5" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("text-[14px] font-semibold leading-snug", q.completed && "text-slate-500")}>{q.title}</p>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold tabular-nums", q.completed ? "bg-emerald-500/12 text-emerald-700" : "bg-amber-400/15 text-amber-700")}>
            {q.completed ? "Earned" : `+${q.credits}`}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex flex-1 gap-1" role="progressbar" aria-label={`${q.title} progress`} aria-valuemin={0} aria-valuemax={q.target} aria-valuenow={q.progress}>
            {Array.from({ length: segments }, (_, i) => (
              <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < filled ? (q.completed ? "bg-emerald-500" : "bg-gradient-to-r from-blue-600 to-violet-500") : "bg-slate-900/[0.08]")} />
            ))}
          </div>
          <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-slate-500">
            {q.progress}/{q.target}
          </span>
        </div>
      </div>
    </li>
  );
}
