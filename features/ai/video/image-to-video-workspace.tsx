"use client";

import { Clock, Gauge, ImagePlay, Palette } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

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
} from "@/features/ai/design/ai-generate";
import { AiShowcase } from "@/features/ai/design/ai-showcase";
import { AiPageShell, AiPanel, AiToolTitle } from "@/features/ai/design/ai-surface";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { AiImageDrop } from "@/features/ai/video/ai-image-drop";
import { AiReferenceSection } from "@/features/ai/video/ai-reference-section";
import { AiVideoResult } from "@/features/ai/video/ai-video-result";
import { useVideoGeneration } from "@/features/ai/video/use-video-generation";
import { VIDEO_STYLES } from "@/features/ai/video/video-styles";
import { KLING_OMNI } from "@/lib/ai/kling/features/capabilities";
import type { ShowcaseSlide } from "@/lib/ai/showcase/slides";
import { withStyle, type VideoStyle } from "@/lib/ai/video/style";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  IMAGE TO VIDEO — the workspace
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Redesign page 4 (Brief B in docs/FRENZ_AI_REDESIGN_BRIEFS.md, built on the
 * system pages 1–3 set): showcase · credits strip · title ("Bring a photo
 * to life.") · ONE card — Your photo → What should happen? → Video Style →
 * Duration › Quality › → References → Advanced (ending photo, sound) — then
 * the sticky cost + Generate.
 *
 * §14: "make the required input visually dominant". Here that is the photo, so
 * the drop surface is the first and largest thing in the card and the prompt
 * is secondary — the frame alone is already an instruction, and the model
 * animates it whether or not anything is typed.
 *
 * ── 🔴 WHAT THIS TOOL HONESTLY IS (§46) ───────────────────────────────────
 *
 * "Animate a photo into a short video." The photo becomes the clip's FIRST
 * FRAME and the output opens on it — verified: a reachable portrait came back
 * animated and faithful, same person, clothing, lighting and background.
 *
 * It is NOT a reference-image tool, and the copy must never imply it is. A
 * plain reference image is ignored by this API entirely (proven by a controlled
 * run: a pug reference produced a woman), so "guide a video with your photo"
 * would be a promise the engine cannot keep.
 *
 * ── Aspect ratio is deliberately absent ────────────────────────────────────
 *
 * §18: only show settings the pipeline takes. With a first frame present the
 * vendor does NOT require an aspect ratio — the frame defines the shape — so
 * offering the control here would invite a member to fight their own photo.
 * Brief B's mock shows "Aspect Ratio" in that slot; Quality (real, priced)
 * takes it instead.
 *
 * ── Style ──────────────────────────────────────────────────────────────────
 *
 * The same tiles as Text to Video (owner, 2026-10-05). The prompt is optional
 * here, so a chosen style is sent even with nothing typed ("Anime style.");
 * nothing is chosen by default.
 */

const DURATIONS = [3, 5, 8, 10, 15] as const;

export function ImageToVideoWorkspace({
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
  const [firstFrameUrl, setFirst] = useState<string | null>(null);
  const [lastFrameUrl, setLast] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<VideoStyle | null>(null);
  const [durationSeconds, setDuration] = useState<number>(KLING_OMNI.duration.defaultSeconds);
  const [resolution, setResolution] = useState<"720p" | "1080p" | "4k">("720p");
  const [audio, setAudio] = useState<"off" | "native">("off");
  /* Optional references, on top of the first frame — the model keeps a face, a product or a place consistent. Priced by the server. */
  const [referenceImageUrls, setReferenceImages] = useState<string[]>([]);
  const [referenceVideoUrl, setReferenceVideo] = useState<string | null>(null);

  const upload = useCallback(async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/ai/video/upload", { method: "POST", body });
    if (!res.ok) throw new Error("upload failed");
    const json = (await res.json()) as { url: string };
    return json.url;
  }, []);

  const sentPrompt = withStyle(prompt, style, KLING_OMNI.prompt.maxChars, { standalone: true });
  const input = useMemo(
    () => ({
      firstFrameUrl: firstFrameUrl ?? "",
      ...(lastFrameUrl ? { lastFrameUrl } : {}),
      ...(sentPrompt ? { prompt: sentPrompt } : {}),
      // Omitted entirely when empty: the wire schema is strict, and an empty
      // array would re-quote as though something had been attached.
      ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
      ...(referenceVideoUrl ? { referenceVideoUrl } : {}),
      options: { durationSeconds, resolution, audio },
    }),
    [firstFrameUrl, lastFrameUrl, sentPrompt, durationSeconds, resolution, audio, referenceImageUrls, referenceVideoUrl],
  );

  // Image to Video's prompt is optional, so the card falls back to the tool's name.
  const gen = useVideoGeneration({ feature: "image_to_video", input, ready: !!firstFrameUrl, label: prompt.trim() || "From your image" });
  const locked = gen.status === "submitting" || gen.status === "running";

  /*
    `FrenzAIEnvironment` resolves tab visibility and reduced motion into the
    presence variables every AI workspace reads (2026-10-04). `bare` because
    `AiPageShell` already paints the ground.
  */
  const envStage: "idle" | "processing" | "completed" | "failed" =
    gen.status === "running" || gen.status === "submitting" ? "processing" : gen.status === "done" ? "completed" : gen.status === "error" ? "failed" : "idle";

  return (
    <FrenzAIEnvironment stage={envStage} bare>
    <AiPageShell>
      <AiShowcase slides={slides} base={base} desktopOnly className="mb-3" />
      <AiCreditStrip base={base} className="mt-1 lg:mt-0" />

      <AiToolTitle
        icon={ImagePlay}
        title="Image to Video"
        tagline={
          <>
            Bring a photo <span className="text-gradient">to life.</span>
          </>
        }
        body="Turn a still image into a cinematic video with Frenz AI."
        className="mt-6"
      />

      {/* ── THE ONE CARD: the photo first and largest (§14) ──────────────── */}
      <AiPanel className="mt-5 space-y-4">
        <AiImageDrop
          label="Your photo"
          hint="The video opens on this image and animates from it."
          value={firstFrameUrl}
          onChange={setFirst}
          upload={upload}
          accept={KLING_OMNI.images.mimeTypes}
          maxBytes={KLING_OMNI.images.maxBytes}
        />

        <AiPromptBox
          label="What should happen?"
          hint="Optional — describe the motion, or leave it and let the model decide."
          value={prompt}
          onChange={setPrompt}
          max={KLING_OMNI.prompt.maxChars}
          rows={3}
          disabled={locked}
          placeholder="A slow, gentle push in. The light shifts softly."
        />

        <div className="space-y-3">
          <AiStylePicker icon={Palette} label="Video Style" value={style} options={VIDEO_STYLES} onChange={setStyle} disabled={locked} />

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
              icon={Gauge}
              label="Quality"
              value={resolution}
              onChange={setResolution}
              options={[
                { value: "720p", label: "720p" },
                { value: "1080p", label: "1080p" },
                { value: "4k", label: "4K" },
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
        </div>

        <AiAdvancedSettings>
          <AiImageDrop
            label="Ending photo"
            hint="The video finishes on this image, blending from the first."
            optional
            value={lastFrameUrl}
            onChange={setLast}
            upload={upload}
            accept={KLING_OMNI.images.mimeTypes}
            maxBytes={KLING_OMNI.images.maxBytes}
          />
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

      {gen.status === "running" ? <AiGenerationStatus className="mt-4" title="Creating your video…" /> : null}
      {gen.result ? <AiVideoResult className="mt-4" job={gen.result} historyHref={historyHref} onAgain={gen.reset} /> : null}
      {gen.error ? (
        <div className="mt-4 rounded-[1.5rem] bg-rose-50/80 p-4 ring-1 ring-inset ring-rose-200/70" role="alert">
          <p className="text-[14px] font-bold text-rose-900">Something went wrong.</p>
          <p className="mt-1 text-[13px] leading-snug text-rose-800/85">{gen.error}</p>
        </div>
      ) : null}

      <AiActionBar>
        <AiCost
          totalCents={gen.quote?.totalCents ?? null}
          currencySymbol={currencySymbol}
          detail={gen.quote ? `${gen.quote.billableSeconds}s · ${resolution}` : null}
          loading={gen.quoting}
          problem={gen.quoteProblem}
        />
        <AiGenerateButton onClick={gen.submit} busy={locked} disabled={!firstFrameUrl || !!gen.quoteProblem} className="ml-auto min-w-0 flex-1">
          {/* the price takes the bar's left side; under 400 px the full label truncated (page 4 lesson) */}
          <span className="min-[400px]:hidden">Generate</span>
          <span className="hidden min-[400px]:inline">Generate Video</span>
        </AiGenerateButton>
      </AiActionBar>
    </AiPageShell>
    </FrenzAIEnvironment>
  );
}
