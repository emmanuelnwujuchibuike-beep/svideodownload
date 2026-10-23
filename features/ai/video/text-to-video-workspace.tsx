"use client";

import { ChevronRight, Clock, Palette, RectangleHorizontal, Users } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AiActionBar,
  AiAdvancedSettings,
  AiCost,
  AiCreateHeader,
  AiField,
  AiGenerateButton,
  AiGenerationStatus,
  AiPromptBox,
  AiSegmented,
  AiSettingRow,
  AiSettingsList,
  AiStylePicker,
} from "@/features/ai/design/ai-generate";
import { PromptIdeas } from "@/features/ai/prompts/prompt-ideas";
import { scrollToSection, showInsertedPrompt } from "@/features/ai/prompts/show-inserted";
import { FreeVideoNotice } from "@/features/ai/video/free-video-notice";
import { AiShowcase } from "@/features/ai/design/ai-showcase";
import { AiDictationButton } from "@/features/ai/design/ai-dictation";
import { AiPageShell } from "@/features/ai/design/ai-surface";
import { VideoModelRow } from "@/features/ai/video/video-model-row";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { AiReferenceSection } from "@/features/ai/video/ai-reference-section";
import { AiVideoResult } from "@/features/ai/video/ai-video-result";
import { VIDEO_STYLES } from "@/features/ai/video/video-styles";
import type { ReplaceDraft } from "@/features/ai/video/replace-characters-screen";
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

/*
  Replace characters (design/ReplaceCharacters.dc.html, 2026-10-22): its own chunk, fetched only when the
  member opens it — Text to Video's first paint carries none of it.
*/
const ReplaceCharactersScreen = dynamic(() => import("@/features/ai/video/replace-characters-screen").then((m) => m.ReplaceCharactersScreen), { ssr: false });



