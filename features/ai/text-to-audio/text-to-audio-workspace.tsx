"use client";

import { AudioLines, Check, Gift, Loader2, Mic, Plus, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AudioAssetPlayer } from "@/features/ai/text-to-audio/audio-player";
import { AiHero } from "@/features/ai/design/ai-surface";
import { FrenzAITrustRow } from "@/features/ai/frenz-ai-chrome";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { AiWalletRechargeSheet } from "@/features/ai/wallet/recharge-sheet";
import { AiPlansSheet } from "@/features/ai/credits/ai-plans-sheet";
import { useTextToAudio } from "@/features/ai/text-to-audio/use-text-to-audio";
import { getAiCredits } from "@/lib/ai/credits/client";
import type { AiPlansPublic } from "@/lib/ai/credits/config";
import { formatCents } from "@/lib/ai/economy";
import { isActiveStatus, type AiJobView } from "@/lib/ai/jobs";
import { TTS_DELIVERIES, TTS_DELIVERY_LABEL } from "@/lib/ai/voice/voice-settings";
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
export function TextToAudioWorkspace({
  basePath,
  aiHref,
  libraryHref,
  lipSyncHref,
  historyHref,
  usageHref,
  initialJobId = null,
  initialVoiceId = null,
}: {
  basePath: string;
  aiHref: string;
  libraryHref: string;
  lipSyncHref: string;
  historyHref: string;
  usageHref: string;
  initialJobId?: string | null;
  /** 2026-09-27: `clone:<uuid>` from the Voice Library's "Make audio with it". */
  initialVoiceId?: string | null;
}) {
  const ws = useTextToAudio({ initialJobId, initialVoiceId });
  const cfg = ws.config?.config ?? null;
  const symbol = cfg?.symbol ?? "$";
  const [plansSheet, setPlansSheet] = useState(false);
  const [rechargeSheet, setRechargeSheet] = useState(false);
  /*
    🔴 THE VOICE LIST IS NOT IN THE DOM UNTIL IT IS ASKED FOR (owner,
    2026-09-27: "make the language and voice selection not show on text to
    audio, it should show when the voice and Language button is click, so the
    text to audio page is light and opens fast on first loading").

    Twenty-one catalogue voices plus the member's own clones is twenty-odd
    cards, each with an icon and two lines — the single heaviest thing on a
    page whose job is a text box and a button. Almost nobody changes the voice
    on the way to their first generation, so it renders as ONE summary row and
    the list is mounted only on the tap that asks for it.
  */
  const [voicePicker, setVoicePicker] = useState(false);
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
  /*
    🔴 2026-09-27: the affordability check that was missing. A generation the
    free characters no longer cover needs money — from plan credits, or from the
    one Frenz AI wallet. When neither covers it, the button must say so and open
    the recharge sheet rather than letting the press fail.
  */
  const needsMoney = !!quoted && quoted.quote.totalCents > 0 && !creditsCover;
  const balanceCents = ws.balance?.balanceCents ?? null;
  const shortOfBalance = needsMoney && balanceCents !== null && balanceCents < quoted.quote.totalCents;
  const shortfallCents = shortOfBalance && quoted ? quoted.quote.totalCents - (balanceCents ?? 0) : 0;
  const generating = ws.launch.phase === "generating";
  const watching = !!ws.jobId;
  const job = ws.watch.job;
  const canGenerate = !!quoted && !generating && !creditsShort && !shortOfBalance && ws.ready && (ws.config?.processingAvailable ?? false);

  const voices = cfg?.voices ?? [];
  const voice = voices.find((v) => v.id === ws.voiceId) ?? null;
  const languages = useMemo(() => (cfg?.languages ?? []).filter((l) => !voice || !voice.languages.length || voice.languages.includes(l.code)), [cfg?.languages, voice]);
  const selectedLanguage = useMemo(() => languages.find((l) => l.code === ws.languageCode) ?? null, [languages, ws.languageCode]);
  const envStage: "idle" | "processing" | "completed" = watching && job ? (isActiveStatus(job.status) ? "processing" : job.status === "completed" ? "completed" : "idle") : "idle";

  return (
    <FrenzAIEnvironment stage={envStage} bare>
      <div className="pb-24">
        {/*
          The shared Frenz AI hero (2026-09-27). This screen used to open with
          a hand-rolled uppercase eyebrow — "Frenz AI · Audio" — where both of
          the owner's references put the breadcrumb PILL, so the tool a member
          reached from the studio looked like a different product from the one
          they left. Same headline, same subtitle, one definition.
        */}
        <AiHero
          tool="Text to Audio"
          title="Text to"
          highlight="Audio"
          subtitle="Turn your words into natural AI audio. Preview it, save it to your library, and use it in Lip Sync Pro whenever you like."
          className="mt-4"
        />

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
            <Section n={1} title="Your script">
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
              ) : !voicePicker ? (
                /* Closed: one row saying what is chosen, and nothing else mounted. */
                <button
                  type="button"
                  onClick={() => {
                    haptic("selection");
                    setVoicePicker(true);
                  }}
                  className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2 text-left transition hover:bg-secondary/40"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Mic className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{voice?.label ?? "Choose a voice"}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[selectedLanguage?.label, cfg?.deliveryChoice && ws.delivery ? TTS_DELIVERY_LABEL[ws.delivery].label : null].filter(Boolean).join(" · ") || "Tap to choose"}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12px] font-semibold text-primary">Change</span>
                </button>
              ) : (
                <>
                  {voices.some((v) => v.own) ? (
                    <>
                      <p className="mb-1 text-[13px] font-semibold text-foreground/80">Your voices</p>
                      {/* The accent is not a setting — a clone learns it from the recordings and keeps it in every language it speaks. Nobody can tell that by looking, so it is said. */}
                      <p className="mb-2.5 text-[11.5px] leading-snug text-muted-foreground">Your cloned voices keep their own accent, in any language you type — Pidgin included.</p>
                    </>
                  ) : null}
                  {/*
                    ── TWO ACROSS, AND SHORTER (owner, 2026-09-28) ──────────────
                    "this voices and languages tile looks too fat and too far to
                    scroll, it should be grid cols 2 to reduce the scroll, and
                    reduce the height of each tile and text."

                    It was ONE column on phones (`sm:grid-cols-2` only kicked in
                    at 640px) with 60px-tall horizontal rows, so twenty voices
                    were twenty full-width tiles and a very long scroll. §48 of
                    the brief is exactly this: reduce scroll fatigue.

                    🔴 THE LAYOUT HAD TO CHANGE, NOT JUST THE COLUMN COUNT. Two
                    columns on a 390px phone leaves ~175px a tile; an icon beside
                    the text would have left ~130px for names like "Roger -
                    Laid-Back, Casual, Resonant", i.e. truncation on almost every
                    one. So the tile is vertical: icon, then name over two lines,
                    then the descriptor. Same information, half the page.

                    The descriptor also stops being 11px muted grey — the owner
                    asked for "a more visible font and color", and it is the line
                    that distinguishes two voices with similar names.
                  */}
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
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
                        className={cn(
                          "flex min-h-[86px] flex-col rounded-2xl px-2.5 py-2.5 text-left transition active:scale-[0.98]",
                          ws.voiceId === v.id
                            ? "bg-foreground text-background"
                            : "bg-secondary/50 hover:bg-secondary/80",
                        )}
                      >
                        <span className={cn("mb-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg", ws.voiceId === v.id ? "bg-background/15" : "bg-primary/10 text-primary")}>
                          <Mic className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <span className="line-clamp-2 text-[12.5px] font-semibold leading-tight">{v.label}</span>
                        <span className={cn("mt-0.5 line-clamp-1 text-[11px] font-medium", ws.voiceId === v.id ? "text-background/80" : "text-foreground/55")}>{v.blurb}</span>
                      </button>
                    ))}
                  </div>
                  {cfg?.deliveryChoice ? (
                    <div className="mt-3">
                      <p className="mb-1.5 text-[12px] font-semibold">Delivery</p>
                      <div className="grid grid-cols-3 gap-2">
                        {TTS_DELIVERIES.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => {
                              haptic("selection");
                              ws.setDelivery(d);
                            }}
                            aria-pressed={ws.delivery === d}
                            className={cn("min-h-[44px] rounded-2xl border px-2 py-1.5 text-center transition", ws.delivery === d ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-secondary/40")}
                          >
                            <span className="block text-[12.5px] font-bold">{TTS_DELIVERY_LABEL[d].label}</span>
                          </button>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{ws.delivery ? TTS_DELIVERY_LABEL[ws.delivery].blurb : null}</p>
                    </div>
                  ) : null}
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
                  <button
                    type="button"
                    onClick={() => {
                      haptic("selection");
                      setVoicePicker(false);
                    }}
                    className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl bg-secondary px-4 text-[13px] font-bold"
                  >
                    Done
                  </button>
                </>
              )}
            </Section>

            {/* ── 3 · the name ───────────────────────────────────────────── */}
            <Section n={3} title="Save as">
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
                  {/* Once the month's free characters are gone this is what pays for it — named before the press, not after a refusal. */}
                  {needsMoney && ws.balance ? (
                    <p className={cn("text-[11.5px]", shortOfBalance ? "font-semibold text-amber-600" : "text-muted-foreground")}>
                      {shortOfBalance
                        ? `Your balance is ${formatCents(balanceCents ?? 0, symbol)} — ${formatCents(shortfallCents, symbol)} short.`
                        : `Paid from your balance of ${formatCents(balanceCents ?? 0, symbol)}.`}
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
                <p className="text-[13px] text-muted-foreground">Type something and the price appears here. Nothing is charged before you press Generate.</p>
              )}
            </Section>

            {ws.launch.phase === "error" ? (
              <Notice tone="error">
                {ws.launch.message}{" "}
                {ws.launch.code === "CR_BALANCE_REQUIRED" || ws.launch.code === "AI_BALANCE_REQUIRED" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRechargeSheet(true);
                      void ws.reloadBalance();
                    }}
                    className="font-semibold underline underline-offset-2"
                  >
                    Recharge
                  </button>
                ) : (
                  <button type="button" onClick={ws.clearLaunchError} className="font-semibold underline underline-offset-2">
                    Dismiss
                  </button>
                )}
              </Notice>
            ) : null}

            {/*
              🔴 SHORT OF BALANCE, THE BUTTON CHANGES JOB (2026-09-27). It used
              to stay "Generate", and pressing it answered CR_BALANCE_REQUIRED
              with no way forward — the owner's "it doesn't show a way to use
              with balance". Now it names the shortfall and opens the recharge
              sheet, the same as Character Replace has done since Part 9.
            */}
            {shortOfBalance ? (
              <button
                type="button"
                onClick={() => {
                  haptic("medium");
                  setRechargeSheet(true);
                }}
                className="ai-cta inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-bold text-background"
              >
                <Plus className="h-4 w-4" aria-hidden /> Recharge to continue · {formatCents(shortfallCents, symbol)} short
              </button>
            ) : (
              <button
                type="button"
                disabled={!canGenerate}
                onClick={() => void ws.generate()}
                className="ai-cta inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-bold text-background disabled:opacity-40"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <AudioLines className="h-4 w-4" aria-hidden />}
                {generating ? "Generating…" : free ? "Generate · Free" : quoted ? `Generate · ${creditsCover ? `${credits?.required ?? 0} credits` : formatCents(quoted.quote.totalCents, symbol)}` : "Generate"}
              </button>
            )}
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

        {/*
          The trust row that closes both of the owner's references. It existed
          in frenz-ai-chrome.tsx and was rendered on NO page at all — a fair
          measure of how much of the reference had been described rather than
          built.
        */}
        <FrenzAITrustRow className="mt-8 border-t border-border/60 pt-5" />
      </div>
      {rechargeSheet && ws.balance ? (
        <AiWalletRechargeSheet
          open={rechargeSheet}
          onClose={() => {
            setRechargeSheet(false);
            ws.clearLaunchError();
            void ws.reloadBalance();
          }}
          balance={ws.balance}
          returnTo={basePath}
          suggestedCents={shortfallCents > 0 ? shortfallCents : null}
        />
      ) : null}
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
        {/*
          🔴 THE LIBRARY IS THE PRIMARY ACTION (owner, 2026-09-27: "the review
          should open the audio library"). The saved audio LIVES there — it is
          where a member goes to play it again, rename it or download it later.
          Lip Sync Pro is one thing they might do next; the library is where the
          thing they just made actually is, so it leads.
        */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href={libraryHref} className="ai-cta inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-bold text-background">
            <AudioLines className="h-4 w-4" aria-hidden /> Open Audio Library
          </Link>
          {tta?.assetId ? (
            <Link
              href={`${lipSyncHref}?audio=${encodeURIComponent(tta.assetId)}`}
              onClick={() => track("audio_library_reused", { from: "result" })}
              className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold"
            >
              <Mic className="h-4 w-4" aria-hidden /> Use in Lip Sync Pro
            </Link>
          ) : null}
        </div>
        {/*
          🔴 THIS LINKED TO THE WRONG PLACE (owner, 2026-09-28: "this
          everything you have saved button lead to character replace history
          instead of audio library").

          It used `historyHref` — the Character Replace job history — while
          `libraryHref`, the Audio Library, was already being passed into this
          component and used elsewhere in the same file. Someone saving a
          voice track was sent to a list of video jobs.

          Both are real buttons now, not underlined captions: 48px, a surface
          and an icon each, per §38.
        */}
        <div className="flex flex-wrap gap-2.5">
          <Link href={basePath} onClick={onAnother} className={cn("inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full bg-secondary/70 px-4 text-[13.5px] font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition active:scale-[0.98]")}>
            <RefreshCcw className="h-4 w-4" aria-hidden /> Make another
          </Link>
          <Link href={libraryHref} className={cn("inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full bg-secondary/70 px-4 text-[13.5px] font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition active:scale-[0.98]")}>
            <AudioLines className="h-4 w-4" aria-hidden /> Audio Library
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

/**
 * One labelled block of the workspace.
 *
 * ── 🔴 WHAT WENT, AND WHY (owner, 2026-09-28) ──────────────────────────────
 *
 * This drew a numbered black disc and an all-caps tracked-out heading inside a
 * bordered card: "① YOUR TEXT", "② VOICE & LANGUAGE", "③ NAME IT". Three of
 * the brief's named anti-patterns in one component — excessive uppercase
 * labels (§1), form-heavy appearance (§1), and a border round every section
 * (§25) — and the numbering turned a creative workspace into a wizard for a
 * task nobody does in order.
 *
 * The reference labels the same blocks quietly: "Your script", "Voice", "Save
 * as", in sentence case, with the editor itself carrying the visual weight.
 *
 * `n` is kept in the signature and deliberately unused: every call site passes
 * it, and removing it there is churn in a file this size for no behaviour. It
 * is prefixed so lint knows it is intentional.
 */
function Section({ n: _n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.5rem] bg-card/70 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
      <h2 className="mb-2.5 text-[13.5px] font-semibold tracking-[-0.01em] text-foreground/80">{title}</h2>
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
