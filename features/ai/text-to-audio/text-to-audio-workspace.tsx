"use client";

import { AudioLines, Check, Gift, Loader2, Mic, RefreshCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AudioAssetPlayer } from "@/features/ai/text-to-audio/audio-player";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { AiPlansSheet } from "@/features/ai/credits/ai-plans-sheet";
import { useTextToAudio } from "@/features/ai/text-to-audio/use-text-to-audio";
import { getAiCredits } from "@/lib/ai/credits/client";
import type { AiPlansPublic } from "@/lib/ai/credits/config";
import { formatCents } from "@/lib/ai/economy";
import { isActiveStatus, type AiJobView } from "@/lib/ai/jobs";
import { track } from "@/lib/analytics/client";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT TO AUDIO — the standalone workspace
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: "a dedicated Text to Audio tool: the user types or pastes
 * text, chooses a voice, generates audio, previews it, downloads it or saves
 * it to an Audio Library with a name — and can then use it in Lip Sync Pro.
 * This must NEVER go through a video pipeline." So there is no upload, no
 * video, no scope and no lip sync on this page:
 *
 *   1  Your text          the box, the counter, the month's free characters
 *   2  Voice & language   the catalogue's rows only (a model is never named)
 *   3  Name it            what the Audio Library will call it
 *   4  The estimate       free characters used, what is billable, the total
 *      Generate           → the four words while it runs → the player
 *
 * The finished audio plays here, downloads from here, and carries one link
 * onward: "Use in Lip Sync Pro", which opens that tool with this audio
 * already chosen — and the brief's rule that it is NOT charged again.
 */
