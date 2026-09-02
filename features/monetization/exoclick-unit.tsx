"use client";

import { Volume2, VolumeX } from "lucide-react";
import { allowWindowOpen } from "@/lib/monetization/popunder-guard";
import { useCallback, useEffect, useRef, useState } from "react";

import { AD_ZONE_META } from "@/lib/monetization/ad-schema";
import type { AdTiming } from "@/lib/monetization/ad-timing";
import type { VastCreative } from "@/lib/monetization/vast";
import { cn } from "@/lib/utils";

/**
 * One ExoClick VIDEO zone, played from its VAST response.
 *
 * ── What this replaced, and why ───────────────────────────────────────────────
 *
 * The first version rendered ExoClick's `<ins class="eas…">` display tag and
 * loaded `ad-provider.js`. That is a real ExoClick product — just not the one
 * the owner's zone is. Their zone answers on `s.magsrv.com/v1/vast.php`, which
 * is the VIDEO product: XML describing a creative, inert without a player. The
 * provider script duly loaded, called its API, found no placeholder it
 * recognised, and rendered nothing, with no error anywhere. Since the ask was
 * for vertical VIDEO ads from the start, VAST is the right pipeline.
 *
 * An ExoClick BANNER zone is still perfectly serviceable today — paste its
 * `<ins>` snippet into a `display` placement, which renders it in the sandboxed
 * iframe like every other network's banner code.
 *
 * ── The player is deliberately small ──────────────────────────────────────────
 *
 * A plain `<video>` on a progressive MP4. No IMA SDK, no VAST library: the
 * parser picked a progressive file precisely so nothing more is needed, and the
 * brief said not to add dependencies. What it does implement is the part that
 * pays — the impression and quartile pixels, and the click-through — because an
 * ad that plays without reporting is an ad that earns nothing.
 */

/**
 * True once the document has finished loading — the gate every ad creative
 * waits behind so none of them competes with the page's own first paint.
 *
 * The 4-second cap is a safety net, not a target: if `load` has not fired by
 * then the page has something else wrong with it, and LCP has long since
 * happened either way. Without the cap a single hanging subresource would mean
 * no ad on the page ever resolves, which is a worse failure than a late one.
 */
function usePageSettled(): boolean {
  const [settled, setSettled] = useState(
    () => typeof document !== "undefined" && document.readyState === "complete",
  );
  useEffect(() => {
    if (settled) return;
    const done = () => setSettled(true);
    window.addEventListener("load", done, { once: true });
    const cap = setTimeout(done, 4000);
    return () => {
      window.removeEventListener("load", done);
      clearTimeout(cap);
    };
  }, [settled]);
  return settled;
}

/**
 * The tallest an IN-PAGE ad unit may be (the reels/full-screen `fill` variant
 * is unaffected — it is meant to own the screen).
 *
 * 62% of the small viewport leaves the section heading above it and the next
 * section's edge below it visible at the same time, so the unit reads as one
 * item in a page rather than as a wall the reader has to scroll through. See
 * the note at the call site for why the width is capped from this too.
 */
const IN_PAGE_MAX_H = "62svh";

/** VAST quartile events, as fractions of duration. */
const QUARTILES: [number, string][] = [
  [0.25, "firstQuartile"],
  [0.5, "midpoint"],
  [0.75, "thirdQuartile"],
];

/** Fire a tracking pixel. Image, not fetch — no CORS, no preflight, fire-and-forget. */
function pixel(urls: string[] | undefined) {
  for (const url of urls ?? []) {
    try {
      const img = new Image();
      img.referrerPolicy = "no-referrer-when-downgrade";
      img.src = url;
    } catch {
      /* A tracking pixel must never be able to break playback. */
    }
  }
}

