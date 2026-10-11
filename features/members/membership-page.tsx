"use client";

import { ArrowLeft, ArrowRight, BadgeCheck, Check, Crown, ExternalLink, Loader2, Lock, Sparkles, Star } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { AmbientWash, GLASS, GlassGroup, PersonAvatar, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import { useStickyState } from "@/features/ui/use-sticky-state";
import { haptic } from "@/lib/motion/haptics";
import { FEEDBACK_ASPECTS, MEMBER_ROLES, RECOGNITIONS, SPONSOR_KINDS, usd, type FeedbackAspect } from "@/lib/creator/membership/engine";
import type { CreatorPage, Membership } from "@/lib/creator/membership/server";
import { cn } from "@/lib/utils";

/**
 * A creator's membership page (Feature 19 · Part 13).
 *
 * Two ways in, and they are different things:
 *   · the FREE community — join and leave on the tap;
 *   · a paid SUB subscription — real money through Paystack (owner brief
 *     2026-10-11), the creator's price plus the purchase fee, shown in full
 *     before anyone pays. It unlocks the creator's SUB POSTS for the period
 *     and never renews by itself. Access comes only from Paystack's verified
 *     charge, so this page never draws "subscribed" ahead of the server.
 */

async function post(body: Record<string, unknown>): Promise<{ error: string | null; data: Record<string, unknown> | null }> {
  const res = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as Record<string, unknown> | null;
  if (res?.ok) return { error: null, data };
  return { error: (data?.error as string | undefined) ?? (res ? "Couldn't do that." : "You're offline."), data: null };
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

export function MembershipPage({ data }: { data: CreatorPage }) {
  const [membership, setMembership] = useStickyState<Membership | null>(`mp-${data.creator.id}`, data.loadedAt, data.viewer.membership);
  const mRef = useRef(membership);
  mRef.current = membership;
  const [busy, setBusy] = useState<"join" | "sub" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const c = data.creator;
  const current = !!membership?.current;
  const isSub = membership?.billing === "sub";
  const subTab = `/u/${c.handle}?tab=sub`;

  const join = async () => {
    haptic("selection");
    setBusy("join");
    setNote(null);
    const out = await post({ op: "join", creatorId: c.id });
    setBusy(null);
    if (out.error) return setNote(out.error);
    setMembership(out.data?.membership as Membership);
    setNote(`You're a member of ${c.displayName}'s community.`);
  };

  /** Drawn on the tap, put back on refusal. Only a free membership is left this way. */
  const leaveNow = async () => {
    const before = mRef.current;
    if (!before) return;
    haptic("selection");
    setMembership({ ...before, status: "ended", current: false });
    const out = await post({ op: "leave", creatorId: c.id });
    if (out.error) {
      setMembership(before);
      setNote(out.error);
    }
  };

  const subscribe = async () => {
    haptic("selection");
    setBusy("sub");
    setNote(null);
    const res = await fetch("/api/sub/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId: c.id, returnPath: subTab }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (res?.ok && j?.url) {
      window.location.assign(j.url);
      return;
    }
    setBusy(null);
    setNote(j?.error ?? "Couldn't open the payment. Try again.");
  };

  return (
    <div className="relative isolate">
      <AmbientWash />
      <header className="mb-5 flex items-start gap-2 pt-1">
        <Link href={`/u/${c.handle}`} aria-label="Back to profile" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] active:bg-black/[0.08]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PersonAvatar user={c} size={52} />
          <div className="min-w-0">
            <h1 className="flex items-center gap-1 text-[22px] font-extrabold leading-tight tracking-[-0.03em]">
              <span className="truncate">{c.displayName}</span>
              {c.verified ? <BadgeCheck className="h-5 w-5 shrink-0 text-primary" aria-label="Verified" /> : null}
            </h1>
            <p className="text-[13.5px] text-muted-foreground">Membership</p>
          </div>
        </div>
      </header>

      <div aria-live="polite">{note ? <p className={cn("mb-4 rounded-2xl px-3.5 py-2.5 text-[13.5px]", GLASS)}>{note}</p> : null}</div>

      {/* The member card */}
      {current && membership ? (
        <section aria-label="Your membership" className="mb-6 overflow-hidden rounded-[24px] bg-gradient-to-br from-slate-900 via-indigo-950 to-violet-900 p-5 text-white shadow-[0_18px_40px_-20px_rgba(49,46,129,0.8)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-white/60">{MEMBER_ROLES[membership.role]}</p>
              <p className="mt-1 text-[20px] font-bold leading-tight">{isSub ? "Subscriber" : "Community member"}</p>
              <p className="mt-0.5 text-[13px] text-white/70">{c.displayName}</p>
            </div>
            <Crown className="h-6 w-6 text-amber-300" aria-hidden />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-[12.5px]">
            <div>
              <dt className="text-white/55">Member since</dt>
              <dd className="font-semibold" suppressHydrationWarning>
                {fmtDate(membership.joinedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-white/55">{isSub ? "Access until" : "Membership"}</dt>
              <dd className="font-semibold" suppressHydrationWarning>
                {isSub && membership.periodEnd ? fmtDate(membership.periodEnd) : "Free"}
              </dd>
            </div>
          </dl>
          {data.viewer.milestone ? (
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[12.5px] font-semibold">
              <Sparkles className="h-3.5 w-3.5 text-amber-300" aria-hidden /> {data.viewer.milestone.label}
            </p>
          ) : null}
          {data.viewer.recognitions.length ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {data.viewer.recognitions.map((r) => (
                <li key={r} className="inline-flex items-center gap-1 rounded-full bg-amber-300/15 px-2.5 py-1 text-[12px] font-semibold text-amber-200">
                  <Star className="h-3 w-3" aria-hidden /> {RECOGNITIONS[r]}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            {isSub ? (
              <Link href={subTab} prefetch={false} className="inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-indigo-800 transition active:scale-[0.97] motion-reduce:active:scale-100">
                Open SUB POSTS <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            ) : (
              <button type="button" onClick={() => void leaveNow()} className="inline-flex min-h-[2.5rem] items-center rounded-full bg-white/12 px-4 text-[13px] font-semibold text-white transition active:scale-[0.97] motion-reduce:active:scale-100">
                Leave
              </button>
            )}
          </div>
          {isSub ? <p className="mt-3 text-[11.5px] text-white/50">Subscriptions never renew by themselves. Subscribe again when this one ends to keep access.</p> : null}
        </section>
      ) : null}

      {data.welcome ? <p className={cn("mb-6 whitespace-pre-line rounded-[22px] px-4 py-3.5 text-[14.5px] leading-relaxed", GLASS)}>{data.welcome}</p> : null}

      {/* Notes for members */}
      {current && data.viewer.notes.length ? (
        <section className="mb-6" aria-labelledby="mp-notes">
          <SectionHeader id="mp-notes" title="For members" />
          <GlassGroup label="Notes for members">
            {data.viewer.notes.map((n) => (
              <li key={n.id} className="px-3.5 py-3">
                <p className="whitespace-pre-line text-[14.5px] leading-relaxed">{n.body}</p>
                <p className="mt-1 text-[12px] text-muted-foreground" suppressHydrationWarning>
                  {fmtDate(n.createdAt)}
                </p>
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      {/* The two ways in */}
      <section className="mb-6" aria-labelledby="mp-offers">
        <SectionHeader id="mp-offers" title="Ways to support" />
        {!data.ready ? (
          <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>Memberships arrive with the next update.</p>
        ) : !data.open && !data.quote ? (
          <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>{data.viewer.isCreator ? "Nothing is open yet. Turn on your free community in Members, or set up SUB from the SUB POSTS tab on your profile." : `${c.displayName} isn't taking members right now.`}</p>
        ) : (
          <div className="grid gap-3">
            {data.quote ? (
              <article className={cn("rounded-[22px] px-4 py-4", GLASS, current && isSub && "ring-2 ring-primary/50")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="inline-flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-indigo-600 dark:text-indigo-400">
                      <Lock className="h-3 w-3" aria-hidden /> Paid subscription
                    </p>
                    <h3 className="text-[17px] font-bold leading-tight">SUB POSTS</h3>
                  </div>
                  <p className="shrink-0 text-right text-[14px] font-bold">{usd(data.quote.priceCents)} / {data.quote.periodDays} days</p>
                </div>
                <p className="mt-2 text-[13.5px] text-foreground/80">
                  {c.displayName}&apos;s subscriber-only photos and videos. Private: they can&apos;t be shared, linked or downloaded.
                </p>
                <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                  {usd(data.quote.priceCents)} + {usd(data.quote.feeCents)} purchase fee ({data.quote.feePercent}%) = <b className="text-foreground">{usd(data.quote.totalCents)}</b>, paid through Paystack. No automatic renewal.
                </p>
                <div className="mt-3.5">
                  {data.viewer.isCreator ? null : !data.viewer.signedIn ? (
                    <Link href={`/login?next=${encodeURIComponent(`/u/${c.handle}/membership`)}`} prefetch={false} className={primaryPill}>
                      Sign in to subscribe
                    </Link>
                  ) : current && isSub ? (
                    <span className={cn(quietPill, "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
                      <Check className="h-4 w-4" aria-hidden /> Subscribed
                    </span>
                  ) : (
                    <button type="button" className={cn(primaryPill, "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600")} disabled={!!busy} onClick={() => void subscribe()}>
                      {busy === "sub" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                      {busy === "sub" ? "Opening Paystack…" : `Subscribe for ${usd(data.quote.totalCents)}`}
                    </button>
                  )}
                </div>
              </article>
            ) : null}
            {data.open ? (
              <article className={cn("rounded-[22px] px-4 py-4", GLASS, current && !isSub && "ring-2 ring-primary/50")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Community</p>
                    <h3 className="text-[17px] font-bold leading-tight">Free membership</h3>
                  </div>
                  <p className="shrink-0 text-right text-[14px] font-bold">Free</p>
                </div>
                <p className="mt-2 text-[13.5px] text-foreground/80">Join {c.displayName}&apos;s community for notes and updates for members.</p>
                <div className="mt-3.5">
                  {data.viewer.isCreator ? null : !data.viewer.signedIn ? (
                    <Link href={`/login?next=${encodeURIComponent(`/u/${c.handle}/membership`)}`} prefetch={false} className={quietPill}>
                      Sign in to join
                    </Link>
                  ) : current ? (
                    <span className={cn(quietPill, "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
                      <Check className="h-4 w-4" aria-hidden /> {isSub ? "Included" : "You're a member"}
                    </span>
                  ) : (
                    <button type="button" className={quietPill} disabled={!!busy} onClick={() => void join()}>
                      {busy === "join" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                      {busy === "join" ? "Joining…" : "Join free"}
                    </button>
                  )}
                </div>
              </article>
            ) : null}
          </div>
        )}
      </section>

      {/* Sponsors: always disclosed */}
      {data.sponsors.length ? (
        <section className="mb-6" aria-labelledby="mp-sponsors">
          <SectionHeader id="mp-sponsors" title="Sponsors and partners" />
          <GlassGroup label="Sponsors and partners">
            {data.sponsors.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold">{s.name}</span>
                  <span className="block text-[12px] text-muted-foreground">{SPONSOR_KINDS[s.kind]}</span>
                </span>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="nofollow noopener noreferrer sponsored" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-black/[0.04] active:bg-black/[0.08]" aria-label={`Visit ${s.name}`}>
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </a>
                ) : null}
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      {/* Private rating of the creator — anyone who has been a member */}
      {membership && data.viewer.signedIn && !data.viewer.isCreator && membership.status !== "removed" ? <Feedback creatorId={c.id} name={c.displayName} initial={data.viewer.feedback ?? {}} /> : null}
    </div>
  );
}

function Feedback({ creatorId, name, initial }: { creatorId: string; name: string; initial: Partial<Record<FeedbackAspect, number | null>> }) {
  const [v, setV] = useState(initial);
  const vRef = useRef(v);
  vRef.current = v;
  const rate = async (aspect: FeedbackAspect, n: number) => {
    const before = vRef.current;
    haptic("selection");
    setV({ ...before, [aspect]: n });
    const res = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "feedback", creatorId, [aspect]: n }) }).catch(() => null);
    if (!res?.ok) setV(before);
  };
  return (
    <section className="mb-8" aria-labelledby="mp-feedback">
      <SectionHeader id="mp-feedback" title={`Rate ${name}, privately`} />
      <div className={cn("rounded-[22px] px-3.5 py-3", GLASS)}>
        <p className="text-[12.5px] text-muted-foreground">They see only averages, and only once five members have answered. Never who said what.</p>
        <ul className="mt-2 space-y-2">
          {(Object.keys(FEEDBACK_ASPECTS) as FeedbackAspect[]).map((a) => (
            <li key={a} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[14px]">{FEEDBACK_ASPECTS[a]}</span>
              <span className="flex gap-1" role="radiogroup" aria-label={FEEDBACK_ASPECTS[a]}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={v[a] === n} aria-label={`${n} of 5`} onClick={() => void rate(a, n)} className={cn("h-9 w-9 rounded-full text-[13px] font-semibold transition active:scale-95 motion-reduce:active:scale-100", (v[a] ?? 0) >= n ? "bg-primary text-primary-foreground" : "bg-black/[0.05] dark:bg-white/[0.08]")}>
                    {n}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