export function TextToAudioWorkspace({ basePath, aiHref, libraryHref, lipSyncHref, historyHref, usageHref, initialJobId = null }: { basePath: string; aiHref: string; libraryHref: string; lipSyncHref: string; historyHref: string; usageHref: string; initialJobId?: string | null }) {
  const ws = useTextToAudio({ initialJobId });
  const cfg = ws.config?.config ?? null;
  const symbol = cfg?.symbol ?? "$";
  const [plansSheet, setPlansSheet] = useState(false);
  const [plansCatalogue, setPlansCatalogue] = useState<AiPlansPublic | null>(null);
  const openPlans = useCallback(() => {
    haptic("medium");
    setPlansSheet(true);
    if (!plansCatalogue) void getAiCredits().then((r) => r.ok && setPlansCatalogue(r.plans));
  }, [plansCatalogue]);
  useEffect(() => {
    if (ws.launch.phase === "error" && ws.launch.code === "CR_CREDITS_REQUIRED") openPlans();
  }, [openPlans, ws.launch]);

  const quoted = ws.quote.status === "quoted" ? ws.quote.answer : null;
  const credits = quoted?.credits ?? null;
  const creditsShort = !!credits?.applicable && !credits.affordable && ws.funding !== "wallet";
  const creditsCover = !!credits?.applicable && credits.affordable && ws.funding !== "wallet";
  const free = quoted ? quoted.quote.totalCents === 0 : false;
  const generating = ws.launch.phase === "generating";
  const watching = !!ws.jobId;
  const job = ws.watch.job;
  const canGenerate = !!quoted && !generating && !creditsShort && ws.ready && (ws.config?.processingAvailable ?? false);

  const voices = cfg?.voices ?? [];
  const voice = voices.find((v) => v.id === ws.voiceId) ?? null;
  const languages = useMemo(() => (cfg?.languages ?? []).filter((l) => !voice || !voice.languages.length || voice.languages.includes(l.code)), [cfg?.languages, voice]);
  const envStage: "idle" | "processing" | "completed" = watching && job ? (isActiveStatus(job.status) ? "processing" : job.status === "completed" ? "completed" : "idle") : "idle";

  return (
    <FrenzAIEnvironment stage={envStage} bare>
      <div className="pb-24">
        <header className="mt-4">
          <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
            Frenz AI · Audio
          </p>
          <h1 className="mt-2 text-[2rem] font-bold leading-[1.06] tracking-[-0.04em] sm:text-[2.4rem]">
            Text to <span className="text-gradient">Audio</span>
          </h1>
          <p className="mt-2.5 max-w-lg text-[14.5px] leading-relaxed text-muted-foreground">Turn your words into natural AI audio. Preview it, save it to your library, and use it in Lip Sync Pro whenever you like.</p>
        </header>

        {ws.configError ? (
          <Notice tone="error" className="mt-5">
            {ws.configError}{" "}
            <button type="button" onClick={() => void ws.reloadConfig()} className="font-semibold underline underline-offset-2">
              Try again
            </button>
          </Notice>
        ) : null}
        {ws.config && !ws.config.available && ws.config.unavailableReason ? (
          <Notice tone="muted" className="mt-5">
            {ws.config.unavailableReason}
          </Notice>
        ) : null}

        {watching ? (
          <div className="mt-6">
            <Result job={job} missing={ws.watch.missing} basePath={basePath} libraryHref={libraryHref} lipSyncHref={lipSyncHref} historyHref={historyHref} onAnother={ws.reset} />
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {/* ── 1 · the text ───────────────────────────────────────────── */}
            <Section n={1} title="Your text">
              <label className="block">
                <span className="sr-only">What should be said</span>
                <textarea
                  value={ws.text}
                  onChange={(e) => ws.setText(e.target.value)}
                  rows={6}
                  maxLength={Math.max(ws.maximum + 200, 1000)}
                  placeholder="Type or paste what you'd like to hear…"
                  className="w-full resize-y rounded-2xl border border-border bg-card p-3.5 text-[15px] leading-relaxed outline-none focus:border-foreground"
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className={cn("text-[11.5px] tabular-nums", ws.overLimit ? "font-semibold text-rose-600" : "text-muted-foreground")}>
                  {ws.characters.toLocaleString("en-US")} / {ws.maximum.toLocaleString("en-US")} characters
                </p>
                {ws.config && ws.config.free.allowance > 0 ? (
                  <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/[0.08] px-2.5 py-1 text-[11.5px] font-semibold text-primary">
                    <Gift className="h-3.5 w-3.5" aria-hidden />
                    {ws.config.free.remaining.toLocaleString("en-US")} free characters left this month
                  </p>
                ) : null}
              </div>
              {ws.overLimit ? <p className="mt-1.5 text-[11.5px] font-semibold text-rose-600">That is longer than one generation takes. Shorten it, or split it into two.</p> : null}
            </Section>

            {/* ── 2 · the voice ──────────────────────────────────────────── */}
            <Section n={2} title="Voice & language">
              {voices.length === 0 ? (
                <Notice tone="muted">No voice is set up for this tool yet.</Notice>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {voices.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          haptic("selection");
                          ws.setVoiceId(v.id);
                          if (v.languages.length && ws.languageCode && !v.languages.includes(ws.languageCode)) ws.setLanguageCode(v.languages[0] ?? null);
                        }}
                        aria-pressed={ws.voiceId === v.id}
                        className={cn("flex min-h-[60px] items-center gap-3 rounded-2xl border px-3 py-2 text-left transition", ws.voiceId === v.id ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-secondary/40")}
                      >
                        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", ws.voiceId === v.id ? "bg-background/15" : "bg-primary/10 text-primary")}>
                          <Mic className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{v.label}</span>
                          <span className={cn("block truncate text-[11px]", ws.voiceId === v.id ? "text-background/75" : "text-muted-foreground")}>{v.blurb}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {languages.length > 1 ? (
                    <label className="mt-3 block">
                      <span className="mb-1.5 block text-[12px] font-semibold">Language</span>
                      <select value={ws.languageCode ?? ""} onChange={(e) => ws.setLanguageCode(e.target.value || null)} className="min-h-[44px] w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:border-foreground">
                        {languages.map((l) => (
                          <option key={l.code} value={l.code}>
                            {l.label} · {l.native}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </>
              )}
            </Section>

            {/* ── 3 · the name ───────────────────────────────────────────── */}
            <Section n={3} title="Name it">
              <label className="block">
                <span className="sr-only">A name for your Audio Library</span>
                <input
                  value={ws.name}
                  onChange={(e) => ws.setName(e.target.value)}
                  maxLength={120}
                  placeholder="Intro voiceover"
                  className="min-h-[48px] w-full rounded-2xl border border-border bg-card px-3.5 text-[15px] outline-none focus:border-foreground"
                />
              </label>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">Saved to your Audio Library so you can reuse it. Leave it blank and we will name it from your text.</p>
            </Section>

            {/* ── 4 · the estimate ───────────────────────────────────────── */}
            <Section n={4} title="What it costs">
              {ws.quote.status === "pending" ? (
                <div className="h-16 animate-pulse rounded-2xl bg-secondary/60" aria-busy="true" aria-label="Pricing" />
              ) : ws.quote.status === "error" ? (
                <Notice tone="error">{ws.quote.message}</Notice>
              ) : quoted ? (
                <div className="space-y-2">
                  {quoted.quote.lines.map((l) => (
                    <Row key={l.key} label={l.label} value={l.amountCents === 0 ? "Free" : formatCents(l.amountCents, symbol)} />
                  ))}
                  <div className="mt-1 border-t border-border/70 pt-2">
                    <Row label="Total" value={free ? "Free" : creditsCover ? `${credits?.required ?? 0} credits` : formatCents(quoted.quote.totalCents, symbol)} strong />
                  </div>
                  <p className="text-[11.5px] text-muted-foreground">
                    {quoted.free.allowance > 0 ? `${quoted.free.afterThis.toLocaleString("en-US")} free characters would be left this month.` : null} {cfg?.priceLine ? `Rate: ${cfg.priceLine}.` : null}
                  </p>
                  {creditsShort ? (
                    <Notice tone="muted">
                      Your plan credits do not cover this one.{" "}
                      <button type="button" onClick={() => ws.setFunding("wallet")} className="font-semibold underline underline-offset-2">
                        Use my balance
                      </button>{" "}
                      ·{" "}
                      <button type="button" onClick={openPlans} className="font-semibold underline underline-offset-2">
                        See plans
                      </button>
                    </Notice>
                  ) : null}
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">Type something and the price appears here. Nothing is charged before you press Generate.</p>
              )}
            </Section>

            {ws.launch.phase === "error" ? (
              <Notice tone="error">
                {ws.launch.message}{" "}
                <button type="button" onClick={ws.clearLaunchError} className="font-semibold underline underline-offset-2">
                  Dismiss
                </button>
              </Notice>
            ) : null}

            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => void ws.generate()}
              className="ai-cta inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-bold text-background disabled:opacity-40"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <AudioLines className="h-4 w-4" aria-hidden />}
              {generating ? "Generating…" : free ? "Generate · Free" : quoted ? `Generate · ${creditsCover ? `${credits?.required ?? 0} credits` : formatCents(quoted.quote.totalCents, symbol)}` : "Generate"}
            </button>
            <p className="text-center text-[11.5px] text-muted-foreground">
              <Link href={libraryHref} className="font-semibold text-primary underline-offset-2 hover:underline">
                Your Audio Library
              </Link>{" "}
              ·{" "}
              <Link href={usageHref} className="underline-offset-2 hover:underline">
                Credits & usage
              </Link>{" "}
              ·{" "}
              <Link href={aiHref} className="underline-offset-2 hover:underline">
                Frenz AI
              </Link>
            </p>
          </div>
        )}
      </div>
      {plansSheet ? (
        <AiPlansSheet
          open={plansSheet}
          onClose={() => {
            setPlansSheet(false);
            ws.clearLaunchError();
          }}
          plans={plansCatalogue}
          currentPlan={credits?.plan ?? null}
          shortfall={credits && !credits.affordable ? { ...credits, walletOffered: true, priceLabel: quoted ? formatCents(quoted.quote.totalCents, symbol) : null } : null}
          returnTo={basePath}
          onPayFromWallet={() => {
            ws.setFunding("wallet");
            setPlansSheet(false);
            ws.clearLaunchError();
          }}
        />
      ) : null}
    </FrenzAIEnvironment>
  );
}

/* ───────────────────────────── the result ────────────────────────────────── */

const STEPS = [{ label: "Preparing" }, { label: "Generating the voice" }, { label: "Saving your audio" }] as const;

function Result({ job, missing, basePath, libraryHref, lipSyncHref, historyHref, onAnother }: { job: AiJobView | null; missing: boolean; basePath: string; libraryHref: string; lipSyncHref: string; historyHref: string; onAnother: () => void }) {
  const tta = job?.textToAudio ?? null;
  if (missing) return <Notice tone="error">That audio is not here any more.</Notice>;
  if (!job) return <div className="h-40 animate-pulse rounded-[1.5rem] bg-secondary/60" aria-busy="true" aria-label="Loading" />;

  if (job.status === "completed") {
    return (
      <div className="space-y-4">
        <div className="rounded-[1.5rem] border border-border/70 bg-card p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <AudioLines className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold tracking-[-0.01em]">{tta?.name ?? "Your audio"}</p>
              <p className="text-[12px] text-muted-foreground">
                {tta?.characters?.toLocaleString("en-US") ?? 0} characters
                {tta?.durationMs ? ` · ${Math.round(tta.durationMs / 1000)} s` : ""}
                {tta?.freeCharactersCovered ? ` · ${tta.freeCharactersCovered} free` : ""}
              </p>
            </div>
          </div>
          {tta?.assetId ? <AudioAssetPlayer assetId={tta.assetId} durationMs={tta.durationMs} className="mt-4" onPlay={() => track("text_to_audio_played", {})} /> : <p className="mt-3 text-[12.5px] text-muted-foreground">This one was not saved to your library.</p>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {tta?.assetId ? (
            <Link
              href={`${lipSyncHref}?audio=${encodeURIComponent(tta.assetId)}`}
              onClick={() => track("audio_library_reused", { from: "result" })}
              className="ai-cta inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-bold text-background"
            >
              <Mic className="h-4 w-4" aria-hidden /> Use in Lip Sync Pro
            </Link>
          ) : null}
          <Link href={libraryHref} className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold">
            <Check className="h-4 w-4" aria-hidden /> Your Audio Library
          </Link>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={basePath} onClick={onAnother} className="inline-flex items-center gap-1.5 font-semibold text-primary">
            <RefreshCcw className="h-4 w-4" aria-hidden /> Make another
          </Link>
          <Link href={historyHref} className="text-muted-foreground underline-offset-2 hover:underline">
            Everything you have made
          </Link>
        </div>
      </div>
    );
  }

  if (!isActiveStatus(job.status)) {
    const ended = job.status === "cancelled" ? "Stopped." : job.status === "expired" ? "That audio expired." : "This one did not finish.";
    const refund = tta?.billing === "FREE_ALLOWANCE" ? "Your free characters are back." : tta?.billing === "CREDITS" ? "Your credits are back." : tta?.refunded ? "Refunded to your balance." : null;
    return (
      <div className="space-y-4">
        <Notice tone={job.status === "failed" ? "error" : "muted"}>
          {ended} {job.error?.message ?? ""} {refund ?? ""}
        </Notice>
        <Link href={basePath} onClick={onAnother} className="ai-cta inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-bold text-background">
          <RefreshCcw className="h-4 w-4" aria-hidden /> Try again
        </Link>
      </div>
    );
  }

  const idx = job.status === "queued" || job.status === "acquiring" || job.status === "waiting" ? 0 : job.status === "processing" ? 1 : 2;
  return (
    <div className="rounded-[1.5rem] border border-border/70 bg-card p-5">
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.label} className={cn("flex items-center gap-3 text-sm", i < idx ? "text-muted-foreground" : i === idx ? "font-semibold" : "text-muted-foreground/60")}>
            <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border", i < idx ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : i === idx ? "border-primary text-primary" : "border-border")}>
              {i < idx ? <Check className="h-3.5 w-3.5" aria-hidden /> : i === idx ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <span className="text-[10px]">{i + 1}</span>}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">Audio usually takes a few seconds. You can leave this page — it will be in your Audio Library.</p>
    </div>
  );
}

/* ───────────────────────────── pieces ────────────────────────────────────── */

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.5rem] border border-border/70 bg-card/60 p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-[11px] font-bold text-background">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn("text-[13px]", strong ? "font-bold" : "text-muted-foreground")}>{label}</span>
      <span className={cn("tabular-nums", strong ? "text-[15px] font-bold" : "text-[13px] font-semibold")}>{value}</span>
    </div>
  );
}

function Notice({ tone, children, className }: { tone: "error" | "muted"; children: React.ReactNode; className?: string }) {
  return <p className={cn("rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-snug", tone === "error" ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-secondary text-muted-foreground", className)}>{children}</p>;
}
