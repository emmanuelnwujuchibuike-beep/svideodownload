/**
 * Ad zone/format catalogue and pure lookup helpers.
 *
 * Deliberately zod-free: `AdSlot` (client-side, rendered on every page with an
 * ad) imports `isPersistentZone`/`sizeFromScript` from here, and zod schema
 * construction at module scope defeats tree-shaking — so the write-validation
 * schemas that used to live in this file now live in `ad-validation.ts`
 * (server-only, imported only by the admin write routes) to keep zod out of
 * every page's client bundle.
 */

/**
 * Every placement the site can fill, in the reading order of the page.
 *
 * The admin dropdown renders this list, and an operator picking a placement is
 * thinking about WHERE it goes, not which component renders it — so the labels
 * and descriptions in `AD_ZONE_META` are part of the contract, not decoration.
 * A mis-placed ad is invisible to everyone except the visitor who sees it.
 */
export const AD_ZONES = [
  "global",
  "homepage_top",
  "under_download",
  "result_top",
  "download_result_page",
  "download_complete",
  "idle_interstitial",
  "batch_download_gate",
  "batch_download_complete",
  "reward_video",
  "sidebar",
  "bottom_banner",
  "top_banner",
  "download_history_top",
  "download_history_bottom",
  /* Legacy, kept so existing rows stay visible and editable in the admin rather
     than vanishing from the list they were created in. */
  "mobile_bottom_banner",
  "exit_intent_popup",
  // In-feed native slot — one after every N posts (2026-08-24). Appended last
  // so existing rows keep their position in the admin list.
  "feed_inline",
  // Multi-Link batch downloader (2026-08-25). Appended last, same reason.
  "multilink_between_sources",
  "multilink_fetch_gate",
  // ExoClick vertical-video placements (2026-08-30). Appended last, same reason.
  "downloader_above_fetch",
  "landing_section_break",
  "multilink_above_batch",
  "multilink_card_inline",
  "reels_interstitial",
  // Plays while a link is fetched / the file prepared (2026-08-30).
  "download_preparing",
  // Above the history media grid (2026-08-30).
  "history_above_grid",
  // Full-screen story ad between history media (2026-08-30).
  "history_story_ad",
  // Rewarded gate on a wallpaper download (2026-08-30).
  "wallpaper_reward",
] as const;

export type AdZoneId = (typeof AD_ZONES)[number];

/**
 * Formats an ad row may use.
 *
 * ── `pop` is back, and it is gated ────────────────────────────────────────────
 *
 * Pop-under / OnClick / Social Bar units monetise by hijacking the visitor's
 * first click. They were removed once, on the instruction to drop
 * click-hijacking formats, and restored on the later instruction to bring them
 * back. Both were deliberate; this comment exists so the next person does not
 * "fix" it in either direction by accident.
 *
 * What is NOT restored is the ability to run one without knowing: the
 * `popunder` switch in monetization settings defaults to OFF, so a pop row
 * serves nothing until an operator turns it on, and the admin warns on the row.
 *
 * ⚠️ Running these while an AdSense application is under review is the most
 * common reason a site is rejected. Google's policies prohibit units that
 * interfere with navigation, and a reviewer meeting a pop-under is meeting
 * exactly that. Both can be configured here; running them together is a real
 * risk to the AdSense account, and it is the operator's call.
 */
export const AD_FORMATS = ["display", "native", "adsense", "video", "pop", "exoclick"] as const;

export type AdFormatId = (typeof AD_FORMATS)[number];

/** Formats that were once allowed and must never be served again. */
export const RETIRED_FORMATS = [] as const;

/**
 * The serving gate.
 *
 * Fails closed on any unknown string, not just the retired ones: a typo in a
 * hand-edited row should render nothing rather than fall through to the
 * `display` branch and inject whatever happens to be in `script_code`.
 */
export function isServableFormat(format: string | null | undefined): format is AdFormatId {
  return (AD_FORMATS as readonly string[]).includes(format ?? "");
}

