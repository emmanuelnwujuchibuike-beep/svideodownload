"use client";

import { AlertTriangle, Check, Loader2, ToggleRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { AdRecord } from "@/lib/monetization/ads";
import {
  AD_ZONE_META,
  AD_ZONES,
  zoneSurface,
  isExoClickZone,
  type AdZoneId,
} from "@/lib/monetization/ad-schema";
import {
  MONETAG_PLACEMENTS,
  MONETAG_SURFACE_GROUPS,
  MONETAG_SURFACES,
  parseMonetagSnippet,
  type MonetagUnit,
} from "@/lib/monetization/monetag";
import { parseExoClickSticky } from "@/lib/monetization/exoclick-sticky";
import type { MonetizationSettings } from "@/lib/monetization/settings";
import {
  DEFAULT_VAST_INTERSTITIAL,
  SKIP_SECOND_OPTIONS,
  type VastInterstitialConfig,
} from "@/lib/monetization/vast-interstitial";
import { cn } from "@/lib/utils";

import { MonetagUnitsEditor } from "./monetag-units-editor";

/*
  Only the boolean switches. `MonetizationSettings` also carries the AdSense
  publisher id and the ads.txt body, which are text fields rendered separately —
  typing this as `keyof` would let one of them be dropped into the toggle grid,
  where `!s[key]` would turn a publisher id into `false`.
*/
const MULTI_FORMAT_PLACEHOLDER = String.raw`<ins class="eas6a97888e38" data-zoneid="6017110"></ins>`;

type ToggleKey = {
  [K in keyof MonetizationSettings]: MonetizationSettings[K] extends boolean ? K : never;
}[keyof MonetizationSettings];

const ROWS: { key: ToggleKey; label: string; hint: string }[] = [
  { key: "adsense", label: "Google AdSense", hint: "AdSense banner and video units" },
  { key: "monetag", label: "Monetag", hint: "Multitag + per-type tags (In-Page Push, Push, Vignette, OnClick) — configure below" },
  {
    key: "offerium",
    label: "Offerium",
    hint: "Rewarded ads / offerwall. Needs the SDK URL and IDs below AND the two server env secrets before it can serve — see the panel below.",
  },
  { key: "adsterra", label: "Adsterra", hint: "Adsterra network banners (retired — off by default)" },
  { key: "propellerads", label: "PropellerAds", hint: "PropellerAds network units (retired — off by default)" },
  { key: "affiliates", label: "Affiliate offers", hint: "Affiliate CTA on the download-result page" },
  { key: "recommendedTools", label: "Recommended tools", hint: "Curated tool sections (home/footer/sidebar)" },
  {
    key: "popunder",
    /*
      Named for the MECHANISM, not one of its products. Adsterra's Social Bar is
      a visible floating unit that needs exactly this switch, and a toggle
      called "Pop-under" is one nobody would turn on to make a Social Bar work.
    */
    label: "In-page scripts",
    hint: "Enables self-injecting scripts — Social Bar, Native, OnClick. It does NOT create a pop-under by itself; that depends on which network zone you paste. Off by default.",
  },
  {
    key: "exoclick",
    label: "ExoClick",
    hint: "Master switch for the five vertical-video zones. Turn it on to reveal a per-page switch for each, so AdSense pages can stay clean while Reels keeps earning. Seed each zone's ID in Ad placements first. Off by default.",
  },
  {
    key: "interstitial",
    label: "Full-screen units",
    hint: "Idle interstitial, the after-download panel, and any video unit. Off by default.",
  },
  {
    key: "interstitialWallpaper",
    label: "Wallpaper interstitial",
    hint: "A skippable full-screen ad after every 2nd wallpaper download, on /wallpapers and the download page. Off by default.",
  },
  {
    key: "interstitialBatchDownload",
    label: "Batch download ads",
    hint: "Makes multi-item batch downloads FREE, paid for by a full-screen ad before the batch and a short one after it finishes. With this off, batch downloads simply run with no ad. Pro and Business skip both.",
  },
  {
    key: "interstitialHistoryVideo",
    label: "History video interstitial",
    hint: "A skippable full-screen ad when the 2nd video watched from download history finishes. Never interrupts a clip mid-watch. Off by default.",
  },
  {
    key: "rewardDownloadHdEnabled",
    label: "HD reward downloads",
    hint: "Server-verified reward session for HD/top-quality video downloads — see the daily limits below. On by default.",
  },
  {
    key: "rewardDownloadBatchEnabled",
    label: "Batch reward downloads",
    hint: "Server-verified reward session for batch downloads, replacing the old skip-countdown gate. On by default.",
  },
  {
    key: "rewardDownloadPreviewEnabled",
    label: "Video preview reward (GPT)",
    hint: "The 'Review video' action after a download requires its own GPT rewarded ad — a second, independent reward from the download unlock. On by default.",
  },
];

/** Daily reward-claim limit presets — 0 is unlimited. */
const DAILY_LIMIT_OPTIONS = [0, 3, 5, 10, 20, 50] as const;

export function MonetizationSettings({
  settings,
  /**
   * The ad rows, read ONLY to decide which zones get a per-page ExoClick
   * switch. Defaulted so any caller that has not been updated still renders the
   * five built-in zones rather than crashing.
   */
  ads = [],
}: {
  settings: MonetizationSettings;
  ads?: Pick<AdRecord, "zone" | "format">[];
}) {
  const router = useRouter();
  const [state, setState] = useState<MonetizationSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setText = (
    key:
      | "adsensePublisherId"
      | "adsTxt"
      | "verificationTags"
      | "monetagSnippet"
      | "googleTagId"
      | "offeriumSdkUrl"
      | "offeriumPublisherId"
      | "offeriumPlacementId"
      | "exoclickStickySnippet"
      | "exoclickBottomNavSnippet"
      | "exoclickHistorySnippet"
      | "exoclickMultiFormatSnippet"
      | "exoclickHistoryFeedSnippet"
      | "exoclickHistoryFeedLastWeekSnippet"
      | "exoclickLandingSnippet"
      | "exoclickInterstitialSnippet"
      | "exoclickInterstitialFallbackSnippet",
    value: string,
  ) => setState((s) => ({ ...s, [key]: value }));

  const persist = async (next: MonetizationSettings) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/monetization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const json = await res.json();
      setMsg(
        res.ok
          ? { ok: true, text: "Saved." }
          : { ok: false, text: json.error ?? "Failed to save." },
      );
      if (res.ok) router.refresh();
      return res.ok;
    } catch {
      setMsg({ ok: false, text: "Network error." });
      return false;
    } finally {
      setBusy(false);
    }
  };

  /*
    Toggles SAVE THEMSELVES.

    The old design updated local state and required a separate "Save controls"
    button — and on mobile that button was below a long section and easy to
    miss, so an operator would turn Adsterra off, see the switch flip, leave, and
    find it still running because nothing was persisted. A switch that looks off
    but is on is worse than no switch. Flipping one now writes immediately, with
    an optimistic UI and a rollback if the write fails.
  */
  const toggle = async (key: ToggleKey) => {
    const next = { ...state, [key]: !state[key] };
    setState(next);
    const ok = await persist(next);
    if (!ok) setState((s) => ({ ...s, [key]: !s[key] })); // roll back on failure
  };

  /**
   * One ExoClick zone's own switch, layered under the master.
   *
   * Absence means ON (see `normalizeExoClickZones`), so the first tap has to
   * write an explicit `false` rather than deleting a key — deleting it would
   * read back as enabled and the switch would spring straight back.
   */
  /**
   * Which zones get a per-page switch.
   *
   * 🔴 The five ExoClick shipped with, PLUS every zone that actually has an
   * ExoClick row (2026-08-30). It was the fixed five, and that left a hole the
   * owner fell into within a day: an ExoClick row placed on `result_top` had no
   * switch here, and — worse — the server refused to serve it at all. Serving
   * any zone is the fix on that side; this is the other half, so a zone that can
   * serve can also be turned off.
   *
   * Sorted by the registry's own order rather than by discovery, so the list
   * does not reshuffle as rows are added.
   */
  const switchableZones = useMemo(() => {
    const placed = new Set<string>(
      ads.filter((a) => a.format === "exoclick").map((a) => a.zone),
    );
    return AD_ZONES.filter((z) => isExoClickZone(z) || placed.has(z));
  }, [ads]);

  const toggleExoClickZone = async (zone: AdZoneId) => {
    const currentlyOn = state.exoclickZones?.[zone] !== false;
    const next: MonetizationSettings = {
      ...state,
      exoclickZones: { ...state.exoclickZones, [zone]: !currentlyOn },
    };
    setState(next);
    const ok = await persist(next);
    if (!ok) setState((s) => ({ ...s, exoclickZones: state.exoclickZones })); // roll back
  };

  /*
    The interstitial block, and one writer for it.

    Falls back to DEFAULTS rather than assuming the key exists: a settings row
    written before this feature shipped carries no `vastInterstitial` at all,
    and reading a field off undefined would take the whole admin panel down.
  */
  /* Parsed for the operator's benefit only — the server parses it again on
     the way out, so this can never be the thing that decides what renders. */
  const stickyTag = parseExoClickSticky(state.exoclickStickySnippet ?? "");
  const bottomNavTag = parseExoClickSticky(state.exoclickBottomNavSnippet ?? "");
  const interstitialTag = parseExoClickSticky(state.exoclickInterstitialSnippet ?? "");
  const vast: VastInterstitialConfig = state.vastInterstitial ?? DEFAULT_VAST_INTERSTITIAL;
  const setVast = async (patch: Partial<VastInterstitialConfig>) => {
    const next = { ...state, vastInterstitial: { ...vast, ...patch } };
    setState(next);
    const ok = await persist(next);
    if (!ok) setState((prev) => ({ ...prev, vastInterstitial: vast })); // roll back
  };

  // The text fields (publisher id, ads.txt, verification tags) still save on a
  // button — persisting on every keystroke would be absurd.
  const saveText = () => persist(state);

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card px-3 py-6 sm:px-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <ToggleRight className="h-5 w-5 text-primary" /> Monetization controls
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Each switch saves on tap and takes effect within a few seconds. No
        separate save.
      </p>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {ROWS.map((r) => (
          <button
            key={r.key}
            type="button"
            disabled={busy}
            onClick={() => toggle(r.key)}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/20 p-3.5 text-left transition hover:border-foreground/20 disabled:opacity-70"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{r.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{r.hint}</span>
            </span>
            <Switch on={state[r.key]} />
          </button>
        ))}
      </div>

      {/*
        Per-page ExoClick switches (owner, 2026-08-30).

        Shown only while the master switch is on — five sub-switches under a
        network that is off would be five controls with no effect, which is the
        dead-affordance pattern this admin keeps having to remove.

        Grouped by whether a Google reviewer would see the page, because that is
        the only question being answered here. The order matters: the AdSense
        surfaces are listed first, since those are the ones being turned OFF.
      */}
      {state.exoclick ? (
        <div className="mt-2.5 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
          {/*
            One id for everything, or a row per placement.

            Owner: "put a way i can select to use one ad zone id link for all ad
            slots or not." Presented as the FIRST thing under the master switch
            because it decides whether the Ad-placements tab is involved at all —
            with a shared id set, there are no rows to create.
          */}
          <div className="mb-4 rounded-xl border border-border/70 bg-background/60 p-3">
            <label className="mb-1 block text-sm font-semibold" htmlFor="exo-shared">
              One Zone ID for all ExoClick slots
            </label>
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
              Paste one numeric Zone ID and every ExoClick placement below uses it — no ad rows to
              create. Leave it <strong>empty</strong> to configure each placement separately in{" "}
              <em>Ad placements</em> instead. A placement that has its own row always wins, so you
              can still point one slot somewhere else.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="exo-shared"
                inputMode="numeric"
                value={state.exoclickSharedZoneId}
                disabled={busy}
                onChange={(e) =>
                  setState((s) => ({ ...s, exoclickSharedZoneId: e.target.value.trim() }))
                }
                placeholder="6015286"
                className="h-10 w-40 rounded-xl bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void persist(state)}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                Save
              </button>
              {state.exoclickSharedZoneId ? (
                <span className="text-[11px] font-medium text-green-600 dark:text-green-400">
                  Shared mode on — all placements use this ID.
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  Off — using per-placement rows.
                </span>
              )}
            </div>
          </div>

          <p className="text-sm font-semibold">ExoClick — which pages</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Turn off the pages AdSense reviews and keep the rest earning. A zone that is off stays
            configured and serves nothing.
          </p>

          {(["marketing", "app"] as const).map((surface) => {
            const zones = switchableZones.filter((z) => zoneSurface(z) === surface);
            if (zones.length === 0) return null;
            return (
              <div key={surface} className="mt-3">
                <p
                  className={cn(
                    "mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em]",
                    surface === "marketing"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground",
                  )}
                >
                  {surface === "marketing"
                    ? "Public pages · AdSense reviews these"
                    : "Signed-in app · no AdSense here"}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {zones.map((zone) => (
                    <button
                      key={zone}
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleExoClickZone(zone)}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/60 p-3 text-left transition hover:border-foreground/20 disabled:opacity-70"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold">
                          {AD_ZONE_META[zone].label}
                        </span>
                      </span>
                      {/* Absent means on — the opt-out default. */}
                      <Switch on={state.exoclickZones?.[zone] !== false} />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/*
        EXOCLICK STICKY BANNER (owner, 2026-08-30: "set a slot in admin
        dashboard where i can configure exoclick sticky banner, separate it
        from other banners").

        Its own field rather than an ad row, because it is a different product:
        ExoClick's DISPLAY zone, which PLACES ITSELF against the viewport. It
        has no slot in any page's layout, so it does not belong in the zone
        registry alongside placements that do.
      */}
      <div className="mt-2.5 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
        <p className="text-sm font-semibold">ExoClick sticky banner</p>
        <p className="mt-0.5 mb-2 text-xs leading-relaxed text-muted-foreground">
          Paste the whole zone snippet from ExoClick (the one with
          {" "}<code className="font-mono">&lt;ins class=&quot;eas…&quot;&gt;</code>). It is parsed into a
          real tag — the markup itself never reaches the page. Leave empty to
          turn the sticky banner off. Gated by the <strong>ExoClick</strong> switch above.
        </p>
        <textarea
          value={state.exoclickStickySnippet ?? ""}
          disabled={busy}
          onChange={(e) => setText("exoclickStickySnippet", e.target.value)}
          placeholder={'<script async src="https://a.magsrv.com/ad-provider.js"></script>\n<ins class="eas6a97888e17" data-zoneid="6015556"></ins>'}
          className="min-h-[80px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void persist(state)}
            className="inline-flex h-9 items-center rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            Save
          </button>
          {/*
            Parsed feedback, because the failure mode here is silent: an <ins>
            whose class ExoClick does not recognise is simply left unfilled,
            with no error anywhere. Showing what was actually read back is the
            difference between a typo caught now and a banner that never
            appears for a week.
          */}
          {stickyTag ? (
            <span className="text-[11px] font-medium text-green-600 dark:text-green-400">
              Read zone {stickyTag.zoneId} · class {stickyTag.cls}
            </span>
          ) : state.exoclickStickySnippet?.trim() ? (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Could not read a zone id and an
              eas… class from that — the banner will not show.
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Off — nothing pasted.</span>
          )}
        </div>
      </div>

      {/*
        🔴 THE BOTTOM-NAV BANNER, SEPARATE FROM THE ZONE (owner, 2026-08-31:
        "configure the bottom nav to use this exoclick banner link and separate
        it with others network banner like adsterra").

        The bottom bar already serves the `bottom_banner` AD ZONE, which is
        where the Adsterra row and every other network row lives. Running an
        ExoClick <ins> through that same zone would make the two networks
        compete for one placement, so an operator could not run both at once.
        Its own key and its own field — the same shape the sticky and history
        ExoClick banners already use.
      */}
      <div className="mt-2.5 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
        <p className="text-sm font-semibold">ExoClick bottom-nav banner</p>
        <p className="mt-0.5 mb-2 text-xs leading-relaxed text-muted-foreground">
          The banner docked directly above the bottom navigation. Paste the whole
          zone snippet from ExoClick (the one with
          {" "}<code className="font-mono">&lt;ins class=&quot;eas…&quot;&gt;</code>). Parsed into a real
          tag — the markup never reaches the page. This runs <strong>alongside</strong> the
          Adsterra / other-network banner in that bar, not instead of it. Leave empty
          to turn it off. Gated by the <strong>ExoClick</strong> switch above.
        </p>
        <textarea
          value={state.exoclickBottomNavSnippet ?? ""}
          disabled={busy}
          onChange={(e) => setText("exoclickBottomNavSnippet", e.target.value)}
          placeholder={'<script async src="https://a.magsrv.com/ad-provider.js"></script>\n<ins class="eas6a97888e2" data-zoneid="6016480"></ins>'}
          className="min-h-[80px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void persist(state)}
            className="inline-flex h-9 items-center rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            Save
          </button>
          {/* Same silent-failure guard as the sticky field: an <ins> whose class
              ExoClick does not recognise is simply never filled, with no error
              anywhere, so what was actually parsed is shown back. */}
          {bottomNavTag ? (
            <span className="text-[11px] font-medium text-green-600 dark:text-green-400">
              Read zone {bottomNavTag.zoneId} · class {bottomNavTag.cls}
            </span>
          ) : state.exoclickBottomNavSnippet?.trim() ? (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Could not read a zone id and an
              eas… class from that — the banner will not show.
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Off — nothing pasted.</span>
          )}
        </div>
      </div>

      {/*
        HISTORY OUTSTREAM VIDEO. Same <ins> mechanism as the sticky banner
        above, different ExoClick product and a different zone — outstream is
        filled and played by their loader, so it does not go through the VAST
        pipeline the five vertical zones use.
      */}
      {/*
        🔴 THE ONE MEASURED TO RENDER ON ITS OWN (owner, 2026-09-01, with the
        tag). Verified on production BEFORE being wired, with
        `scripts/exoclick-try-tag.mjs eas6a97888e38 6017110`:

            html=582  host=250px  processed=true  biggest=DIV 300x250 static
            🟢 RENDERS ON ITS OWN — no scroll needed

        Listed FIRST and above the outstream field because it is the one that
        works without the reader doing anything, and because it takes precedence
        over that field above the history grid.
      */}
      {/*
        The two placements added 2026-09-01: between the history time periods,
        and on the landing page under the wallpaper button. Both take ANY
        ExoClick zone — multi-format, display banner or outstream — because the
        mechanism is one `<ins>` their loader fills and only the zone type
        differs. The guidance says which behaves how; the choice is the
        operator's.
      */}
      <DuplicateZoneWarning
        fields={[
          { label: "Sticky banner", snippet: state.exoclickStickySnippet ?? "" },
          { label: "Bottom banner", snippet: state.exoclickBottomNavSnippet ?? "" },
          { label: "Multi-format (above the History grid)", snippet: state.exoclickMultiFormatSnippet ?? "" },
          { label: "History outstream", snippet: state.exoclickHistorySnippet ?? "" },
          { label: "History in-feed (Yesterday)", snippet: state.exoclickHistoryFeedSnippet ?? "" },
          { label: "History in-feed (Last week)", snippet: state.exoclickHistoryFeedLastWeekSnippet ?? "" },
          { label: "Landing page", snippet: state.exoclickLandingSnippet ?? "" },
          { label: "Full-page interstitial", snippet: state.exoclickInterstitialSnippet ?? "" },
          { label: "Interstitial fallback (multi-format)", snippet: state.exoclickInterstitialFallbackSnippet ?? "" },
        ]}
      />

      {/*
        🔴 TWO FIELDS FOR THE TWO IN-FEED POSITIONS, AND THEY NEED TWO DIFFERENT
        ZONE IDS (owner, 2026-09-01: "exoclick requires each link, each page").

        One field used to feed both. ExoClick batches every placement on a page
        into one request and will not serve a zone twice in it, so the second
        slot could never fill whatever was pasted. Pasting the SAME snippet in
        both of these is therefore not a shortcut — it is the original bug, and
        the duplicate-zone warning above will say so.
      */}
      <div className="mt-2.5 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
        <p className="text-sm font-semibold">History in-feed — after Yesterday</p>
        <p className="mt-0.5 mb-2 text-xs leading-relaxed text-muted-foreground">
          Inside the History feed, where <strong>Yesterday</strong> gives way to the
          week. Multi-format, display banner or outstream video all work here — an
          outstream is a good fit, because the reader is scrolling past it by
          definition. Needs its <strong>own zone id</strong>, different from every
          other field on this page. Gated by the <strong>ExoClick</strong> switch.
        </p>
        <SnippetField
          value={state.exoclickHistoryFeedSnippet ?? ""}
          busy={busy}
          placeholder={MULTI_FORMAT_PLACEHOLDER}
          onChange={(next) => setText("exoclickHistoryFeedSnippet", next)}
          onSave={() => void persist(state)}
        />
      </div>

      <div className="mt-2.5 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
        <p className="text-sm font-semibold">History in-feed — after Last week</p>
        <p className="mt-0.5 mb-2 text-xs leading-relaxed text-muted-foreground">
          The second in-feed position, where <strong>Last week</strong> gives way to
          Earlier. A <strong>separate ExoClick zone</strong> from the one above:
          the same zone in both serves nothing in either. Left empty, this
          position simply shows no ad. Gated by the <strong>ExoClick</strong> switch.
        </p>
        <SnippetField
          value={state.exoclickHistoryFeedLastWeekSnippet ?? ""}
          busy={busy}
          placeholder={MULTI_FORMAT_PLACEHOLDER}
          onChange={(next) => setText("exoclickHistoryFeedLastWeekSnippet", next)}
          onSave={() => void persist(state)}
        />
      </div>

      <div className="mt-2.5 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
        <p className="text-sm font-semibold">Landing page — under the wallpaper button</p>
        <p className="mt-0.5 mb-2 text-xs leading-relaxed text-muted-foreground">
          Sits on the landing page directly below the feature cards and the
          Explore-wallpapers button. Loaded lazily and code-split, so it stays off
          the landing page&apos;s first-load budget and only mounts as the reader
          approaches it. Gated by the <strong>ExoClick</strong> switch.
        </p>
        <SnippetField
          value={state.exoclickLandingSnippet ?? ""}
          busy={busy}
          placeholder={MULTI_FORMAT_PLACEHOLDER}
          onChange={(next) => setText("exoclickLandingSnippet", next)}
          onSave={() => void persist(state)}
        />
      </div>

      <div className="mt-2.5 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
        <p className="text-sm font-semibold">Multi-format — above the History grid</p>
        <p className="mt-0.5 mb-2 text-xs leading-relaxed text-muted-foreground">
          Paste an ExoClick <strong>Multi-format</strong> zone snippet (class ending
          <code className="mx-1 rounded bg-background px-1 py-0.5 font-mono text-[10px]">38</code>).
          It renders as soon as it loads — no scrolling needed — so this is the
          recommended unit for above the History grid. When set it is used
          <strong> instead of</strong> the outstream field below. Gated by the
          {" "}<strong>ExoClick</strong> switch above.
        </p>
        <SnippetField
          value={state.exoclickMultiFormatSnippet ?? ""}
          busy={busy}
          placeholder={MULTI_FORMAT_PLACEHOLDER}
          onChange={(next) => setText("exoclickMultiFormatSnippet", next)}
          onSave={() => void persist(state)}
        />

        {/*
          🔴 ONE SLOT, ONE TAG — and the operator can SEE which (owner,
          2026-09-01: "put a switch in admin dashboard to turn off and on so one
          link can serve in one slot position in the history page").

          There is exactly one placement above the history grid and two tags that
          could fill it. This switch is the choice, resolved server-side in
          /api/ads/config so the page is never handed both — stacking them is
          what produced the wrong-shaped double slot on 2026-08-30.

          It goes through `toggle()` like every other switch here, so it writes
          immediately with an optimistic flip and a rollback if the write fails.
          A switch that looks flipped but has not persisted is how an operator
          ends up debugging the wrong configuration — which is the note on
          `toggle` itself.
        */}
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggle("exoclickHistoryUseMultiFormat")}
          className="mt-2.5 flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/60 p-3 text-left transition hover:border-foreground/20 disabled:opacity-70"
        >
          <span className="min-w-0">
            <span className="block text-xs font-semibold">
              Use the multi-format tag above the History grid
            </span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
              {state.exoclickHistoryUseMultiFormat !== false
                ? "On — the multi-format tag serves. The outstream tag below is ignored."
                : "Off — the outstream tag below serves instead. It only appears once the reader scrolls."}
            </span>
          </span>
          {/* Absent means on — the default, and the unit measured to render. */}
          <Switch on={state.exoclickHistoryUseMultiFormat !== false} />
        </button>
      </div>

      <div className="mt-2.5 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
        <p className="text-sm font-semibold">History — above the grid</p>
        <p className="mt-0.5 mb-2 text-xs leading-relaxed text-muted-foreground">
          Shown full width on the History page, directly under the column-count control.
          Paste <strong>any</strong> ExoClick zone snippet — a display banner or an
          Outstream Video. Gated by the <strong>ExoClick</strong> switch above.
        </p>
        {/*
          🔴 THE ZONE TYPE DECIDES WHETHER THIS EVER APPEARS, AND NOTHING WE DO
          CAN CHANGE THAT (measured on production, 2026-09-01).

          The owner reported this slot blank through many rounds of fixes while
          the bottom-nav banner — the SAME component, the same host, the same
          width — rendered fine. The difference is not our code, it is the zone:

            • a display banner (class ending 2) paints as soon as it arrives;
            • an OUTSTREAM VIDEO (class ending 37) is held shut by ExoClick's
              own CSS — `._effect { max-height: 0 }`, released only by the class
              `exo_wrapper_show` that THEIR script adds, and only when its own
              viewability test passes:

                  m = ceil(video.top);  m > 0 && m + halfHeight < innerHeight

              evaluated ONLY on scroll/resize/focus, never polled. Measured, an
              outstream on /history opened after one 120px scroll and stayed shut
              until then. A reader who lands and does not scroll sees nothing,
              and that is by the network's design.

          So this field takes any snippet, and the guidance says which is which,
          because the reliable fix here is choosing the zone — not another change
          on our side.
        */}
        <p className="mb-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <strong>Outstream zones only open after the reader scrolls.</strong> That is
          ExoClick&apos;s own viewability rule, not something this app can override — the
          player stays collapsed until its slot is properly in view. For a unit that shows
          as soon as it loads, paste a <strong>display banner</strong> zone here instead
          (the same kind as the bottom-nav banner).
        </p>
        <SnippetField
          value={state.exoclickHistorySnippet ?? ""}
          busy={busy}
          placeholder={'<ins class="eas6a97888e37" data-zoneid="6015590"></ins>'}
          onChange={(next) => setText("exoclickHistorySnippet", next)}
          onSave={() => void persist(state)}
        />
      </div>

      <div className="rounded-2xl bg-secondary/40 p-4 ring-1 ring-inset ring-border/60">
        <p className="text-sm font-semibold">Full-page interstitial</p>
        <p className="mt-0.5 mb-2 text-xs leading-relaxed text-muted-foreground">
          Paste the ExoClick <strong>Fullpage Interstitial</strong> zone snippet. Once set,
          it is used for <strong>every</strong> interstitial moment — idle, back-swipe, the
          download start and the download completion — in place of the VAST interstitial
          below, which stays as the fallback when this is empty. ExoClick owns the whole
          takeover, including its own close control, so there is no skip timer to set here.
          The cooldown and the per-moment switches below still apply.
        </p>
        <textarea
          value={state.exoclickInterstitialSnippet ?? ""}
          disabled={busy}
          onChange={(e) => setText("exoclickInterstitialSnippet", e.target.value)}
          placeholder={'<ins class="eas6a97888e33" data-zoneid="6016704"></ins>'}
          className="min-h-[70px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => void persist(state)} className="inline-flex h-9 items-center rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60">Save</button>
          {interstitialTag ? (
            <span className="text-[11px] font-medium text-green-600 dark:text-green-400">
              Read zone {interstitialTag.zoneId} · class {interstitialTag.cls}
              {interstitialTag.src ? ` · loader ${new URL(interstitialTag.src).hostname}` : ""}
            </span>
          ) : state.exoclickInterstitialSnippet?.trim() ? (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> Could not read a zone id and an eas… class — it will not show.</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Off — the multi-format fallback below runs on its own, or the VAST interstitial.</span>
          )}
        </div>
      </div>

      {/*
        🔴 THE FALLBACK IS A SECOND PLACEMENT, SO IT IS A SECOND SLOT HERE
        (owner, 2026-09-01: "put a slot in the admin dashboard for main exoclick
        interclick and fall back multi format used as interstilla").

        It used to borrow the multi-format tag from the History block, which is
        one zone in two placements the moment this overlay opens on /history —
        and because the fallback builds its `<ins>` by hand rather than through
        `ExoClickSticky`, the runtime zone-claim never saw that clash. The
        duplicate warning above is the only thing that can catch it, which is
        why the field is listed there.
      */}
      <div className="mt-2.5 rounded-2xl bg-secondary/40 p-4 ring-1 ring-inset ring-border/60">
        <p className="text-sm font-semibold">Interstitial fallback — multi-format</p>
        <p className="mt-0.5 mb-2 text-xs leading-relaxed text-muted-foreground">
          Shown on <strong>our own</strong> full-screen overlay — the backdrop, the
          countdown and the close button are ours, so a unit that only knows how to
          sit in a page can still take an interstitial moment. It runs when the
          fullpage zone above does not appear within six seconds, and also when that
          field is <strong>empty</strong>, so this can be the only ExoClick
          interstitial you set. Paste a <strong>Multi-format</strong> zone (class ending
          <code className="mx-1 rounded bg-background px-1 py-0.5 font-mono text-[10px]">38</code>)
          — it renders without waiting for a scroll, which an interstitial moment needs.
          Give it a <strong>separate zone</strong> from every other field on this page:
          this overlay can open on the History page, and one zone in two places on one
          page serves nothing in either. Empty means the VAST interstitial takes the
          moment instead.
        </p>
        <SnippetField
          value={state.exoclickInterstitialFallbackSnippet ?? ""}
          busy={busy}
          placeholder={MULTI_FORMAT_PLACEHOLDER}
          onChange={(next) => setText("exoclickInterstitialFallbackSnippet", next)}
          onSave={() => void persist(state)}
        />
      </div>

      {/*
        VAST INTERSTITIAL (owner, 2026-08-30).

        Its own block rather than a row in the toggle grid above, because it is
        the only placement with two independent timers and the pair is the thing
        most likely to be misread — so they are shown together, labelled with
        what each one actually governs.
      */}
      <div className="mt-2.5 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void setVast({ enabled: !vast.enabled })}
          className="flex w-full flex-wrap items-center justify-between gap-3 text-left disabled:opacity-70"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold">
              Full-screen skippable video ad (download complete)
            </span>
            <span className="block text-xs text-muted-foreground">
              Full-screen video when a download FINISHES, on every page. Turn on for the timing
              controls. Fills from the shared Zone ID above. The download never waits on it.
            </span>
          </span>
          <Switch on={vast.enabled} />
        </button>

        {vast.enabled ? (
          <div className="mt-3 space-y-2.5 border-t border-border/60 pt-3">
            <VastRow
              label="Show when a download COMPLETES"
              hint="Landing, /download, /history — every page. The recommended moment: the visitor already has their file."
              control={
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void setVast({ enabledOnDownloadComplete: !vast.enabledOnDownloadComplete })}
                >
                  <Switch on={vast.enabledOnDownloadComplete} />
                </button>
              }
            />
            <VastRow
              label="Show when a download STARTS"
              hint={
                vast.enabledOnDownloadComplete && vast.cooldownMs > 0
                  ? "⚠ With the completion ad also on, this one runs first and the cooldown below usually suppresses the completion ad."
                  : "Plays while the file is still being prepared."
              }
              control={
                <button type="button" disabled={busy} onClick={() => void setVast({ enabledOnDownload: !vast.enabledOnDownload })}>
                  <Switch on={vast.enabledOnDownload} />
                </button>
              }
            />
            <VastRow
              label="Allow skip / close"
              hint="Only ever shown when the VAST response permits it."
              control={
                <button type="button" disabled={busy} onClick={() => void setVast({ skipEnabled: !vast.skipEnabled })}>
                  <Switch on={vast.skipEnabled} />
                </button>
              }
            />
            {vast.skipEnabled ? (
              <VastRow
                label="Skip after"
                hint="A CEILING, not a fixed countdown — a shorter ad unlocks Skip when it ends. Set 10s and the network fills a 5s ad, Skip appears at 5s."
                control={
                  <select
                    value={vast.skipAfterSeconds}
                    disabled={busy}
                    onChange={(e) => void setVast({ skipAfterSeconds: Number(e.target.value) })}
                    className={selectCls}
                  >
                    {SKIP_SECOND_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? "Immediately" : `${n} seconds`}
                      </option>
                    ))}
                  </select>
                }
              />
            ) : null}
            <VastRow
              label="Startup timeout"
              /* 🔴 Named as a DIFFERENT thing from the skip timer on purpose —
                 conflating them is how a slow network turns into a visitor
                 staring at a blank overlay for the length of the skip timer. */
              hint="How long we wait for the ad to START before giving up and letting the download run. NOT the skip timer."
              control={
                <select
                  value={vast.timeoutMs}
                  disabled={busy}
                  onChange={(e) => void setVast({ timeoutMs: Number(e.target.value) })}
                  className={selectCls}
                >
                  {[1000, 2000, 3000, 4000, 5000].map((n) => (
                    <option key={n} value={n}>{`${n / 1000}s`}</option>
                  ))}
                </select>
              }
            />
            <VastRow
              label="Cooldown"
              hint="Minimum gap between two interstitials for the same visitor."
              control={
                <select
                  value={vast.cooldownMs}
                  disabled={busy}
                  onChange={(e) => void setVast({ cooldownMs: Number(e.target.value) })}
                  className={selectCls}
                >
                  {[0, 30_000, 90_000, 300_000, 900_000, 3_600_000].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "Every download" : n < 60_000 ? `${n / 1000}s` : `${n / 60_000} min`}
                    </option>
                  ))}
                </select>
              }
            />
            {!state.exoclick ? (
              <p className="flex items-start gap-2 rounded-xl border border-amber-500\30 bg-amber-500\10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>ExoClick is off, so this will never show.</strong> The interstitial serves
                  from the same zone stack as every other ExoClick placement — turn on{" "}
                  <strong>ExoClick</strong> above, and leave{" "}
                  <em>{AD_ZONE_META.download_preparing.label}</em> enabled in the per-page switches.
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Interstitial skip delay — how long before a full-screen ad can be
          skipped. Only meaningful with full-screen units on; saves on change. */}
      {state.interstitial ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Interstitial skip delay</span>
            <span className="block truncate text-xs text-muted-foreground">How long before a full-screen ad can be skipped.</span>
          </span>
          <select
            value={state.interstitialSkipSeconds}
            disabled={busy}
            onChange={async (e) => {
              const v = Number(e.target.value);
              const prev = state.interstitialSkipSeconds;
              const next = { ...state, interstitialSkipSeconds: v };
              setState(next);
              const ok = await persist(next);
              if (!ok) setState((s) => ({ ...s, interstitialSkipSeconds: prev }));
            }}
            className="h-9 shrink-0 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary"
          >
            <option value={0}>Skip immediately</option>
            <option value={5}>After 5 seconds</option>
            <option value={10}>After 10 seconds</option>
          </select>
        </div>
      ) : null}

      {/*
        Batch ad lengths. Shown only when batch ads are on: two countdown
        selectors nobody is using are just noise on an already dense screen.

        The "before" ad is the PRICE of the feature and the "after" one is a
        courtesy, which is why they are configured separately rather than
        sharing the interstitial skip delay above — 30 seconds on an idle ad
        would be intolerable, and 5 seconds before a batch would not pay for it.
      */}
      {state.interstitialBatchDownload ? (
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Before a batch</span>
              <span className="block truncate text-xs text-muted-foreground">Skippable after…</span>
            </span>
            <select
              value={state.batchGateSeconds}
              disabled={busy}
              onChange={async (e) => {
                const v = Number(e.target.value);
                const prev = state.batchGateSeconds;
                const next = { ...state, batchGateSeconds: v };
                setState(next);
                const ok = await persist(next);
                if (!ok) setState((x) => ({ ...x, batchGateSeconds: prev }));
              }}
              className="h-9 shrink-0 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary"
            >
              <option value={0}>Immediately</option>
              <option value={5}>5 seconds</option>
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={45}>45 seconds</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">After a batch</span>
              <span className="block truncate text-xs text-muted-foreground">Files are already saved.</span>
            </span>
            <select
              value={state.batchCompleteSeconds}
              disabled={busy}
              onChange={async (e) => {
                const v = Number(e.target.value);
                const prev = state.batchCompleteSeconds;
                const next = { ...state, batchCompleteSeconds: v };
                setState(next);
                const ok = await persist(next);
                if (!ok) setState((x) => ({ ...x, batchCompleteSeconds: prev }));
              }}
              className="h-9 shrink-0 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary"
            >
              <option value={0}>Immediately</option>
              <option value={5}>5 seconds</option>
              <option value={10}>10 seconds</option>
            </select>
          </div>
        </div>
      ) : null}

      {/*
        Reward-ad quality tier (owner, 2026-08-16): "All videos must show a 30
        seconds ad to download the top 2 highest quality videos" and "image
        and audio download shouldn't show 30 seconds reward ad… only a 5 sec
        ad that can be skipped after 5sec" — both for the top N (default 2)
        best-quality format options. Always visible, unlike the batch/
        interstitial sections above: this isn't a separate placement someone
        opts into, it's how the EXISTING reward-ad gate (server/extractors'
        quality-ranked formats, gated in lib/monetization/reward-policy.ts)
        behaves for top-tier downloads, so there is no "off" state to hide it
        behind — only 0 on either duration effectively disables that half.
      */}
      <div className="mt-2.5 space-y-2.5 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Top-quality reward ad</span>
            <span className="block truncate text-xs text-muted-foreground">
              Applies to the best N format options of a download, by kind.
            </span>
          </span>
          <select
            value={state.rewardTopTierCount}
            disabled={busy}
            onChange={async (e) => {
              const v = Number(e.target.value);
              const prev = state.rewardTopTierCount;
              const next = { ...state, rewardTopTierCount: v };
              setState(next);
              const ok = await persist(next);
              if (!ok) setState((x) => ({ ...x, rewardTopTierCount: prev }));
            }}
            className="h-9 shrink-0 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary"
          >
            <option value={0}>Off</option>
            <option value={1}>Top 1</option>
            <option value={2}>Top 2</option>
            <option value={3}>Top 3</option>
            <option value={4}>Top 4</option>
          </select>
        </div>

        {state.rewardTopTierCount > 0 ? (
          <div className="grid gap-2.5 sm:grid-cols-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-background/60 p-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Video</span>
                <span className="block truncate text-xs text-muted-foreground">Never skippable.</span>
              </span>
              <select
                value={state.rewardVideoTopTierSeconds}
                disabled={busy}
                onChange={async (e) => {
                  const v = Number(e.target.value);
                  const prev = state.rewardVideoTopTierSeconds;
                  const next = { ...state, rewardVideoTopTierSeconds: v };
                  setState(next);
                  const ok = await persist(next);
                  if (!ok) setState((x) => ({ ...x, rewardVideoTopTierSeconds: prev }));
                }}
                className="h-9 shrink-0 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary"
              >
                <option value={0}>Off</option>
                <option value={15}>15 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={45}>45 seconds</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-background/60 p-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Image / audio</span>
                <span className="block truncate text-xs text-muted-foreground">Ad length.</span>
              </span>
              <select
                value={state.rewardImageAudioTopTierSeconds}
                disabled={busy}
                onChange={async (e) => {
                  const v = Number(e.target.value);
                  const prev = state.rewardImageAudioTopTierSeconds;
                  const next = { ...state, rewardImageAudioTopTierSeconds: v };
                  setState(next);
                  const ok = await persist(next);
                  if (!ok) setState((x) => ({ ...x, rewardImageAudioTopTierSeconds: prev }));
                }}
                className="h-9 shrink-0 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary"
              >
                <option value={0}>Off</option>
                <option value={5}>5 seconds</option>
                <option value={10}>10 seconds</option>
                <option value={15}>15 seconds</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-background/60 p-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Image / audio skip</span>
                <span className="block truncate text-xs text-muted-foreground">Skippable after…</span>
              </span>
              <select
                value={state.rewardImageAudioSkipAfterSeconds}
                disabled={busy}
                onChange={async (e) => {
                  const v = Number(e.target.value);
                  const prev = state.rewardImageAudioSkipAfterSeconds;
                  const next = { ...state, rewardImageAudioSkipAfterSeconds: v };
                  setState(next);
                  const ok = await persist(next);
                  if (!ok) setState((x) => ({ ...x, rewardImageAudioSkipAfterSeconds: prev }));
                }}
                className="h-9 shrink-0 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary"
              >
                <option value={0}>Immediately</option>
                <option value={5}>5 seconds</option>
                <option value={10}>10 seconds</option>
                <option value={15}>15 seconds</option>
              </select>
            </div>
          </div>
        ) : null}
      </div>

      {/*
        Daily reward-claim limits (owner, 2026-08-16 spec, Part 7-8; preview
        limit added the same day for the GPT video-preview reward): how many
        HD/batch downloads or video previews a FREE member can unlock per day
        via the reward-session flow (lib/monetization/reward-sessions.ts). Separate from the
        general per-plan daily download cap above — this one gates specifically
        how many REWARD CLAIMS a day, enforced server-side, Pro/Business always
        unlimited. 0 = unlimited (the starting value — owner: "unlimited while
        testing, cap later").
      */}
      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Free HD downloads/day</span>
            <span className="block truncate text-xs text-muted-foreground">Reward-session claims. Pro/Business unlimited.</span>
          </span>
          <select
            value={state.rewardHdDailyLimit}
            disabled={busy}
            onChange={async (e) => {
              const v = Number(e.target.value);
              const prev = state.rewardHdDailyLimit;
              const next = { ...state, rewardHdDailyLimit: v };
              setState(next);
              const ok = await persist(next);
              if (!ok) setState((x) => ({ ...x, rewardHdDailyLimit: prev }));
            }}
            className="h-9 shrink-0 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary"
          >
            {DAILY_LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Unlimited" : `${n}/day`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Free batch downloads/day</span>
            <span className="block truncate text-xs text-muted-foreground">Reward-session claims. Pro/Business unlimited.</span>
          </span>
          <select
            value={state.rewardBatchDailyLimit}
            disabled={busy}
            onChange={async (e) => {
              const v = Number(e.target.value);
              const prev = state.rewardBatchDailyLimit;
              const next = { ...state, rewardBatchDailyLimit: v };
              setState(next);
              const ok = await persist(next);
              if (!ok) setState((x) => ({ ...x, rewardBatchDailyLimit: prev }));
            }}
            className="h-9 shrink-0 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary"
          >
            {DAILY_LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Unlimited" : `${n}/day`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Free video previews/day</span>
            <span className="block truncate text-xs text-muted-foreground">GPT reward claims. Pro/Business unlimited.</span>
          </span>
          <select
            value={state.rewardPreviewDailyLimit}
            disabled={busy}
            onChange={async (e) => {
              const v = Number(e.target.value);
              const prev = state.rewardPreviewDailyLimit;
              const next = { ...state, rewardPreviewDailyLimit: v };
              setState(next);
              const ok = await persist(next);
              if (!ok) setState((x) => ({ ...x, rewardPreviewDailyLimit: prev }));
            }}
            className="h-9 shrink-0 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary"
          >
            {DAILY_LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Unlimited" : `${n}/day`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/*
        Shown only when both are on, and only then — a standing warning about a
        combination nobody has selected is noise that trains people to ignore it.
      */}
      {/*
        Same rule as the pop-under warning below: shown only for the combination
        that is actually selected, never as standing noise.

        This one is about INVENTORY rather than mechanism. ExoClick's demand
        skews adult, and AdSense judges the page a reviewer lands on — so the
        risk here is not that ExoClick does something prohibited, it is what
        else ends up rendered beside an AdSense unit on the same page.
      */}
      {state.exoclick &&
      state.adsense &&
      switchableZones.some(
        (z) => zoneSurface(z) === "marketing" && state.exoclickZones?.[z] !== false,
      ) ? (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500\30 bg-amber-500\10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>ExoClick is serving on public pages while AdSense is enabled.</strong> Filtering
            adult and sexy categories on the ExoClick zone removes the biggest part of this risk and
            is worth doing — but it does not remove it entirely: category filters are applied by the
            network, not guaranteed by Google, and AdSense judges the page its reviewer actually
            lands on. This site has already been refused three times for content quality.
            <br />
            <strong className="mt-1 inline-block">
              You do not have to choose the whole network.
            </strong>{" "}
            Switch off the four <em>Public pages</em> zones above and leave{" "}
            <em>{AD_ZONE_META.reels_interstitial.label}</em> on — Reels is behind sign-in, so no
            AdSense reviewer reaches it, and the zones you turn off stay configured and serve
            nothing.
          </span>
        </p>
      ) : null}

      {state.popunder && state.adsense ? (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>In-page scripts are on while AdSense is enabled.</strong> This switch also
            allows pop-under and OnClick units, and Google prohibits anything that interferes with
            navigation — a reviewer who meets one is meeting exactly that. It is the most common
            reason a site is rejected, and it can cost an already-approved account.
            <br />
            <strong className="mt-1 inline-block">
              If your site is still &ldquo;Getting ready&rdquo; or under review, turn this off until
              you are approved.
            </strong>{" "}
            Adsterra <em>banner</em> units are unaffected and safe to keep running. Note this is a
            single switch: enabling it for a Social Bar also enables any pop-under row you have.
          </span>
        </p>
      ) : null}

      {/*
        Site-level AdSense. Deliberately separated from the ad-placement form:
        that form configures an ad UNIT (publisher id + slot id, rendered in a
        placement); these two are what AdSense asks for to VERIFY the site, and
        neither has a slot. There was previously nowhere to put them.
      */}
      <div className="mt-6 space-y-4 border-t border-border/60 pt-5">
        <div>
          <h3 className="text-sm font-semibold">Google AdSense — site setup</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            These verify the site and enable Auto ads. Individual banner and video units are
            configured under Ad placements.
          </p>
        </div>

        <div>
          <label htmlFor="adsense-pub" className="mb-1 block text-xs font-medium text-muted-foreground">
            Publisher ID
          </label>
          <input
            id="adsense-pub"
            value={state.adsensePublisherId}
            onChange={(e) => setText("adsensePublisherId", e.target.value)}
            placeholder="ca-pub-6455244673998965"
            className="h-10 w-full rounded-xl bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {/* Naming the exact failure, because it is silent: the wrong prefix
                produces a script URL that 404s and no ads, with no error. */}
            From the <code className="font-mono">client=</code> part of the AdSense snippet. Must
            start with <code className="font-mono">ca-pub-</code> — the bare{" "}
            <code className="font-mono">pub-</code> form used in ads.txt will not load.
          </p>
          {/*
            The empty state is the one worth calling out. AdSense enabled with
            no publisher id means the loader script is never emitted, so no unit
            can ever fill — and nothing anywhere else says so. ads.txt can be
            Authorised while this is blank, which makes it look done.
          */}
          {state.adsense && !state.adsensePublisherId.trim() ? (
            <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>No publisher ID set.</strong> The AdSense script is not on the site, so no
                AdSense unit can fill — even once your site is approved, and even though ads.txt is
                already authorised. Paste it above and save.
              </span>
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="ads-txt" className="mb-1 block text-xs font-medium text-muted-foreground">
            ads.txt
          </label>
          <textarea
            id="ads-txt"
            value={state.adsTxt}
            onChange={(e) => setText("adsTxt", e.target.value)}
            placeholder="google.com, pub-6455244673998965, DIRECT, f08c47fec0942fa0"
            className="min-h-[80px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Paste the line AdSense gives you. Served at{" "}
            <a href="/ads.txt" target="_blank" rel="noopener" className="font-medium text-primary hover:underline">
              /ads.txt
            </a>{" "}
            as soon as you save — add other networks&apos; lines here too, one per line.
          </p>
        </div>
      </div>

      {/*
        Offerium — rewarded ads / offerwall (owner, 2026-08-23: "put a slot in
        admin dashboard where I can set up all Offerium API, SDK, and all").

        Only the PUBLIC values are editable here. The API key and postback
        signing secret are server-side env vars on purpose and are deliberately
        NOT fields — this panel is saved to a database row and an allowlisted
        subset of these settings is served publicly by /api/ads/config, so a
        signing secret in this form would be a reward-forgery primitive. The
        panel states where they go instead, so an operator is not left guessing.
      */}
      <div className="mt-6 space-y-4 border-t border-border/60 pt-5">
        <div>
          <h3 className="text-sm font-semibold">Offerium — rewarded ads</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Paste the values from your Offerium publisher dashboard. All three, plus the two
            server secrets below, must be present before a rewarded ad is offered to anyone.
          </p>
        </div>

        <div>
          <label htmlFor="offerium-sdk" className="mb-1 block text-xs font-medium text-muted-foreground">
            SDK / script URL
          </label>
          <input
            id="offerium-sdk"
            value={state.offeriumSdkUrl}
            onChange={(e) => setText("offeriumSdkUrl", e.target.value)}
            placeholder="https://…"
            className="h-10 w-full rounded-xl bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Must be <code className="font-mono">https</code> — a browser blocks an http script on
            this site, so an http URL would simply never load.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="offerium-pub" className="mb-1 block text-xs font-medium text-muted-foreground">
              Publisher ID
            </label>
            <input
              id="offerium-pub"
              value={state.offeriumPublisherId}
              onChange={(e) => setText("offeriumPublisherId", e.target.value)}
              className="h-10 w-full rounded-xl bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="offerium-placement" className="mb-1 block text-xs font-medium text-muted-foreground">
              Placement / zone ID
            </label>
            <input
              id="offerium-placement"
              value={state.offeriumPlacementId}
              onChange={(e) => setText("offeriumPlacementId", e.target.value)}
              className="h-10 w-full rounded-xl bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div>
          <label htmlFor="offerium-fallback" className="mb-1 block text-xs font-medium text-muted-foreground">
            If Offerium is unavailable
          </label>
          <select
            id="offerium-fallback"
            value={state.offeriumFallback}
            onChange={(e) =>
              setState((s) => ({ ...s, offeriumFallback: e.target.value === "block" ? "block" : "allow" }))
            }
            className="h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
          >
            <option value="allow">Allow the normal download (recommended)</option>
            <option value="block">Keep it locked and show a retry</option>
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Neither option ever grants the reward. &ldquo;Allow&rdquo; falls back to the normal
            non-rewarded rules so a broken ad network can&apos;t lock people out of content they
            could otherwise reach.
          </p>
        </div>

        {/*
          The honest status. An operator who flips the master switch on and sees
          nothing happen needs to know exactly which piece is missing — and that
          the two secrets are not fields on this form by design.
        */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          <p className="flex items-start gap-2">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Not serving yet.</strong> The live Offerium integration (loading their SDK
              and verifying reward postbacks) is not implemented — it needs Offerium&apos;s official
              publisher documentation for the callback parameters and signature scheme, which
              hasn&apos;t been supplied. These fields save correctly and are ready for it; nothing
              is guessed in the meantime.
            </span>
          </p>
          <p className="mt-2 pl-6">
            The two secrets are <strong>server environment variables</strong>, not fields here:{" "}
            <code className="font-mono">OFFERIUM_API_KEY</code> and{" "}
            <code className="font-mono">OFFERIUM_POSTBACK_SECRET</code>. A signing secret stored in
            this form could be used to forge &ldquo;reward completed&rdquo; callbacks.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-2 border-t border-border/60 pt-5">
        <h3 className="text-sm font-semibold">Monetag</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Paste the Multitag <code className="font-mono">&lt;script&gt;</code> snippet from your
          Monetag dashboard, then turn the <strong>Monetag</strong> switch above on. It&apos;s parsed
          into a safe script tag in the page head (never injected as raw HTML) and, being
          server-rendered, also satisfies Monetag&apos;s &ldquo;code&rdquo; verification — so you do
          NOT need Monetag&apos;s &ldquo;upload sw.js&rdquo; method, which can&apos;t be used here
          (that path is the app&apos;s own service worker).
        </p>
        <label className="block text-xs font-medium text-muted-foreground">Multitag (all formats)</label>
        <textarea
          value={state.monetagSnippet}
          onChange={(e) => setText("monetagSnippet", e.target.value)}
          placeholder={'<script src="//example.monetag.com/tag.min.js" data-zone="1234567" async data-cfasync="false"></script>'}
          className="min-h-[80px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <p className="text-xs text-muted-foreground">
          Only the <code className="font-mono">https</code> script URL and{" "}
          <code className="font-mono">data-zone</code> are used; anything else in the snippet is
          ignored. Save with the button below.
        </p>

        {/*
          Per-type Monetag tags. Controlled by the parent state so there is one
          settings object and one save path — see MonetagUnitsEditor.
        */}
        <div className="mt-4 border-t border-border/50 pt-4">
          <MonetagUnitsEditor
            units={state.monetagUnits}
            disabled={busy}
            onChange={(next: MonetagUnit[]) => setState((s) => ({ ...s, monetagUnits: next }))}
          />
        </div>

        {/* WHERE Monetag shows. Pro/Business are ad-free regardless; this narrows
            it further by page. Controlled by the parent state (one save path). */}
        <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => setState((s) => ({ ...s, monetagAllPages: !s.monetagAllPages }))}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/20 p-3.5 text-left transition hover:border-foreground/20 disabled:opacity-70"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Show on all pages</span>
              <span className="block truncate text-xs text-muted-foreground">
                {state.monetagAllPages ? "Monetag runs on every page." : "Monetag runs only on the pages ticked below."}
              </span>
            </span>
            <Switch on={state.monetagAllPages} />
          </button>

          {!state.monetagAllPages ? (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">
                Pages Monetag may show on — tick each page (e.g. only the Download page).
              </p>
              {MONETAG_SURFACE_GROUPS.map((group) => (
                <div key={group} className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">{group}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {MONETAG_SURFACES.filter((s) => s.group === group).map((surface) => {
                      const on = state.monetagSurfaces.includes(surface.id);
                      return (
                        <button
                          key={surface.id}
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setState((s) => ({
                              ...s,
                              monetagSurfaces: on
                                ? s.monetagSurfaces.filter((id) => id !== surface.id)
                                : [...s.monetagSurfaces, surface.id],
                            }))
                          }
                          className={cn(
                            "flex items-start gap-2.5 rounded-2xl border p-3 text-left transition disabled:opacity-70",
                            on ? "border-primary/50 bg-primary/[0.06]" : "border-border/70 bg-secondary/20 hover:border-foreground/20",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                              on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                            )}
                          >
                            {on ? <Check className="h-3 w-3" /> : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{surface.label}</span>
                            <span className="block text-[11px] text-muted-foreground">{surface.hint}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {state.monetagSurfaces.length === 0 ? (
                <p className="text-[11px] text-amber-500">
                  Nothing ticked — Monetag will not show anywhere until you select a page or turn
                  &ldquo;Show on all pages&rdquo; back on.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Monetag moment placements — WHEN a Monetag tag loads. Controlled by the
          parent state (one save path). */}
      <div className="mt-6 space-y-3 border-t border-border/60 pt-5">
        <div>
          <h3 className="text-sm font-semibold">Monetag ad placements</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Choose the moments a Monetag ad loads. Tick a moment and paste the Monetag tag to show
            then. Monetag places its own ad once loaded, so this controls which tag activates and
            roughly when. Pro/Business never see them, and the page scope above still applies.
          </p>
        </div>
        <div className="space-y-2.5">
          {MONETAG_PLACEMENTS.map((pl) => {
            const current = state.monetagPlacements.find((p) => p.moment === pl.id);
            const on = !!current;
            const parsed = current ? parseMonetagSnippet(current.snippet) : null;
            return (
              <div
                key={pl.id}
                className={cn(
                  "rounded-2xl border p-3.5",
                  on ? "border-primary/40 bg-primary/[0.04]" : "border-border/70 bg-secondary/20",
                )}
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      monetagPlacements: on
                        ? s.monetagPlacements.filter((p) => p.moment !== pl.id)
                        : [...s.monetagPlacements, { moment: pl.id, snippet: "" }],
                    }))
                  }
                  className="flex w-full items-center justify-between gap-3 text-left disabled:opacity-70"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{pl.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{pl.hint}</span>
                  </span>
                  <Switch on={on} />
                </button>
                {on ? (
                  <div className="mt-3 space-y-1.5">
                    <textarea
                      value={current!.snippet}
                      disabled={busy}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          monetagPlacements: s.monetagPlacements.map((p) =>
                            p.moment === pl.id ? { ...p, snippet: e.target.value } : p,
                          ),
                        }))
                      }
                      placeholder={'<script src="//example.monetag.com/tag.min.js" data-zone="1234567"></script>'}
                      className="min-h-[56px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                    />
                    {current!.snippet.trim() ? (
                      parsed ? (
                        <p className="flex items-center gap-1.5 text-[11px] text-green-500">
                          <Check className="h-3.5 w-3.5" /> Valid tag{parsed.zone ? ` · zone ${parsed.zone}` : ""}.
                        </p>
                      ) : (
                        <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Not a Monetag script
                          tag — nothing will load until fixed.
                        </p>
                      )
                    ) : (
                      <p className="text-[11px] text-muted-foreground/70">Paste the Monetag tag for this moment.</p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 space-y-2 border-t border-border/60 pt-5">
        <h3 className="text-sm font-semibold">Site verification (other networks)</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          One <code className="font-mono">name|content</code> pair per line — only needed for
          networks other than AdSense, whose tag is added automatically from the publisher ID above.
          {/*
            Kept because the constraint is permanent and the reason is not
            obvious: a future network will ask for the same thing, and the next
            person to hit it should find the answer here rather than by
            overwriting the service worker and losing offline mode.
          */}{" "}
          Always choose the <strong>meta tag</strong> method: the &ldquo;upload a file to your root
          folder&rdquo; option cannot be used, because networks that offer it ask for{" "}
          <code className="font-mono">/sw.js</code> — already the app&apos;s service worker (offline
          mode, push notifications, background downloads).
        </p>
        <textarea
          value={state.verificationTags}
          onChange={(e) => setText("verificationTags", e.target.value)}
          placeholder={"monetag|abc123def456\ngoogle-adsense-account|ca-pub-6455244673998965"}
          className="min-h-[80px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <p className="text-xs text-muted-foreground">
          Rendered as real <code className="font-mono">&lt;meta&gt;</code> tags in the page head on
          every page. The AdSense one is added automatically from the publisher ID above — you only
          need a line here for other networks.
        </p>
      </div>

      {/* ── Google tag ──────────────────────────────────────────────────
          GA4 / Google Ads / Tag Manager, from an ID rather than a pasted
          script. Google's install page gives you a <script> block; taking that
          verbatim would put an admin-editable script on every page, so only
          the ID is stored and the snippet is rendered from a template. */}
      <div className="mt-5 space-y-2 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
        <label htmlFor="google-tag-id" className="block text-sm font-semibold">
          Google tag ID
        </label>
        <input
          id="google-tag-id"
          value={state.googleTagId}
          onChange={(e) => setText("googleTagId", e.target.value)}
          placeholder="G-XXXXXXXXXX"
          spellCheck={false}
          autoCapitalize="characters"
          className="w-full rounded-xl bg-background p-3 font-mono text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Paste the <strong>ID only</strong>, not the whole script Google shows you.{" "}
          <code className="font-mono">G-…</code> for Analytics,{" "}
          <code className="font-mono">AW-…</code> for Google Ads,{" "}
          <code className="font-mono">GTM-…</code> for Tag Manager — the right loader is chosen from
          the prefix. It loads on every page after the content, so it never slows the first paint.
          Leave empty to remove it.
        </p>
      </div>

      {/* This button saves the AdSense TEXT fields above. The switches save
          themselves on tap, so it no longer needs to be reached to turn a
          subsystem off — which on mobile it often could not be. */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={saveText}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save Monetag &amp; AdSense details
        </button>
        {msg ? (
          <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The textarea + Save + "read zone N" status line shared by the ExoClick
 * snippet fields.
 *
 * Four of these blocks were byte-identical apart from the settings key, and the
 * duplication is what pushed /admin over its gzipped ceiling when two more
 * placements were added. Extracting it is the cheap saving the budget note in
 * lib/perf/budget.test.ts asks to be taken before raising the number again.
 *
 * The sticky, bottom-nav and interstitial blocks keep their own markup on
 * purpose — the interstitial also reports which provider DOMAIN its tag names,
 * which matters because a zone is activated against one provider and asking the
 * wrong one serves nothing.
 */
function SnippetField({
  value,
  placeholder,
  busy,
  onChange,
  onSave,
}: {
  value: string;
  placeholder: string;
  busy: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
}) {
  const tag = parseExoClickSticky(value);
  return (
    <>
      <textarea
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-[70px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="inline-flex h-9 items-center rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          Save
        </button>
        {tag ? (
          <span className="text-[11px] font-medium text-green-600 dark:text-green-400">Read zone {tag.zoneId} · class {tag.cls}</span>
        ) : value.trim() ? (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> Could not read a zone id and an eas… class — it will not show.</span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Off — nothing pasted.</span>
        )}
      </div>
    </>
  );
}

/**
 * Warn when two ExoClick fields point at the SAME zone id.
 *
 * 🔴 THE SAME ZONE TWICE ON ONE PAGE SERVES NOTHING (owner, 2026-09-01: "the
 * exoclick banner and multi format is not showing", with only Adsterra
 * rendering).
 *
 * The live config had one zone in three fields — History, Multi-format and
 * History in-feed all set to 6017110 — which on /history is three placeholders
 * for one zone. Their loader batches placements into a single request and will
 * not serve one zone several times in it; the API answers `{"zones":[null,
 * null]}` and every copy comes back empty. Adsterra was unaffected, which is
 * what made it look like an ExoClick outage.
 *
 * The app now stands one duplicate down so at least one ad shows, but that is
 * damage control: two placements genuinely need two zones, and only the operator
 * can create the second one. So it is said here, where it can be acted on.
 */
function DuplicateZoneWarning({ fields }: { fields: { label: string; snippet: string }[] }) {
  const byZone = new Map<string, string[]>();
  for (const f of fields) {
    const tag = parseExoClickSticky(f.snippet ?? "");
    if (!tag) continue;
    byZone.set(tag.zoneId, [...(byZone.get(tag.zoneId) ?? []), f.label]);
  }
  const clashes = [...byZone.entries()].filter(([, names]) => names.length > 1);
  if (clashes.length === 0) return null;

  return (
    <div className="mt-2.5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4 shrink-0" /> The same zone is used in more than one place
      </p>
      <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-amber-700/90 dark:text-amber-300/90">
        {clashes.map(([zone, names]) => (
          <li key={zone}>
            Zone <strong>{zone}</strong> — {names.join(", ")}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-amber-700/90 dark:text-amber-300/90">
        ExoClick asks for every placement on a page in one request and will not serve the same
        zone twice in it, so duplicated slots come back empty — <strong>all of them</strong>, not
        just the extra one. Only the first placement on the page is used; the others are switched
        off so at least one ad shows. Create a separate zone in ExoClick for each placement to run
        them all.
      </p>
    </div>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        on ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </span>
  );
}

/** Shared class for the interstitial's small selects. */
const selectCls =
  "h-9 shrink-0 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary";

/**
 * One labelled control in the interstitial block.
 *
 * A local component rather than repeated markup: five rows sharing a
 * label/hint/control shape is exactly where copy-paste drift starts, and the
 * hints here are load-bearing — they are what stop the startup timeout and the
 * skip timer being read as the same setting.
 */
function VastRow({
  label,
  hint,
  control,
}: {
  label: string;
  hint: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold">{label}</span>
        <span className="block text-[11px] leading-relaxed text-muted-foreground">{hint}</span>
      </span>
      {control}
    </div>
  );
}