export function ExoClickUnit({
  zone,
  /**
   * Fill the parent instead of sitting in a constrained column. The Reels slide
   * owns a whole 9:16 screen; the in-page placements sit in a page that is not
   * vertical, so they cap their width and centre.
   */
  fill = false,
  className,
  onFill,
  onAdTiming,
}: {
  /** OUR zone name. The ExoClick zone id is resolved server-side. */
  zone: string;
  fill?: boolean;
  className?: string;
  /**
   * The creative's own length and end, for gates that must obey the network's
   * timer rather than an admin number — see `lib/monetization/ad-timing.ts`.
   * Fired on `loadedmetadata` (duration) and on `ended`.
   */
  onAdTiming?: (timing: AdTiming) => void;
  /**
   * Whether a creative actually arrived AND started playing.
   *
   * Reported late and honestly: a configured zone is not a filled one, and a
   * VAST document that parses is still not a video that plays. Everything
   * upstream — the "Sponsored" card, the reels slide — collapses on `false`.
   */
  onFill?: (filled: boolean) => void;
}) {
  const [ad, setAd] = useState<VastCreative | null>(null);
  const [dead, setDead] = useState(false);
  const [muted, setMuted] = useState(true);
  /**
   * The box's aspect ratio, as `width / height`.
   *
   * Starts at 9/16 — the shape these zones are sold as — and is replaced with
   * the creative's real ratio the moment metadata arrives. Holding a ratio
   * rather than letting height be `auto` is what keeps the result section from
   * jumping when the video resolves.
   */
  const [ratio, setRatio] = useState(9 / 16);
  const video = useRef<HTMLVideoElement | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  /** The last answer given to `onFill`, so it is only re-sent on a real change. */
  const answered = useRef<boolean | null>(null);
  const started = useRef(false);
  const fired = useRef<Set<string>>(new Set());

  /**
   * 🔴 Reports on the CREATIVE RESOLVING, never on playback starting.
   *
   * Firing this from `onPlaying` deadlocked every ExoClick placement, and it
   * took a headless browser to see it — the MP4 reported `readyState: 4`
   * (fully buffered) while sitting at `0x0`, `paused`, forever:
   *
   *   the parent card is `hidden` until `onFill(true)`
   *     → a `display:none` element measures 0x0
   *       → the IntersectionObserver never sees it as visible
   *         → playback never starts
   *           → `onFill` never fires
   *
   * `AdSurface` and `FetchedAd` both gate exactly that way, so this affected
   * every slot, not just the one being tested. Fill means "a playable creative
   * exists", which is knowable the moment the VAST resolves. Whether it was
   * SEEN is a different question, answered separately by the impression pixel
   * below, which still waits for real playback.
   *
   * Deliberately NOT latched against a later `false`: a creative that resolves
   * and then fails to decode has to be able to take its card back down.
   */
  const answer = useCallback(
    (filled: boolean) => {
      if (answered.current === filled) return;
      answered.current = filled;
      if (!filled) setDead(true);
      onFill?.(filled);
    },
    // `onFill` is an inline arrow at every call site; including it would restart
    // the effect below on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Resolve the creative ──────────────────────────────────────────────────
  /*
    🔴 NEVER BEFORE THE PAGE HAS LOADED (owner, 2026-08-30: "i think the lcp is
    broken").

    Three zones on the landing page are declared `prefetch` — the above-fetch
    slot, the under-download slot and the preparing-download slot — and each one
    resolved its VAST and then pulled a whole MP4 (`preload="auto"`) as soon as
    it mounted, which is during hydration, which is while the browser is still
    fetching the thing the LCP is waiting on. Measured on production against a
    1.6Mbps link: LCP 3136ms with the ads live, 2796ms with them blocked. ~340ms
    of the landing page's budget was ad creatives competing for bandwidth with
    the hero.

    Waiting for `load` costs the ads nothing that matters. "Prefetched" means
    "ready before the visitor acts", and nobody has pasted a link, opened the
    batch panel or tapped Download inside the first second of a cold visit. It
    still buffers well ahead of the moment it is needed — it just stops doing it
    in front of the page.

    Units mounted after a client-side navigation (reels, the feed, the wallpaper
    viewer) see `readyState === "complete"` immediately and are unaffected.
  */
  const settled = usePageSettled();

  useEffect(() => {
    if (!settled) return;
    let alive = true;
    fetch(`/api/ads/exoclick?zone=${encodeURIComponent(zone)}`)
      .then((r) => (r.ok ? r.json() : { ad: null }))
      .then((d: { ad: VastCreative | null }) => {
        if (!alive) return;
        if (!d.ad?.mediaUrl) {
          answer(false);
          return;
        }
        setAd(d.ad);
        // The card may now render, which is what gives the <video> a size, which
        // is what lets it become visible and play. See the note on `answer`.
        answer(true);
      })
      .catch(() => {
        if (alive) answer(false);
      });
    return () => {
      alive = false;
    };
  }, [zone, answer, settled]);

  // ── Play only once it is actually on screen ───────────────────────────────
  /*
    An autoplaying video that starts below the fold burns the advertiser's
    impression on nobody and burns the visitor's data on nothing. It also fires
    an impression pixel for a view that did not happen, which is the kind of
    thing that gets a publisher account reviewed.
  */
  useEffect(() => {
    const el = video.current;
    const box = host.current;
    if (!ad || !el || !box) return;

    /*
      🔴 SOUND FIRST, muted only as a FALLBACK (owner, 2026-08-30: "make all
      video ad start always start with sound and can be muted").

      Unmuted autoplay is not something a page may simply assert — browsers
      refuse it without user activation, and the refusal arrives as a REJECTED
      `play()` promise rather than an error anyone would notice. So this asks for
      sound, and if the browser says no, it immediately retries muted rather than
      leaving a silent frozen frame.

      In Reels this usually succeeds: the viewer has already tapped and swiped,
      so the document carries user activation. On a cold landing page it usually
      does not, and the visitor gets the muted unit plus the unmute control —
      which is the honest outcome, not a bug.
    */
    /*
      🔴 IN-PAGE UNITS START MUTED (owner, 2026-08-31: "make the video ad below
      the hero to always start on muted not with sound").

      This narrows the 2026-08-30 instruction quoted above rather than reversing
      it, and the line is `fill`:

        • A FULL-BLEED unit — the reels slide, the interstitial — occupies the
          whole screen and only appears after the visitor has tapped and swiped
          their way into it. Sound is the point there, and the document usually
          carries the user activation needed to start it.
        • An IN-PAGE unit sits in a page someone is reading. It starts playing
          the moment it scrolls into view, which the reader did not ask for, so
          starting it with audio is the single most hostile thing this component
          can do. The unmute control right below is how they ask for sound.

      Decided from `fill` rather than a zone list on purpose: it is a property
      of the SURFACE, and a hardcoded list of zone ids is both the thing
      `ad-slots.test.ts` rejects and the thing that goes stale the next time a
      placement is added.
    */
    const tryPlay = () => {
      if (!fill) {
        el.muted = true;
        setMuted(true);
        void el.play().catch(() => {
          /* Blocked even muted — the frame stays and `onError` covers a
             genuinely broken file. Not a no-fill: the creative is there. */
        });
        return;
      }
      el.muted = false;
      void el
        .play()
        .then(() => setMuted(false))
        .catch(() => {
          el.muted = true;
          setMuted(true);
          void el.play().catch(() => {
            /* Blocked even muted — see above. */
          });
        });
    };

    if (typeof IntersectionObserver === "undefined") {
      tryPlay();
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) tryPlay();
          else el.pause();
        }
      },
      { threshold: 0.5 },
    );
    obs.observe(box);
    return () => obs.disconnect();
    // `fill` decides whether playback starts muted — see `tryPlay`.
  }, [ad, fill]);

  // Nothing to show — render no box at all, so the parent's card collapses with
  // it rather than framing an empty 9:16 hole.
  if (dead || !ad) return null;

  return (
    <div
      ref={host}
      className={cn(
        "relative overflow-hidden",
        /*
          🔴 Black ONLY on the full-screen reels slide (owner, 2026-08-30: "and
          a black background too").

          In-page, the box is set to the creative's own aspect ratio, so
          `object-contain` fills it edge to edge and any visible black is purely
          the container showing through during the moment before metadata lands
          — a dark slab flashing into a light page. Transparent there means the
          page's own background carries it and nothing flashes.

          The reels slide keeps it: that IS a full-screen black surface, and a
          transparent one would show the previous reel behind the ad.
        */
        fill ? "bg-black" : "bg-transparent",
        /*
          🔴 FULL WIDTH, sized to the CREATIVE'S OWN ASPECT (owner, 2026-08-30:
          "i want it to be full width like a platform reels … so users can enjoy
          watching it").

          This was `aspect-[9/16] max-w-[300px]` — a fixed vertical box in a
          narrow column, which is what made a full-motion video read as a boxed
          advert rather than something to watch. It now spans its container and
          takes its height from the video, so there are no letterbox bars at any
          width and no cropping.

          `aspectRatio` is applied inline from the real dimensions once they are
          known (see `onLoadedMetadata`), with 9/16 held until then — a plain
          `h-auto` would collapse to zero height before metadata lands and then
          snap open, which is a layout shift on the result section.
        */
        fill ? "h-full w-full" : "mx-auto w-full rounded-xl",
        className,
      )}
      /*
        🔴 HEIGHT-CAPPED IN PAGE (owner, 2026-08-31: "reduce the height of the
        sections video ad slot, is too long on a scroll, makes users cant see it
        full and fast without scrolling").

        This is in tension with the 2026-08-30 instruction directly above ("full
        width like a platform reels"), and the cap is how both hold. A 9/16
        creative at `w-full` is 1.78× the viewport WIDTH tall — on a 390px phone
        that is ~693px, taller than the screen, so the unit could never be seen
        whole and scrolled past as an endless slab.

        🔴 HEIGHT ONLY — the width cap was REVERTED the same day it shipped.

        The first version also capped the WIDTH (from the same number, through
        the ratio) so the box kept the creative's exact shape with no letterbox
        bars. That is the tidier answer and the wrong one: it cut a 412px-wide
        unit to about 297px — roughly HALVING an ad's on-screen area — on the
        same deploy after which the owner reported losing ExoClick impressions
        and clicks.

        Viewable area is the product here. Bars beside a vertical creative cost
        nothing but neatness; a unit half the size costs viewability on every
        single impression. So the width stays full and only the height is
        bounded, which is all the original complaint actually asked for: the
        whole unit visible without scrolling.

        `svh`, not `vh`: on mobile `vh` is the tallest-possible viewport, so a
        `vh` cap still overflows while the browser's toolbar is on screen —
        which is precisely the moment the reader is scrolling past this.
      */
      style={
        fill
          ? undefined
          : { aspectRatio: ratio, maxHeight: IN_PAGE_MAX_H }
      }
    >
      <video
        ref={video}
        src={ad.mediaUrl}
        muted={muted}
        playsInline
        /*
          🔴 NO `autoPlay` ATTRIBUTE (owner, 2026-08-30: "when i click the
          wallpaper download button it starts with the audio without showing
          anything").

          `autoPlay` starts playback as soon as the element can play —
          including while it is inside a `display:none` wrapper, which is
          exactly the state a gated interstitial is in before it reveals. iOS
          happily plays the AUDIO of a hidden video, so the visitor heard an
          ad they could not see.

          Playback is started explicitly by the IntersectionObserver instead,
          which by definition only fires once the element is really on
          screen. Sound and picture then start together.
        */
        /*
          🔴 Buffer AHEAD for zones declared `prefetch` (owner, 2026-08-30:
          "the ad video in above fetch card should prefetch and load before the
          link is pasted and fetched, to avoid the video loading slowing and
          making users scroll before it loads").

          `metadata` only fetches the header, so the slot sat there empty until
          it scrolled into view and only THEN started pulling the file — which
          is exactly the wait being described. The zone registry already knows
          which placements must be ready before they are looked at, so that one
          flag decides it rather than a second list to keep in step.

          Everything else stays on `metadata`: buffering a whole MP4 for a slot
          most visitors never scroll to is bandwidth spent on nobody.
        */
        preload={AD_ZONE_META[zone as keyof typeof AD_ZONE_META]?.prefetch ? "auto" : "metadata"}
        // Loops are not free impressions: each replay would re-fire nothing (the
        // pixels are latched) but would keep pulling bytes. One play, then stop.
        /*
          🔴 COVER when filling a reel, CONTAIN in-page (owner: "is not full
          and fills … make it fill like a reels video").

          The reels slide is a full-screen 9:16 stage, and object-contain left
          black bands above and below any creative that was not exactly that
          ratio — which is what made the ad read as letterboxed rather than as a
          reel. Cover fills the screen the way every real reel does.

          In-page stays CONTAIN on purpose: there the box is already set to the
          creative's own aspect ratio, so contain fits it exactly with no bars,
          and cover would crop an ad nobody asked to have cropped.
        */
        /*
          🔴 COVER only in the REELS deck (owner, 2026-08-30: the interstitial
          was "cropping and stretching too much").

          Cover crops whatever does not fit. That is right for the reels slide,
          which is a true full-screen 9:16 stage where letterboxing would break
          the illusion — and wrong everywhere else, especially the interstitial,
          whose stage is now inset by the safe area and so crops even harder.

          Decided from the ZONE rather than a prop: it is a property of the
          surface, and threading a flag through AdSurface and AdSlot to reach
          here is how the two get out of step.
        */
        className={cn(
          "h-full w-full",
          fill && zone === "reels_interstitial" ? "object-cover" : "object-contain",
        )}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth > 0 && v.videoHeight > 0) setRatio(v.videoWidth / v.videoHeight);
          /*
            🔴 Report the ad's REAL length upward (owner, 2026-08-30: "skipable
            when the ad finishes in the ad network, admin timer set up should
            only be a fallback").

            The gate above this has no access to the element, so without this it
            can only count the admin number — which is how a 10-second wallpaper
            gate ended up holding a visitor four seconds past the end of a
            6-second fill. The VAST's declared duration is used when the file
            itself has not got one.
          */
          const declared = ad.durationSeconds;
          const real = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : declared;
          onAdTiming?.({ durationSeconds: real ?? null, ended: false });
        }}
        onPlaying={() => {
          if (started.current) return;
          started.current = true;
          /*
            The impression belongs to the moment pixels actually moved on a
            screen someone is looking at — NOT to the moment the creative
            resolved. That distinction is the whole reason `onFill` and this are
            separate: the card can appear as soon as there is something to show,
            while the advertiser is only billed for a view that really happened.
          */
          pixel(ad.impressions);
          pixel(ad.tracking.start);
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;

          /*
            🔴 THE VIEW BEACON (fixed 2026-08-30).

            ExoClick reported ~100 impressions, 0 views, $0.00. Their VAST sends
            NO `start` and NO quartile events — every tracker is
            `event="progress"` with a time offset, and the URL behind it is
            `vregister.php?a=vview`, which IS their view counter. Firing only the
            named milestones meant `a=vimp` fired correctly on every play while
            `a=vview` never fired once, so views stayed at zero and revenue
            followed.

            Driven by real `currentTime`, never a JS timer, so a paused, stalled
            or backgrounded video cannot accrue a view it did not earn. Each
            offset fires at most once per playback (`fired`), which also makes it
            safe against React re-renders re-invoking this handler.
          */
          for (const p of ad.progress) {
            const key = `progress@${p.offsetSeconds}`;
            if (el.currentTime >= p.offsetSeconds && !fired.current.has(key)) {
              fired.current.add(key);
              pixel([p.url]);
            }
          }

          // Named milestones, for networks that do send them. ExoClick does not,
          // which is exactly why the progress trackers above had to be handled.
          const total = ad.durationSeconds || el.duration;
          if (!total || !Number.isFinite(total)) return;
          for (const [at, event] of QUARTILES) {
            if (el.currentTime >= total * at && !fired.current.has(event)) {
              fired.current.add(event);
              pixel(ad.tracking[event]);
            }
          }
        }}
        onEnded={() => {
          // The authoritative "the network's timer ran out" signal — reported
          // even if the complete pixel has already fired, because the gate above
          // needs it every time and pixel de-duplication is a separate concern.
          onAdTiming?.({ durationSeconds: null, ended: true });
          if (fired.current.has("complete")) return;
          fired.current.add("complete");
          pixel(ad.tracking.complete);
        }}
        /* A creative that 404s or will not decode is a no-fill, not a black box. */
        onError={() => answer(false)}
      />

      {/*
        The click-through, as a real overlay button rather than a handler on the
        <video>. A bare video click is also the platform's play/pause gesture, so
        putting navigation on it would hijack the one control the visitor
        expects. `noopener` because the destination is a third party.
      */}
      {ad.clickThrough ? (
        <button
          type="button"
          aria-label="Visit advertiser"
          onClick={() => {
            pixel(ad.clickTracking);
            /*
              Our OWN click beacon, alongside ExoClick's.

              The player owns its click target, so `AdSlot`'s built-in click
              tracking never saw it — ExoClick's dashboard counted the click
              and the admin dashboard recorded nothing, which is exactly the
              kind of divergence that makes an internal report untrustworthy.
            */
            try {
              navigator.sendBeacon?.(
                "/api/track",
                new Blob(
                  [JSON.stringify({ kind: "click", zone, adId: ad.adId ?? null })],
                  { type: "application/json" },
                ),
              );
            } catch {
              /* A dropped beacon must never cost the visitor the click-through. */
            }
            /* An intentional click on an ad is a real click the network should be
               paid for — the guard blocks pop-unders, not advertising. */
            allowWindowOpen();
            window.open(ad.clickThrough!, "_blank", "noopener,noreferrer");
          }}
          className="absolute inset-0 h-full w-full cursor-pointer"
        />
      ) : null}

      {/*
        Sound is OFF and stays off until asked. Autoplaying audio over a page
        someone is reading — or over a reel they are already listening to — is
        the single most hostile thing a video ad can do.
      */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const el = video.current;
          if (!el) return;
          const next = !muted;
          setMuted(next);
          el.muted = next;
          if (!next) void el.play().catch(() => {});
        }}
        aria-label={muted ? "Unmute ad" : "Mute ad"}
        className="absolute bottom-2 left-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>

      {/*
        🔴 Bottom-right, not top-left (owner, 2026-08-30: "take the embedded ad
        logo and text to the bottom right of the video").

        The mute control moved to the bottom LEFT to make room — the two cannot
        share a corner, and the disclosure badge is the one whose position was
        actually asked for. Still on the video and still always visible, so the
        unit remains labelled as an ad wherever it renders.
      */}
      <span className="pointer-events-none absolute bottom-2 right-2 z-10 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/85">
        Ad
      </span>
    </div>
  );
}
