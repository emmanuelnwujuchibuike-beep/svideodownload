"use client";

import { ArrowLeft, Bookmark, BookmarkCheck, Check, ChevronDown, Columns2, Download, History, Loader2, Maximize2, Share2, Smartphone, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { aiResultDownloadHref, startAiResultDownload } from "@/features/ai/ai-result-download";
import { VideoReadyPlayer, type VideoReadyPlayerHandle } from "@/features/ai/character-replace/video-ready-player";
import { useDownloadManager } from "@/features/downloads/use-download-manager";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import { REPLACEMENT_MODE_COPY } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceResult } from "@/lib/ai/character-replace/types";
import { formatSeconds } from "@/lib/ai/character-replace/workspace";
import { deleteAiJob, getAiJobSource, saveAiJob } from "@/lib/ai/client";
import { formatCents } from "@/lib/ai/economy";
import { resultFileName, resultSuffixFor } from "@/lib/ai/media";
import { track } from "@/lib/analytics/client";
import { isIosDevice } from "@/lib/client-download";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VIDEO READY — Frenz AI Studio's result (Part 7)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-14 (the Video Ready brief, then Part 7 §2, §14, §28): the
 * VIDEO is the hero; Download is the one primary action; Save and Share are
 * the two quiet ones; details fold away; "Create Another" and history are
 * secondary. Top to bottom on a phone: video → Download → Save · Share →
 * details → the rest. Nothing here is a developer dashboard.
 *
 * ── The master is the model's output ────────────────────────────────────────
 * What plays is the stored file over a short signed URL; what downloads is
 * the same bytes through the same-origin result route (no transform, no
 * re-encode). No CSS filter touches the frame. Comparison (§5) streams the
 * PREPARED cut — the exact input the model received — through the same
 * signed-URL route, only when the member switches to it, one element at a
 * time, resuming at the same second.
 *
 * ── What each platform can honestly do ──────────────────────────────────────
 *   · iOS: Download hands the file to the share sheet (the download manager
 *     already does this), where "Save Video" puts it in Photos.
 *   · Android: Download saves to the device; Share (Web Share with a file)
 *     lists Google Photos and the rest as targets.
 *   · Desktop: Download saves the master; Share falls back to the download
 *     with a sentence saying so (§10) — no public link is ever minted (§11).
 *
 * ── Money (§34) ──────────────────────────────────────────────────────────────
 * Nothing on this screen touches the balance: opening, playing, saving,
 * sharing and downloading are free; the charge happened at Start.
 */
