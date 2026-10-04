"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { AiActionBar, AiAdvancedSettings, AiCost, AiField, AiGenerateButton, AiGenerationStatus, AiSegmented } from "@/features/ai/design/ai-generate";
import { AiDisplayTitle, AiGlassCard, AiPageShell } from "@/features/ai/design/ai-surface";
import { FrenzAICrumb } from "@/features/ai/frenz-ai-chrome";
import { AiReferenceRail } from "@/features/ai/video/ai-reference-rail";
import { AiVideoResult } from "@/features/ai/video/ai-video-result";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { useVideoGeneration } from "@/features/ai/video/use-video-generation";
import { KLING_OMNI } from "@/lib/ai/kling/features/capabilities";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT TO VIDEO — the workspace
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 6 §13 fixes the order and §14 fixes the emphasis:
 *
 *     Header → INPUT (dominant) → core settings → advanced → cost → Generate
 *
 * So the prompt field is the largest thing on the screen, duration and shape
 * sit under it as two small segmented rows, everything rarely touched is behind
 * a disclosure, and the price and the button share one sticky bar that never
 * scrolls out of reach on a phone.
 *
 * ── 🔴 THE SETTINGS SHOWN ARE THE ONES THE PIPELINE ACTUALLY TAKES (§18, §54) ─
 *
 * Duration, aspect ratio, resolution and native audio are read from the
 * VERIFIED capability table — the same constants the server validates against.
 * `480p` is absent from the quality row because Kling lists it and then refuses
 * it at generation, and a negative-prompt control is absent because
 * `settings.negative_prompt` is not a field the live API validates. Offering a
 * control the backend cannot honour is the confusing UI §18 exists to prevent.
 *
 * ── 🔴 THE PRICE IS THE SERVER'S (§19, §55) ────────────────────────────────
 *
 * Every settings change re-asks `/api/ai/video/quote`. Nothing here multiplies
 * seconds by a rate. The number the member sees is the number `/jobs`
 * recomputes, and a mismatch refuses rather than silently charging the new one.
 */

const DURATIONS = [3, 5, 8, 10, 15] as const;

