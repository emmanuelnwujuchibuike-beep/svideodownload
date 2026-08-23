"use client";

import { Check, ChevronRight, Compass, Download, ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { apkAvailable, startApkDownload } from "@/lib/pwa/android-apk";
import { recordDecline } from "@/lib/pwa/decline-tracker";
import { reportInstallEvent } from "@/lib/pwa/install-analytics";
import { classifyInstallPlatform } from "@/lib/pwa/platform";
import {
  getInstallState,
  getServerInstallState,
  promptInstall,
  subscribeInstall,
} from "@/lib/pwa/install-store";
import {
  BROWSER_CHOICES,
  describeEnvironment,
  installGuide,
  readEnvironment,
  type BrowserId,
  type InstallEnvironment,
} from "@/lib/pwa/install-environment";
import { cn } from "@/lib/utils";

/**
 * The Smart Install sheet — everything the install feature knows, in the chunk
 * that is only fetched once someone taps Install.
 *
 * ── Why nothing here is on the landing's first load ───────────────────────────
 * `/(marketing)/page` is held to 275 kB gzipped (lib/perf/budget.test.ts). This
 * file, the browser matrix it renders, and the icons it uses are all behind the
 * `next/dynamic` boundary in `install-button.tsx`, so a visitor who never asks
 * to install pays nothing for it beyond the two event listeners in
 * `lib/pwa/install-store.ts`.
 *
 * ── Animation ─────────────────────────────────────────────────────────────────
 * CSS transforms and opacity only, on `transform`/`opacity` so the compositor
 * handles it without a main-thread paint. Deliberately NOT framer-motion: it is
 * ~39 kB, the landing has a test asserting it stays off
 * (budget.test.ts → "keeps framer-motion off the landing page entirely"), and a
 * 180ms slide does not need a physics engine. `motion-reduce:` removes the
 * movement entirely rather than shortening it.
 *
 * ── Deliberately no backdrop blur ─────────────────────────────────────────────
 * A full-viewport `backdrop-filter` is a GPU pass over everything behind it,
 * every frame it animates. On the low-end Android hardware this project targets
 * that is exactly the kind of effect that shows up as heat, so the scrim is a
 * flat translucent colour.
 */

/** Presentation: bottom sheet on phones, centred dialog from `sm` up. */
export function InstallModal({ onClose }: { onClose: () => void }) {
  /*
    Detection runs ONCE, here, on open — never during page load and never on a
    timer. Reading `navigator` is cheap but it is also pointless before someone
    has asked to install, and doing it in render would repeat it on every state
    change (the browser switcher below causes several).
  */
  const detected = useMemo(() => readEnvironment(), []);
  /** Overridden by the "Using a different browser?" picker. */
  const [override, setOverride] = useState<BrowserId | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);

  const env: InstallEnvironment = useMemo(() => {
    if (!override) return detected;
    /*
      Re-describe rather than patching `browser` on the detected object: the
      LABEL has to change with it ("Firefox on Android", not "Safari on
      iPhone" with Firefox steps), and label construction lives in one place.
      Synthesising a representative UA keeps that single source of truth
      instead of duplicating the naming rules here.
    */
    const synthetic: Record<BrowserId, string> = {
      chrome: "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36",
      safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari/605.1.15",
      firefox: "Mozilla/5.0 (Android 14; Mobile) Gecko/120.0 Firefox/120.0",
      edge: "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36 EdgA/120",
      samsung: "Mozilla/5.0 (Linux; Android 14) SamsungBrowser/23.0 Chrome/115 Mobile Safari/537.36",
      opera: "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36 OPR/76",
      brave: "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36",
      chromium: "Mozilla/5.0 (X11; Linux x86_64) Chromium/120",
      inapp: "Mozilla/5.0 (iPhone) Instagram 300.0",
      unknown: "Mozilla/5.0",
    };
    return describeEnvironment(synthetic[override], undefined, override === "safari" ? 0 : 0, override === "brave");
  }, [detected, override]);

  const guide = useMemo(() => installGuide(env), [env]);

  /*
    Whether a REAL native install is available — the single most important
    honesty check in this component.

    It is gated on an actual parked `beforeinstallprompt` (the capability), not
    on the browser's name (the guess). Rendering "Install now" whenever the
    browser merely LOOKS Chromium produces a button that opens nothing on the
    many legitimate occasions Chrome declines to offer installation — an
    already-installed app, an unmet manifest/HTTPS requirement, a browser that
    simply hasn't fired the event yet. The brief's rule cuts both ways: never
    fake an install prompt, and never hide the real one.

    Also suppressed once the person has overridden the browser via the picker —
    they are then reading "what would this look like in Firefox", and firing
    Chrome's parked event from under that heading would install via a browser
    the screen is no longer describing.
  */
  const installState = useSyncExternalStore(subscribeInstall, getInstallState, getServerInstallState);
  const canPromptNatively = installState.canPrompt && !override && !env.inAppName;

  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const platform = useMemo(
    () =>
      classifyInstallPlatform(
        env.inAppName && env.os === "ios" ? "ios-inapp" : env.os === "ios" ? "ios" : "android",
        typeof navigator === "undefined" ? "" : navigator.userAgent,
      ),
    [env],
  );

  useEffect(() => {
    reportInstallEvent("pwa_install_prompt_shown", platform);
    // Report once per open, not on every environment change from the picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    setShown(false);
    // Let the exit transition finish before unmounting; matches `duration-200`.
    window.setTimeout(onClose, 190);
  }, [onClose]);

  const dismiss = useCallback(() => {
    reportInstallEvent("pwa_install_dismissed", platform);
    // Shares the automatic banner's per-device decline budget, so someone who
    // keeps closing this is not nagged by the banner either.
    recordDecline("add-to-home-screen");
    close();
  }, [close, platform]);

  /* Mount → next frame → animate. A panel mounted at its final position has
     nothing to interpolate from, so it would simply appear. */
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  /*
    Focus management: remember what was focused, move focus into the dialog,
    trap Tab inside it, and restore on close. Escape closes. This is the whole
    of the dialog contract and there is no library doing it for us.
  */
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    node?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismiss();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const focusables = node.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    const previousOverflow = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflowY = previousOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [dismiss]);

  /*
    ── Android gets the real APK, not the PWA prompt ───────────────────────────
    Owner, 2026-08-23: "clicking the existing Install App button must download
    the official Frenzsave APK … do not trigger the browser's PWA installation
    prompt when the user clicks this button on Android."

    Detection reuses `env.os` from lib/pwa/install-environment.ts — the same
    parameterised, unit-tested matrix the rest of this modal runs on, which
    already handles the iPadOS-reports-as-Mac case via `maxTouchPoints`. No new
    detection code and no UA library for this, per the brief.

    The availability check stops a missing file looking like a success: the APK
    may legitimately not be uploaded yet, and this modal must not say
    "downloading" and hand someone a 404. When it fails we fall back to the
    written per-browser steps that are already on screen and say so.

    🔴 THE CHECK RUNS ON OPEN, AND THE TAP HANDLER IS SYNCHRONOUS (owner,
    2026-08-23: "when I click on download app on android it just loads for half
    a second and disappears").

    It used to `await apkAvailable()` inside the click handler and only then
    create the anchor. That await is what broke it: a browser only honours a
    programmatic download while the tap's TRANSIENT USER ACTIVATION is still
    alive, and awaiting a network round-trip outlives it. Chrome on Android then
    blocks the download silently — no error, no file — while our own code
    carried on to `close()`, which is the "loads for half a second and
    disappears" exactly as described.

    This codebase has hit the same class of bug before: `saveFilesToDevice`
    documents that iOS only permits `navigator.share` inside the live gesture,
    and that awaiting a dynamic import first destroys it. Same rule, different
    API — so the fix is the same shape. The HEAD request now happens when the
    sheet opens, its result is held in state, and the tap does nothing but click
    an anchor.
  */
  const isAndroid = env.os === "android";
  const [apkStatus, setApkStatus] = useState<"checking" | "ready" | "missing">("checking");
  const [apkStarted, setApkStarted] = useState(false);

  useEffect(() => {
    if (!isAndroid) return;
    const controller = new AbortController();
    void apkAvailable(controller.signal).then((ok) => {
      if (!controller.signal.aborted) setApkStatus(ok ? "ready" : "missing");
    });
    return () => controller.abort();
  }, [isAndroid]);

  /*
    Synchronous. No `await`, no promise, nothing between the tap and the click —
    see the note above. `void` on the beacon because `reportInstallEvent` is
    already fire-and-forget; awaiting it here would reintroduce the exact bug.
  */
  const downloadApk = () => {
    if (apkStatus !== "ready") return;
    startApkDownload();
    setApkStarted(true);
    // An accepted install INTENT — deliberately not `pwa_installed`, which is
    // reserved for the browser's own `appinstalled` event and must keep meaning
    // "the app is actually on the device".
    reportInstallEvent("pwa_install_accepted", platform);
    /*
      The sheet deliberately stays OPEN and switches to a "download started"
      state. Closing instantly was the other half of what read as a failure:
      Android hands the transfer to the download manager with no visible change
      on the page, so a sheet that vanishes at the same moment looks like the
      tap dismissed it rather than started anything.
    */
  };

  const install = async () => {
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    if (outcome === "accepted") {
      reportInstallEvent("pwa_install_accepted", platform);
      close();
    } else if (outcome === "dismissed") {
      reportInstallEvent("pwa_install_dismissed", platform);
      recordDecline("add-to-home-screen");
      close();
    }
    // "unavailable" → the parked event went stale; fall through to the written
    // steps already on screen rather than closing on a dead end.
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-[120] flex items-end justify-center sm:items-center",
        "bg-black/50 transition-opacity duration-200 motion-reduce:transition-none",
        shown ? "opacity-100" : "opacity-0",
      )}
      onClick={dismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative w-full bg-card shadow-2xl outline-none",
          // Bottom sheet on phones; a centred card from `sm` up.
          "max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:max-w-[27rem] sm:rounded-3xl",
          "px-5 pt-5",
          // Clears the iPhone home indicator without padding the desktop card.
          "pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] sm:pb-5",
          "transition-transform duration-200 [transition-timing-function:var(--ease-out)] motion-reduce:transition-none",
          shown ? "translate-y-0" : "translate-y-full sm:translate-y-2",
        )}
      >
        {/* The grab handle reads as a native sheet; decorative, phones only. */}
        <span aria-hidden className="mx-auto mb-3 block h-1 w-9 rounded-full bg-border sm:hidden" />

        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="text-center">
          <FrenzLogo size={48} className="mx-auto" />
          <h2 id="install-modal-title" className="mt-3 text-xl font-bold tracking-tight">
            Install Frenz
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Get the full Frenz experience on your device.
          </p>
        </div>

        {/* What we detected, stated plainly so a wrong guess is obvious and the
            person knows the switcher below is the fix. */}
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-secondary/60 px-3 py-2.5 text-[13px] font-medium">
          <Compass className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="text-muted-foreground">You&apos;re using </span>
            <span className="font-semibold text-foreground">{env.label}</span>
          </span>
        </p>

        {/*
          When the browser can do it natively, the steps are noise: the button
          below opens the real system install sheet and there is nothing for the
          person to follow. The written matrix is the FALLBACK, so it only
          renders when there is genuinely no prompt to fire.
        */}
        {isAndroid && apkStatus !== "missing" ? (
          /* Android: the APK is the install, so the PWA steps would be the
             wrong instructions entirely. Says what the download is and what
             Android will ask for, because "install blocked" from an unknown
             source is the step people actually get stuck on. */
          apkStarted ? (
            <p className="mt-4 rounded-2xl bg-emerald-500/10 px-3 py-2.5 text-[13px] leading-snug text-emerald-700 dark:text-emerald-400">
              <strong>Download started.</strong> Check your notifications or Downloads folder, open{" "}
              <span className="font-mono">frenzsave.apk</span>, and tap Install. If Android warns
              about an unknown source, allow it for your browser and tap Install again.
            </p>
          ) : (
            <p className="mt-4 rounded-2xl bg-secondary/45 px-3 py-2.5 text-[13px] leading-snug text-muted-foreground">
              Downloads the Frenz app (.apk). Android will ask you to confirm the install — if it
              warns about an unknown source, allow it for your browser and tap Install.
            </p>
          )
        ) : canPromptNatively ? (
          <p className="mt-4 rounded-2xl bg-secondary/45 px-3 py-2.5 text-[13px] leading-snug text-muted-foreground">
            One tap — {env.label.split(" on ")[0]} will ask you to confirm, then Frenz appears with your
            other apps.
          </p>
        ) : (
          <>
            <p className="mt-4 text-sm font-bold">{guide.title}</p>
            <ol className="mt-2 space-y-2">
              {guide.steps.map((step, i) => (
                <li
                  key={step}
                  className="flex items-start gap-3 rounded-2xl bg-secondary/45 px-3 py-2.5 text-[13px] leading-snug"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 pt-px">{step}</span>
                </li>
              ))}
            </ol>

            {guide.note ? (
              <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{guide.note}</p>
            ) : null}
          </>
        )}

        {/* The APK genuinely isn't there — say so plainly and let the written
            steps below stand in. Never silently "succeeds". */}
        {isAndroid && apkStatus === "missing" ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            <ExternalLink aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            The app download isn&apos;t available right now. You can still add Frenz to your home
            screen using the steps above.
          </p>
        ) : null}

        <div className="mt-4">
          {isAndroid && apkStatus !== "missing" ? (
            /* Android: downloads the APK. Deliberately ahead of the
               `canPromptNatively` branch — on Android Chrome BOTH are true, and
               the owner's instruction is that this button installs the app, not
               that it fires the PWA prompt.

               Disabled only while the on-open availability check is still in
               flight, which is a single HEAD request — never gated on an await
               that runs INSIDE the tap. */
            apkStarted ? (
              <button type="button" onClick={close} className="btn-lux btn-lux-primary w-full justify-center">
                <Check className="h-4 w-4" /> Done
              </button>
            ) : (
              <button
                type="button"
                onClick={downloadApk}
                disabled={apkStatus === "checking"}
                className="btn-lux btn-lux-primary w-full justify-center disabled:opacity-70"
              >
                <Download className="h-4 w-4" />
                {apkStatus === "checking" ? "Preparing…" : "Download the app"}
              </button>
            )
          ) : canPromptNatively ? (
            /* A REAL native install — only rendered when the browser actually
               parked a `beforeinstallprompt`. Never a fake button that opens
               instructions while claiming to install. */
            <button
              type="button"
              onClick={install}
              disabled={busy}
              className="btn-lux btn-lux-primary w-full justify-center disabled:opacity-70"
            >
              <Download className="h-4 w-4" />
              {busy ? "Installing…" : "Install now"}
            </button>
          ) : (
            <button type="button" onClick={close} className="btn-lux btn-lux-primary w-full justify-center">
              <Check className="h-4 w-4" /> Got it
            </button>
          )}
        </div>

        {/* Browser switcher — local state only. No navigation, no fetch. */}
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => setPickerOpen((p) => !p)}
            aria-expanded={pickerOpen}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-primary transition hover:bg-secondary"
          >
            Using a different browser?
            <ChevronRight className={cn("h-4 w-4 transition-transform", pickerOpen && "rotate-90")} />
          </button>
        </div>

        {pickerOpen ? (
          <div className="mt-2 grid grid-cols-2 gap-2 animate-in fade-in duration-150 motion-reduce:animate-none">
            {BROWSER_CHOICES.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setOverride(b.id)}
                aria-pressed={override === b.id}
                className={cn(
                  "rounded-xl px-3 py-2.5 text-[13px] font-semibold transition active:scale-[0.98]",
                  override === b.id
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                {b.name}
              </button>
            ))}
            {override ? (
              <button
                type="button"
                onClick={() => setOverride(null)}
                className="col-span-2 rounded-xl px-3 py-2 text-[13px] font-semibold text-primary transition hover:bg-secondary"
              >
                Back to {detected.label}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* The one case where the honest answer is "leave this browser". */}
        {env.inAppName ? (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            Installing isn&apos;t possible inside {env.inAppName}.
          </p>
        ) : null}
      </div>
    </div>
  );
}
