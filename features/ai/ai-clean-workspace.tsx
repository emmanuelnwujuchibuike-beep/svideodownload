"use client";

import { HelpCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { AICleanEmptyState } from "@/features/ai/ai-clean-empty-state";
import { AICleanErrorState } from "@/features/ai/ai-clean-error-state";
import { AICleanHero } from "@/features/ai/ai-clean-hero";
import { AICleanProBadge } from "@/features/ai/ai-clean-pro-badge";
import { AICleanReadyState } from "@/features/ai/ai-clean-ready-state";
import { AICleanUrlInput } from "@/features/ai/ai-clean-url-input";
import { AICleanVideoPreview } from "@/features/ai/ai-clean-video-preview";
import { FrenzAIHeader } from "@/features/ai/frenz-ai-header";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { inspectVideoFile, type AICleanErrorCode } from "@/lib/ai/clean-media";
import {
  hasSeenAICleanTutorial,
  setAICleanTutorialState,
  type AICleanTutorialState,
} from "@/lib/ai/clean-tutorial";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI CLEAN — the one stateful component in the feature
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every other piece of AI Clean is a pure render over props. This is where the
 * chosen source, the error, the stage and the tutorial live, for one reason: an
 * object URL has a lifetime, and a lifetime needs exactly one owner. Split it
 * across a preview component and its parent and you get the two classic bugs —
 * a URL revoked while the `<video>` still points at it (a preview that goes
 * black on re-render) or one never revoked at all (a 90 MB blob pinned in memory
 * until the tab closes). Created here, revoked here, in every path: replace,
 * remove, error, unmount.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────────
 *
 * No upload, no fetch, no processing, no progress, no usage counter, no ad. Part
 * 1 is the interface; the brief is explicit about each of those, and the ready
 * state says so on screen rather than miming it.
 *
 * ── Why the tutorial is dynamically imported ──────────────────────────────────
 *
 * It is seen once per device, ever. Shipping its markup, its four diagrams and
 * its focus-trap logic inside the page's first load would make every RETURNING
 * visit pay for a sheet that will never open again. It is also what keeps the
 * boot order the brief asks for: page paints, then the tutorial arrives — never
 * a modal over an empty screen.
 */

const AICleanTutorial = dynamic(
  () => import("@/features/ai/ai-clean-tutorial").then((m) => m.AICleanTutorial),
  { ssr: false },
);

/** What the tool has been pointed at. A link carries no file — that is the point. */
type Source =
  | { kind: "file"; file: File; objectUrl: string }
  | { kind: "link"; url: string };

/** Which panel the stage is showing. */
type Stage = "choose" | "link" | "ready";

export function AICleanWorkspace() {
  const { isPremium, ready: planKnown } = useEntitlements();

  const [source, setSource] = useState<Source | null>(null);
  const [stage, setStage] = useState<Stage>("choose");
  const [error, setError] = useState<AICleanErrorCode | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  /*
    The live object URL, mirrored in a ref.

    State alone cannot do this job: the unmount cleanup below closes over the
    value from its own render, so a URL created after that render would leak.
    The ref is always current, which makes "revoke whatever is outstanding" a
    single expression at every exit.
  */
  const objectUrlRef = useRef<string | null>(null);

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => releaseObjectUrl, [releaseObjectUrl]);

  /*
    First visit only. Runs after mount, so the page has already painted — the
    tutorial arrives over a rendered AI Clean, never over a blank screen, which
    is the boot sequence the PWA section of the brief specifies.
  */
  useEffect(() => {
    if (!hasSeenAICleanTutorial()) setTutorialOpen(true);
  }, []);

  const acceptFile = useCallback(
    (file: File) => {
      const verdict = inspectVideoFile(file);
      if (!verdict.ok) {
        releaseObjectUrl();
        setSource(null);
        setStage("choose");
        setError(verdict.code);
        return;
      }
      // Replace, in this order: the old URL dies before the new one is stored,
      // so the ref never holds one that is already revoked.
      releaseObjectUrl();
      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      setError(null);
      setSource({ kind: "file", file, objectUrl });
      setStage("choose");
    },
    [releaseObjectUrl],
  );

  const clearSource = useCallback(() => {
    releaseObjectUrl();
    setSource(null);
    setStage("choose");
    setError(null);
  }, [releaseObjectUrl]);

  const closeTutorial = useCallback((outcome: AICleanTutorialState) => {
    setTutorialOpen(false);
    // The one thing this feature stores locally, and only ever this.
    setAICleanTutorialState(outcome === "completed" ? "completed" : "skipped");
  }, []);

  return (
    <div>
      <FrenzAIHeader
        crumb="AI Clean"
        title="Clean your videos with AI."
        description="Remove unwanted captions, subtitles and text overlays while keeping your video looking natural."
        badge={<AICleanProBadge />}
        action={
          <button
            type="button"
            onClick={() => setTutorialOpen(true)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border/70 bg-card px-3.5 text-xs font-semibold text-muted-foreground transition hover:border-primary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <HelpCircle className="h-4 w-4" aria-hidden />
            How it works
          </button>
        }
      />

      <AICleanHero>
        {error ? (
          <AICleanErrorState
            code={error}
            onRetry={() => {
              setError(null);
              setStage("choose");
            }}
          />
        ) : stage === "ready" && source ? (
          <AICleanReadyState
            source={source.kind === "file" ? { kind: "file", name: source.file.name } : { kind: "link", url: source.url }}
            isPro={isPremium}
            planKnown={planKnown}
            onBack={() => setStage(source.kind === "file" ? "choose" : "link")}
          />
        ) : source?.kind === "file" ? (
          <AICleanVideoPreview
            // Keyed on the URL so a replaced file gets a fresh <video> rather
            // than a reused element still holding the previous clip's metadata.
            key={source.objectUrl}
            file={source.file}
            objectUrl={source.objectUrl}
            onChange={acceptFile}
            onRemove={clearSource}
            onContinue={() => setStage("ready")}
            onInvalid={(code) => {
              releaseObjectUrl();
              setSource(null);
              setError(code);
            }}
          />
        ) : stage === "link" ? (
          <AICleanUrlInput
            onSubmit={(url) => {
              releaseObjectUrl();
              setSource({ kind: "link", url });
              setStage("ready");
            }}
            onCancel={() => setStage("choose")}
          />
        ) : (
          <AICleanEmptyState onFile={acceptFile} onPasteLink={() => setStage("link")} />
        )}
      </AICleanHero>

      {tutorialOpen ? <AICleanTutorial open onClose={closeTutorial} /> : null}
    </div>
  );
}
