import { ArrowLeft, Award, Check, ChevronRight, Info, RotateCcw, Scale, ShieldCheck, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { reputationFor, transparencyFor } from "@/lib/trust/server";
import { LEVELS } from "@/lib/trust/reputation";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reputation & transparency", robots: { index: false, follow: false } };

const GLASS = "border border-black/[0.06] bg-card/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur dark:border-white/[0.08]";

/**
 * /account/reputation — Relationship Reputation™ and the Transparency Center™
 * (Feature 19 · Part 16). Server-rendered, private to the member. A level (a
 * title, never a number), earned badges with why, strengths, what would help,
 * the recovery that applies, and every decision on the account with its reason,
 * the rule, and how to appeal.
 */
export default async function ReputationRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/reputation");
  const [rep, decisions] = await Promise.all([reputationFor(user.id), transparencyFor(user.id)]);
  const idx = rep ? LEVELS.indexOf(rep.level) : 0;
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <header className="mb-4 flex items-start gap-2 pt-1">
        <Link href="/account" prefetch={false} aria-label="Back" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] active:bg-black/[0.08]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div>
          <h1 className="text-[clamp(1.6rem,7vw,2rem)] font-extrabold leading-none tracking-[-0.04em]">Reputation</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">Built on trust and contribution. Followers, likes and views never count.</p>
        </div>
      </header>

      {rep ? (
        <>
          <section aria-label="Your level" className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-slate-900 via-indigo-950 to-violet-900 px-5 py-5 text-white">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/60">Your standing</p>
            <p className="mt-1 text-[1.8rem] font-extrabold tracking-[-0.03em]">{rep.level}</p>
            <p className="mt-1 text-[13.5px] text-white/80">{rep.levelWhy}</p>
            <ol className="mt-4 flex gap-1" aria-label="Levels">
              {LEVELS.map((l, i) => (
                <li key={l} className="flex-1" title={l} aria-current={i === idx ? "step" : undefined}>
                  <span className={cn("block h-1.5 rounded-full", i <= idx ? "bg-gradient-to-r from-amber-300 to-amber-200" : "bg-white/15")} />
                  <span className="sr-only">{l}</span>
                </li>
              ))}
            </ol>
            <p className="mt-1.5 text-[11.5px] text-white/55">{LEVELS.join(" · ")}</p>
          </section>

          {rep.badges.length ? (
            <section className="mt-5" aria-labelledby="rep-badges">
              <h2 id="rep-badges" className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
                Earned badges
              </h2>
              <ul className={cn("divide-y divide-border/60 overflow-hidden rounded-[22px]", GLASS)}>
                {rep.badges.map((b) => (
                  <li key={b.key} className="flex items-start gap-3 px-3.5 py-3">
                    <Award className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
                    <span>
                      <span className="block text-[14.5px] font-semibold">{b.label}</span>
                      <span className="block text-[12.5px] text-muted-foreground">{b.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-5 grid gap-3 sm:grid-cols-2" aria-label="Strengths and suggestions">
            <div className={cn("rounded-[22px] px-4 py-3.5", GLASS)}>
              <p className="flex items-center gap-1.5 text-[13.5px] font-bold">
                <Sparkles className="h-4 w-4 text-emerald-600" aria-hidden /> Strengths
              </p>
              {rep.strengths.length ? (
                <ul className="mt-1.5 space-y-1 text-[13px]">
                  {rep.strengths.map((s) => (
                    <li key={s} className="flex gap-1.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden /> {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-[13px] text-muted-foreground">They&apos;ll show here as you take part.</p>
              )}
            </div>
            <div className={cn("rounded-[22px] px-4 py-3.5", GLASS)}>
              <p className="flex items-center gap-1.5 text-[13.5px] font-bold">
                <Info className="h-4 w-4 text-indigo-600" aria-hidden /> What would help
              </p>
              {rep.improvements.length ? (
                <ul className="mt-1.5 space-y-1 text-[13px] text-muted-foreground">
                  {rep.improvements.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-[13px] text-muted-foreground">Nothing — keep doing what you&apos;re doing.</p>
              )}
            </div>
          </section>

          {rep.recovery.length ? (
            <section className={cn("mt-3 rounded-[22px] px-4 py-3.5", GLASS)} aria-label="Recovery">
              <p className="flex items-center gap-1.5 text-[13.5px] font-bold">
                <RotateCcw className="h-4 w-4 text-sky-600" aria-hidden /> Recovery
              </p>
              <ul className="mt-1.5 space-y-1 text-[13px] text-muted-foreground">
                {rep.recovery.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      <section id="transparency" className="mt-7 scroll-mt-24" aria-labelledby="rep-tc">
        <h2 id="rep-tc" className="mb-1 flex items-center gap-1.5 px-1 text-[17px] font-extrabold tracking-[-0.02em]">
          <Scale className="h-5 w-5 text-indigo-600" aria-hidden /> Transparency Center
        </h2>
        <p className="mb-2 px-1 text-[12.5px] text-muted-foreground">Every decision on your account: why, which rule, and what you can do.</p>
        {decisions.length ? (
          <ul className="space-y-2">
            {decisions.map((d) => (
              <li key={d.id} className={cn("rounded-[20px] px-4 py-3", GLASS)}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[14.5px] font-semibold">{d.title}</p>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", d.status === "in effect" ? "bg-rose-500/10 text-rose-600" : d.status === "under review" ? "bg-sky-500/10 text-sky-700" : "bg-emerald-500/10 text-emerald-700")}>{d.status}</span>
                </div>
                <p className="mt-1 text-[13px] text-muted-foreground">{d.why}</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Rule: {d.policy}
                  {d.at ? ` · ${new Date(d.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                </p>
                {d.improve ? <p className="mt-1 text-[12.5px]">{d.improve}</p> : null}
                {d.appealHref ? (
                  <Link href={d.appealHref} prefetch={false} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-primary">
                    Appeal or ask for a review <ChevronRight className="h-4 w-4" aria-hidden />
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={cn("flex items-center gap-2 rounded-[20px] px-4 py-4 text-[13.5px]", GLASS)}>
            <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden /> No decisions have been made on your account. You&apos;re in good standing.
          </p>
        )}
      </section>
    </div>
  );
}