/**
 * What each format is, in the operator's terms.
 *
 * ── The naming problem this fixes ─────────────────────────────────────────────
 *
 * The dropdown showed raw ids, and `pop` was described everywhere as
 * "pop-under / OnClick". That is only two thirds of what it is. Adsterra's
 * **Social Bar** is a VISIBLE floating unit — not a click hijacker — and it uses
 * the same mechanism: a script that must run in the page to attach itself.
 *
 * With no label saying so, the only options that looked right for a Social Bar
 * were `display` (which sandboxes it in an iframe where it cannot attach, so it
 * renders nothing) or a format called "pop-under" (which nobody would pick for
 * a banner-like unit). Hence "why does the social link doesn't show".
 */
export interface AdFormatMeta {
  label: string;
  description: string;
}

export const AD_FORMAT_META: Record<AdFormatId, AdFormatMeta> = {
  display: {
    label: "Banner (iframe)",
    description:
      "A standard banner. Rendered in a sandboxed frame, so it cannot touch the page — use this for Adsterra's banner code (the one containing atOptions).",
  },
  native: {
    label: "House ad",
    description: "Your own image, headline and link. No network involved.",
  },
  adsense: {
    label: "Google AdSense unit",
    description: "A publisher ID and ad unit ID from the AdSense ad-unit screen.",
  },
  video: {
    label: "Video file",
    description: "A direct video URL, for the rewarded and result placements.",
  },
  pop: {
    label: "In-page script (Social Bar, pop-under, OnClick)",
    description:
      "Runs in the page rather than a frame, which is what Social Bar and similar units need to attach themselves. Requires the in-page script switch to be on.",
  },
  exoclick: {
    label: "ExoClick VIDEO zone (VAST)",
    /*
      The label and this text both name VAST explicitly, because ExoClick sells
      two products behind one number and the difference is invisible from the id.
      Picking the wrong one produces silence, not an error — which is exactly
      what happened the first time this shipped.
    */
    description:
      "For an ExoClick VIDEO zone — the kind whose tag looks like s.magsrv.com/v1/vast.php?idzone=1234567. Paste only the number. Plays as a 9:16 vertical video with sound off until tapped. For an ExoClick BANNER zone instead, use Banner (iframe) and paste its whole <ins> snippet. Requires the ExoClick switch in Ad settings, which is OFF by default.",
  },
};

/* ------------------------------ ExoClick tag ------------------------------- */

/**
 * The class name on ExoClick's `<ins>` tag.
 *
 * ── Why this is a named constant and not inlined ──────────────────────────────
 *
 * ExoClick's serving script finds its placeholders by CLASS, so this one string
 * is the difference between every ExoClick zone on the site rendering and none
 * of them rendering — with no error anywhere, because an `<ins>` the script does
 * not recognise is simply left alone. That is the single most likely thing to be
 * wrong here, so it gets a name, a comment and one place to change it.
 *
 * The hex matches the site-verification meta tag ExoClick issued for this
 * account (`6a97888e-site-verification`), which is what identifies the tag as
 * ExoClick's rather than being per-publisher. If ExoClick's dashboard ever hands
 * out an embed with a different class, change it HERE and every zone follows.
 */
export const EXOCLICK_INS_CLASS = "eas6a97888e";

/** ExoClick's ad-provider loader. Serves every un-served `<ins>` on the page. */
export const EXOCLICK_PROVIDER_SRC = "https://a.magsrv.com/ad-provider.js";

