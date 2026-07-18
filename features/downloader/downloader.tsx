"use client";

import {
  AlertCircle,
  ClipboardPaste,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { RecommendedToolsClient } from "@/components/monetization/recommended-tools-client";
import { useGatewayMemory } from "@/features/download-hub/use-gateway-memory";
import { FloatingDownloadProgress } from "@/features/downloads/floating-progress";
import { startDownload as enqueueDownload } from "@/features/downloads/manager";
import { PublishButton } from "@/features/social/publish-button";
import { FetchedAd } from "@/features/monetization/fetched-ad";
import { ResultOffer } from "@/features/monetization/result-offer";
import { useUser } from "@/features/auth/use-user";
import type { DownloadContext } from "@/lib/download-hub/types";
import { detectPlatform } from "@/lib/platforms";
import { sourceUrlSchema } from "@/lib/validation";
import type { MediaFormat, MediaKind } from "@/types";

import { useDownloader } from "./use-downloader";

// Result card (+ its framer-motion dependency) only ever appears after a
// visitor submits a link — code-split it out of the landing page's initial
// bundle instead of shipping it to every visitor who never converts.
const PreviewCard = dynamic(() => import("./preview-card").then((m) => m.PreviewCard), { ssr: false });

// Discovery Gateway™ — only renders once a download has actually completed, so
// code-split it (along with the Learning Academy content it links to) out of the
// landing page's initial bundle. Same proven pattern as PreviewCard above.
const DiscoveryGateway = dynamic(
  () => import("@/features/download-hub/discovery-gateway").then((m) => m.DiscoveryGateway),
  { ssr: false },
);

/**
 * Vertical pixel count of a chosen rendition, for Discovery Gateway ranking.
 *
 * There is no `height` field on MediaFormat, so this reads the three places the
 * information actually appears, cheapest first. Returns 0 for "unknown", which
 * the ranker treats as a neutral signal rather than as low quality.
 */
function heightOf(fmt: MediaFormat | undefined): number {
  if (!fmt) return 0;
  const fromId = Number(fmt.formatId);
  if (Number.isFinite(fromId) && fromId > 0) return fromId;
  const fromResolution = fmt.resolution?.match(/x(\d+)/)?.[1];
  if (fromResolution) return Number(fromResolution);
  const fromLabel = fmt.label?.match(/(\d+)p/)?.[1];
  return fromLabel ? Number(fromLabel) : 0;
}

// Cycled through in the input placeholder for a lively, on-brand prompt.
const PLACEHOLDER_PLATFORMS = [
  "TikTok",
  "Instagram",
  "X (Twitter)",
  "Snapchat",
  "YouTube",
  "Facebook",
  "Pinterest",
];

export function Downloader({ initialUrl }: { initialUrl?: string } = {}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [phIndex, setPhIndex] = useState(0);
  const { status, metadata, error, fetchMetadata, reset } = useDownloader();
  const previewRef = useRef<HTMLDivElement | null>(null);

  const isBusy = status === "fetching";
  const detected = url ? detectPlatform(url) : null;

  // Set once the user taps download on this fetch's result — drives the
  // Discovery Gateway below. Reset whenever a new video is fetched.
  const [justDownloaded, setJustDownloaded] = useState(false);
  useEffect(() => setJustDownloaded(false), [metadata?.id]);

  // What was actually saved, in the shape the Gateway ranks over. Held in state
  // rather than derived from `metadata` because the chosen format matters: the
  // right next step after a 360p grab differs from a 1080p one.
  const [savedContext, setSavedContext] = useState<DownloadContext | null>(null);
  useEffect(() => setSavedContext(null), [metadata?.id]);

  const { downloadCount, countDownload } = useGatewayMemory();
  const { user } = useUser();

  const handleDownload = (formatId: string, kind: MediaKind) => {
    if (!metadata) return;
    const fmt = metadata.formats.find((f) => f.formatId === formatId);
    // In-app background download: streamed with live progress in the floating
    // card, the page stays fully usable, and the user NEVER lands on a raw
    // file/Quick Look page (the old link-navigation stranded the installed
    // iOS webapp there — see features/downloads/manager.ts). The manager
    // saves to the on-device library, records history, and hands the file to
    // the device (share-sheet Save on iOS, direct save elsewhere).
    enqueueDownload({
      url: metadata.sourceUrl,
      formatId,
      kind,
      title: metadata.title,
      thumbnail: metadata.thumbnail,
      platform: metadata.platform,
      platformName: metadata.platformName,
      qualityLabel: fmt?.label ?? (kind === "audio" ? "Audio" : kind === "image" ? "Image" : "Video"),
    });
    setJustDownloaded(true);
    countDownload();
    setSavedContext({
      platformId: metadata.platform,
      kind,
      durationSec: metadata.durationSeconds ?? 0,
      height: heightOf(fmt),
      // `acodec: "none"` is yt-dlp's marker for a video-only rendition. Absent
      // codec data means unknown, and assuming audio is present is the safer
      // default — it keeps caption suggestions available rather than silently
      // dropping them.
      hasAudio: kind !== "image" && fmt?.acodec !== "none",
      signedIn: !!user,
      plan: "free",
      downloadCount: downloadCount + 1,
    });
  };

  // Share Target (manifest `share_target`) hands us a link from another app
  // (e.g. "Share" out of TikTok/Instagram) as a one-time initial value —
  // auto-fetch it immediately so the user lands straight on a result instead
  // of having to paste it again. Runs once; the already-validated
  // `initialUrl` comes from the server (app/page.tsx), so no re-validation
  // is needed here.
  useEffect(() => {
    if (initialUrl) fetchMetadata(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On phones, bring the result card into view once a fetch resolves.
  useEffect(() => {
    if (metadata && typeof window !== "undefined" && window.innerWidth < 768) {
      const t = setTimeout(
        () => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        90,
      );
      return () => clearTimeout(t);
    }
  }, [metadata]);

  // Rotate the placeholder platform every couple of seconds (visible only while
  // the field is empty).
  useEffect(() => {
    const id = setInterval(
      () => setPhIndex((i) => (i + 1) % PLACEHOLDER_PLATFORMS.length),
      2200,
    );
    return () => clearInterval(id);
  }, []);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        setValidationError(null);
      }
    } catch {
      setValidationError("Clipboard access was blocked. Paste manually.");
    }
  };

  const startFetch = () => {
    const parsed = sourceUrlSchema.safeParse(url);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid URL.");
      return;
    }
    setValidationError(null);
    void fetchMetadata(parsed.data);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    startFetch();
  };

  const handleClear = () => {
    setUrl("");
    setValidationError(null);
    reset();
  };

  return (
    <div className="w-full">
      <form
        onSubmit={handleSubmit}
        className="glass rounded-[1.5rem] p-2 shadow-luxury ring-1 ring-inset ring-white/[0.06] transition-shadow focus-within:shadow-glow-blue focus-within:ring-primary/25"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={`Paste your ${PLACEHOLDER_PLATFORMS[phIndex]} link…`}
              aria-label="Video URL"
              className="h-16 w-full rounded-2xl bg-background/60 px-5 pr-28 text-base outline-none ring-1 ring-inset ring-border/80 transition-all focus:bg-background/90 focus:ring-2 focus:ring-primary sm:text-lg"
            />
            <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {url ? (
                <button
                  type="button"
                  onClick={handleClear}
                  aria-label="Clear"
                  className="rounded-xl p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={handlePaste}
                className="inline-flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-secondary/70 active:scale-[0.97]"
              >
                <ClipboardPaste className="h-4 w-4" /> Paste
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={isBusy}
            className="group relative inline-flex h-16 items-center justify-center gap-2 overflow-hidden rounded-2xl bg-primary px-8 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:shadow-glow-blue active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
          >
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            {isBusy ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Fetching…
              </>
            ) : (
              <>
                <Search className="h-5 w-5 transition-transform group-hover:scale-110" />{" "}
                Download
              </>
            )}
          </button>
        </div>

        {detected && detected.id !== "generic" ? (
          <p className="px-4 pb-1.5 pt-2.5 text-xs text-muted-foreground">
            Detected ·{" "}
            <span className="font-medium text-foreground">{detected.name}</span>
          </p>
        ) : null}
      </form>

      {(validationError || error) && status !== "fetching" ? (
        <ErrorCard
          message={validationError ?? error ?? "Something went wrong."}
          isValidation={!!validationError}
          onRetry={validationError ? undefined : startFetch}
          onDismiss={handleClear}
        />
      ) : null}

      {metadata ? (
        <div ref={previewRef} className="scroll-mt-24">
          <FetchedAd key={`ad-${metadata.id}`} />
          <PreviewCard metadata={metadata} phase="idle" onDownload={handleDownload} />

          {/* Decision-engine offer: ad / affiliate / upgrade — keyed per video. */}
          <ResultOffer key={metadata.id} />
          {/* Admin-managed recommended tools (renders nothing when empty). */}
          <RecommendedToolsClient placement="download_result" />

          {/*
            Discovery Gateway™ — replaces what used to be a single hardcoded
            "publish it" prompt with a ranked, contextual set of next steps.
            See docs/DOWNLOAD_HUB_RFC.md §3.

            It renders only AFTER the download has been handed to the manager, so
            it never delays or gates the file. Publish stays alongside it as the
            direct affordance, because it works from metadata here and the Gateway
            deliberately caps itself at three suggestions.
          */}
          {justDownloaded ? (
            <>
              <div className="mt-5 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600/10 to-violet-600/10 p-4 text-center ring-1 ring-inset ring-violet-500/20">
                <p className="text-sm font-bold">Downloaded — share it with your Frenz</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Publish it to your profile so your followers can watch and save it too.
                </p>
                <div className="mt-3 flex justify-center">
                  <PublishButton metadata={metadata} highlight />
                </div>
              </div>
              {savedContext ? <DiscoveryGateway context={savedContext} /> : null}
            </>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {!justDownloaded ? <PublishButton metadata={metadata} /> : null}
            <button
              type="button"
              onClick={() => {
                handleClear();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground shadow-soft transition hover:bg-secondary active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" /> Download another video
            </button>
          </div>
        </div>
      ) : null}

      {/* Progress / "Save to device" completion card — singleton (safe to
          mount alongside the app shell's own copy; first mount wins). Needed
          here since Downloader also renders on public pages outside the
          signed-in app shell, which is the only place AppOverlays mounts it. */}
      <FloatingDownloadProgress />
    </div>
  );
}

function ErrorCard({
  message,
  isValidation,
  onRetry,
  onDismiss,
}: {
  message: string;
  isValidation: boolean;
  onRetry?: () => void;
  onDismiss: () => void;
}) {
  const privateLike = /private|sign-?in|login|region|removed|unavailable/i.test(message);
  return (
    <div
      role="alert"
      className="mx-auto mt-5 max-w-xl rounded-2xl border border-red-500/25 bg-red-500/[0.04] p-4 text-left"
    >
      <div className="flex gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/12 text-red-400">
          <AlertCircle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {isValidation
              ? "That doesn't look like a valid link"
              : privateLike
                ? "We couldn't reach that post"
                : "Couldn't fetch that link"}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{message}</p>
          {!isValidation && privateLike ? (
            <p className="mt-1.5 text-xs text-muted-foreground/80">
              Tip: make sure the post is public and the link is complete.
            </p>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98]"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </button>
            ) : null}
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
