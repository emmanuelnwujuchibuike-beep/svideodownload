"use client";

import { Check, Gift, Loader2, Mic, Plus, RefreshCcw, ShieldCheck, Sparkles, Trash2, Type, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { AiPlansSheet } from "@/features/ai/credits/ai-plans-sheet";
import { useVoiceCloning } from "@/features/ai/voice-clone/use-voice-cloning";
import { VoiceLibrary } from "@/features/ai/voice-clone/voice-library";
import { getAiCredits } from "@/lib/ai/credits/client";
import type { AiPlansPublic } from "@/lib/ai/credits/config";
import { formatCents } from "@/lib/ai/economy";
import { isActiveStatus, type AiJobView } from "@/lib/ai/jobs";
import { track } from "@/lib/analytics/client";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VOICE CLONING — the standalone workspace
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "next lets build the standalone voice cloning … all ai
 * features pipeline must be standalone to give a cleaner premium result rather
 * than making them all go through same pipeline."
 *
 * So there is no video, no scope and no lip sync on this page:
 *
 *   1  Your recordings   the files, how much audio they add up to, the advice
 *                        that actually changes the result
 *   2  Name it           what the Voice Library will call it
 *   3  The rights        the one typed confirmation this product asks for
 *   4  What it costs     the month's free voice, or the price
 *      Create the voice  → the wait → the voice, and the two doors onward
 *
 * Under it all: the member's existing voices, because somebody arriving here
 * for a second voice should see the first one rather than hunt for it.
 *
 * ── 🔴 THE ADVICE IS PART OF THE PRODUCT ────────────────────────────────────
 * A clone is only as good as what it is built from, and the difference between
 * a disappointing voice and an uncanny one is usually one of three things:
 * clean audio, one speaker, and enough of it. Saying so before the upload is
 * worth more than any amount of post-hoc apology, and it is why the guidance
 * sits in step 1 rather than in a help page.
 */
export function VoiceCloningWorkspace({
  basePath,
  aiHref,
  ttaHref,
  lipSyncHref,
  historyHref,
  usageHref,
  initialJobId = null,
}: {
  basePath: string;
  aiHref: string;
  ttaHref: string;
  lipSyncHref: string;
  historyHref: string;
  usageHref: string;
  initialJobId?: string | null;
}) {
  const ws = useVoiceCloning({ initialJobId });
  const cfg = ws.config?.config ?? null;
  const symbol = cfg?.symbol ?? "$";
  const picker = useRef<HTMLInputElement | null>(null);
  const [plansSheet, setPlansSheet] = useState(false);
  const [plansCatalogue, setPlansCatalogue] = useState<AiPlansPublic | null>(null);

  const openPlans = useCallback(() => {
    haptic("medium");
    setPlansSheet(true);
    if (!plansCatalogue) void getAiCredits().then((r) => r.ok && setPlansCatalogue(r.plans));
  }, [plansCatalogue]);
  useEffect(() => {
    if (ws.state.phase === "error" && ws.state.code === "CR_CREDITS_REQUIRED") openPlans();
  }, [openPlans, ws.state]);

  const quote = ws.config?.quote ?? null;
  const credits = ws.config?.credits ?? null;
  const creditsShort = !!credits?.applicable && !credits.affordable && ws.funding !== "wallet";
  const creditsCover = !!credits?.applicable && credits.affordable && ws.funding !== "wallet";
  const free = quote ? quote.totalCents === 0 : false;
  const working = ws.state.phase === "uploading" || ws.state.phase === "starting";
  const watching = !!ws.jobId;
  const job = ws.watch.job;
  const slotsFull = !!ws.config && ws.config.slots.used >= ws.config.slots.total;
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
            Voice <span className="text-gradient">Cloning</span>
          </h1>
          <p className="mt-2.5 max-w-lg text-[14.5px] leading-relaxed text-muted-foreground">
            Turn a voice you own into one you can type with. Give us a few clean recordings and it becomes yours to use in Text to Audio and Lip Sync Pro, as often as you like.
          </p>
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
            <Result job={job} missing={ws.watch.missing} basePath={basePath} ttaHref={ttaHref} lipSyncHref={lipSyncHref} historyHref={historyHref} onAnother={ws.reset} />
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {/* ── 1 · the recordings ─────────────────────────────────────── */}
            <Section n={1} title="Your recordings">
              <div className="rounded-2xl bg-secondary/50 px-3.5 py-3">
                <p className="text-[12px] font-semibold">What makes a voice sound real</p>
                <ul className="mt-1.5 space-y-1 text-[11.5px] leading-snug text-muted-foreground">
                  <li>· One person speaking, nobody else, no music behind it.</li>
                  <li>· Natural speech — read something aloud rather than listing words.</li>
                  <li>· {cfg ? `At least ${cfg.samples.minimumSecondsTotal} seconds in total; a minute or two is noticeably better.` : "A minute or two of audio is noticeably better than a few seconds."}</li>
                  {/* Worth saying before they record, not after: the accent comes from the recordings, so record in the voice they want to hear back. */}
                  <li>· Whatever accent you record in is the accent you get — and it speaks any language you type, Pidgin included.</li>
                </ul>
              </div>

              {cfg && ws.samples.length < cfg.samples.maximum ? (
                <>
                  <input
                    ref={picker}
                    type="file"
                    multiple
                    accept={[...cfg.samples.acceptMimeTypes, ...cfg.samples.acceptExtensions].join(",")}
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files?.length) void ws.addFiles(files);
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      haptic("selection");
                      picker.current?.click();
                    }}
                    className="mt-3 flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 text-[13.5px] font-semibold transition hover:bg-secondary/40"
                  >
                    <Upload className="h-4 w-4" aria-hidden />
                    {ws.samples.length === 0 ? "Choose your recordings" : "Add another"}
                  </button>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {cfg.samples.formatLabels.join(", ")} · up to {cfg.samples.maximum} files · {Math.round(cfg.samples.maximumBytes / (1024 * 1024))} MB each · audio only, never video
                  </p>
                  {ws.pickError ? <p className="mt-1.5 text-[11.5px] font-semibold text-amber-600">{ws.pickError}</p> : null}
                </>
              ) : null}

              {ws.samples.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {ws.samples.map((s) => (
                    <li key={s.key} className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Mic className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">{s.file.name}</span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          {(s.file.size / (1024 * 1024)).toFixed(1)} MB{s.durationMs ? ` · ${Math.round(s.durationMs / 1000)} s` : ""}
                        </span>
                      </span>
                      <button type="button" onClick={() => ws.removeSample(s.key)} aria-label={`Remove ${s.file.name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground">
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {ws.measurable && ws.measuredSeconds > 0 ? (
                <p className={cn("mt-2 text-[11.5px] tabular-nums", ws.tooLittle ? "font-semibold text-amber-600" : "text-muted-foreground")}>
                  {Math.round(ws.measuredSeconds)} seconds of audio{cfg && ws.tooLittle ? ` — add at least ${cfg.samples.minimumSecondsTotal} for a usable voice.` : "."}
                </p>
              ) : null}
              {ws.tooMuch ? <p className="mt-1.5 text-[11.5px] font-semibold text-rose-600">That is more audio than one voice takes. Remove a file and try again.</p> : null}
            </Section>

            {/* ── 2 · the name ───────────────────────────────────────────── */}
            <Section n={2} title="Name it">
              <label className="block">
                <span className="sr-only">A name for this voice</span>
                <input
                  value={ws.name}
                  onChange={(e) => ws.setName(e.target.value)}
                  maxLength={60}
                  placeholder="My voice"
                  className="min-h-[48px] w-full rounded-2xl border border-border bg-card px-3.5 text-[15px] outline-none focus:border-foreground"
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-[12px] font-semibold">A note, if you like</span>
                <input
                  value={ws.description}
                  onChange={(e) => ws.setDescription(e.target.value)}
                  maxLength={300}
                  placeholder="Warm, for narration"
                  className="min-h-[44px] w-full rounded-2xl border border-border bg-card px-3.5 text-[14px] outline-none focus:border-foreground"
                />
              </label>
            </Section>

            {/* ── 3 · the rights ─────────────────────────────────────────────
                🔴 THE ONE PLACE THIS PRODUCT ASKS FOR A TYPED CONFIRMATION. A
                cloned voice is a person's likeness; "they clicked through a
                dialog" is not a record anybody can stand behind later. The
                server refuses a request without both of these, so this is the
                interface agreeing with the server rather than the only guard. */}
            <Section n={3} title="The rights to this voice">
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-3.5">
                <input type="checkbox" checked={ws.agreed} onChange={(e) => ws.setAgreed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[currentColor]" />
                <span className="text-[12.5px] leading-relaxed">{cfg?.consentStatement ?? "This is my own voice, or I have the speaker's explicit permission to clone it."}</span>
              </label>
              {cfg?.requireConsentName ? (
                <label className="mt-3 block">
                  <span className="mb-1.5 block text-[12px] font-semibold">Type your name to confirm</span>
                  <input
                    value={ws.consentName}
                    onChange={(e) => ws.setConsentName(e.target.value)}
                    maxLength={120}
                    autoComplete="name"
                    placeholder="Your full name"
                    className="min-h-[48px] w-full rounded-2xl border border-border bg-card px-3.5 text-[15px] outline-none focus:border-foreground"
                  />
                </label>
              ) : null}
              <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground/80">
                <ShieldCheck className="mt-[1px] h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
                <span>We keep this confirmation with the voice. Cloning someone without their permission, or using a voice to impersonate or mislead, is not allowed and ends access.</span>
              </p>
            </Section>

            {/* ── 4 · the price ──────────────────────────────────────────── */}
            <Section n={4} title="What it costs">
              {quote ? (
                <div className="space-y-2">
                  {quote.lines.map((l) => (
                    <Row key={l.key} label={l.label} value={l.amountCents === 0 ? "Free" : formatCents(l.amountCents, symbol)} />
                  ))}
                  <div className="mt-1 border-t border-border/70 pt-2">
                    <Row label="Total" value={free ? "Free" : creditsCover ? `${credits?.required ?? 0} credits` : formatCents(quote.totalCents, symbol)} strong />
                  </div>
                  {ws.config && ws.config.free.allowance > 0 ? (
                    <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/[0.08] px-2.5 py-1 text-[11.5px] font-semibold text-primary">
                      <Gift className="h-3.5 w-3.5" aria-hidden />
                      {ws.config.free.remaining} of {ws.config.free.allowance} free {ws.config.free.allowance === 1 ? "voice" : "voices"} left this month
                    </p>
                  ) : null}
                  {ws.config ? (
                    <p className="text-[11.5px] text-muted-foreground">
                      {ws.config.slots.used} of {ws.config.slots.total} voice {ws.config.slots.total === 1 ? "slot" : "slots"} used. A voice stays yours until you delete it.
                    </p>
                  ) : null}
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
                <div className="h-16 animate-pulse rounded-2xl bg-secondary/60" aria-busy="true" aria-label="Pricing" />
              )}
            </Section>

            {slotsFull ? (
              <Notice tone="muted">
                All your voice slots are in use. Delete one below, or{" "}
                <button type="button" onClick={openPlans} className="font-semibold underline underline-offset-2">
                  see plans
                </button>{" "}
                for more.
              </Notice>
            ) : null}

            {ws.state.phase === "error" ? (
              <Notice tone="error">
                {ws.state.message}{" "}
                <button type="button" onClick={ws.clearError} className="font-semibold underline underline-offset-2">
                  Dismiss
                </button>
              </Notice>
            ) : null}

            <button
              type="button"
              disabled={!ws.ready || working || slotsFull}
              onClick={() => void ws.create()}
              className="ai-cta inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-bold text-background disabled:opacity-40"
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
              {ws.state.phase === "uploading"
                ? `Uploading ${ws.state.done} of ${ws.state.total}…`
                : ws.state.phase === "starting"
                  ? "Creating your voice…"
                  : free
                    ? "Create my voice · Free"
                    : quote
                      ? `Create my voice · ${creditsCover ? `${credits?.required ?? 0} credits` : formatCents(quote.totalCents, symbol)}`
                      : "Create my voice"}
            </button>
            <p className="text-center text-[11.5px] text-muted-foreground">
              <Link href={ttaHref} className="font-semibold text-primary underline-offset-2 hover:underline">
                Text to Audio
              </Link>{" "}
              ·{" "}
              <Link href={usageHref} className="underline-offset-2 hover:underline">
                Credits &amp; usage
              </Link>{" "}
              ·{" "}
              <Link href={aiHref} className="underline-offset-2 hover:underline">
                Frenz AI
              </Link>
            </p>

            <div className="border-t border-border/60 pt-2">
              <VoiceLibrary cloneHref={basePath} ttaHref={ttaHref} lipSyncHref={lipSyncHref} compact />
            </div>
          </div>
        )}
      </div>
      {plansSheet ? (
        <AiPlansSheet
          open={plansSheet}
          onClose={() => {
            setPlansSheet(false);
            ws.clearError();
          }}
          plans={plansCatalogue}
          currentPlan={credits?.plan ?? null}
          shortfall={credits && !credits.affordable ? { ...credits, walletOffered: true, priceLabel: quote ? formatCents(quote.totalCents, symbol) : null } : null}
          returnTo={basePath}
          onPayFromWallet={() => {
            ws.setFunding("wallet");
            setPlansSheet(false);
            ws.clearError();
          }}
        />
      ) : null}
    </FrenzAIEnvironment>
  );
}

/* ───────────────────────────── the result ────────────────────────────────── */

const STEPS = [{ label: "Reading your recordings" }, { label: "Learning the voice" }, { label: "Adding it to your library" }] as const;

function Result({ job, missing, basePath, ttaHref, lipSyncHref, historyHref, onAnother }: { job: AiJobView | null; missing: boolean; basePath: string; ttaHref: string; lipSyncHref: string; historyHref: string; onAnother: () => void }) {
  const vc = job?.voiceClone ?? null;
  if (missing) return <Notice tone="error">That voice is not here any more.</Notice>;
  if (!job) return <div className="h-40 animate-pulse rounded-[1.5rem] bg-secondary/60" aria-busy="true" aria-label="Loading" />;

  if (job.status === "completed") {
    return (
      <div className="space-y-4">
        <div className="rounded-[1.5rem] border border-border/70 bg-card p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Mic className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold tracking-[-0.01em]">{vc?.name ?? "Your voice"}</p>
              <p className="text-[12px] text-muted-foreground">
                Ready to speak · {vc?.sampleCount ?? 0} recording{vc?.sampleCount === 1 ? "" : "s"}
                {vc?.sampleSeconds ? ` · ${Math.round(vc.sampleSeconds)} s` : ""}
                {vc?.freeCovered ? " · free this month" : ""}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">Type anything and it will be said in this voice. It stays in your library until you delete it.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link
            href={vc?.cloneId ? `${ttaHref}?voice=${encodeURIComponent(`clone:${vc.cloneId}`)}` : ttaHref}
            onClick={() => track("voice_clone_reused", { from: "result", to: "text_to_audio" })}
            className="ai-cta inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-bold text-background"
          >
            <Type className="h-4 w-4" aria-hidden /> Make audio with it
          </Link>
          <Link
            href={vc?.cloneId ? `${lipSyncHref}?voice=${encodeURIComponent(`clone:${vc.cloneId}`)}` : lipSyncHref}
            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold"
          >
            <Check className="h-4 w-4" aria-hidden /> Use in Lip Sync Pro
          </Link>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={basePath} onClick={onAnother} className="inline-flex items-center gap-1.5 font-semibold text-primary">
            <Plus className="h-4 w-4" aria-hidden /> Clone another
          </Link>
          <Link href={historyHref} className="text-muted-foreground underline-offset-2 hover:underline">
            Everything you have made
          </Link>
        </div>
      </div>
    );
  }

  if (!isActiveStatus(job.status)) {
    const ended = job.status === "cancelled" ? "Stopped." : job.status === "expired" ? "That request expired." : "We could not build that voice.";
    const refund = vc?.billing === "FREE_ALLOWANCE" ? "Your free voice this month is back." : vc?.billing === "CREDITS" ? "Your credits are back." : vc?.refunded ? "Refunded to your balance." : null;
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
      <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">A voice usually takes a few seconds. You can leave this page — it will be in your library.</p>
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