/**
 * The zones ExoClick was wired for, each independently switchable.
 *
 * ── Why per-zone and not one switch (owner, 2026-08-30) ───────────────────────
 *
 * "I can turn off landing page where adsense are, and leave for only reels page
 * when adsense accepts."
 *
 * That is the whole shape of the problem. AdSense judges the PAGE its reviewer
 * lands on, and the AdSense-facing pages (the landing, the downloader pages) are
 * a different surface from the signed-in social product where Reels lives. A
 * single network switch forces an all-or-nothing choice between running ExoClick
 * everywhere and running it nowhere — so the two networks could never occupy the
 * site at the same time, on different pages, which is exactly the arrangement
 * that gets both paid.
 *
 * Listed here rather than derived by a name convention: which placements are
 * ExoClick-shaped is a product decision, not something a prefix should imply.
 * This file is the registry, so re-listing zone ids here is the ONE place that is
 * not a second copy — see the guard in `ad-slots.test.ts`.
 */
export const EXOCLICK_ZONES = [
  "downloader_above_fetch",
  /*
    Under the paste box (owner, 2026-08-30: "put an exoclick ad slot under the
    fetch card"). The slot already existed and every downloader surface already
    renders it — it simply was not on this list, so the shared Zone ID could
    never reach it.

    ⚠️ If an Adsterra (or any other) row is active on this zone, THAT row wins:
    the shared id only ever fills a placement that has nothing in it. Switch the
    other row off to hand this slot to ExoClick.
  */
  "under_download",
  "landing_section_break",
  "multilink_above_batch",
  "multilink_card_inline",
  "reels_interstitial",
  "download_preparing",
  /*
    🔴 SECOND TIME THIS LIST HAS CAUSED A SILENT NO-FILL — see `under_download`
    above, same cause (owner, 2026-08-30: "i dont see a slot in admin dashboard
    to set up the download completed full screen video ad").

    The post-download full-screen video ad serves from this zone. Everything
    else about it was wired — the trigger fired, `/api/ads/exoclick` was
    reached, `exoClickZoneEnabled` returned true — but `resolveExoClickZoneId`
    hands the SHARED Zone ID only to a zone in THIS list (`isExoClickZone`). It
    was not one, so with no per-placement row it resolved to null and the route
    answered `{ ad: null }` forever, with no error on any surface. A feature
    that looks installed and can never show an ad once.

    `ad-timing.test.ts` now asserts every zone in `ZONE_BY_TRIGGER` is on this
    list, so a third occurrence fails the build instead of shipping silence.
  */
  "download_complete",
  "history_above_grid",
  "history_story_ad",
  "wallpaper_reward",
] as const;

export type ExoClickZoneId = (typeof EXOCLICK_ZONES)[number];

export function isExoClickZone(zone: string): zone is ExoClickZoneId {
  return (EXOCLICK_ZONES as readonly string[]).includes(zone);
}

/**
 * Which AdSense-facing surface EVERY zone renders on.
 *
 * The admin groups the ExoClick switches by this, because "will a Google
 * reviewer see it" is the only question that matters when deciding which to
 * turn off, and it is not answerable from a zone id.
 *
 * 🔴 Covers ALL zones, not just the five ExoClick was built for (2026-08-30).
 * It was originally the five, which quietly made those five the only zones an
 * ExoClick row could serve on — see the note on `exoClickZoneEnabled`. An
 * operator is free to put an ExoClick unit on any placement, so the
 * classification has to answer for any placement.
 *
 * 🔴 `downloader_above_fetch` is `marketing`, and that is not a typo: the
 * landing page renders the shared `Downloader`, so that zone appears ON the
 * landing page as well as on the ~148 generated downloader pages. Marking it
 * anything else would let someone switch the landing "off" and still be serving
 * ExoClick above the paste box on it.
 *
 * Only the two social-feed placements are `app` — everything else is reachable
 * without signing in, and therefore reachable by a reviewer.
 */
/*
  The rule is small, so it is written small: a placement is behind sign-in, or
  it is public. Only the two social-feed surfaces are behind sign-in.

  Expressed as an exception set rather than a 25-entry table because the default
  has to FAIL SAFE. A zone added later and never classified comes back
  `marketing` — "assume a Google reviewer can reach it" — which is the cautious
  answer, and the operator sees it under the heading warning them so. A table
  would return undefined and silently render no warning at all, on the one
  control built to prevent that.
*/
const SIGNED_IN_ZONES: ReadonlySet<string> = new Set(["feed_inline", "reels_interstitial"]);

