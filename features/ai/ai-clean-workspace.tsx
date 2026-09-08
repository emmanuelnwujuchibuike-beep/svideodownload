"use client";

import { AlertTriangle, HelpCircle, RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { AICleanAllowance } from "@/features/ai/ai-clean-allowance";
import { AICleanEmptyState } from "@/features/ai/ai-clean-empty-state";
import { AICleanProcessing } from "@/features/ai/ai-clean-processing";
import { AICleanResult } from "@/features/ai/ai-clean-result";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { AICleanErrorState } from "@/features/ai/ai-clean-error-state";
import { AICleanHero } from "@/features/ai/ai-clean-hero";
import { AICleanProBadge } from "@/features/ai/ai-clean-pro-badge";
import { AICleanReadyState } from "@/features/ai/ai-clean-ready-state";
import { AICleanUrlInput } from "@/features/ai/ai-clean-url-input";
import { AICleanVideoPreview } from "@/features/ai/ai-clean-video-preview";
import { FrenzAIHeader } from "@/features/ai/frenz-ai-header";
import { useAiCleanJob } from "@/features/ai/use-ai-clean-job";
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
 * ── 🔴 THE ENVIRONMENT WRAPPER IS NOT DECORATION ─────────────────────────────
 *
 * `FrenzAIEnvironment` is what supplies the four CSS custom properties every
 * animated Frenz AI surface reads (lib/ai/presence.ts). Without an ancestor
 * setting them, the Core inside the processing panel silently falls back to its
 * defaults and never brightens as the job moves from queued to finalizing —
 * which is the whole point of the thing. It also resolves reduced-motion and tab
 * visibility once, here, for everything below.
 *
 * It wraps the WHOLE surface rather than the stage, so the header's own state
 * and the panel's stay in step.
 *
 * ── Two flows, and only one of them is connected ──────────────────────────────
 *
 * A FILE is real work now (Part 3): it is uploaded straight to private storage,
 * a job is started, and `useAiCleanJob` owns every state after that. A LINK is
 * not — fetching arbitrary URLs is still a later part — so that path still ends
 * at the honest "not connected yet" panel rather than pretending to run.
 *
 * The job machine lives in one hook, deliberately. This component decides WHICH
 * panel to show and nothing about how a job behaves.
 *
 * ── Why the tutorial is dynamically imported ──────────────────────────────────
 *
 * It is seen once per device, ever. Shipping its markup, its four diagrams and
 * its focus-trap logic inside the page's first load would make every RETURNING
 * visit pay for a sheet that will never open again. It is also what keeps the
 * boot order the brief asks for: page paints, then the tutorial arrives — never
 * a modal over an empty screen.
 */

/*
  The app's REAL rewarded gate — the same component the downloader uses. Nothing
  in Frenz AI simulates an ad or grants a reward on a timer; this is the actual
  ad surface, and the server treats its completion as an attestation (see
  lib/ai/reward.ts for exactly how much that is worth).

  Dynamically imported: a member who never needs an ad — anyone on a paid plan —
  never downloads it.
*/
const RewardedAdGate = dynamic(
  () => import("@/features/monetization/rewarded-ad").then((m) => m.RewardedAdGate),
  { ssr: false },
);

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
  /*
    Everything about a running job: creating it, uploading, starting, watching,
    cancelling, and finding one that was already running when this page opened.
    A refresh mid-clean lands back on the processing panel because of that last
    part — the state is looked up, never remembered locally.
  */
  const cleanJob = useAiCleanJob();

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

  /*
    ── 🔴 "HOW IT WORKS" ARRIVES AS A QUERY PARAM ──────────────────────────

    The welcome page links here with `?tutorial=1`, and nothing read it — so
    the button did nothing at all for anybody who had already seen the
    tutorial once (which is everybody after their first visit, since the
    effect above only fires for first-timers).

    Read from `location` rather than `useSearchParams` deliberately: this
    component is deep inside a client tree, and `useSearchParams` opts the
    whole subtree into a Suspense boundary it does not otherwise need. One
    read on mount is all this requires.
  */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const wants = new URLSearchParams(window.location.search).get("tutorial");
    if (wants === "1") {
      setTutorialOpen(true);
      // Take it out of the URL so a refresh — or a back-navigation — does not
      // reopen a sheet the person has just closed.
      const url = new URL(window.location.href);
      url.searchParams.delete("tutorial");
      window.history.replaceState({}, "", url.toString());
    }
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

  /*
    ── 🔴 WHICH SCREEN IS THIS? NAMED ONCE, USED TWICE ──────────────────────

    The branch chain below decides what to render, and the chrome around it now
    needs the same answer — the input screen carries its own breadcrumb,
    headline and allowance (public/ai input page.jpg), so the old header and
    allowance strip must not appear above it.

    Writing that condition out a second time is exactly the mistake this
    codebase has a standing rule about: three hand-written copies of "is this
    still running" once drifted apart and stopped polling mid-job. So every
    state is a NAMED boolean here, the chain reads the names, and `idleScreen`
    is the negation of all of them. One place to change when a state is added.
  */
  const finished = !!cleanJob.job && cleanJob.job.status === "completed";
  const running = cleanJob.view.active || cleanJob.busy;
  const jobFailed =
    !!cleanJob.job && (cleanJob.job.status === "failed" || cleanJob.job.status === "cancelled");
  const readyToStart = stage === "ready" && !!source;
  const previewing = source?.kind === "file";
  const enteringLink = stage === "link";

  /*
    🔴 The PROGRESS screen has no header either (owner, 2026-09-08: "the
    progress page still have the old hero i said you should remove").

     draws its own chrome — the work scene, the
    headline that changes with the stage, its own tracker. A second title
    above all of that is the duplicate the owner keeps pointing at.

    Result and error states KEEP it: those screens carry no heading of their
    own, and somebody landing on a finished job needs to know where they are.
  */
  const idleScreen =
    !finished &&
    !running &&
    !cleanJob.error &&
    !jobFailed &&
    !error &&
    !readyToStart &&
    !previewing &&
    !enteringLink;

  /** Screens that draw their own heading, so the shared header would duplicate it. */
  const chromeless = idleScreen || running;

  return (
    <FrenzAIEnvironment
      stage={cleanJob.view.stage}
      // Awake once a video is chosen, before anything has been sent.
      armed={!!source}
      bare
    >
      {/*
        🔴 NO HEADER ON THE INPUT SCREEN (owner, 2026-09-08: "remove the frenz
        Ai hero section in the screenshot above").

        What was removed is this header plus the dots allowance strip beneath
        it. The headline did not disappear — it MOVED into the input page and
        gained a scene beside it, exactly as `public/ai input page.jpg` draws
        it. Rendering both would print the title twice.

        It stays for every other state: somebody watching a job or reading a
        result still needs to know where they are, and those screens carry no
        heading of their own.
      */}
      {chromeless ? null : (
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
      )}

      {/*
        What today looks like. Rendered from the server's answer and never read
        back as authority — the start request re-resolves all of it.
      */}
      {/*
        Hidden on the idle screen, which shows the same figure in the shape the
        reference draws: a bar at the BOTTOM, after the action, rather than a
        limit as the second thing somebody reads about a tool they have not
        tried yet.
      */}
      {chromeless ? null : (
        <AICleanAllowance entitlement={cleanJob.entitlement} className="mb-4" />
      )}

      {/*
        `bare` on the idle screen: the reference lays the input page directly on
        the page ground, not inside a bordered card. Every other state keeps the
        frame, which is what makes processing and results read as one surface
        the work happens inside.
      */}
      <AICleanHero bare={idleScreen}>
        {/*
          A live job outranks whatever the picker was showing: somebody who
          refreshes mid-clean must land on their video's real state, not on an
          empty drop zone that invites them to start a second one.
        */}
        {finished && cleanJob.job ? (
          <AICleanResult
            job={cleanJob.job}
            fetchResultUrl={cleanJob.fetchResultUrl}
            fetchSourceUrl={cleanJob.fetchSourceUrl}
            onStartAnother={() => {
              cleanJob.reset();
              clearSource();
            }}
          />
        ) : running ? (
          <AICleanProcessing
            view={cleanJob.view}
            fileName={source?.kind === "file" ? source.file.name : (cleanJob.job?.source.name ?? null)}
            onCancel={cleanJob.job ? () => void cleanJob.cancel() : undefined}
          />
        ) : cleanJob.error ? (
          <AICleanJobFailure
            message={cleanJob.error.message}
            onRetry={() => {
              cleanJob.reset();
              // The file is still in hand when the tab never went away, so a
              // retry is one tap. After a refresh it is gone, and the empty
              // state asks for it again — which is honest rather than silent.
              if (source?.kind === "file") void cleanJob.submit(source.file);
            }}
            onChoose={() => {
              cleanJob.reset();
              clearSource();
            }}
            canRetry={source?.kind === "file"}
          />
        ) : jobFailed && cleanJob.job ? (
          <AICleanJobFailure
            message={
              cleanJob.job.error?.message ??
              (cleanJob.job.status === "cancelled"
                ? "You stopped this one. Nothing was used from today's allowance."
                : "That video didn't finish.")
            }
            onRetry={() => {
              cleanJob.reset();
              if (source?.kind === "file") void cleanJob.submit(source.file);
            }}
            onChoose={() => {
              cleanJob.reset();
              clearSource();
            }}
            canRetry={source?.kind === "file"}
          />
        ) : error ? (
          <AICleanErrorState
            code={error}
            onRetry={() => {
              setError(null);
              setStage("choose");
            }}
          />
        ) : readyToStart && source ? (
          <AICleanReadyState
            source={source.kind === "file" ? { kind: "file", name: source.file.name } : { kind: "link", url: source.url }}
            isPro={isPremium}
            planKnown={planKnown}
            onBack={() => setStage(source.kind === "file" ? "choose" : "link")}
          />
        ) : previewing && source?.kind === "file" ? (
          <AICleanVideoPreview
            // Keyed on the URL so a replaced file gets a fresh <video> rather
            // than a reused element still holding the previous clip's metadata.
            key={source.objectUrl}
            file={source.file}
            objectUrl={source.objectUrl}
            onChange={acceptFile}
            onRemove={clearSource}
            // 🔴 The real thing now: upload to private storage, then start.
            onContinue={() => void cleanJob.submit(source.file)}
            onInvalid={(code) => {
              releaseObjectUrl();
              setSource(null);
              setError(code);
            }}
          />
        ) : enteringLink ? (
          <AICleanUrlInput
            onSubmit={(url) => {
              releaseObjectUrl();
              setSource({ kind: "link", url });
              setStage("ready");
            }}
            onCancel={() => setStage("choose")}
          />
        ) : (
          <AICleanEmptyState
            onFile={acceptFile}
            onPasteLink={() => setStage("link")}
            entitlement={cleanJob.entitlement}
          />
        )}
      </AICleanHero>

      {tutorialOpen ? <AICleanTutorial open onClose={closeTutorial} /> : null}

      {/*
        The ad. `onReward` attests it to the server, which then starts the job;
        `onCancel` simply closes — no allowance was reserved and no reward
        granted, so an abandoned ad costs the member nothing, which is the
        brief's rule and falls out of the ordering rather than being handled.
      */}
      {cleanJob.pendingReward ? (
        <RewardedAdGate
          open
          step={cleanJob.pendingReward.step}
          totalSteps={cleanJob.pendingReward.total}
          onReward={() => void cleanJob.completeReward()}
          onCancel={cleanJob.cancelReward}
        />
      ) : null}
    </FrenzAIEnvironment>
  );
}

