"use client";

import { ClipboardPaste, Loader2, Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { useUser } from "@/features/auth/use-user";
import { useGatewayMemory } from "@/features/download-hub/use-gateway-memory";
import { useDownloader } from "@/features/downloader/use-downloader";
import { PreviewCard } from "@/features/downloader/preview-card";
import { FloatingDownloadProgress } from "@/features/downloads/floating-progress";
import { startDownload } from "@/features/downloads/manager";
import { getAutoDownload, getPreferredQuality } from "@/lib/download-hub/auto-download";
import { buildDownloadContext, pickFormat } from "@/lib/download-hub/context";
import type { DownloadContext } from "@/lib/download-hub/types";
import { BRAND_ICONS, FLAGSHIP_IDS } from "@/lib/platform-icons";
import { detectPlatform, PLATFORMS } from "@/lib/platforms";
import { sourceUrlSchema } from "@/lib/validation";
import type { MediaKind } from "@/types";

// Renders only after a download completes, and pulls in the Learning Academy
// content it links to — code-split so the Hub's initial bundle does not carry it.
// Importing it directly cost /downloads 16 kB of lesson prose on first load.
const DiscoveryGateway = dynamic(
  () => import("@/features/download-hub/discovery-gateway").then((m) => m.DiscoveryGateway),
  { ssr: false },
);

/** Large paste box + preview that enqueues into the in-app download manager
 * (real progress / pause / resume), with supported-platform badges. */
export function DownloadBox() {
  const [url, setUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const { status, metadata, error, fetchMetadata, reset } = useDownloader();
  const [justQueued, setJustQueued] = useState(false);

  // Discovery Gateway™ context for the most recent save. The Hub is where a
  // signed-in user downloads, so this is the surface where a recommendation is
  // MOST actionable — they already have an account to act with.
  const [savedContext, setSavedContext] = useState<DownloadContext | null>(null);
  const { downloadCount, countDownload } = useGatewayMemory();
  const { user } = useUser();

  const isBusy = status === "fetching";

  const startFetch = () => {
    const parsed = sourceUrlSchema.safeParse(url);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid URL.");
      return;
    }
    setValidationError(null);
    void fetchMetadata(parsed.data);
  };

  // Prefill + auto-fetch from a ?u= link (the home Download bars route here).
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("u");
    if (!u) return;
    setUrl(u);
    const parsed = sourceUrlSchema.safeParse(u);
    if (parsed.success) void fetchMetadata(parsed.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        setValidationError(null);
      }
    } catch {
      setValidationError("Clipboard blocked — paste manually.");
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    startFetch();
  };

  const onDownload = (formatId: string, kind: MediaKind) => {
    if (!metadata) return;
    const fmt = metadata.formats.find((f) => f.formatId === formatId);
    // In-app background download: streamed with live progress in the floating
    // card, the page stays fully usable, and the user NEVER lands on a raw
    // file/Quick Look page (the old link-navigation stranded iOS there). The
    // manager saves to the on-device library, records history, and hands the
    // file to the device (share-sheet Save on iOS, direct save elsewhere).
    startDownload({
      url: metadata.sourceUrl,
      formatId,
      kind,
      title: metadata.title,
      thumbnail: metadata.thumbnail,
      platform: metadata.platform,
      platformName: metadata.platformName,
      qualityLabel: fmt?.label ?? (kind === "audio" ? "Audio" : kind === "image" ? "Image" : "Video"),
    });
    setJustQueued(true);
    setTimeout(() => setJustQueued(false), 2400);
    countDownload();
    setSavedContext(
      buildDownloadContext({
        metadata,
        formatId,
        kind,
        signedIn: !!user,
        downloadCount: downloadCount + 1,
      }),
    );
  };

  /*
   * Auto Download: honour the rail's toggle by starting the best rendition as
   * soon as metadata resolves, instead of rendering the picker.
   *
   * `autoStartedFor` guards against re-firing — this effect re-runs whenever
   * metadata changes identity, and without the guard a re-render would enqueue
   * the same file twice.
   */
  const autoStartedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!metadata || !getAutoDownload()) return;
    if (autoStartedFor.current === metadata.id) return;
    const chosen = pickFormat(metadata.formats, getPreferredQuality());
    if (!chosen) return;
    autoStartedFor.current = metadata.id;
    onDownload(chosen.formatId, chosen.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata]);

  const clear = () => {
    setUrl("");
    setValidationError(null);
    setSavedContext(null);
    reset();
  };

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} className="rounded-2xl bg-white/10 p-1.5 ring-1 ring-inset ring-white/15 backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste any link here (TikTok, Instagram, X, Facebook…)"
              aria-label="Video URL"
              className="h-14 w-full rounded-xl bg-background px-4 pr-24 text-base text-foreground outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {url ? (
                <button type="button" onClick={clear} aria-label="Clear" className="rounded-lg p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              ) : null}
              <button type="button" onClick={handlePaste} className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-secondary/70">
                <ClipboardPaste className="h-4 w-4" /> Paste
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={isBusy}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-7 text-base font-semibold text-white shadow-lg transition hover:opacity-95 active:scale-[0.98] disabled:opacity-60"
          >
            {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />} Download
          </button>
        </div>
      </form>

      {validationError || error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-rose-300">{validationError ?? error}</p>
      ) : null}
      {justQueued ? (
        <p className="mt-2 text-sm font-medium text-emerald-300">Added to your downloads ↓</p>
      ) : null}

      {/* Supported platforms */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-white/70">Supported:</span>
        {FLAGSHIP_IDS.map((id) => {
          const platform = PLATFORMS[id];
          const Icon = BRAND_ICONS[id];
          return (
            <span key={id} title={platform.name} className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${platform.accent} text-white shadow-sm ring-1 ring-white/20`}>
              {Icon ? <Icon className="h-4 w-4" /> : null}
            </span>
          );
        })}
        {url && detectPlatform(url).id !== "generic" ? (
          <span className="text-xs font-medium text-white/80">· Detected {detectPlatform(url).name}</span>
        ) : null}
      </div>

      {metadata ? (
        <div className="text-foreground">
          <PreviewCard metadata={metadata} phase="idle" onDownload={onDownload} />
          {savedContext ? <DiscoveryGateway context={savedContext} /> : null}
        </div>
      ) : null}

      {/* Live progress / completion card (singleton — no-op if the app shell
          already mounted one). */}
      <FloatingDownloadProgress />
    </div>
  );
}