export function zoneSurface(zone: string): "marketing" | "app" {
  return SIGNED_IN_ZONES.has(zone) ? "app" : "marketing";
}

/**
 * Is this a usable ExoClick zone id?
 *
 * Numeric only, and bounded. A zone id pasted with the surrounding embed code
 * still attached — the obvious copy/paste mistake, since ExoClick's dashboard
 * shows the full snippet — would otherwise be written into a `data-zoneid`
 * attribute where it renders nothing and reports nothing.
 */
export function isExoClickZoneId(value: string | null | undefined): boolean {
  return /^\d{4,20}$/.test((value ?? "").trim());
}

export interface AdZoneMeta {
  label: string;
  description: string;
  /** Furniture rather than something a visitor dismisses — never gets an X. */
  persistent: boolean;
  /**
   * The visitor WAITS through this placement, so a skip control is meaningful
   * and `skippable` / `skip_after_seconds` apply.
   *
   * A property of the zone, kept here beside `persistent`, because the
   * alternative is each surface naming zone ids to decide — which is how three
   * separate copies of the zone list came to exist in the first place.
   */
  supportsSkip: boolean;
  /**
   * Worth warming as soon as the page loads.
   *
   * True for placements that can appear without any interaction, so their data
   * is already cached before the component mounts — the difference between an
   * ad that is there when the visitor looks and one that arrives after they
   * have downloaded and gone.
   *
   * False for placements that only exist after an action (a fetched result, a
   * completed download): requesting those up front would spend a round trip on
   * something most visitors never reach.
   */
  prefetch: boolean;
  deprecated?: boolean;
}

/** Zones to warm on page load. Derived, so the list cannot drift. */
export function prefetchZoneIds(): AdZoneId[] {
  return AD_ZONES.filter((z) => AD_ZONE_META[z].prefetch);
}

