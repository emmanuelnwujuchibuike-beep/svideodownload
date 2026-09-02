"use client";

import { useEffect, useRef, useState } from "react";

import { hilltopZoneSource, type HilltopConfig } from "@/lib/monetization/hilltop-config";

import { useRewardNetwork } from "@/features/monetization/use-interstitial-skip";
import { useShowAds } from "@/features/monetization/use-show-ads";

import { FullscreenInterstitial } from "./fullscreen-interstitial";
import { useAdGateCountdown } from "./use-ad-gate-countdown";

/**
 * The reward gate shown when a wallpaper download is tapped.
 *
 * Owner, 2026-08-30: "put a slot for exoclick to show a 5 secs reward full
 * screen like reels ad when the download wallpaper button is clicked, it should
 * be able to be switched when offerium approve so i can replace with offerium
 * reward ads."
 *
 * ── The switch already exists, and is reused rather than rebuilt ──────────────
 *
 * `lib/monetization/reward-networks.ts` already routes each reward MOMENT to its
 * own network, and `wallpaper` is already one of those moments. So "switchable
 * to Offerium later" is not new plumbing — it is the admin dropdown that is
 * already there, pointed at this gate. When Offerium is approved and its
 * postback seam is implemented, changing the network for the `wallpaper` moment
 * is all that is required, with no change here.
 *
 * ── It NEVER blocks the download ─────────────────────────────────────────────
 *
 * Same rule as the VAST interstitial: the ad is an optional enhancement. If the
 * zone is unseeded, the network is unavailable, or the creative never resolves,
 * `onDone` fires immediately and the wallpaper saves. A gate that can strand
 * someone between a tap and their file is worse than no gate.
 */
