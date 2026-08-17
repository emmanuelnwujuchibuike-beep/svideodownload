"use client";

import { ClipboardPaste, Loader2, Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { SupportedPlatforms } from "@/components/landing/supported-platforms";
import type { PlatformStatusMap } from "@/lib/platform-status";
import { useUser } from "@/features/auth/use-user";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { useGatewayMemory } from "@/features/download-hub/use-gateway-memory";
import { useDownloader } from "@/features/downloader/use-downloader";
import { onDownloadCompleted, startDownload } from "@/features/downloads/manager";
import { useHistory } from "@/features/history/use-history";
import { limitForPlan, totalUsedBytes } from "@/features/history/usage";
import { getAutoDownload, getPreferredQuality } from "@/lib/download-hub/auto-download";
import { buildDownloadContext, pickFormat } from "@/lib/download-hub/context";
import type { DownloadContext } from "@/lib/download-hub/types";
/* `BRAND_ICONS`, `FLAGSHIP_IDS` and `PLATFORMS` are gone with the hand-rolled
   strip above — the shared `SupportedPlatforms` owns the marks now. Only
   `detectPlatform` is still needed, for the live "Detected …" line. */
import { detectPlatform } from "@/lib/platforms";
import { cn } from "@/lib/utils";
import { sourceUrlSchema } from "@/lib/validation";
import type { MediaKind } from "@/types";

/*
  🔴 CODE-SPLIT, ALL OF IT (owner, 2026-08-16: "make the download page…
  reusable" → landing now renders this exact component, which put the
  landing page's cold-entry bundle at 322 kB against a 275 kB ceiling, and
  even pushed /downloads itself to its own 300 kB ceiling — this component
  was never held to either budget while it only lived behind /downloads'
  sign-in gate).

  None of the six below can render on the FIRST paint of this component —
  `PreviewCard`/`FetchedAd`/`ResultOffer` need `metadata`, which does not
  exist until a fetch resolves; `FloatingDownloadProgress` needs a queued
  task; `QuotaGate` needs the storage ceiling to actually be hit;
  `DownloadCompleteAd` needs a finished transfer. Every one was a STATIC
  import anyway, so 100% of visitors — landing's overwhelming majority, who
  paste nothing — paid for all six on load. `PreviewCard` in particular
  already had this exact split one call site over: `downloader.tsx` dynamic-
  imports it, this file didn't. Same fix, same `{ ssr: false }` reasoning as
  `DiscoveryGateway` below (already split, kept as-is): none of these six
  need to exist in server-rendered HTML — they render from client state that
  is null on the server regardless.
*/
const PreviewCard = dynamic(() => import("@/features/downloader/preview-card").then((m) => m.PreviewCard), { ssr: false });
const FloatingDownloadProgress = dynamic(
  () => import("@/features/downloads/floating-progress").then((m) => m.FloatingDownloadProgress),
  { ssr: false },
);
const QuotaGate = dynamic(() => import("@/features/downloads/quota-gate").then((m) => m.QuotaGate), { ssr: false });
const DownloadCompleteAd = dynamic(
  () => import("@/features/monetization/download-complete-ad").then((m) => m.DownloadCompleteAd),
  { ssr: false },
);
const FetchedAd = dynamic(() => import("@/features/monetization/fetched-ad").then((m) => m.FetchedAd), { ssr: false });
const ResultOffer = dynamic(() => import("@/features/monetization/result-offer").then((m) => m.ResultOffer), { ssr: false });

// Renders only after a download completes, and pulls in the Learning Academy
// content it links to — code-split so the Hub's initial bundle does not carry it.
// Importing it directly cost /downloads 16 kB of lesson prose on first load.
const DiscoveryGateway = dynamic(
  () => import("@/features/download-hub/discovery-gateway").then((m) => m.DiscoveryGateway),
  { ssr: false },
);

/** Large paste box + preview that enqueues into the in-app download manager
 * (real progress / pause / resume), with supported-platform badges. */
/**
 * `surface` picks the palette this box sits on. "hero" is the original
 * white-on-purple treatment; "card" is the light card the download page's
 * reference design puts it on (public/new downloadpage.jpg), where white text
 * and white/10 fills would be invisible.
 */
export function DownloadBox({
  surface = "hero",
  /**
   * Operator-declared platform health, resolved at the server page and threaded
   * down (Feature: platform status, 2026-08-11).
   *
   * 🔴 A PROP, not a fetch. This component is `"use client"` — it cannot read
   * the settings store, and turning it into a server component to do so would
   * cost the download page its whole interactive paste flow.
   */
  platformStatus,
}: { surface?: "hero" | "card"; platformStatus?: PlatformStatusMap } = {}) {
  const onCard = surface === "card";
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
  const { plan, ready: planReady } = useEntitlements();
  const { items: historyItems, clearHistory } = useHistory();
  // The storage gate for the signed-in paste box, mirroring the public downloader.
  const [gate, setGate] = useState<{ open: boolean; usedBytes: number; count: number; limitBytes: number }>({
    open: false,
    usedBytes: 0,
    count: 0,
    limitBytes: 0,
  });

  // The after-download ad fires on a REAL completion, not the button press —
  // the manager's completion beat is the only honest signal a transfer finished.
  const [completeAdOpen, setCompleteAdOpen] = useState(false);
  useEffect(() => onDownloadCompleted(() => setCompleteAdOpen(true)), []);

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
    // Over the plan ceiling → open the upgrade-or-clear gate instead of starting.
    // Fail open until entitlements resolve so a paid visitor is never wrongly held.
    const limitBytes = planReady ? limitForPlan(plan) : Infinity;
    const usedBytes = totalUsedBytes(historyItems);
    if (usedBytes >= limitBytes) {
      setGate({ open: true, usedBytes, count: historyItems.length, limitBytes });
      return;
    }
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
      <form onSubmit={onSubmit} className={cn("rounded-2xl p-1.5 ring-1 ring-inset", onCard ? "bg-secondary/40 ring-border/60" : "bg-white/10 ring-white/15 backdrop-blur")}>
        <div className="flex flex-col gap-2 sm:flex-row">
          {/*
            🔴 THE PURPLE STRIPE GOES AROUND THE PLACEHOLDER (owner, 2026-08-11:
            "the stripe … is supposed to be around this placeholder and not the
            parent container, and the stripe should be a bit bigger … so it can
            fill in the existing white line around the placeholder").

            It was first built as a `p-px` wrapper around the whole paste CARD.
            That is one level too high: the thing the owner pointed at is the
            input, and the card's own edge is a different boundary.

            So the gradient sits here, and at `p-0.5` (2px) rather than a
            hairline — it now OCCUPIES the pale ring the input used to draw for
            itself, instead of adding a second line beside it. The input's
            `ring-1 ring-border` is removed for exactly that reason: a grey
            hairline immediately inside a violet one reads as a double border,
            which is the same mistake already corrected once on the card.

            Radii differ by 2px (0.9rem outer / 0.7rem inner) so the inner corner
            sits concentrically inside the outer one. Equal radii leave a visibly
            thick spot at each corner.

            Focus moves to the WRAPPER (`focus-within`) because the input no
            longer owns a ring. It is a real 2px ring plus a halo, not a colour
            change — a gradient that merely brightens is not a focus indicator
            anyone can see, and this is the primary control on the page.
          */}
          <div className="relative flex-1 rounded-[0.9rem] bg-gradient-to-r from-blue-500 via-violet-500 to-purple-500 p-0.5 transition focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1 focus-within:ring-offset-transparent">
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste any link here (TikTok, Instagram, X, Facebook…)"
              aria-label="Video URL"
              className={`h-[3.25rem] w-full rounded-[0.7rem] bg-background px-4 ${url ? "pr-36" : "pr-24"} text-base text-foreground outline-none`}
            />
            <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {url ? (
                /*
                  🔴 THIS is the button the landing page actually renders — the
                  earlier "make it visible" fix (2026-08-17) landed on
                  features/downloader/downloader.tsx, a component the landing
                  page never mounts (it renders THIS file, download-box.tsx,
                  per the 2026-08-16 "landing = DownloadPageCore" merge). Same
                  two bugs as that fix: `pr-24` didn't grow to fit this
                  button's width, so it overlapped the pasted URL text; and
                  `bg-secondary`/`ring-border` are only a few points of
                  lightness from `bg-background`, so a filled circle in those
                  tokens is invisible on this near-white input. `foreground`
                  is always the opposite pole from `background` in this token
                  system, so `bg-foreground/10` + `ring-foreground/20` give
                  real contrast in both themes.
                */
                <button
                  type="button"
                  onClick={clear}
                  aria-label="Clear — paste a different link"
                  title="Clear"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground/10 text-foreground ring-1 ring-inset ring-foreground/20 transition hover:bg-rose-500/15 hover:text-rose-600 hover:ring-rose-500/40 active:scale-90 dark:hover:text-rose-400"
                >
                  <X className="h-4 w-4" strokeWidth={2.75} />
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
        <p role="alert" className={cn("mt-2 text-sm font-medium", onCard ? "text-rose-500" : "text-rose-300")}>{validationError ?? error}</p>
      ) : null}
      {justQueued ? (
        <p className={cn("mt-2 text-sm font-medium", onCard ? "text-emerald-600 dark:text-emerald-400" : "text-emerald-300")}>Added to your downloads ↓</p>
      ) : null}

      {/*
        ── ONE component, shared with the landing page (owner, 2026-08-10) ─────
        "make the supported platform and logos in the landing page be the same in
        the download page with same structure, the logos below the supported
        text."

        This was a SECOND, hand-rolled copy of the same strip: its own label
        ("Supported:" vs "Platforms supported"), its own tiles (8px-radius
        gradient squares tinted per platform vs white squircles carrying each
        brand's real colour), and its own layout (a wrapping inline row vs label
        above, logos below).

        It is now the landing's `SupportedPlatforms`, which is the actual fix
        rather than restyling this copy to match. Two copies of a shared strip is
        how "I changed it and it still looks the same" happens — you change the
        branch the owner is not looking at. Same trap the Wallpaper CTA was
        collapsed out of.

        It lists the SAME EIGHT platforms in the SAME ORDER — `SUPPORTED_PLATFORMS`
        and `[...FLAGSHIP_IDS, youtube, telegram]` were already identical — so
        nothing is added or dropped here; only the duplicate definition goes.

        `surface` carries the one real difference between the two placements: on
        the downloads dashboard it sits on a card, in the hero it sits on the
        purple gradient, and the label needs different ink for each.
      */}
      <SupportedPlatforms surface={onCard ? "light" : "onGradient"} className="mt-4" statuses={platformStatus} />

      {/* The detected-platform confirmation stays — it is live feedback about the
          URL the visitor just pasted, not part of the static strip, and folding
          it into the shared component would put a downloader concern inside a
          marketing one. */}
      {url && detectPlatform(url).id !== "generic" ? (
        <p className={cn("mt-2 text-xs font-medium", onCard ? "text-foreground" : "text-white/80")}>
          Detected {detectPlatform(url).name}
        </p>
      ) : null}
      {/* Telegram is genuinely slower (authenticated MTProto, not a plain CDN
          pull) — see the identical note in features/downloader/downloader.tsx,
          the other surface this same warning lives on. */}
      {url && detectPlatform(url).id === "telegram" ? (
        <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          Telegram downloads can take up to a minute to prepare — that&apos;s normal.
        </p>
      ) : null}

      {metadata ? (
        <div className="text-foreground">
          {/* The download-result ad, above the result — same placement as the
              landing flow. Renders nothing until the zone is filled. */}
          <FetchedAd key={`ad-${metadata.id}`} />
          <PreviewCard metadata={metadata} phase="idle" onDownload={onDownload} />
          {/* Decision-engine offer (ad / affiliate / upgrade), keyed per result. */}
          <ResultOffer key={metadata.id} />
          {savedContext ? <DiscoveryGateway context={savedContext} /> : null}
        </div>
      ) : null}

      {/* Live progress / completion card (singleton — no-op if the app shell
          already mounted one). */}
      <FloatingDownloadProgress />

      {/* After-download ad — renders nothing until a transfer completes AND the
          download_complete zone is filled. */}
      <DownloadCompleteAd open={completeAdOpen} onClose={() => setCompleteAdOpen(false)} />

      {/* Plan storage gate — upgrade or clear when over the ceiling. */}
      <QuotaGate
        open={gate.open}
        usedBytes={gate.usedBytes}
        count={gate.count}
        limitBytes={gate.limitBytes}
        plan={plan}
        signedIn={!!user}
        onClearHistory={clearHistory}
        onClose={() => setGate((g) => ({ ...g, open: false }))}
      />
    </div>
  );
}