export function TextToVideoWorkspace({ historyHref, currencySymbol }: { historyHref: string; currencySymbol: string }) {
  const promptId = useId();
  const [prompt, setPrompt] = useState("");
  const [durationSeconds, setDuration] = useState<number>(KLING_OMNI.duration.defaultSeconds);
  const [aspectRatio, setAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [resolution, setResolution] = useState<"720p" | "1080p" | "4k">("720p");
  const [audio, setAudio] = useState<"off" | "native">("off");
  /* Optional references — the model keeps a face, a product or a place consistent. Priced by the server. */
  const [referenceImageUrls, setReferenceImages] = useState<string[]>([]);
  const [referenceVideoUrl, setReferenceVideo] = useState<string | null>(null);

  /*
    The request the SERVER will price and run. Memoised on the settings alone so
    an unrelated re-render cannot spam the quote endpoint.
  */
  const input = useMemo(
    () => ({
      prompt: prompt.trim(),
      // Omitted entirely when empty: the wire schema is strict, and an empty
      // array would re-quote as though something had been attached.
      ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
      ...(referenceVideoUrl ? { referenceVideoUrl } : {}),
      options: { durationSeconds, aspectRatio, resolution, audio },
    }),
    [prompt, durationSeconds, aspectRatio, resolution, audio, referenceImageUrls, referenceVideoUrl],
  );

  const gen = useVideoGeneration({ feature: "text_to_video", input, ready: prompt.trim().length > 0, label: prompt.trim() });

  /*
    🔴 `--ai-play` HAS TO COME FROM SOMEWHERE (2026-10-04).

    `.ai-cta::before` — the Generate button gradient — animates forever on
    `animation-play-state: var(--ai-play, running)`. Every other AI workspace
    (text-to-audio, voice cloning, lip sync) wraps itself in this environment,
    which is the ONE component that resolves tab visibility and
    `prefers-reduced-motion` into that variable. These two screens shipped
    without it, so it was never set, the fallback `running` applied, and the
    gradient kept animating even while the tab was HIDDEN — a battery cost
    paid for something nobody can see, which is the exact thing the presence
    module exists to prevent.

    `bare` because `AiPageShell` already paints `.ai-wash`; this is here for
    the variables, not for a second background.
  */
  const envStage: "idle" | "processing" | "completed" | "failed" =
    gen.status === "running" || gen.status === "submitting" ? "processing" : gen.status === "done" ? "completed" : gen.status === "error" ? "failed" : "idle";

  return (
    <FrenzAIEnvironment stage={envStage} bare>
    <AiPageShell>
      <FrenzAICrumb tool="Text to Video" />
      <AiDisplayTitle title="Describe it." highlight="We&apos;ll film it." />

      {/* ── INPUT: the dominant surface (§14) ─────────────────────────────── */}
      <AiGlassCard className="mt-5 p-4 sm:p-5">
        <AiField label="Describe your video" hint={`Up to ${KLING_OMNI.prompt.maxChars.toLocaleString("en-US")} characters. Say what happens, and how it should look.`} htmlFor={promptId}>
          <textarea
            id={promptId}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, KLING_OMNI.prompt.maxChars))}
            rows={5}
            placeholder="A slow drone shot over a misty pine forest at sunrise, warm light breaking through the trees…"
            className="w-full resize-y rounded-2xl border-0 bg-white/80 p-3.5 text-[15px] leading-relaxed ring-1 ring-inset ring-black/[0.07] placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          />
        </AiField>
        <p className="mt-1.5 text-right text-[11px] tabular-nums text-muted-foreground">
          {prompt.length.toLocaleString("en-US")} / {KLING_OMNI.prompt.maxChars.toLocaleString("en-US")}
        </p>
        <AiReferenceRail
          className="mt-3.5"
          images={referenceImageUrls}
          onImagesChange={setReferenceImages}
          videoUrl={referenceVideoUrl}
          onVideoChange={setReferenceVideo}
          disabled={gen.status === "submitting" || gen.status === "running"}
        />
      </AiGlassCard>

      {/* ── CORE SETTINGS: the two that change the price most ─────────────── */}
      <AiGlassCard className="mt-4 p-4 sm:p-5" tone="quiet">
        <div className="space-y-4">
          <AiField label="Length">
            <AiSegmented
              ariaLabel="Video length"
              value={String(durationSeconds)}
              onChange={(v) => setDuration(Number(v))}
              options={DURATIONS.map((d) => ({ value: String(d), label: `${d}s` }))}
            />
          </AiField>
          <AiField label="Shape">
            <AiSegmented
              ariaLabel="Aspect ratio"
              value={aspectRatio}
              onChange={setAspect}
              options={[
                { value: "16:9", label: "Landscape", hint: "16:9" },
                { value: "9:16", label: "Portrait", hint: "9:16" },
                { value: "1:1", label: "Square", hint: "1:1" },
              ]}
            />
          </AiField>
        </div>

        <AiAdvancedSettings>
          <AiField label="Quality" hint="Higher quality costs more and takes longer.">
            <AiSegmented
              ariaLabel="Quality"
              value={resolution}
              onChange={setResolution}
              options={[
                { value: "720p", label: "720p" },
                { value: "1080p", label: "1080p" },
                { value: "4k", label: "4K" },
              ]}
            />
          </AiField>
          <AiField label="Sound" hint="Generated audio to match the scene.">
            <AiSegmented
              ariaLabel="Sound"
              value={audio}
              onChange={setAudio}
              options={[
                { value: "off", label: "No sound" },
                { value: "native", label: "Generate sound" },
              ]}
            />
          </AiField>
        </AiAdvancedSettings>
      </AiGlassCard>

      {/* ── STATUS / RESULT ───────────────────────────────────────────────── */}
      {gen.status === "running" ? <AiGenerationStatus className="mt-4" title="Making your video" /> : null}
      {gen.result ? <AiVideoResult className="mt-4" job={gen.result} historyHref={historyHref} onAgain={gen.reset} /> : null}
      {gen.error ? (
        <div className="mt-4 rounded-[1.5rem] bg-rose-50/80 p-4 ring-1 ring-inset ring-rose-200/70" role="alert">
          <p className="text-[14px] font-bold text-rose-900">Generation couldn&apos;t be completed</p>
          <p className="mt-1 text-[13px] leading-snug text-rose-800/85">{gen.error}</p>
        </div>
      ) : null}

      {/* ── COST + GENERATE, always reachable (§19, §21) ──────────────────── */}
      <AiActionBar>
        <AiCost
          totalCents={gen.quote?.totalCents ?? null}
          currencySymbol={currencySymbol}
          detail={gen.quote ? `${gen.quote.billableSeconds}s · ${resolution}` : null}
          loading={gen.quoting}
          problem={gen.quoteProblem}
        />
        <AiGenerateButton onClick={gen.submit} busy={gen.status === "submitting" || gen.status === "running"} disabled={!prompt.trim() || !!gen.quoteProblem} />
      </AiActionBar>
    </AiPageShell>
    </FrenzAIEnvironment>
  );
}