export function WallpaperRewardGate({
  open,
  onDone,
  /**
   * Seconds before the gate can be dismissed.
   *
   * A FALLBACK for a caller that wants to override it. The real value is
   * admin-set and fetched below — see `wallpaperGateSeconds`.
   */
  seconds,
}: {
  open: boolean;
  /** Called exactly once, whether the ad ran, failed, or never existed. */
  onDone: () => void;
  seconds?: number;
}) {
  /*
    The admin-set hold. Starts at the built-in default so a slow or failed config
    fetch behaves exactly as before rather than releasing the download instantly.
  */
  const [configured, setConfigured] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { wallpaperGateSeconds?: number }) => {
        if (alive && typeof d.wallpaperGateSeconds === "number") setConfigured(d.wallpaperGateSeconds);
      })
      .catch(() => {
        /* The default is the safe outcome. */
      });
    return () => {
      alive = false;
    };
  }, []);
  const holdSeconds = seconds ?? configured ?? 10;

  /*
    🔴 THE VIDEO PATH (owner, 2026-09-01: "the wallpaper download started and
    completed is suppose to be hiltop vast video and not hiltop banner, cause now
    it only shows a 5sec hiltop banner and doesnt show a download complete vast
    video on wallpaper download").

    This gate renders through `FullscreenInterstitial` → `AdSlot`, and AdSlot has
    NO VIDEO BRANCH — so a banner was the only thing it could ever show, which is
    exactly the 5-second banner being described. The video is the VAST
    interstitial, and `requestVastInterstitial` is the only thing that plays one.

    With the zone set to `vast` this gate hands the moment to it and releases the
    download when it resolves — shown, skipped, or nothing to show. The download
    is NEVER blocked on the ad: every path calls `onDone`, including the failure
    one, which is the standing rule for this gate.
  */
  const [videoMode, setVideoMode] = useState<"unknown" | "vast" | "slot">("unknown");
  const firedVideo = useRef(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { hilltop?: HilltopConfig }) => {
        if (!alive) return;
        setVideoMode(
          d.hilltop && hilltopZoneSource(d.hilltop, "wallpaper_reward") === "vast" ? "vast" : "slot",
        );
      })
      .catch(() => alive && setVideoMode("slot"));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open || videoMode !== "vast" || firedVideo.current) return;
    firedVideo.current = true;
    void import("./vast-interstitial/request")
      .then((m) => m.requestVastInterstitial("wallpaper"))
      .catch(() => {
        /* A gate that cannot load its ad must still release the download. */
      })
      .finally(onDone);
  }, [open, videoMode, onDone]);

  // Re-arm for the next wallpaper once this one has been released.
  useEffect(() => {
    if (!open) firedVideo.current = false;
  }, [open]);
  /*
    Read only so the admin's per-moment routing is honoured. ExoClick serves it
    today through the shared zone stack; when the moment is pointed at Offerium
    this is where that branch lands.
  */
  const { network } = useRewardNetwork("wallpaper");
  const [hasAd, setHasAd] = useState<boolean | null>(null);

  /*
    🔴 `hasAd` is deliberately NOT reset per open (owner, 2026-08-30: "wallpaper
    download button takes time to fire, when i click on download, it takes time
    before it loads").

    Resetting it to null threw away the answer the prefetch had already
    obtained, and `AdSlot` resolves once — it does not re-answer for a slot it
    has already reported on. So from the second tap onward `hasAd` was stuck at
    null, which meant two things at once: the fail-open timer below took its
    full 2.5s unresolved path before releasing the download, and `shown` (which
    requires `=== true`) never became true, so the ad it had just buffered never
    appeared either. The whole point of mounting this early is that the answer
    is already in hand by the time anyone taps.

    The COUNTDOWN is still per-open — `useAdGateCountdown` resets itself
    whenever `running` goes false.
  */

  /*
    🔴 `seconds` is a FALLBACK, not the countdown (owner, 2026-08-30: "to be
    skipable when the ad finishes in the ad network, admin timer set up should
    only be a fallback").

    This used to tick down from `seconds` with no idea what it was gating, so a
    5-second setting over a 3-second ExoClick fill held the visitor two seconds
    past the end of a frozen, finished video. The hook now closes the gate the
    moment the creative ends, targets the creative's real length when it is
    shorter than `seconds`, and only falls back to `seconds` for a creative with
    no timeline at all.

    `running` is `hasAd === true`: the countdown only runs while a creative is
    genuinely on screen — counting down over a blank overlay would be charging
    the visitor for nothing.
  */
  const { remaining, canSkip, onAdTiming } = useAdGateCountdown({
    fallbackSeconds: holdSeconds,
    running: open && hasAd === true,
  });

  /*
    ═══════════════════════════════════════════════════════════════════════════
     🔴 `none` MEANS NO GATE — AND IT USED TO MEAN NOTHING AT ALL.
    ═══════════════════════════════════════════════════════════════════════════

    Owner, 2026-09-02: "Wallpaper download, Download twice… after wallpaper
    download the vast shows for 15 secs and not a duplicate."

    `network` was read here and then used for exactly one thing: a
    `data-reward-network` attribute on the overlay. It never gated anything. So
    routing the `wallpaper` moment to "no ad" in the admin — or in the defaults —
    changed a debug attribute and left the gate running, which is the second
    half of the duplicate: a gate ad here, then the completion VAST seconds
    later, for one tap.

    Honouring it is the fix. The wallpaper saves immediately and the ONE ad the
    visitor sees is the completion VAST.
  */
  // A paying member sees no ad at all, so warming for one would be a VAST
  // request with no impression behind it.
  const { showAds } = useShowAds();

  const noGate = network === "none";

  useEffect(() => {
    if (open && noGate) onDone();
  }, [open, noGate, onDone]);

  /*
    🔴 WARM THE COMPLETION CREATIVE ON MOUNT.

    Removing this gate also removed the only thing that pre-warmed the wallpaper
    flow's completion ad: `requestVastInterstitial("wallpaper")` used to run
    here, and `PREFETCHES_ON_START` warms `download-complete` off the back of it.
    With the gate gone, nothing warms, the completion creative starts cold, and
    a cold Hilltop creative is ~10.9s to first frame — the "triggers too late"
    the owner reported on the downloader is the same bug here.

    Mount, not tap: this component is mounted when the wallpaper viewer opens
    (see the note below on why), which gives the media real lead time. Tapping
    download and warming then would be too late to help.
  */
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current || !showAds) return;
    warmed.current = true;
    void import("./vast-interstitial/request")
      .then((m) => {
        m.warmVastInterstitial();
        m.warmCreativeFor("download-complete");
      })
      .catch(() => {
        /* A warm that fails costs nothing — the moment still fetches normally. */
      });
  }, [showAds]);

  /*
    FAIL OPEN. No creative, or a slot that never answers, releases the download
    rather than holding it. The short delay on the unresolved case gives a slow
    network a moment to arrive without the visitor noticing a pause.
  */
  useEffect(() => {
    if (!open || noGate) return;
    const id = setTimeout(() => {
      if (hasAd !== true) onDone();
    }, hasAd === false ? 0 : 2500);
    return () => clearTimeout(id);
  }, [open, noGate, hasAd, onDone]);

  /*
    🔴 MOUNTED ALWAYS, REVEALED ON TAP (owner: "the download button should load
    and prefetch the ad after the wallpaper have finished opening, so the ad
    opens instantly").

    Returning null until the gate opened meant the unit only began resolving its VAST and
    pulling an MP4 at the moment of the tap — a round trip plus a video download
    while someone waits for their wallpaper. Mounting it up front lets the
    creative buffer in advance, so revealing it is instant.

    Safe because the player no longer carries an autoplay attribute: playback
    starts from the IntersectionObserver, which cannot fire while this is
    hidden. That is what stopped the ad playing its AUDIO behind a hidden
    overlay.
  */
  // The video path owns this moment — the gate renders nothing there.
  if (videoMode === "vast") return null;
  // Routed to "no ad": nothing to show, and the effect above has already
  // released the download.
  if (noGate) return null;

  return (
    <FullscreenInterstitial
      zone="wallpaper_reward"
      /* Clears the wallpaper viewer (`fixed inset-0 z-[100]`), which is what
         `z-[60]` did not — and the same level the existing wallpaper reward ad
         already uses. */
      z="z-[130]"
      /* `=== true`: three-state, and "not false" would flash the overlay
         before the slot has said anything. */
      shown={open && hasAd === true}
      canSkip={canSkip}
      remaining={remaining}
      onResolved={setHasAd}
      onAdTiming={onAdTiming}
      onClose={() => {
        if (canSkip) onDone();
      }}
      data-reward-network={network}
    />
  );
}
