"use client";

import { Clock, Palette, Play, RectangleHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

import { AiCreditStrip } from "@/features/ai/design/ai-credit-strip";
import {
  AiActionBar,
  AiAdvancedSettings,
  AiCost,
  AiField,
  AiGenerateButton,
  AiGenerationStatus,
  AiPromptBox,
  AiSegmented,
  AiSettingRow,
  AiStylePicker,
  type AiStyleOption,
} from "@/features/ai/design/ai-generate";
import { AiShowcase } from "@/features/ai/design/ai-showcase";
import { AiPageShell, AiPanel, AiToolTitle } from "@/features/ai/design/ai-surface";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { AiReferenceSection } from "@/features/ai/video/ai-reference-section";
import { AiVideoResult } from "@/features/ai/video/ai-video-result";
import { useVideoGeneration } from "@/features/ai/video/use-video-generation";
import { KLING_OMNI } from "@/lib/ai/kling/features/capabilities";
import type { ShowcaseSlide } from "@/lib/ai/showcase/slides";
import { withStyle, type VideoStyle } from "@/lib/ai/video/style";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT TO VIDEO — the workspace
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Redesign page 3 (owner's reference image, 2026-10-05), top to bottom:
 *
 *     showcase · credits strip
 *     [▷] Text to Video — Describe it. Watch it come to life.
 *     ONE card: prompt (counter inside) · Video Style tiles ·
 *               Duration ›  Aspect Ratio › · Add Reference · Advanced
 *     cost + Generate (sticky, the shared pill)
 *
 * Part 6 §13/§14 still hold: the prompt is the dominant element, the two
 * settings that change the price most are one tap away, everything rarely
 * touched is behind a disclosure, and the price and the button share one
 * sticky bar that never scrolls out of reach on a phone.
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
 * ── 🔴 STYLE IS WORDS IN THE PROMPT, AND SAYS SO ────────────────────────────
 *
 * The reference has style tiles; the model has no style field — it takes the
 * look from the description (owner, 2026-10-04: "realistic, cartoon or anyhow
 * described"). So a chosen style is appended to the prompt sent, here and
 * nowhere else (`withStyle`, lib/ai/video/style.ts), and NOTHING is chosen by default: a member who
 * ignores the tiles sends exactly what they typed, as before. The price does
 * not depend on the prompt, so a style never changes the quote.
 *
 * ── 🔴 THE PRICE IS THE SERVER'S (§19, §55) ────────────────────────────────
 *
 * A priced settings change re-asks `/api/ai/video/quote` (typing does not —
 * see use-video-generation.ts). Nothing here multiplies seconds by a rate. The
 * number the member sees is the number `/jobs` recomputes, and a mismatch
 * refuses rather than silently charging the new one.
 */

const DURATIONS = [3, 5, 8, 10, 15] as const;

/* The owner's own pictures (2026-10-05); the realistic one from the curated wallpaper library. */
const STYLES: readonly AiStyleOption<VideoStyle>[] = [
  { value: "realistic", label: "Realistic", image: "/ai/styles/realistic.webp" },
  { value: "anime", label: "Anime", image: "/ai/styles/anime.webp" },
  { value: "cartoon", label: "Cartoon", image: "/ai/styles/cartoon.webp" },
  { value: "3d", label: "3D", image: "/ai/styles/3d.webp" },
];

export function TextToVideoWorkspace({
  historyHref,
  currencySymbol,
  slides,
  base,
}: {
  historyHref: string;
  currencySymbol: string;
  /** The showcase slides, read by the server page (lib/ai/showcase/server.ts). */
  slides: ShowcaseSlide[];
  /** The door: "/ai" or "/studio/ai". */
  base: string;
}) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<VideoStyle | null>(null);
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
      prompt: withStyle(prompt, style, KLING_OMNI.prompt.maxChars),
      // Omitted entirely when empty: the wire schema is strict, and an empty
      // array would re-quote as though something had been attached.
      ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
      ...(referenceVideoUrl ? { referenceVideoUrl } : {}),
      options: { durationSeconds, aspectRatio, resolution, audio },
    }),
    [prompt, style, durationSeconds, aspectRatio, resolution, audio, referenceImageUrls, referenceVideoUrl],
  );

  const gen = useVideoGeneration({ feature: "text_to_video", input, ready: prompt.trim().length > 0, label: prompt.trim() });
  const locked = gen.status === "submitting" || gen.status === "running";

  /*
    `FrenzAIEnvironment` resolves tab visibility and reduced motion into the
    presence variables every AI workspace reads (2026-10-04). `bare` because
    `AiPageShell` already paints the ground; this is here for the variables,
    not for a second background.
  */
  const envStage: "idle" | "processing" | "completed" | "failed" =
    gen.status === "running" || gen.status === "submitting" ? "processing" : gen.status === "done" ? "completed" : gen.status === "error" ? "failed" : "idle";

  return (
    <FrenzAIEnvironment stage={envStage} bare>
    <AiPageShell>
      <AiShowcase slides={slides} base={base} />
      <AiCreditStrip base={base} className="mt-3" />

      <AiToolTitle
        icon={Play}
        title="Text to Video"
        tagline="Describe it. Watch it come to life."
        body="Turn your ideas into videos with Frenz AI — type a prompt and let it film the scene."
        className="mt-6"
      />

      {/* ── THE ONE CARD: input first and largest (§14), then the settings ─── */}
      <AiPanel className="mt-5 space-y-3">
        <AiPromptBox
          label="Describe your video"
          hint={`Up to ${KLING_OMNI.prompt.maxChars.toLocaleString("en-US")} characters. Be as detailed as you want — scene, style, mood, action.`}
          value={prompt}
          onChange={setPrompt}
          max={KLING_OMNI.prompt.maxChars}
          rows={5}
          disabled={locked}
          placeholder="A cinematic shot of a futuristic city at sunset, with flying cars, neon lights and a dramatic sky…"
        />

        <AiStylePicker icon={Palette} label="Video Style" value={style} options={STYLES} onChange={setStyle} disabled={locked} />

        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
          <AiSettingRow
            icon={Clock}
            label="Duration"
            value={String(durationSeconds)}
            onChange={(v) => setDuration(Number(v))}
            options={DURATIONS.map((d) => ({ value: String(d), label: `${d} seconds` }))}
            disabled={locked}
          />
          <AiSettingRow
            icon={RectangleHorizontal}
            label="Aspect Ratio"
            value={aspectRatio}
            onChange={setAspect}
            options={[
              { value: "16:9", label: "16:9 (Landscape)" },
              { value: "9:16", label: "9:16 (Portrait)" },
              { value: "1:1", label: "1:1 (Square)" },
            ]}
            disabled={locked}
          />
        </div>

        <AiReferenceSection
          images={referenceImageUrls}
          onImagesChange={setReferenceImages}
          videoUrl={referenceVideoUrl}
          onVideoChange={setReferenceVideo}
          disabled={locked}
        />

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
      </AiPanel>

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
        <AiGenerateButton onClick={gen.submit} busy={locked} disabled={!prompt.trim() || !!gen.quoteProblem} className="ml-auto min-w-0 flex-1">
          Generate Video
        </AiGenerateButton>
      </AiActionBar>
    </AiPageShell>
    </FrenzAIEnvironment>
  );
}