export const AD_ZONE_META: Record<AdZoneId, AdZoneMeta> = {
  global: {
    label: "Page-level script",
    description:
      "Loaded once per page and renders nothing itself. Use for an AdSense Auto ads loader or a network page tag.",
    persistent: true,
    supportsSkip: false,
    prefetch: false,
  },
  homepage_top: {
    label: "Home — above the platform strip",
    description: "Between the hero and the supported-platform row. Collapses when empty.",
    persistent: true,
    supportsSkip: false,
    prefetch: true,
  },
  under_download: {
    label: "Under the Download button",
    description:
      "Directly below the paste box and Download button, on the home page and every downloader page. The highest-attention placement on the site.",
    persistent: true,
    supportsSkip: false,
    prefetch: true,
  },
  result_top: {
    label: "Above a fetched result",
    description: "A strip above a result that dismisses itself after five seconds.",
    persistent: false,
    supportsSkip: false,
    prefetch: false,
  },
  download_result_page: {
    label: "Download result",
    description:
      "Shown alongside the result. Renders as a skippable video when the format is AdSense or video.",
    persistent: false,
    supportsSkip: true,
    prefetch: false,
  },
  download_complete: {
    label: "After a download finishes",
    description: "A skippable panel shown once the file has actually been saved.",
    persistent: false,
    supportsSkip: true,
    prefetch: false,
  },
  batch_download_gate: {
    label: "Batch download — before",
    description:
      "Full-screen ad shown BEFORE a multi-item batch download starts. This is what pays for batch being free, so an empty slot means the batch simply RUNS with no ad — never blocked behind a placement that failed to fill.",
    persistent: false,
    supportsSkip: true,
    // Prefetched: the creative has to be on screen the instant the member taps
    // Download, or the gate reads as the app hanging.
    prefetch: true,
  },
  batch_download_complete: {
    label: "Batch download — after",
    description:
      "Short full-screen ad once a batch download finishes. Fires after the files are already saved, never before — so dismissing it can never cost the member their download.",
    persistent: false,
    supportsSkip: true,
    prefetch: false,
  },
  idle_interstitial: {
    label: "Idle interstitial",
    description:
      "Full screen, shown after the visitor has gone idle. Always closable from the top right.",
    persistent: false,
    supportsSkip: true,
    prefetch: true,
  },
  reward_video: {
    label: "Rewarded video (large downloads)",
    description:
      "Gated by FILE SIZE (2026-08-11): over 100 MB shows one 30s ad that must be watched out; over 500 MB shows that ad and then a second 30s ad the visitor may skip after 15s. Images are always gated. Premium members never see it, and if no ad is configured here the download is released immediately rather than blocked. AdSense is the intended network.",
    persistent: true,
    // The FIRST ad is never skippable — it is the exchange. The second one is,
    // after 15s, because sixty uninterrupted seconds in front of a download
    // someone is already waiting for is how a downloader gets abandoned.
    supportsSkip: true,
    prefetch: false,
  },
  sidebar: {
    label: "Blog sidebar",
    description: "In-article placement on blog posts. Collapses when empty.",
    persistent: true,
    supportsSkip: false,
    prefetch: false,
  },
  bottom_banner: {
    label: "Bottom banner (all pages)",
    description:
      "Pinned to the bottom of the viewport on every marketing page, directly above the app-style bottom nav, on a solid card so it reads as part of the chrome. Not dismissible. (Zone id kept as bottom_banner for back-compat.)",
    persistent: true,
    supportsSkip: false,
    prefetch: true,
  },
  top_banner: {
    label: "Top banner (content pages)",
    description:
      "Pinned to the top of the viewport, directly below the header, on content pages — history, academy, blog, help and the SEO downloader pages. Deliberately NOT shown on the home page, the download pages, or any social page. Not dismissible.",
    persistent: true,
    supportsSkip: false,
    prefetch: true,
  },
  /*
    Both descriptions used to say "the library and Downloads pages" and left out
    /history — which was accurate, and was the bug: the History nav destination
    rendered neither zone, so an operator who filled the two placements named
    after the download history saw nothing on the page that carries it. The page
    now renders them, and the description names every surface it appears on,
    because this text is what the operator reads when deciding where an ad goes.
  */
  download_history_top: {
    label: "Download history — above the list",
    description:
      "Directly above the download history on the History, library and Downloads pages. Collapses when empty.",
    persistent: true,
    supportsSkip: false,
    prefetch: false,
  },
  download_history_bottom: {
    label: "Download history — below the list",
    description:
      "Under the download history on the History, library and Downloads pages, where a user browsing what they've saved dwells. Collapses when empty.",
    persistent: true,
    supportsSkip: false,
    prefetch: false,
  },
  mobile_bottom_banner: {
    label: "Fixed bottom banner — mobile only (legacy)",
    description:
      "Superseded by the all-pages bottom banner, which serves this zone as a fallback. Prefer the new placement.",
    persistent: true,
    supportsSkip: false,
    prefetch: false,
    deprecated: true,
  },
  feed_inline: {
    label: "In-feed (social feed)",
    description:
      "Native slot between posts in the social feed — one after every 4 posts, decided server-side. Loads only once the reader is within ~600px of it. Keep it LIGHT: this renders inside an infinite scroll full of autoplaying video, so a heavy SDK or an audio-autoplay creative degrades the whole feed rather than a single page.",
    // Persistent: no dismiss control. A close button on an item in an infinite
    // feed is a control whose effect vanishes as soon as it scrolls away.
    persistent: true,
    supportsSkip: false,
    // 🔴 Never prefetched. Prefetching is precisely what the slot's own
    // IntersectionObserver exists to avoid — it would pull every upcoming ad
    // in the feed up front and undo the whole lazy-loading design.
    prefetch: false,
  },
  multilink_between_sources: {
    label: "Multi-Link — between source cards",
    description:
      "An in-page unit between each fetch card in the batch downloader. Takes any format — banner, native, AdSense unit or video. Only ever appears BETWEEN two source cards, never after the last one, so it can't sit at the bottom of the panel as filler.",
    // Part of the panel's rhythm, like the under-download unit — not an
    // interruption the visitor should be dismissing one at a time.
    persistent: true,
    supportsSkip: false,
    /*
      🔴 Not prefetched. The whole panel is behind a lazy gate that most
      visitors never open (see multi-link-button.tsx) — warming this zone on
      page load would spend a round trip on every cold landing visit for a
      placement that usually never renders.
    */
    prefetch: false,
  },
  multilink_fetch_gate: {
    label: "Multi-Link — after fetching sources",
    description:
      "A full-screen skippable vignette shown once when a fetch finishes and the results appear. One per fetch action, however many sources it covered — never one ad per source.",
    persistent: false,
    // The visitor waits through it, so `skippable` / `skip_after_seconds` on
    // the ad row are meaningful here.
    supportsSkip: true,
    prefetch: false,
  },
  /*
    The five ExoClick vertical-video placements (2026-08-30).

    All five are `persistent` — none of them gets a dismiss X. Four are page
    furniture in the SofaScore sense (they sit in the layout's own rhythm), and
    the fifth is a full-screen reel slide whose dismissal is the swipe the
    viewer was already going to make. Adding an X to that one would put a second
    close control on a screen that already has the deck's own.

    None of them `supportsSkip`: a skip control is for a placement the visitor is
    WAITING through, and none of these block anything.
  */
  downloader_above_fetch: {
    /*
      🔴 Renamed 2026-08-30. It was "Downloader — above the paste box", and the
      owner — who had asked for an ad "above the fetch card" — picked
      `result_top` instead, because "Above a fetched result" was the only label
      in the list containing the word they had used. Two placements either side
      of the same flow, and the label did not speak the operator's language.
    */
    label: "Downloader — above the fetch box (paste + Download)",
    description:
      "A 9:16 vertical unit directly ABOVE the fetch/paste box and its Download button, on the home page and every downloader page. This is the one to pick for an ad above the fetch card. Distinct from Above a fetched result, which appears AFTER a fetch, and from Under the Download button. Collapses when empty.",
    persistent: true,
    supportsSkip: false,
    // Above the fold on the site's highest-traffic pages, so the zone data is
    // warmed with the rest of the page rather than starting a round trip when
    // the component mounts. This warms the ZONE lookup only — the creative
    // still loads lazily, from the unit itself.
    prefetch: true,
  },
  landing_section_break: {
    label: "Landing — between sections",
    description:
      "A 9:16 vertical unit in the gap between each landing-page section (features, how it works, ecosystem, platforms, tools, CTA, links, FAQ). Every one of them loads lazily, only as the reader scrolls near it, so an unscrolled page costs nothing.",
    persistent: true,
    supportsSkip: false,
    /*
      🔴 Never prefetched. This zone renders at up to eight positions on the
      landing page, which is the one route in the project with a hard cold-entry
      budget. Warming it would pull ad data for seven placements the visitor has
      not scrolled to on every single cold visit.
    */
    prefetch: false,
  },
  multilink_above_batch: {
    label: "Multi-Link — above the Download button",
    description:
      "A 9:16 vertical unit directly above the batch summary and its Download button, inside the Multi-Link panel. Sits above the summary card so it never separates the button from the count it refers to.",
    persistent: true,
    supportsSkip: false,
    // Behind the same lazy gate as the rest of the panel — most visitors never
    // open it, so warming this would spend a round trip on every cold visit.
    prefetch: false,
  },
  multilink_card_inline: {
    label: "Multi-Link — inside each source card",
    description:
      "A 9:16 vertical unit inside each Multi-Link source card, between the link row and the posts that link produced. Renders only once a card actually has results, so an empty card is never padded with an ad.",
    persistent: true,
    supportsSkip: false,
    prefetch: false,
  },
  reels_interstitial: {
    label: "Reels — full-screen slide after every 3 reels",
    description:
      "A full-screen 9:16 slide in the Reels swipe deck, inserted after every third reel and never as the last slide. It is its own card, so it is swiped past exactly like a reel and never covers one. Renders only if this zone is actually filled — an unseeded zone inserts no slide at all, rather than a blank black screen.",
    // Swiping past IS the dismissal. A close X here would be a second close
    // control on a screen that already carries the deck's own.
    persistent: true,
    supportsSkip: false,
    /*
      🔴 Never prefetched from the marketing shell — this is a social-surface
      placement and the deck probes the zone itself before composing any slide.
      See features/feed/reel-viewer.tsx.
    */
    prefetch: false,
  },
  download_preparing: {
    label: "While the file is preparing",
    description:
      "Plays full-width under the paste box from the moment a link is submitted until the result appears — the wait becomes something to watch instead of a spinner. Never a gate: the fetch does not wait on it, and it disappears the instant the file is ready.",
    // Not an interruption the visitor should be dismissing — it IS the waiting
    // state, and it removes itself.
    persistent: true,
    supportsSkip: false,
    /*
      🔴 Prefetched, unlike every other ExoClick zone. This one has to be ON
      SCREEN the instant Download is tapped — resolving the zone at that moment
      would spend a round trip during the very wait it exists to fill, and the
      creative would arrive about when the result does.
    */
    prefetch: true,
  },
  history_above_grid: {
    label: "History — above the media grid",
    description:
      "A 9:16 vertical unit on the History page, directly under the column-count control and above the saved media. Sits in the gap the grid already leaves, so it costs the page no layout of its own. Collapses when empty.",
    persistent: true,
    supportsSkip: false,
    // Above the fold on a page people open deliberately, so the zone lookup
    // is warmed with the rest of the page rather than on mount.
    prefetch: true,
  },
  history_story_ad: {
    label: "History — story ad between media",
    description:
      "A full-screen vertical video between saved media on the History page, after every 3 items — the WhatsApp-status shape. Sits INSIDE the safe area rather than under the notch. Side tap advances to the next media, centre tap opens the advertiser. Shows nothing when unseeded, and the queue simply advances as it always did.",
    // Swiping/tapping past IS the dismissal, exactly as in the reels deck.
    persistent: true,
    supportsSkip: false,
    /*
      🔴 Prefetched. It has to be ready the instant the third clip ends —
      resolving it at that moment would mean a black screen for a round trip
      in the middle of someone paging through their own downloads.
    */
    prefetch: true,
  },
  wallpaper_reward: {
    label: "Wallpaper download reward",
    description:
      "A short full-screen video when a wallpaper download is tapped, in the same style as the reels ad. Which NETWORK fills it is set per moment in Reward networks, so it can be switched to Offerium once that is approved. Never blocks the download: an unseeded zone or a creative that does not arrive releases the file immediately.",
    persistent: false,
    // The visitor waits through it, so skippable / skip_after_seconds apply.
    supportsSkip: true,
    // Must be on screen the instant Download is tapped.
    prefetch: true,
  },
  exit_intent_popup: {
    label: "Exit intent",
    description:
      "Shown when the visitor looks like they are leaving — pointer to the address bar on desktop, tab hidden on mobile. Never traps the back button.",
    persistent: false,
    supportsSkip: false,
    prefetch: false,
  },
};