/**
 * A job that did not finish, or one the member stopped.
 *
 * Separate from `AICleanErrorState`, which is about a FILE being unusable
 * before anything ran. This one is about work that started: the sentence comes
 * from the server, and the two ways out are different — try the same video
 * again, or choose a different one.
 *
 * "Try again" is only offered while the file is still in hand. After a refresh
 * the browser no longer holds it, and a button that silently could not do what
 * it says is worse than one that is not there.
 */
function AICleanJobFailure({
  message,
  onRetry,
  onChoose,
  canRetry,
}: {
  message: string;
  onRetry: () => void;
  onChoose: () => void;
  canRetry: boolean;
}) {
  return (
    <div className="p-4 sm:p-6">
      <div role="alert" className="mx-auto max-w-md px-2 py-10 text-center sm:py-14">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-lg font-bold tracking-[-0.01em]">That didn&apos;t finish</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{message}</p>
        <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          {canRetry ? (
            <button type="button" onClick={onRetry} className="btn-lux btn-lux-primary">
              <RotateCcw className="h-4 w-4" aria-hidden />
              Try again
            </button>
          ) : null}
          <button type="button" onClick={onChoose} className="btn-lux btn-lux-secondary">
            Choose another video
          </button>
        </div>
      </div>
    </div>
  );
}
