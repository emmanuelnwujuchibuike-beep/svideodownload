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
import { type FormEvent, useEffect, useRef, useState } from "react";

import { RecommendedToolsClient } from "@/components/monetization/recommended-tools-client";
import { PublishButton } from "@/features/social/publish-button";
import { FetchedAd } from "@/features/monetization/fetched-ad";
import { ResultOffer } from "@/features/monetization/result-offer";
import { detectPlatform } from "@/lib/platforms";
import { sourceUrlSchema } from "@/lib/validation";

import { PreviewCard } from "./preview-card";
import { useDownloader } from "./use-downloader";

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

export function Downloader() {
  const [url, setUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [phIndex, setPhIndex] = useState(0);
  const { status, metadata, error, fetchMetadata, download, reset } = useDownloader();
  const previewRef = useRef<HTMLDivElement | null>(null);

  const isBusy = status === "fetching";
  const detected = url ? detectPlatform(url) : null;

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
          <PreviewCard
            metadata={metadata}
            phase={
              status === "downloading" ? "working" : status === "started" ? "done" : "idle"
            }
            onDownload={download}
          />

          {/* Decision-engine offer: ad / affiliate / upgrade — keyed per video. */}
          <ResultOffer key={metadata.id} />
          {/* Admin-managed recommended tools (renders nothing when empty). */}
          <RecommendedToolsClient placement="download_result" />
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <PublishButton metadata={metadata} />
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