export function CharacterReplaceResultScreen({
  result,
  config,
  historyHref,
  onMakeAnother,
  onBack,
  onDeleted,
  onJobChanged,
  className,
}: {
  result: CharacterReplaceResult;
  config: CharacterReplacePublicConfig | null;
  historyHref: string;
  /** "Create Another": `keepPhoto` reuses the character photo still in the browser's hand (§15–§16). */
  onMakeAnother: (opts?: { keepPhoto?: boolean }) => void;
  /** The header's Back. Defaults to "make another" (the workspace, fresh). */
  onBack?: () => void;
  /** After a confirmed delete: the page shows its deleted state. */
  onDeleted?: () => void;
  /** A refreshed view after save/unsave, so the caller's copy agrees. */
  onJobChanged?: (job: CharacterReplaceResult["job"]) => void;
  className?: string;
}) {
  const player = useRef<VideoReadyPlayerHandle | null>(null);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!!result.job.characterReplace?.savedAt);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [canReusePhoto, setCanReusePhoto] = useState(false);
  /* §5 — comparison: which source is on screen, and the original's signed URL once asked for */
  const [view, setView] = useState<"result" | "original">("result");
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [originalState, setOriginalState] = useState<"idle" | "loading" | "unavailable">("idle");
  /* §8 — the download task this screen started, followed through the manager */
  const [taskId, setTaskId] = useState<string | null>(null);
  const { tasks } = useDownloadManager();
  const task = useMemo(() => (taskId ? tasks.find((t) => t.id === taskId) ?? null : null), [taskId, tasks]);

  // Read in an effect: the server markup has no platform, and a mismatch is a hydration error.
  useEffect(() => {
    setPlatform(isIosDevice() ? "ios" : /android/i.test(navigator.userAgent) ? "android" : "other");
    setCanShareFiles(typeof navigator.share === "function" && typeof navigator.canShare === "function");
  }, []);
  useEffect(() => setSaved(!!result.job.characterReplace?.savedAt), [result.job.characterReplace?.savedAt]);
  useEffect(() => {
    // §33 — once per result opened; the id is the only property, and it is the member's own.
    track("character_replace_result_viewed", { mode: result.mode ?? "full_character", quality: result.quality ?? null });
  }, [result.job.id, result.mode, result.quality]);

  const cr = result.job.characterReplace;
  const mode = result.mode ?? "full_character";
  const modeView = config?.modes.find((m) => m.id === mode) ?? null;
  const quality = modeView?.tiers.find((t) => t.id === result.quality)?.label ?? config?.qualities.find((q) => q.id === result.quality)?.label ?? result.quality ?? "—";
  const out = cr?.output ?? null;
  const resolution = out?.width && out?.height ? `${out.width}×${out.height}` : null;
  const fps = out?.frameRate && Number.isFinite(out.frameRate) ? `${Math.round(out.frameRate * 100) / 100} fps` : null;
  const newVoice = result.voice?.mode === "new_voice";
  const language = newVoice && cr?.languageCode ? (config?.languages.find((l) => l.code === cr.languageCode)?.label ?? cr.languageCode) : null;
  const voiceName = newVoice && cr?.voiceId ? (config?.voices.find((v) => v.id === cr.voiceId)?.label ?? null) : null;
  const audioLine = newVoice ? (result.voice?.source === "upload" ? "Your audio" : "New voice") : "Original";
  const lipTier = result.lipSync?.tier ? (config?.lipSync.find((l) => l.id === result.lipSync?.tier)?.label ?? result.lipSync.tier) : null;
  const poster = result.job.result.hasPoster ? `/api/ai/jobs/${encodeURIComponent(result.job.id)}/poster` : null;
  const attempt = cr?.attempt ?? 1;
  const symbol = cr?.currency === "NGN" ? "₦" : cr?.currency === "USD" ? "$" : cr?.currency === "GHS" ? "GH₵" : (config?.symbol ?? "");
  const keptDays = config?.retention.savedResultDays ?? 30;
  const keptHours = config?.retention.resultHours ?? 72;

  /* ── download (§7–§8): the platform's one implementation, its states shown here ── */
  const download = useCallback(() => {
    if (task && (task.status === "queued" || task.status === "preparing" || task.status === "downloading")) return;
    track("character_replace_download_clicked", { mode });
    const id = startAiResultDownload(result.job);
    setTaskId(id);
  }, [mode, result.job, task]);
  const downloadLabel =
    task?.status === "preparing" || task?.status === "queued"
      ? "Preparing download…"
      : task?.status === "downloading"
        ? `Downloading… ${task.totalBytes > 0 ? `${Math.round((task.receivedBytes / task.totalBytes) * 100)}%` : ""}`.trim()
        : task?.status === "completed"
          ? task.awaitingSave
            ? "Tap to save to Photos"
            : "Download ready"
          : task?.status === "failed"
            ? "Download failed — try again"
            : "Download Video";
  const downloadBusy = task?.status === "preparing" || task?.status === "queued" || task?.status === "downloading";

  /* ── share (§10–§11): a FILE through the share sheet, or the honest fallback; never a public link ── */
  const share = useCallback(async () => {
    if (sharing) return;
    haptic("light");
    setSharing(true);
    setShareNote(null);
    track("character_replace_shared", { mode, method: canShareFiles ? "share-sheet" : "download" });
    try {
      if (!canShareFiles) {
        setShareNote("Sharing from this browser saves the video first — share it from your files.");
        startAiResultDownload(result.job);
        return;
      }
      const res = await fetch(aiResultDownloadHref(result.job.id), { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], resultFileName(result.job.source.name, resultSuffixFor(result.job.feature)), { type: blob.type || "video/mp4" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "My Character Replace video" });
      } else {
        setShareNote("This device can't share a video file directly — it has been saved instead.");
        startAiResultDownload(result.job);
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) {
        setShareNote("Sharing didn't work here — the video has been saved instead.");
        startAiResultDownload(result.job);
      }
    } finally {
      setSharing(false);
    }
  }, [canShareFiles, mode, result.job, sharing]);

  /* ── save (§9): kept for the saved window; no copy, no charge ── */
  const toggleSave = useCallback(async () => {
    if (saving) return;
    haptic("selection");
    setSaving(true);
    const next = !saved;
    const res = await saveAiJob(result.job.id, next);
    setSaving(false);
    if (res.ok) {
      setSaved(res.saved);
      if (res.saved) track("character_replace_saved", { mode });
      onJobChanged?.(res.job);
    }
  }, [mode, onJobChanged, result.job.id, saved, saving]);

  /* ── delete (§20): confirmed, then the files go; the ledger stays ── */
  const remove = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    const res = await deleteAiJob(result.job.id);
    setDeleting(false);
    setConfirmDelete(false);
    if (res.ok && res.deleted) onDeleted?.();
  }, [deleting, onDeleted, result.job.id]);

  /* ── comparison (§5): the original is fetched only when asked for ── */
  const showOriginal = useCallback(async () => {
    if (view === "original") return;
    if (originalUrl) {
      setView("original");
      return;
    }
    setOriginalState("loading");
    const res = await getAiJobSource(result.job.id);
    if (res.ok) {
      setOriginalUrl(res.url);
      setOriginalState("idle");
      setView("original");
    } else {
      setOriginalState("unavailable");
    }
  }, [originalUrl, result.job.id, view]);

  useEffect(() => {
    // "Use same photo" is offered only while the photo is still in the browser's hand (a draft that just finished).
    setCanReusePhoto(typeof window !== "undefined" && window.sessionStorage?.getItem("frenz:cr:photo-in-hand") === "1");
  }, []);

  const compareAvailable = result.job.status === "completed" && originalState !== "unavailable";
  const src = view === "original" ? originalUrl : result.previewUrl;

  return (
    <section className={cn("space-y-4", className)} aria-labelledby="video-ready-title" data-reveal>
      {/* ── header: ← Character Replace · Your video is ready ─────────────── */}
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack ?? (() => onMakeAnother())}
          aria-label="Back to Character Replace"
          className="flex h-10 w-10 items-center justify-center rounded-full text-foreground transition hover:bg-secondary active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Character Replace</p>
          <h2 id="video-ready-title" className="flex items-center gap-1.5 text-[20px] font-bold leading-tight tracking-[-0.02em]">
            Your video is ready
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          </h2>
        </div>
        <span role="status" aria-live="polite" className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-600">
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
          Ready
        </span>
      </header>

      {/* ── the hero ───────────────────────────────────────────────────────── */}
      <div className="animate-fade-up">
      <VideoReadyPlayer
        ref={player}
        src={src}
        poster={view === "result" ? poster : null}
        title={view === "original" ? "Your original video" : "Your Character Replace video"}
        badge={view === "original" ? "Original" : originalUrl ? REPLACEMENT_MODE_COPY[mode].label : null}
        speedControl={view === "result"}
        onFirstPlay={() => track("character_replace_video_played", { mode, view })}
      />
      </div>

      {/* the facts line + comparison switch (§5–§6) */}
      <div className="animate-fade-up flex flex-wrap items-center justify-between gap-2 [animation-delay:90ms]">
        <p className="text-[13px] font-semibold tabular-nums text-muted-foreground">
          {REPLACEMENT_MODE_COPY[mode].label} · {quality} · {formatSeconds(result.durationSeconds)}
          {fps ? ` · ${fps}` : ""}
        </p>
        {compareAvailable ? (
          <div role="radiogroup" aria-label="Compare" className="flex rounded-full bg-secondary p-0.5 text-[12px] font-semibold">
            <button
              type="button"
              role="radio"
              aria-checked={view === "original"}
              onClick={() => void showOriginal()}
              disabled={originalState === "loading"}
              className={cn("flex items-center gap-1 rounded-full px-3 py-1.5 transition", view === "original" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {originalState === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Columns2 className="h-3.5 w-3.5" aria-hidden />}
              Original
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={view === "result"}
              onClick={() => setView("result")}
              className={cn("rounded-full px-3 py-1.5 transition", view === "result" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {REPLACEMENT_MODE_COPY[mode].label}
            </button>
          </div>
        ) : null}
      </div>

      {/* ── Download · Save · Share (§7–§11) ──────────────────────────────── */}
      <div className="animate-fade-up space-y-2 [animation-delay:160ms]">
        <button
          type="button"
          onClick={download}
          disabled={downloadBusy || !result.previewUrl}
          aria-live="polite"
          className={cn(
            "flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-[1.1rem] bg-foreground px-6",
            "text-[15.5px] font-semibold tracking-[-0.01em] text-background",
            "shadow-[0_12px_28px_-16px_rgba(15,23,42,0.55)] transition motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
            "disabled:opacity-60 disabled:hover:translate-y-0",
            task?.status === "failed" && "bg-rose-600 text-white",
          )}
        >
          {downloadBusy ? <Loader2 className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" aria-hidden /> : task?.status === "completed" ? <Check className="h-[18px] w-[18px]" strokeWidth={3} aria-hidden /> : <Download className="h-[18px] w-[18px]" aria-hidden />}
          {downloadLabel}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void toggleSave()}
            disabled={saving || result.job.status !== "completed"}
            aria-pressed={saved}
            className={cn(
              "btn-lux min-h-[46px] border text-[13.5px] disabled:opacity-50",
              saved ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-border/70 bg-card text-foreground hover:border-foreground/25",
            )}
          >
            {saved ? <BookmarkCheck className="h-4 w-4" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
            {saving ? "Saving…" : saved ? "Saved" : "Save to FrenzSave"}
          </button>
          <button
            type="button"
            onClick={() => void share()}
            disabled={sharing || !result.previewUrl}
            className="btn-lux min-h-[46px] border border-border/70 bg-card text-[13.5px] text-foreground hover:border-foreground/25 disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" aria-hidden />
            {sharing ? "Preparing…" : "Share"}
          </button>
        </div>
        <p className="text-center text-[11.5px] leading-relaxed text-muted-foreground" aria-live="polite">
          {shareNote ??
            (saved
              ? `Saved — kept for ${keptDays} days. Only you can see it.`
              : `Kept for ${keptHours >= 48 ? `${Math.round(keptHours / 24)} days` : `${keptHours} hours`}. Save to keep it for ${keptDays} days. Sharing sends the file itself — no public link is created.`)}
        </p>
      </div>

      {/* ── Video Details (§12), only what was used ─────────────────────── */}
      <div className="rounded-[1.25rem] border border-border/70 bg-card">
        <button
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13.5px] font-semibold transition hover:bg-secondary/40"
        >
          Video details
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", detailsOpen && "rotate-180")} aria-hidden />
        </button>
        {detailsOpen ? (
          <dl className="divide-y divide-border/60 border-t border-border/60 px-4 pb-2">
            <DetailRow label="Replacement" value={REPLACEMENT_MODE_COPY[mode].label} />
            <DetailRow label="Duration" value={formatSeconds(result.durationSeconds)} />
            <DetailRow label="Output" value={[quality, resolution, fps].filter(Boolean).join(" · ")} />
            <DetailRow label="Audio" value={audioLine} />
            {language ? <DetailRow label="Language" value={language} /> : null}
            {voiceName ? <DetailRow label="Voice" value={voiceName} /> : null}
            {lipTier ? <DetailRow label="Lip sync" value={lipTier} /> : null}
            {cr?.rateCents !== null && cr?.rateCents !== undefined ? <DetailRow label="Rate" value={`${formatCents(cr.rateCents, symbol)} per second`} /> : null}
            {cr?.chargedCents !== null && cr?.chargedCents !== undefined && cr.chargedCents > 0 ? <DetailRow label="Charged" value={formatCents(cr.chargedCents, symbol)} /> : null}
            <DetailRow label="Created" value={createdOn(result.job.createdAt)} />
            {result.job.expiresAt ? <DetailRow label="Kept until" value={createdOn(result.job.expiresAt)} /> : null}
            {attempt > 1 ? <DetailRow label="Attempt" value={String(attempt)} /> : null}
          </dl>
        ) : null}
      </div>

      {/* ── the honest hand-off to the phone's own editor ─────────────────── */}
      <aside className="flex gap-3 rounded-[1.25rem] bg-secondary/50 px-4 py-3.5" aria-label="Edit on your phone">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-card text-primary ring-1 ring-inset ring-black/[0.05] dark:ring-white/10">
          <Smartphone className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold tracking-[-0.01em]">Edit on your phone</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{editingLine(platform)}</p>
        </div>
      </aside>

      {/* ── secondary actions (§14–§16) ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={() => onMakeAnother()} className="btn-lux border border-border/70 bg-card text-foreground hover:border-foreground/25">
          <Sparkles className="h-4 w-4" aria-hidden />
          Create Another
        </button>
        {canReusePhoto ? (
          <button type="button" onClick={() => onMakeAnother({ keepPhoto: true })} className="btn-lux border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground">
            Use same photo
          </button>
        ) : null}
        <Link href={historyHref} prefetch={false} className="btn-lux border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground">
          <History className="h-4 w-4" aria-hidden />
          View history
        </Link>
        <button type="button" onClick={() => player.current?.enterFullscreen()} disabled={!src} className="btn-lux border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50">
          <Maximize2 className="h-4 w-4" aria-hidden />
          Fullscreen
        </button>
      </div>

      {/* ── disclosure (§13) and delete (§20) ─────────────────────────────── */}
      <div className="flex flex-col items-center gap-2 pt-1 text-center">
        <p className="text-[11px] text-muted-foreground/80">AI-generated transformation · made with Frenz AI</p>
        {!confirmDelete ? (
          <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground underline-offset-4 hover:text-rose-500 hover:underline">
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete video
          </button>
        ) : (
          <div role="alertdialog" aria-labelledby="cr-delete-title" className="w-full rounded-[1.25rem] border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3.5">
            <p id="cr-delete-title" className="text-[13.5px] font-bold">Delete this video?</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">The file is removed from FrenzSave and from your history. Your charge record stays. This can&apos;t be undone.</p>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" onClick={() => void remove()} disabled={deleting} className="btn-lux min-h-[42px] bg-rose-600 px-4 text-[13px] text-white hover:bg-rose-700 disabled:opacity-60">
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="btn-lux min-h-[42px] border border-border/70 bg-card px-4 text-[13px] text-foreground">
                Keep it
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function editingLine(platform: "ios" | "android" | "other"): string {
  switch (platform) {
    case "ios":
      return "Download, then choose Save Video in the share sheet. In Photos, open the video and tap Edit for Apple's own colour, crop and adjustment tools.";
    case "android":
      return "Download saves the clean master to your gallery. Open it in Google Photos (or your gallery app) and tap Edit for filters and adjustments.";
    default:
      return "Download the clean master and open it in any editor you like — the file is a standard MP4 at the resolution you chose.";
  }
}

function createdOn(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-right text-[13px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