/** Zones whose unit is furniture — never given a dismiss control. */
export function isPersistentZone(zone: string): boolean {
  return AD_ZONE_META[zone as AdZoneId]?.persistent ?? false;
}

/* ------------------------- click-hijack script detection ------------------- */

/**
 * Hosts and markers that identify an OnClick / pop-under / Social Bar script.
 *
 * These are the invocation URLs the networks hand out for their INTERSTITIAL
 * products, as opposed to their banner products. The distinction is invisible
 * from the snippet itself — both are `<script src="…">` — which is exactly why
 * this exists.
 */
const HIJACK_MARKERS = [
  "effectivecpmnetwork.com",
  "effectivegatecpm.com",
  "highperformanceformat.com/js",
  "profitabledisplaynetwork.com",
  "popcash",
  "popads",
  "propellerads.com/ntfc",
  "onclickalgo",
  "adcash",
];

/**
 * Whether an embed looks like a click-hijacking unit rather than a banner.
 *
 * ── The mistake this catches ──────────────────────────────────────────────────
 *
 * A pop-under or OnClick script pasted into a `display` placement produces a
 * slot that renders NOTHING — those products have no visual creative; they
 * monetise by taking over the visitor's next click. The result is a blank space
 * that navigates somewhere unexpected when tapped, which is precisely what was
 * reported on this site.
 *
 * Nothing about the snippet says so. Both products are a one-line
 * `<script src>`, so an operator pasting the wrong one from their dashboard has
 * no feedback at all until a visitor complains.
 *
 * A heuristic, and deliberately advisory rather than blocking: these host lists
 * change, and refusing to save on a false positive would be worse than a
 * warning. The iframe sandbox in `AdSlot` is what actually prevents the hijack.
 */
