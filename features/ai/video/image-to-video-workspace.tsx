"use client";

import { useCallback, useId, useMemo, useState } from "react";

import { AiActionBar, AiAdvancedSettings, AiCost, AiField, AiGenerateButton, AiGenerationStatus, AiSegmented } from "@/features/ai/design/ai-generate";
import { AiDisplayTitle, AiGlassCard, AiPageShell } from "@/features/ai/design/ai-surface";
import { FrenzAICrumb } from "@/features/ai/frenz-ai-chrome";
import { AiImageDrop } from "@/features/ai/video/ai-image-drop";
import { AiReferenceRail } from "@/features/ai/video/ai-reference-rail";
import { AiVideoResult } from "@/features/ai/video/ai-video-result";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { useVideoGeneration } from "@/features/ai/video/use-video-generation";
import { KLING_OMNI } from "@/lib/ai/kling/features/capabilities";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  IMAGE TO VIDEO — the workspace
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §14: "make the required input visually dominant". Here that is the photo, so
 * the drop surface is the first and largest thing on the screen and the prompt
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
 * ── Aspect ratio is deliberately absent from the core row ─────────────────
 *
 * §18: only show settings the pipeline takes. With a first frame present the
 * vendor does NOT require an aspect ratio — the frame defines the shape — so
 * offering the control here would invite a member to fight their own photo.
 */

const DURATIONS = [3, 5, 8, 10, 15] as const;

export function ImageToVideoWorkspace({ historyHref, currencySymbol }: { historyHref: string; currencySymbol: string }) {
  const promptId = useId();
  const [firstFrameUrl, setFirst] = useState<string | null>(null);
  const [lastFrameUrl, setLast] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
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

  const input = useMemo(
    () => ({
      firstFrameUrl: firstFrameUrl ?? "",
      ...(lastFrameUrl ? { lastFrameUrl } : {}),
      ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
      // Omitted entirely when empty: the wire schema is strict, and an empty
      // array would re-quote as though something had been attached.
      ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
      ...(referenceVideoUrl ? { referenceVideoUrl } : {}),
      options: { durationSeconds, resolution, audio },
    }),
    [firstFrameUrl, lastFrameUrl, prompt, durationSeconds, resolution, audio, referenceImageUrls, referenceVideoUrl],
  );

  // Image to Video's prompt is optional, so the card falls back to the tool's name.
  const gen = useVideoGeneration({ feature: "image_to_video", input, ready: !!firstFrameUrl, label: prompt.trim() || "From your image" });

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
      <FrenzAICrumb tool="Image to Video" />
      <AiDisplayTitle title="Bring a photo" highlight="to life." />

      {/* ── INPUT: the photo, dominant (§14) ──────────────────────────────── */}
      <AiGlassCard className="mt-5 p-4 sm:p-5">
        <AiImageDrop
          label="Your photo"
          hint="The video opens on this image and animates from it."
          value={firstFrameUrl}
          onChange={setFirst}
          upload={upload}
          accept={KLING_OMNI.images.mimeTypes}
          maxBytes={KLING_OMNI.images.maxBytes}
        />

        <div className="mt-4">
          <AiField label="What should happen?" hint="Optional — describe the motion, or leave it and let the model decide." htmlFor={promptId}>
            <textarea
              id={promptId}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, KLING_OMNI.prompt.maxChars))}
              rows={3}
              placeholder="A slow, gentle push in. The light shifts softly."
              className="w-full resize-y rounded-2xl border-0 bg-white/80 p-3.5 text-[15px] leading-relaxed ring-1 ring-inset ring-black/[0.07] placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            />
          </AiField>
        </div>

        <AiReferenceRail
          className="mt-3.5"
          images={referenceImageUrls}
          onImagesChange={setReferenceImages}
          videoUrl={referenceVideoUrl}
          onVideoChange={setReferenceVideo}
          disabled={gen.status === "submitting" || gen.status === "running"}
        />
      </AiGlassCard>

      {/* ── CORE SETTINGS ─────────────────────────────────────────────────── */}
      <AiGlassCard className="mt-4 p-4 sm:p-5" tone="quiet">
        <AiField label="Length">
          <AiSegmented ariaLabel="Video length" value={String(durationSeconds)} onChange={(v) => setDuration(Number(v))} options={DURATIONS.map((d) => ({ value: String(d), label: `${d}s` }))} />
        </AiField>

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

      {gen.status === "running" ? <AiGenerationStatus className="mt-4" title="Animating your photo" /> : null}
      {gen.result ? <AiVideoResult className="mt-4" job={gen.result} historyHref={historyHref} onAgain={gen.reset} /> : null}
      {gen.error ? (
        <div className="mt-4 rounded-[1.5rem] bg-rose-50/80 p-4 ring-1 ring-inset ring-rose-200/70" role="alert">
          <p className="text-[14px] font-bold text-rose-900">Generation couldn&apos;t be completed</p>
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
        <AiGenerateButton onClick={gen.submit} busy={gen.status === "submitting" || gen.status === "running"} disabled={!firstFrameUrl || !!gen.quoteProblem} />
      </AiActionBar>
    </AiPageShell>
    </FrenzAIEnvironment>
  );
}
