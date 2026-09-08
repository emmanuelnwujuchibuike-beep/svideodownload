"use client";

import { Download, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { FrenzAICompare } from "@/features/ai/core/frenz-ai-compare";
import { FrenzAICore } from "@/features/ai/core/frenz-ai-core";
import { FrenzAIReveal } from "@/features/ai/core/frenz-ai-reveal";
import { FrenzAICrumb, FrenzAITrustRow } from "@/features/ai/frenz-ai-chrome";
import { useHistory } from "@/features/history/use-history";
import type { AiJobView } from "@/lib/ai/jobs";
import { cleanedFileName } from "@/lib/ai/clean-media";
import { cn, formatBytes, formatDuration } from "@/lib/utils";

/**
 * The finished video.
 *
 * ── 🔴 THE LINK IS FETCHED, NOT STORED ───────────────────────────────────────
 *
 * The result lives in a private bucket with no read policy, so playing it needs
 * a signed URL — and that URL expires in minutes. It is therefore requested
 * when this panel mounts and requested AGAIN when the member presses Download,
 * because a link that was valid when the page loaded is very often dead by the
 * time somebody has watched the video and decided to keep it. Holding one in
 * state for the length of a session would produce exactly that failure, and it
 * would look like the file was gone.
 *
 * ── The reveal, and the proof (2026-09-07) ───────────────────────────────────
 *
 * A result does not appear — it materialises, then its controls follow a beat
 * later (FrenzAIReveal). One 620ms animation, once, so the finished video reads
 * as something that was made rather than something that loaded.
 *
 * And it can be checked. "Before" puts the original beside the result on a
 * dragging divider, which for a text-removal tool is the difference between
 * claiming it worked and showing it. That comparison decodes ONE frame from each
 * file and then releases both video elements — see FrenzAICompare for why two
 * playing videos was the wrong build.
 *
 * ── What the member is told about their audio ────────────────────────────────
 *
 * The model returns video with no sound, and Part 4's worker muxes the original
 * back on. `audioRestored` records what actually happened, and there are three
 * different truths to tell — sound is back, the source never had any, or we do
 * not know because the row predates this. They are said differently, because
 * "no audio" and "we could not restore your audio" are not the same sentence
 * and a member can tell.
 */
type View = "result" | "compare";

export function AICleanResult({
  job,
  fetchResultUrl,
  fetchSourceUrl,
  onStartAnother,
}: {
  job: AiJobView;
  fetchResultUrl: (forDownload?: boolean) => Promise<string | null>;
  /** Optional: without it, the comparison is simply not offered. */
  fetchSourceUrl?: () => Promise<string | null>;
  onStartAnother: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [view, setView] = useState<View>("result");
  const { addDownload } = useHistory();

  useEffect(() => {
    let alive = true;
    (async () => {
      const url = await fetchResultUrl();
      if (!alive) return;
      setPreviewUrl(url);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [fetchResultUrl]);

  /*
    The original, fetched separately and quietly. It is only needed for the
    comparison, so its failure must never delay or disturb the result itself —
    the toggle simply does not appear.
  */
  useEffect(() => {
    if (!fetchSourceUrl) return;
    let alive = true;
    (async () => {
      const url = await fetchSourceUrl();
      if (alive) setSourceUrl(url);
    })();
    return () => {
      alive = false;
    };
  }, [fetchSourceUrl]);

  const canCompare = !!previewUrl && !!sourceUrl;

  /*
    ── 🔴 SAME-ORIGIN, AND IT LANDS IN HISTORY ────────────────────────────────

    Owner, 2026-09-08, with a screenshot of Safari on a supabase.co file page
    offering "Open in WA Business": "the frenz ai result video downloads like
    this, it should download through the platform download pipeline and save in
    history."

    Two separate faults, both fixed here.

    1. IT LEFT THE SITE. Pointing an `<a download>` at a foreign origin makes
       the browser ignore the attribute and navigate, so the member ended up on
       Supabase's own preview page. The link is now OUR route with
       `?download=1&redirect=1`, which 302s to a freshly-signed url carrying a
       `Content-Disposition` — a same-origin click that saves a file, exactly
       like every other download in this app.

    2. IT WAS INVISIBLE AFTERWARDS. A cleaned video was the only thing this
       product could produce that never appeared in Downloads. It is recorded
       through the SAME store the downloader writes to, so it shows up in
       history, in the rail, and on other devices via the store's own sync.

    `directUrl` is the field that makes a retry work later: history's default
    retry path is the /api/download pipeline, which cannot fetch an AI result.
    That field exists precisely for records whose bytes come from somewhere
    else — wallpapers set it for the same reason — and because our route
    re-signs on every request, the stored url keeps working for the three days
    the file is kept.
  */
  const downloadHref = `/api/ai/jobs/${encodeURIComponent(job.id)}/result?download=1&redirect=1`;

  const download = () => {
    setDownloading(true);

    addDownload({
      url: downloadHref,
      directUrl: downloadHref,
      platform: "generic",
      platformName: "Frenz AI",
      title: cleanedFileName(job.source.name),
      thumbnail: null,
      formatId: "ai-clean",
      kind: "video",
      qualityLabel: "AI Clean",
      size: job.result.size ?? null,
      durationSeconds: job.source.durationSeconds ?? null,
      status: "completed",
    });

    const a = document.createElement("a");
    a.href = downloadHref;
    // Same-origin now, so this is honoured and names the file.
    a.download = cleanedFileName(job.source.name);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();

    // The navigation is the browser's from here; the button should not sit
    // disabled waiting for something that will never call back.
    setTimeout(() => setDownloading(false), 1200);
  };

  return (
    <div className="p-4 sm:p-6">
      {/*
        ── 🔴 THIS SCREEN CARRIES ITS OWN HEADING NOW ───────────────────────

        Owner, 2026-09-08: "remove the hero from the video is ready page and
        upgrade the video is ready page to look more premium."

        The shared `FrenzAIHeader` is suppressed for this state in the workspace,
        so what was a small centred line under a duplicated title becomes the
        page's own opening: the breadcrumb every other Frenz AI screen has, and
        a headline at the same weight as "Clean your videos with AI."

        The Core stays, small, beside the words rather than stacked above them.
        `settled` is the whole point of it here — the environment comes back
        down after the work, which is the visual full stop on the job.
      */}
      <FrenzAICrumb tool="AI Clean" />

      <div className="mt-3.5 flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          <FrenzAICore presence="settled" size="md" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[1.6rem] font-bold leading-[1.1] tracking-[-0.035em] sm:text-[1.9rem]">
            Your video is <span className="text-gradient">ready</span>.
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            {job.result.audioRestored === true
              ? "Text removed, original audio back on it."
              : job.result.audioRestored === false
                ? "Text removed. This video had no sound to restore."
                : "Text removed and ready to save."}
          </p>
        </div>
      </div>

      {canCompare ? (
        <div className="mx-auto mt-4 flex w-fit rounded-full bg-secondary p-1">
          {(["result", "compare"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setView(tab)}
              aria-pressed={view === tab}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold transition",
                view === tab ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab === "result" ? "Result" : "Before / after"}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4">
        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-2xl bg-black/90 text-white/60">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
            <span className="sr-only">Loading your video</span>
          </div>
        ) : previewUrl ? (
          <FrenzAIReveal>
            <div className={view === "result" ? undefined : "hidden"}>
              <div className="overflow-hidden rounded-2xl bg-black/90">
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="mx-auto block max-h-[46vh] w-full object-contain"
                />
              </div>
            </div>
            {/*
              Mounted alongside rather than swapped in, so switching tabs does
              not re-run the frame capture. Hidden with a class, not unmounted:
              the two decodes happen once for the life of this panel.
            */}
            {canCompare && sourceUrl ? (
              <div className={view === "compare" ? undefined : "hidden"}>
                <FrenzAICompare beforeUrl={sourceUrl} afterUrl={previewUrl} />
              </div>
            ) : null}
          </FrenzAIReveal>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-2xl bg-black/90 px-6 text-center text-sm text-white/70">
            That link has expired. Press Download and we&apos;ll make a fresh one.
          </div>
        )}
      </div>

      {/*
        The facts, on one surface rather than loose on the page. Three numbers
        floating under a video read as debug output; the same three inside a
        card read as a receipt for work that was done.
      */}
      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-border/60 bg-card/95 p-3">
        <Fact label="Size" value={job.source.size ? formatBytes(job.source.size) : null} />
        <Fact
          label="Length"
          value={job.source.durationSeconds ? formatDuration(job.source.durationSeconds) : null}
        />
        <Fact label="Took" value={job.durationMs ? formatDuration(Math.round(job.durationMs / 1000)) : null} />
      </dl>

      {/*
        🔴 DOWNLOAD IS THE FULL-WIDTH GRADIENT ACTION.

        It was one of two equal-weight buttons in a reversed row, which made
        saving the video — the entire reason somebody is on this screen — look
        exactly as important as starting over. It now gets the same treatment as
        "Try AI Clean" on the welcome page, and "Clean another" steps back to a
        quiet secondary underneath it.
      */}
      <div className="mt-4 flex flex-col gap-2.5">
        <button
          type="button"
          onClick={download}
          disabled={downloading}
          className={cn(
            "group inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5",
            "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500",
            "text-sm font-bold text-white shadow-[0_14px_34px_-12px_rgb(99_102_241/0.95)]",
            "transition duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
            "disabled:opacity-70 disabled:hover:translate-y-0",
          )}
        >
          <Download className="h-4 w-4" aria-hidden />
          {downloading ? "Preparing…" : "Download video"}
        </button>

        <button
          type="button"
          onClick={onStartAnother}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border/70 bg-card/95 px-6 py-3 text-sm font-semibold transition hover:border-foreground/20 active:scale-[0.99]"
        >
          <RotateCcw className="h-4 w-4 text-muted-foreground" aria-hidden />
          Clean another video
        </button>
      </div>

      {/*
        The retention line, quietly. It used to also repeat the audio sentence
        that now sits under the headline — saying it twice on one short screen
        made it read as a disclaimer rather than as a fact.
      */}
      <p className="mt-3.5 text-center text-xs leading-relaxed text-muted-foreground">
        Kept privately for three days, then deleted.
      </p>

      <FrenzAITrustRow className="mt-4" />
    </div>
  );
}

/** `null` renders as an em-dash. Not measured is not zero. */
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 text-center">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold tabular-nums">
        {value ?? <span className="font-medium text-muted-foreground">&mdash;</span>}
      </dd>
    </div>
  );
}
