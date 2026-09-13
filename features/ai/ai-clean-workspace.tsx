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
import { FrenzAIPageHero } from "@/features/ai/frenz-ai-page-hero";
import { useAiCleanJob } from "@/features/ai/use-ai-clean-job";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { inspectVideoFile, parseVideoUrl, type AICleanErrorCode } from "@/lib/ai/clean-media";
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
 * ── Two flows, and BOTH are connected now (Part 6) ───────────────────────────
 *
 * A FILE is uploaded straight to private storage from the browser, then started.
 * A LINK is never touched by the browser at all: the url is validated against an
 * allow-list server-side, the job moves to `acquiring`, and OUR worker fetches
 * the video with the same yt-dlp pipeline every download on this site uses.
 *
 * Both end in the same place — one job row, one `useAiCleanJob`, one set of
 * states — which is why `submit` takes a File or a url rather than there being
 * two submission paths to keep in step.
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

export function AICleanWorkspace({
  historyHref = "/ai/history",
  usageHref = "/ai/usage",
}: { historyHref?: string; usageHref?: string } = {}) {
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
    const params = new URLSearchParams(window.location.search);
    const wants = params.get("tutorial");
    if (wants === "1") setTutorialOpen(true);

    /*
      ── 🔴 `?source=` — ARRIVING FROM SOMEWHERE ELSE WITH A VIDEO (Part 6) ───

      Owner, 2026-09-09: "check if users can select videos from history too."
      They could not: the only two ways in were the file picker and the paste
      field, so a video already in Downloads had to be found, re-copied and
      re-pasted by hand.

      Part 6 is what makes this possible at all — a `DownloadRecord` carries the
      original platform `url`, and until the server could fetch a url there was
      nothing to hand over. Now any surface holding one can deep-link here.

      🔴 IT IS STILL VALIDATED. A query parameter is as untrusted as a typed
      string — it can be crafted, shared, or arrive from a bookmark — so it goes
      through the SAME `parseVideoUrl` the paste field uses, and then through the
      server's allow-list on create. Nothing is fetched by the browser, and
      nothing auto-starts: it lands on the confirm screen, because a link that
      spent somebody's daily allowance just by being opened would be a trap.
    */
    const incoming = params.get("source");
    if (incoming) {
      const parsed = parseVideoUrl(incoming);
      if (parsed) {
        setSource({ kind: "link", url: parsed });
        setStage("ready");
      } else {
        setError("invalid-url");
      }
    }

    if (wants === "1" || incoming) {
      // Taken out of the url so a refresh — or a back-navigation — does not
      // reopen a sheet somebody has just closed, or re-arm a video they cleared.
      const url = new URL(window.location.href);
      url.searchParams.delete("tutorial");
      url.searchParams.delete("source");
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
  const chromeless = idleScreen || running || finished;

  return (
    <FrenzAIEnvironment
      stage={cleanJob.view.stage}
      // Awake once a video is chosen, before anything has been sent.
      armed={!!source}
      bare
    >
      {/*
        🔴 THE HERO IS THE NEW ONE, AND ONLY WHERE A SCREEN LACKS ITS OWN.

        Owner, 2026-09-08: "use the new upgraded hero in all ai pages." The
        input, progress and result screens each open with their own version of
        it; every OTHER state — the link field, the preview, ready, and the two
        error panels — gets it from here. `FrenzAIHeader`, the original, used to
        render above ALL of them, which stacked two different treatments of the
        same title on one screen.

        What was removed is this header plus the dots allowance strip beneath
        it. The headline did not disappear — it MOVED into the input page and
        gained a scene beside it, exactly as `public/ai input page.jpg` draws
        it. Rendering both would print the title twice.

        It stays for every other state: somebody watching a job or reading a
        result still needs to know where they are, and those screens carry no
        heading of their own.
      */}
      {chromeless ? null : (
        <FrenzAIPageHero
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
            sourceKind={cleanJob.job?.source.kind ?? (source?.kind === "link" ? "url" : "upload")}
            entitlement={cleanJob.entitlement}
            onCancel={cleanJob.job ? () => void cleanJob.cancel() : undefined}
          />
        ) : cleanJob.error ? (
          <AICleanJobFailure
            message={cleanJob.error.message}
            onRetry={() => {
              cleanJob.reset();
              /*
                🔴 A LINK CAN ALWAYS BE RETRIED; A FILE OFTEN CANNOT.

                The browser still holds the File only while the tab lived. A
                link is just a string the member typed, so Part 6 makes "try
                again" work after a refresh for that path — which is the one
                where a retry is most likely to help, because the failures are
                a busy platform or a slow CDN.
              */
              if (source?.kind === "file") void cleanJob.submit(source.file);
              else if (source?.kind === "link") void cleanJob.submit({ url: source.url });
            }}
            onChoose={() => {
              cleanJob.reset();
              clearSource();
            }}
            canRetry={!!source}
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
            canRetry={!!source}
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
            /* The server's own allowance, so the sentence on that screen cannot
               claim a number the reservation will not honour. */
            entitlement={cleanJob.entitlement}
            planKnown={planKnown}
            busy={cleanJob.busy}
            onBack={() => setStage(source.kind === "file" ? "choose" : "link")}
            /*
              🔴 Part 6: the link path is real. The same `submit` the file path
              uses — one state machine, as the brief requires — with a url
              instead of a File. The browser sends nothing; the server fetches.
            */
            onStart={() =>
              void cleanJob.submit(source.kind === "file" ? source.file : { url: source.url })
            }
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
            historyHref={historyHref}
            usageHref={usageHref}
          />
        )}
      </AICleanHero>

      {tutorialOpen ? <AICleanTutorial open onClose={closeTutorial} /> : null}

      {/*
        🔴 NO AD GATE. One rendered here until 2026-09-13, on
        `cleanJob.pendingReward`, and it is what held every free member's job
        at "queued 58%": the gate opened, the network it was never keyed for
        served nothing, and `/start` — which fired from its `onReward` — was
        never called. Standing rule §6 removed ads from the AI economy; the
        hook no longer has a reward state to render, so nothing can open one.
      */}
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