export function looksLikeHijackScript(scriptCode: string | null | undefined): boolean {
  if (!scriptCode) return false;
  const s = scriptCode.toLowerCase();
  /*
    A VISIBLE banner renders into its own element and is perfectly safe in the
    display iframe, even when it shares a host with the pop / Social Bar scripts.
    Adsterra's NATIVE BANNER ships a `<div id="container-…">` fed by `invoke.js`;
    the classic banner declares an `atOptions` block. Neither is a click-hijacker,
    so they must NOT be flagged — doing so was blocking a real native banner from
    being saved as a banner (owner report). Only the bare self-injecting
    `<script src>` (Social Bar / OnClick / pop-under — no container, no atOptions)
    should trip the warning.
  */
  if (s.includes("atoptions") || /id\s*=\s*["']?container-/.test(s)) return false;
  return HIJACK_MARKERS.some((marker) => s.includes(marker));
}

/**
 * Read a banner's real size out of its own embed code.
 *
 * ── Why this is worth doing rather than asking the operator ───────────────────
 *
 * Adsterra's banner tag declares its dimensions in an `atOptions` block:
 *
 *     atOptions = { 'key': '…', 'format': 'iframe', 'height': 250, 'width': 300 }
 *
 * The width and height columns on the row are separate fields an operator has
 * to fill in by hand, and in practice they do not — every seeded banner on this
 * site left them null while the script itself said 300×250 or 468×60. The frame
 * then had no size to use and fell back to a generic one, so a 250-tall unit
 * was rendered 100 tall and cropped.
 *
 * The information was in the row the whole time. This reads it.
 *
 * Explicit columns still win: an operator who typed a size meant it, and some
 * networks serve a responsive unit whose declared size is a minimum rather than
 * a fixed frame.
 */
export function sizeFromScript(
  scriptCode: string | null | undefined,
): { width: number; height: number } | null {
  if (!scriptCode) return null;
  const width = Number(scriptCode.match(/['"]width['"]\s*:\s*['"]?(\d{2,4})/i)?.[1]);
  const height = Number(scriptCode.match(/['"]height['"]\s*:\s*['"]?(\d{2,4})/i)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Whether an embed looks like a genuine BANNER invocation.
 *
 * Adsterra banners carry an `atOptions` block with a size; PropellerAds banners
 * use their iframe/banner tag. Used only to make the admin warning specific —
 * "this looks like an OnClick script" is far more actionable than "this may not
 * render".
 */
export function looksLikeBannerScript(scriptCode: string | null | undefined): boolean {
  if (!scriptCode) return false;
  const s = scriptCode.toLowerCase();
  return s.includes("atoptions") || s.includes("data-cfasync") || /\bwidth\b.*\bheight\b/.test(s);
}