export function TextToVideoWorkspace({
  historyHref,
  slides,
  base,
  oneMinute = false,
  characterReplace = false,
}: {
  /** Character Replace is on sale (or the viewer is an admin previewing it) — the page decides (lib/ai/kling/pricing.ts characterReplaceOnSale). */
  characterReplace?: boolean;
  /** The admin's one-minute switch (Kling pricing). On: a "1 minute" length is offered. */
  oneMinute?: boolean;
  historyHref: string;
  /** Unused since 0184 (the cost is in credits); kept so the pages need not change. */
  currencySymbol?: string;
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
  const [audio, setAudio] = useState<"off" | "native" | "original">("off");
  /* Optional references — the model keeps a face, a product or a place consistent. Priced by the server. */
  const [referenceImageUrls, setReferenceImages] = useState<string[]>([]);
  const [referenceVideoUrl, setReferenceVideo] = useState<string | null>(null);
  // the worker's signed measurement of that video — the server checks and prices it from this (2026-10-19)
  const [referenceVideoToken, setReferenceVideoToken] = useState<string | null>(null);
  // its storage path (Replace characters finds the people in THAT object), and each reference image's path
  const [referenceVideoPath, setReferenceVideoPath] = useState<string | null>(null);
  const [imagePaths, setImagePaths] = useState<Record<string, string>>({});
  /*
    🔴 REPLACE CHARACTERS (2026-10-22). Saved choices turn Generate into a Character Replace job on this
    same video — `full_character`, priced and validated by the server from the signed inspection — and
    the prompt becomes the optional "other changes". Cleared with the video it was made for.
  */
  const [replaceDraft, setReplaceDraft] = useState<ReplaceDraft | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  /*
    🔴 A reference video brings ITS OWN SOUND by default (owner, 2026-10-07:
    "reference videos don't take the audio from the reference video"). Kling's
    `audio: "original"` keeps it — proven by generation, no extra cost
    (lib/ai/kling/features/capabilities.ts). Attaching a video selects it;
    removing the video drops it (it needs a video). A minute can't use a
    reference video, so the 60 s choice steps back to the default.
  */
  useEffect(() => {
    if (referenceVideoUrl) {
      setAudio("original");
      setDuration((d) => (d === 60 ? KLING_OMNI.duration.defaultSeconds : d));
    } else {
      setReferenceVideoToken(null);
      setReferenceVideoPath(null);
      setAudio((a) => (a === "original" ? "off" : a));
    }
  }, [referenceVideoUrl]);
  // replacements belong to the video they were chosen on
  useEffect(() => {
    setReplaceDraft((d) => (d && d.videoPath === referenceVideoPath ? d : null));
  }, [referenceVideoPath]);
  /*
    🔴 What the reference video is FOR, and how long it is (2026-10-06).
    "base" = edit that clip (keep its scene and motion, apply the prompt) — what
    members were asking for; "feature" = only follow its motion and style. The
    length is read from the clip once (metadata only): an edit comes back at
    the clip length whatever duration is picked, and the server prices it so.
  */
  const [referenceVideoMode, setReferenceVideoMode] = useState<"base" | "feature">("base");
  const [referenceVideoSeconds, setReferenceVideoSeconds] = useState<number | null>(null);
  useEffect(() => {
    setReferenceVideoSeconds(null);
    if (!referenceVideoUrl) return;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) setReferenceVideoSeconds(Math.round(v.duration * 100) / 100);
      v.removeAttribute("src");
      v.load();
    };
    v.onloadedmetadata = done;
    v.src = referenceVideoUrl;
    return () => {
      v.onloadedmetadata = null;
      v.removeAttribute("src");
    };
  }, [referenceVideoUrl]);

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
      ...(referenceVideoUrl
        ? {
            referenceVideoUrl,
            referenceVideoMode,
            ...(referenceVideoSeconds ? { referenceVideoSeconds } : {}),
            // 🔴 required by the server with any video — without it the quote and the job refuse the clip
            ...(referenceVideoToken ? { referenceVideoToken } : {}),
          }
        : {}),
      options: { durationSeconds, aspectRatio, resolution, audio },
    }),
    [prompt, style, durationSeconds, aspectRatio, resolution, audio, referenceImageUrls, referenceVideoUrl, referenceVideoMode, referenceVideoSeconds, referenceVideoToken],
  );

  const replacing = characterReplace && !!referenceVideoUrl && referenceVideoMode === "base" && !!replaceDraft && replaceDraft.targets.length > 0;
  // an edit keeps the video's own sound or has none — never generated sound (Kling's base-video rule)
  const editAudio: "original" | "off" = audio === "off" ? "off" : "original";
  const replaceInput = useMemo(() => {
    if (!replaceDraft) return null;
    const words = withStyle(prompt, style, KLING_OMNI.prompt.maxChars).trim();
    return {
      inspection: replaceDraft.inspection,
      targets: replaceDraft.targets.map((t) => ({ personId: t.personId, ...(t.description.trim() ? { description: t.description.trim() } : {}), referencePaths: t.photos.map((p) => p.path) })),
      ...(words ? { instructions: words } : {}),
      // saved only after the member ticked the permission box on the Replace characters screen
      consent: true as const,
      options: { resolution, audio: editAudio },
    };
  }, [replaceDraft, prompt, style, resolution, editAudio]);
  const referencePhotos = useMemo(() => referenceImageUrls.flatMap((url) => (imagePaths[url] ? [{ url, path: imagePaths[url]! }] : [])), [referenceImageUrls, imagePaths]);

  const gen = useVideoGeneration(
    replacing && replaceInput
      ? { feature: "full_character", input: replaceInput, ready: true, label: prompt.trim() || "Character Replace" }
      : { feature: "text_to_video", input, ready: prompt.trim().length > 0, label: prompt.trim() },
  );
  // prompt suggestions (2026-10-15): they only ever set the prompt text; these let them show it and point at the references
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const referencesRef = useRef<HTMLDivElement | null>(null);
  const assets = useMemo(
    () => ({ firstFrame: false, referenceImages: referenceImageUrls.length, referenceVideo: !!referenceVideoUrl, referenceVideoMode }),
    [referenceImageUrls.length, referenceVideoUrl, referenceVideoMode],
  );
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
      <AiShowcase slides={slides} base={base} desktopOnly className="mb-3" />
      {/*
        Step 18 (design/TextToVideo.dc.html, owner 2026-10-19): "‹ Studio", the tool's name, the balance; the
        prompt first (with Explore prompts and the dictation mic inside it), the style tiles, the Settings list,
        the references, Advanced settings, and the glass Generate bar pinned to the bottom (the tab bar is hidden
        on this screen — mobile-nav AI_CREATION_SCREEN). Every control is the one this page already had.
      */}
      <AiCreateHeader backHref={`${base}/character-replace`} title="Text to Video" tagline="Describe it. Watch it come to life." />

      <div className="frenz-ui mt-5 space-y-5">
        <AiPromptBox
          inputRef={promptRef}
          label="Describe your video"
          value={prompt}
          onChange={setPrompt}
          max={KLING_OMNI.prompt.maxChars}
          rows={5}
          disabled={locked}
          placeholder="A cinematic shot of a futuristic city at sunset, with flying cars, neon lights and a dramatic sky…"
          footer={
            <>
              {/* Prompt ideas (owner, 2026-10-15): the library loads on the first tap */}
              <PromptIdeas
                variant="inline"
                mode="text_to_video"
                prompt={prompt}
                onPromptChange={setPrompt}
                max={KLING_OMNI.prompt.maxChars}
                assets={assets}
                onShowReferences={() => scrollToSection(referencesRef.current)}
                onUseEditMode={() => setReferenceVideoMode("base")}
                onInserted={() => showInsertedPrompt(promptRef.current)}
                base={base}
                disabled={locked}
              />
              <AiDictationButton value={prompt} onChange={setPrompt} max={KLING_OMNI.prompt.maxChars} disabled={locked} />
            </>
          }
        />

        <AiStylePicker icon={Palette} label="Style" value={style} options={VIDEO_STYLES} onChange={setStyle} disabled={locked} />

        <AiSettingsList>
          <VideoModelRow disabled={locked} />
          <AiSettingRow
            icon={Clock}
            label="Duration"
            value={String(durationSeconds)}
            onChange={(v) => setDuration(Number(v))}
            options={[...DURATIONS.map((d) => ({ value: String(d), label: `${d} sec` })), ...(oneMinute && !referenceVideoUrl ? [{ value: "60", label: "1 minute" }] : [])]}
            disabled={locked}
          />
          <AiSettingRow
            icon={RectangleHorizontal}
            label="Aspect ratio"
            value={aspectRatio}
            onChange={setAspect}
            options={[
              { value: "16:9", label: "16:9" },
              { value: "9:16", label: "9:16" },
              { value: "1:1", label: "1:1" },
            ]}
            disabled={locked}
          />
        </AiSettingsList>

        <div ref={referencesRef} className="scroll-mt-24">
          <AiReferenceSection
            images={referenceImageUrls}
            onImagesChange={setReferenceImages}
            videoUrl={referenceVideoUrl}
            onVideoChange={setReferenceVideo}
            onVideoUploaded={(v) => {
              setReferenceVideoToken(v.token ?? null);
              setReferenceVideoPath(v.path);
            }}
            onImageUploaded={(img) => setImagePaths((m) => ({ ...m, [img.url]: img.path }))}
            disabled={locked}
          />
        </div>

        {referenceVideoUrl ? (
          <AiField
            label="Use the reference video to"
            hint={
              referenceVideoMode === "base"
                ? `Your video is kept — its scene, motion and camera — and your prompt and reference images change it. The result is as long as your video${referenceVideoSeconds ? ` (${Math.round(referenceVideoSeconds)} s)` : ""}.`
                : "Only the motion and style of your video are followed; everything else comes from your prompt."
            }
          >
            <AiSegmented
              ariaLabel="Use the reference video to"
              value={referenceVideoMode}
              onChange={setReferenceVideoMode}
              options={[
                { value: "base", label: "Edit this video" },
                { value: "feature", label: "Copy its motion" },
              ]}
            />
          </AiField>
        ) : null}

        {characterReplace && referenceVideoUrl && referenceVideoMode === "base" ? (
          <div>
            <button
              type="button"
              onClick={() => setReplaceOpen(true)}
              disabled={locked || !referenceVideoPath}
              className="flex min-h-[3.5rem] w-full items-center gap-3 rounded-[20px] border border-frenz-line bg-frenz-card px-3.5 text-left shadow-frenz-card disabled:opacity-55"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-frenz-violet/10 text-frenz-violet">
                <Users className="h-[17px] w-[17px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-frenz-ink">Replace characters</span>
              <span className="truncate text-[14px] text-frenz-muted">{replacing ? (replaceDraft!.targets.length === 1 ? "1 person" : `${replaceDraft!.targets.length} people`) : "Off"}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-frenz-muted" aria-hidden />
            </button>
            <p className="m-0 mt-1.5 px-1 text-[11.5px] leading-snug text-frenz-muted">
              {replacing
                ? "The people you chose become the people in your photos. Your prompt is optional here — use it for any other changes. Reference images aren't used while replacing."
                : "Swap up to two people in your video for the people in your photos."}
            </p>
          </div>
        ) : null}

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
          <AiField label="Sound" hint={audio === "original" ? "The reference video's own sound, kept as it is." : "Generated audio to match the scene."}>
            <AiSegmented
              ariaLabel="Sound"
              value={audio}
              onChange={setAudio}
              options={[
                { value: "off", label: "No sound" },
                ...(referenceVideoUrl ? [{ value: "original" as const, label: "Keep video's sound" }] : []),
                // a replacement is an edit: no generated sound
                ...(replacing ? [] : [{ value: "native" as const, label: "Generate sound" }]),
              ]}
            />
          </AiField>
        </AiAdvancedSettings>
      </div>

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
      <FreeVideoNotice offer={gen.freeOffer} className="mt-4" />
      <AiActionBar docked>
        <AiCost
          credits={gen.complimentary ? 0 : (gen.quote?.credits ?? null)}
          detail={gen.quote ? `${gen.quote.billableSeconds}s · ${resolution}` : null}
          funding={gen.complimentary ? { label: "Your complimentary video", hint: "free" } : undefined}
          loading={gen.quoting}
          problem={gen.quoteProblem}
        />
        <AiGenerateButton onClick={gen.submit} busy={locked} disabled={(!replacing && !prompt.trim()) || !!gen.quoteProblem} className="ml-auto min-w-0 flex-1">
          {/* the price takes the bar's left side; under 400 px the full label truncated (page 4 lesson) */}
          <span className="min-[400px]:hidden">Generate</span>
          <span className="hidden min-[400px]:inline">Generate video</span>
        </AiGenerateButton>
      </AiActionBar>
      {replaceOpen && referenceVideoUrl && referenceVideoPath ? (
        <ReplaceCharactersScreen
          videoUrl={referenceVideoUrl}
          videoPath={referenceVideoPath}
          initial={replaceDraft}
          referencePhotos={referencePhotos}
          resolution={resolution}
          audio={editAudio}
          onSave={(draft) => {
            setReplaceDraft(draft);
            setReplaceOpen(false);
          }}
          onClose={() => setReplaceOpen(false)}
        />
      ) : null}
    </AiPageShell>
    </FrenzAIEnvironment>
  );
}
