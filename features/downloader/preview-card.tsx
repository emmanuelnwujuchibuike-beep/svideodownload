"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  BadgeCheck,
  Check,
  CheckCircle2,
  Crown,
  Download,
  Eye,
  Heart,
  ImageIcon,
  Loader2,
  Music,
  Play,
  ShieldCheck,
  UserX,
  Video,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BatchAdGate, type BatchAuthorization } from "@/features/downloader/batch-ad-gate";
import { startDownload as enqueueDownload } from "@/features/downloads/manager";
import { ResultAd } from "@/features/monetization/result-ad";
import { RewardConsentSheet } from "@/features/monetization/reward-consent-sheet";
import { RewardedAdGate } from "@/features/monetization/rewarded-ad";
import { useRewardFlow } from "@/features/monetization/use-reward-flow";
import type { RewardSessionItem } from "@/features/monetization/use-reward-session";
import { rewardAdsFor, type RewardAd } from "@/lib/monetization/reward-policy";
import { useInterstitialConfig, useRewardNetwork } from "@/features/monetization/use-interstitial-skip";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { cn, formatBytes, formatCompactNumber, formatDuration } from "@/lib/utils";
import type { MediaFormat, MediaKind, VideoMetadata } from "@/types";

type DownloadPhase = "idle" | "working" | "done";

/** A server-authorized redemption to attach to an `/api/download` request —
 *  see `lib/monetization/reward-sessions.ts`. */
export interface DownloadOptions {
  directUrl?: string;
}

interface PreviewCardProps {
  metadata: VideoMetadata;
  phase: DownloadPhase;
  onDownload: (formatId: string, kind: MediaKind, options?: DownloadOptions) => void;
}

/**
 * Batch selection limits for free members (owner, 2026-08-23).
 *
 * `FREE_BATCH_SELECT_LIMIT` is the hard cap on how many items one batch may
 * carry. `FREE_SELECT_ALL_PROMPT_AT` is the point where "Select all" stops
 * quietly clamping and instead explains itself: selecting 20 out of 60 without
 * a word looks like a bug, so past this size the upgrade sheet does the talking.
 *
 * Two different numbers on purpose — the owner asked for both. The cap is what
 * a free batch may contain; the threshold is when the product should say why.
 */
/*
  🔴 SETTLED 2026-08-23 after two corrections in the same conversation. Final
  instruction, verbatim: "note, I never said change limit from 20 to 30, leave
  batch limit to be 20" and "select all should show the upgrade prompt for
  above 20".

  So BOTH numbers are 20, and they mean two different things:
   • `FREE_BATCH_SELECT_LIMIT` — the most a free batch may ever contain.
   • `FREE_SELECT_ALL_PROMPT_AT` — the size above which "Select all" stops
     silently clamping and shows the upgrade sheet instead.

  They are kept as separate constants even though they currently share a value,
  because they answer different questions and have already been set apart once.
  Collapsing them into one would make the next change to either silently move
  the other.

  🔴 The sheet is an UPGRADE prompt, never an error (owner was explicit: "not
  an error prompt, show error or anything like that"). Hitting a plan ceiling
  is a sales moment; an error toast frames a working product as broken.
*/
const FREE_BATCH_SELECT_LIMIT = 20;
const FREE_SELECT_ALL_PROMPT_AT = 20;

export function PreviewCard({ metadata, phase, onDownload }: PreviewCardProps) {
  const videoFormats = useMemo(
    () => metadata.formats.filter((f) => f.kind === "video"),
    [metadata.formats],
  );
  const audioFormats = useMemo(
    () => metadata.formats.filter((f) => f.kind === "audio"),
    [metadata.formats],
  );
  const imageFormats = useMemo(
    () => metadata.formats.filter((f) => f.kind === "image"),
    [metadata.formats],
  );

  const listFor = (k: MediaKind) =>
    k === "video" ? videoFormats : k === "image" ? imageFormats : audioFormats;

  const [tab, setTab] = useState<MediaKind>(
    videoFormats.length > 0 ? "video" : imageFormats.length > 0 ? "image" : "audio",
  );
  const formats = listFor(tab);
  const [activeId, setActiveId] = useState<string>(formats[0]?.formatId ?? "best");

  const onTabChange = (next: MediaKind) => {
    setTab(next);
    setActiveId(listFor(next)[0]?.formatId ?? "best");
  };

  // ── Batch download — multi-photo posts and multi-snap stories ──────────
  // Premium selection grid per the design: numbered tiles, animated checkmarks,
  // Select All, live counter + total size, one button downloads everything in
  // the background (each item streams through the download manager).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Which limit the free member just hit, and how many items were on offer. */
  const [upgradePrompt, setUpgradePrompt] = useState<{ kind: "cap" | "selectAll"; total: number } | null>(null);

  /*
    Premium is derived the same way every other surface derives it
    (site-header, wallpaper-reels): "ads are resolved AND we are not showing
    them". Deliberately NOT a separate entitlement read — two sources for one
    question is how a Pro member ends up gated on one screen and not another.

    While `ready` is false we treat the viewer as PREMIUM, i.e. we do NOT
    enforce the cap. The alternative fails closed on a slow connection: a
    paying member whose entitlement hasn't resolved yet would be told to
    upgrade, which is the worst possible false positive here. Nothing is
    granted by being optimistic — this only decides what the picker lets you
    tick, and the download path keeps its own server-side checks.

    Declared here, beside the selection state it governs, rather than down with
    the ad-policy block: `onSelectAll` and `selectableCount` are evaluated
    during render, so a declaration below them is a temporal-dead-zone error,
    not merely untidy.
  */
  const { showAds, ready: adsReady } = useShowAds();
  const isPremiumBatch = !adsReady || !showAds;
  useEffect(() => setSelected(new Set()), [metadata.id]);


  /*
    What can be batch-downloaded.

    Two cases, both "these are distinct pieces of media, not alternatives":
      · a multi-photo post — more than one image format (the original case), and
      · anything an extractor explicitly flagged `isSeparateItem`, which is how
        a Snapchat story with several snaps arrives.

    ── Separate items are read from EVERY format, not the active tab ────────
    Owner (2026-08-09), with a link: a story fetched only one snap. The
    extractor returned all three — verified against the live page — but this
    line filtered the TAB'S list, and that story was one video plus two photos.
    On the Video tab exactly one separate item survived, so `isBatchable` was
    false and the whole story collapsed to a single download; on Photos it
    would have offered two and silently lost the video.

    The tabs exist to choose a QUALITY of one item, which is a question that
    does not apply to separate items: a story is one collection whether its
    snaps are video, photo or both. So they are collected from all formats and
    the grid offers the entire story, each tile carrying its own kind.

    Multi-photo posts are unchanged — an image tab with more than one image
    still batches through the second branch.
  */
  const separateItems = useMemo(
    () => metadata.formats.filter((f) => f.isSeparateItem),
    [metadata.formats],
  );
  const batchItems = separateItems.length > 1 ? separateItems : tab === "image" ? imageFormats : [];

  /*
    🔴 CLOSE THE OPTIMISTIC WINDOW (owner, 2026-08-24: "Some users still select
    more than 20").

    The optimism above is right and stays: telling a paying member to upgrade
    because their entitlement had not resolved yet is the worst false positive
    on this screen. But it left a real hole — while `adsReady` was false the cap
    was not enforced AT ALL, so a free member who started ticking immediately
    could pass 20, and nothing ever re-checked once the answer arrived. The
    selection simply stayed over the cap.

    That is not cosmetic. `/api/download` charges quota per BATCH ("one charge
    per batch") and does not police how many items a batch contains, so an
    over-selected batch really does download more than 20 for one charge.

    So: stay optimistic while loading, then reconcile the moment the truth
    lands. A member who was genuinely over the cap is trimmed back to it and
    shown the same upgrade sheet they would have seen; a Pro member is never
    touched, because the effect only acts when the resolved answer says free.
  */
  useEffect(() => {
    if (!adsReady || !showAds) return; // still unknown, or genuinely premium
    if (selected.size <= FREE_BATCH_SELECT_LIMIT) return;
    /*
      Computed OUTSIDE the state updater on purpose. Raising the upgrade sheet
      from inside a `setSelected(prev => …)` callback would be a side effect in
      a state updater — React is free to invoke those more than once (it does in
      StrictMode), which would fire the sheet twice.

      Reading `selected` from this render's closure is correct here: the effect
      only runs when the ENTITLEMENT changes, and at that instant the closure
      holds the current selection.
    */
    const keep = batchItems
      .filter((f) => selected.has(f.formatId))
      // Keep the first N in the picker's own order, so the trim is predictable
      // rather than dropping whichever items a Set happens to iterate last.
      .slice(0, FREE_BATCH_SELECT_LIMIT)
      .map((f) => f.formatId);
    setSelected(new Set(keep));
    setUpgradePrompt({ kind: "cap", total: batchItems.length });
    // Deliberately NOT depending on `selected`/`batchItems`: this reconciles a
    // late entitlement answer, so it must fire on that answer and nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adsReady, showAds]);
  const isBatchable = batchItems.length > 1;
  const toggleSelect = (formatId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(formatId)) {
        next.delete(formatId);
        return next;
      }
      // Deselecting is always free; only ADDING can cross the cap.
      if (!isPremiumBatch && next.size >= FREE_BATCH_SELECT_LIMIT) {
        setUpgradePrompt({ kind: "cap", total: batchItems.length });
        return prev;
      }
      next.add(formatId);
      return next;
    });

  /**
   * "Select all", which is where the limit actually bites.
   *
   * Three outcomes, in the order a free member meets them:
   *  • more than `FREE_SELECT_ALL_PROMPT_AT` items → the upgrade sheet, because
   *    silently selecting 20 of 60 and saying nothing would read as broken.
   *  • at or under that, but over the cap → select the first 20 and say so.
   *  • Pro → everything, always.
   */
  const onSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    if (!isPremiumBatch && batchItems.length > FREE_SELECT_ALL_PROMPT_AT) {
      setUpgradePrompt({ kind: "selectAll", total: batchItems.length });
      return;
    }
    const take = isPremiumBatch ? batchItems.length : Math.min(batchItems.length, FREE_BATCH_SELECT_LIMIT);
    setSelected(new Set(batchItems.slice(0, take).map((f) => f.formatId)));
  };

  /* Pro selects everything; a free member's "all" is their cap. Without this
     the tick never fills at 20/60 and the control looks stuck. */
  const selectableCount = isPremiumBatch
    ? batchItems.length
    : Math.min(batchItems.length, FREE_BATCH_SELECT_LIMIT);
  const allSelected = isBatchable && selected.size >= selectableCount;
  const batchBytes = batchItems.reduce((n, f) => (selected.has(f.formatId) ? n + (f.filesize ?? 0) : n), 0);
  /*
    ── Batch is free, and an ad pays for it (owner, 2026-08-09) ────────────
    It used to be a Pro wall. An upgrade prompt earns nothing from the people
    who will never buy; it just takes the feature away. So the batch is queued
    behind a full-screen ad and runs the moment that ad is dismissed — and it
    runs regardless if the slot is empty, the config never loaded, or the
    member is premium.
  */
  const [pendingBatch, setPendingBatch] = useState<typeof batchItems | null>(null);
  const [batchFinished, setBatchFinished] = useState(false);

  /*
    The same items, shaped for the reward session (`url`/`formatId`/`kind`
    only — see `lib/monetization/reward-sessions.ts`). Memoised so its
    reference only changes when `pendingBatch` itself does: `BatchAdGate`'s
    "open the gate" effect keys on THIS reference, and a fresh array on every
    render would either never fire (stale closure) or fire on every render —
    see the reference-stability note on `pendingBatch` above; this is the same
    class of bug, on the derived value instead of the source.
  */
  const pendingRewardItems = useMemo<RewardSessionItem[] | null>(
    () =>
      pendingBatch
        ? pendingBatch.map((f) => ({ url: metadata.sourceUrl, formatId: f.formatId, kind: f.kind, title: f.label }))
        : null,
    [pendingBatch, metadata.sourceUrl],
  );

  /** Queue the items and let the gate decide whether an ad runs first. */
  const batchDownload = (explicit?: typeof batchItems) => {
    setPendingBatch(explicit ?? batchItems.filter((f) => selected.has(f.formatId)));
  };

  /**
   * Actually enqueue — called by the gate once the reward (if any) is
   * confirmed. `auth` is null only for a bypass (Pro/Business, or the feature
   * switched off in the admin); otherwise it's the server-authorized session
   * whose items are redeemed via `/api/download?rewardToken=...&itemIndex=...`
   * — never the plain formatId, which the server would now trust exactly as
   * little as a forged one (see app/api/download/route.ts).
   */
  const runBatch = (items: typeof batchItems, auth: BatchAuthorization | null) => {
    /*
      ONE id for the whole batch (owner, 2026-08-09: "multiple download should
      be recorded as one in the free user daily limit for download but not the
      rest api request").

      A story or a slideshow is many files but ONE thing the member asked for.
      The daily cap was charged per FILE, so a 12-photo TikTok slideshow spent
      12 of a free visitor's 30 — and once the cap ran out mid-batch the
      remaining files came back 429 while the earlier ones had already
      succeeded. That is the reported "some failed in the multiple download".

      Every item carries this id; the server writes one receipt against it and
      charges once. The API requests themselves are untouched — each file still
      needs its own extraction and transfer.
    */
    const batchId = crypto.randomUUID();
    items.forEach((f, i) => {
      // Each item carries its OWN kind — a story can mix video snaps and photo
      // snaps, and sending them all as "image" would have saved the videos with
      // the wrong extension.
      const directUrl = auth
        ? `/api/download?rewardToken=${encodeURIComponent(auth.rewardSessionId)}&itemIndex=${i}&t=${crypto.randomUUID()}&b=${batchId}`
        : undefined;
      enqueueDownload({
        url: metadata.sourceUrl,
        formatId: f.formatId,
        kind: f.kind,
        title: `${metadata.title || "download"} · ${i + 1} of ${items.length}`,
        thumbnail: f.thumbnail ?? (f.kind === "image" ? f.directUrl : null) ?? metadata.thumbnail,
        platform: metadata.platform,
        platformName: metadata.platformName,
        qualityLabel: f.label,
        durationSeconds: metadata.durationSeconds,
        batchId,
        directUrl,
      });
    });
    // No "started" toast — the floating card shows "Downloading N items…".
    setSelected(new Set());
    // The closing ad fires AFTER the files are queued, so dismissing it can
    // never cost the member their download.
    setBatchFinished(true);
  };

  /*
    ── One is free, many is Pro (owner, 2026-08-04) ────────────────────────
    Removing the `isImageTab` gate earlier made ANY selection take the batch
    path, so ticking a single video asked a free member to upgrade to download
    one file — which they could already do by just pressing the button.

    The line is now where the value actually is: picking one item is an
    ordinary download and stays free; picking several is the feature worth
    paying for. A single tick therefore downloads THAT item rather than
    whatever the active row happens to be, which is also what tapping a tile
    plainly means.
  */
  const runDownload = () => {
    // Nothing ticked on a multi-item link means "give me the lot" — that is
    // what a story link asks for, and it is the action the button advertises.
    if (isBatchable && selected.size === 0) {
      batchDownload(batchItems);
      return;
    }
    if (isBatchable && selected.size > 1) {
      batchDownload();
      return;
    }
    if (isBatchable && selected.size === 1) {
      const only = batchItems.find((f) => selected.has(f.formatId));
      if (only) {
        startDownload(only.formatId, only.kind);
        return;
      }
    }
    startDownload(activeId, tab);
  };

  const activeFormat = formats.find((f) => f.formatId === activeId);

  /*
    ── 🔴 THE REWARD GATE IS BY FILE SIZE NOW (owner, 2026-08-11) ────────────
    "downloads above 100mb [a 30 sec reward ad], more than 500mb should show a
    first 30 sec reward ad and after it finishes another 30 sec reward ad but
    can be skipable after 15 secs."

    It used to be `kind === "image" || formatId === topVideoId` — the
    highest-RANKED format, with no reference to size. On the 60-minute video that
    prompted this it was wrong in both directions at once: 720p is 1.03 GB and is
    NOT the top format, so a gigabyte went through ungated, while a 15-second
    clip's top format is a few MB and WAS gated. Cost scales with bytes, so the
    gate is bytes. The policy and its thresholds live in
    lib/monetization/reward-policy.ts with the tests.

    `queue` holds the ads still to watch. Draining it one at a time — rather than
    rendering two gates or nesting them — is what makes "after it finishes, show
    another" literal, and it means the second ad's own props (its skip window)
    come from the policy rather than from a flag threaded through the component.
  */
  const {
    rewardTopTierCount,
    rewardVideoTopTierSeconds,
    rewardImageAudioTopTierSeconds,
    rewardImageAudioSkipAfterSeconds,
  } = useInterstitialConfig();
  const tierConfig = {
    topTierCount: rewardTopTierCount,
    videoTopTierSeconds: rewardVideoTopTierSeconds,
    imageAudioTopTierSeconds: rewardImageAudioTopTierSeconds,
    imageAudioSkipAfterSeconds: rewardImageAudioSkipAfterSeconds,
  };
  // Quality rank is this format's position in ITS OWN kind's best-first list
  // (0 = the single best option) — the only place that list exists, so the
  // policy function (which knows nothing about the full format set) takes
  // the rank rather than re-deriving it.
  const qualityRankFor = (formatId: string, kind: MediaKind): number | null => {
    const i = listFor(kind).findIndex((f) => f.formatId === formatId);
    return i >= 0 ? i : null;
  };
  const [gate, setGate] = useState<{ formatId: string; kind: MediaKind } | null>(null);
  const [queue, setQueue] = useState<RewardAd[]>([]);
  const [totalAds, setTotalAds] = useState(0);
  /*
    🔴 VIDEO PAUSED off the real GPT rewarded ad (owner, 2026-08-16, direct
    correction: "top quality video still doesnt click… reduced my visitor").

    Root cause: no Google Ad Manager account is configured
    (`NEXT_PUBLIC_GPT_REWARDED_AD_UNIT_PATH` is unset everywhere), so this
    was requesting GOOGLE'S OWN PUBLIC TEST rewarded ad unit in production —
    which is not reliably fillable for real visitors. The lock-up bug fixed
    earlier the same day made "Try Again" work again instead of freezing
    forever, but if the underlying test ad never fills, retrying just
    repeats the same failure — every top-2-quality video download dead-ends.

    `downloadUnlock`/`onDownloadUnlockGranted` are left fully wired below
    (dormant, not called) rather than deleted: once a real Ad Manager
    account and ad unit exist, restoring the real flow is a one-line
    `downloadUnlock.open(...)` swap back in `startDownload`, not a rebuild.
    Until then, video quality tiers route through the SAME proven
    admin-video/timer `RewardedAdGate` that image/audio already use below —
    it works today.
  */
  const onDownloadUnlockGranted = useCallback(
    (items: RewardSessionItem[], rewardSessionId: string) => {
      const item = items[0];
      if (!item) return;
      const directUrl = `/api/download?rewardToken=${encodeURIComponent(rewardSessionId)}&itemIndex=0&t=${crypto.randomUUID()}`;
      onDownload(item.formatId, item.kind, { directUrl });
    },
    [onDownload],
  );
  /*
    ── The pause above is now an ADMIN SWITCH, not a hard-coded state
       (owner, 2026-08-25: "I want to be able to decide in admin dashboard
       which reward ad network for a particular feature") ──────────────────

    `hd_download` defaults to `rewarded_video` — exactly the behaviour the note
    above describes and the only one that works without a Google Ad Manager
    account. But the moment a real ad unit exists, an admin selects "Google
    rewarded ad (GPT)" for this surface and the dormant flow below goes live,
    with no deploy. That is precisely the "one-line swap back" the note
    anticipated, turned into configuration.
  */
  const hdNetwork = useRewardNetwork("hd_download");
  const downloadUnlock = useRewardFlow(
    "DOWNLOAD_UNLOCK",
    onDownloadUnlockGranted,
    hdNetwork.gptAdUnitPath,
  );
  const startDownload = (formatId: string, kind: MediaKind) => {
    const fmt = formats.find((f) => f.formatId === formatId && f.kind === kind);
    const ads = rewardAdsFor({
      filesize: fmt?.filesize ?? null,
      showAds,
      kind,
      qualityRank: qualityRankFor(formatId, kind),
      tierConfig,
    });
    if (ads.length > 0) {
      // Routed away from an ad entirely by the admin.
      if (hdNetwork.network === "none") {
        onDownload(formatId, kind);
        return;
      }
      if (hdNetwork.network === "gpt_rewarded") {
        downloadUnlock.open([
          { url: metadata.sourceUrl, formatId, kind, title: metadata.title },
        ]);
        return;
      }
      /*
        ── The Hilltop VAST as the top-quality gate (owner, 2026-09-02) ────────

        "i want hiltop vast to be the acting reward ad in place of offerium
        untill offerium approved, so the batch download, top 2 quality download
        started should show hiltop ad for a particular time set in the admin
        dashboard."

        The `batch` trigger, deliberately, and not a new one: it already resolves
        the `batch_download_gate` zone and already reads `batchGateSeconds`, so
        the two "download started" gates share ONE zone and ONE admin timer —
        which is exactly what "a particular time set in the admin dashboard"
        asks for, and it avoids a second number that can drift from the first.
        A trigger must also already exist in EXOCLICK_ZONES, and this one does.

        🔴 IT GRANTS ON FINISH, WHATEVER THE FINISH IS. `requestVastInterstitial`
        resolves for every outcome — shown, skipped, no fill, timed out, blocked
        — and the download proceeds in all of them. A visitor must never lose a
        file they asked for because an ad network had nothing to serve; that is
        the standing fail-open rule for this whole subsystem, and the reward
        session is not what is being protected here.
      */
      if (hdNetwork.network === "interstitial") {
        void import("@/features/monetization/vast-interstitial/request")
          .then((m) => m.requestVastInterstitial("batch"))
          .catch(() => {
            /* A gate that cannot load its own ad must still release the file. */
          })
          .finally(() => onDownload(formatId, kind));
        return;
      }
      setQueue(ads);
      setTotalAds(ads.length);
      setGate({ formatId, kind });
      return;
    }
    onDownload(formatId, kind);
  };

  /*
    How many ads the CURRENT selection would cost — drives the button's amber
    treatment, so the colour is a promise the gate actually keeps. It was
    previously `needsReward(activeId, tab)`, which asked the old rank-based rule
    and so lit up for the wrong formats in both directions.
  */
  const gatedAdCount = useMemo(() => {
    /*
      🔴 NOTHING IS GATED WHEN THE SURFACE PLAYS NO AD (owner, 2026-09-02:
      "remove the ad text on the top quality button").

      `rewardAdsFor` answers "does this format sit in the paid tier", which is
      only half the question. The other half is whether the surface still runs a
      gate at all — and `hd_download` is routed to `none` now, so a top-quality
      download starts immediately.

      Without this the badge said "Ad" and the button turned amber for a
      download that costs nothing, which is exactly the failure the badge's own
      note warns about: a tag that lies about a cost teaches people to distrust
      the whole row. One check here fixes the badge AND the button styling,
      because both read this number.
    */
    if (hdNetwork.network === "none") return 0;

    const rank = formats.findIndex((f) => f.formatId === activeId && f.kind === tab);
    const fmt = rank >= 0 ? formats[rank] : undefined;
    return rewardAdsFor({
      filesize: fmt?.filesize ?? null,
      showAds,
      kind: tab,
      qualityRank: rank >= 0 ? rank : null,
      tierConfig: {
        topTierCount: rewardTopTierCount,
        videoTopTierSeconds: rewardVideoTopTierSeconds,
        imageAudioTopTierSeconds: rewardImageAudioTopTierSeconds,
        imageAudioSkipAfterSeconds: rewardImageAudioSkipAfterSeconds,
      },
    }).length;
  }, [formats, activeId, tab, showAds, hdNetwork.network, rewardTopTierCount, rewardVideoTopTierSeconds, rewardImageAudioTopTierSeconds, rewardImageAudioSkipAfterSeconds]);

  /*
    ═══════════════════════════════════════════════════════════════════════════
     🔴 WARM THE GATE AD WHILE THE VISITOR IS STILL CHOOSING A QUALITY
    ═══════════════════════════════════════════════════════════════════════════

    Owner, 2026-09-02: "some high quality vast video reward ad doesnt trigger on
    time, and they make the download button to respond late … the ad download
    button should always preftch as soon as the link finished extracting so the
    ad download button respond instant and the reward ad respond instantly so
    there can be time for the download complete vast video too."

    The COMPLETION moments were already warmed — a download start predicts them
    (`PREFETCHES_ON_START`). The GATE had nothing in front of it: its creative
    and its media were both fetched on the tap, so the first thing a Download
    press did was wait on the network. That is the late button, and it also eats
    the head start the download-complete ad needs afterwards.

    Extraction finishing is the honest predictor — by the time this card is on
    screen with a gated quality selected, tapping Download is the primary action
    of the screen.

    ── The three gates on this, and why each is load-bearing ─────────────────

    Every warm is a REAL VAST request, and a request with no impression behind
    it is exactly what makes a publisher's fill rate look broken to the network
    — the number the owner is watching. So it only fires when an ad is genuinely
    going to be asked for:

      • `showAds`      — Pro and Business never reach a gate at all.
      • `gatedAdCount` — the CURRENT selection actually costs an ad. Warming for
                         an ungated pick would be a request for a moment that
                         will not happen.
      • `interstitial` — the admin has this surface routed to the VAST. Any
                         other network plays something else entirely.

    Once per card, guarded by a ref rather than by the dependency array: the
    deps change as the visitor tries different qualities, and re-warming on
    every tab switch would be several ad requests for one download.
  */
  /*
    ═══════════════════════════════════════════════════════════════════════════
     🔴 WARM THE COMPLETION AD — NOT THE GATE THAT NO LONGER EXISTS.
    ═══════════════════════════════════════════════════════════════════════════

    Owner, 2026-09-02: "download complete vast trigger too late."

    That is a regression from removing the click-time gates, and this effect is
    where it happened. The three guards above described the GATE: warm only when
    a quality costs an ad (`gatedAdCount > 0`) and the surface is routed to the
    VAST (`network === "interstitial"`). Both are now permanently false —
    `hd_download` is `none` — so this stopped running, and with it went the only
    thing that pre-warmed the completion creative. A cold Hilltop creative
    measures ~10.9s to first frame, which is precisely the "late" being reported.

    The moment worth warming was never the gate; it was the COMPLETION, which
    still happens on every single download. So the guards now describe that:

      • `showAds` — a Pro or Business member sees no ad at all, so warming for
        one would be a VAST request with no impression behind it, which is what
        makes a publisher's fill rate look broken. That reasoning was right and
        is kept.
      • Once per card, by ref — the deps change as the visitor tries qualities,
        and re-warming on every tab switch would be several requests for one
        download.

    `gatedAdCount` and the network check are deliberately GONE: neither has
    anything to say about an ad that plays after the file is saved.
  */
  const warmedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!adsReady || !showAds) return;
    if (warmedFor.current === metadata.id) return;
    warmedFor.current = metadata.id;
    void import("@/features/monetization/vast-interstitial/request")
      .then((m) => {
        // The module and the player chunk, so the completion pays for neither.
        m.warmVastInterstitial();
        // The creative AND its media, so playback starts almost immediately
        // once the file lands.
        m.warmCreativeFor("download-complete");
      })
      .catch(() => {
        /* A warm that fails costs nothing — the moment still fetches normally. */
      });
  }, [adsReady, showAds, metadata.id]);

  const platform = PLATFORMS[metadata.platform];
  const BrandIcon = BRAND_ICONS[metadata.platform];

  // Live cover: when browsing photos, mirror the selected photo; otherwise show
  // the video poster, falling back to any available image so every fetch — image
  // OR video — always shows a cover.
  const firstImage = imageFormats.find((f) => f.directUrl)?.directUrl ?? null;
  const cover =
    (tab === "image" ? activeFormat?.directUrl : null) ??
    metadata.thumbnail ??
    firstImage ??
    null;

  const isImageTab = tab === "image";
  const photoIndex = isImageTab ? imageFormats.findIndex((f) => f.formatId === activeId) : -1;

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      /*
        🔴 A RING, NOT A BORDER (owner, 2026-08-25, with a screenshot of this
        card: "the fetch card has an unprofessional gray boder that doesnt have
        a border radius").

        It carried `border border-border/60` — a full-strength grey hairline. On
        the near-white surface this card sits on, that reads as a BOX drawn
        around the result rather than as the result's own edge, and it is the
        only card in this flow still drawn that way: the section card that
        contains it, the landing tiles and the ad surface all use the house
        treatment below.

        `ring-1 ring-inset` also cannot produce the square edge that was
        reported. An inset ring is painted inside the element's border-box and
        follows `border-radius` exactly, whereas a `border` sits in the layout
        box — so where a radius is fighting a clip or a transformed ancestor
        (this is a `motion.div`; framer leaves an inline transform on it even at
        rest), the border is the thing that can end up looking squared off while
        the content inside it stays correctly rounded. Swapping to a ring
        removes both the greyness and that whole failure mode.
      */
      className="group/card relative mx-auto mt-10 w-full max-w-2xl overflow-hidden rounded-[2rem] bg-card shadow-luxury ring-1 ring-inset ring-slate-900/[0.06] dark:ring-white/10"
    >
      {/* subtle gradient sheen on top edge */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r opacity-70",
          platform.accent,
        )}
      />

      {/* ---------------- Media cover ---------------- */}
      <div className="relative aspect-video overflow-hidden bg-neutral-950">
        {/* blurred fill so portrait/square media frames elegantly */}
        <AnimatePresence mode="popLayout">
          {cover ? (
            <motion.div
              key={cover}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="absolute inset-0"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cover}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cover}
                alt={metadata.title}
                className="absolute inset-0 h-full w-full object-contain"
              />
            </motion.div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-white/25">
              {BrandIcon ? <BrandIcon className="h-16 w-16" /> : <Video className="h-14 w-14" />}
            </div>
          )}
        </AnimatePresence>

        {/* legibility gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/40" />

        {/* center play (video only) */}
        {tab === "video" ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="absolute h-16 w-16 rounded-full bg-white/20 blur-md" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/95 shadow-2xl ring-1 ring-black/5 transition-transform duration-300 group-hover/card:scale-105">
              <Play className="h-6 w-6 translate-x-0.5 fill-black text-black" />
            </div>
          </div>
        ) : null}

        {/* photo counter (image only) */}
        {isImageTab && imageFormats.length > 1 ? (
          <span className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur-md">
            {photoIndex + 1} / {imageFormats.length}
          </span>
        ) : null}

        {/* brand badge */}
        <span
          className={cn(
            "absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br px-3 py-1.5 text-xs font-semibold text-white shadow-lg",
            platform.accent,
          )}
        >
          {BrandIcon ? <BrandIcon className="h-3.5 w-3.5" /> : null}
          {metadata.platformName}
        </span>

        {/* duration / hd chip */}
        <div className="absolute right-4 top-4 flex items-center gap-2">
          {tab === "video" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-md ring-1 ring-white/20">
              <BadgeCheck className="h-3 w-3" /> No watermark
            </span>
          ) : null}
          {tab === "video" && metadata.durationSeconds ? (
            <span className="rounded-md bg-black/65 px-2 py-0.5 text-xs font-semibold tabular-nums text-white backdrop-blur-md">
              {formatDuration(metadata.durationSeconds)}
            </span>
          ) : null}
        </div>

        {/* title + meta overlay */}
        <div className="absolute inset-x-0 bottom-0 p-5">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug text-white drop-shadow sm:text-lg">
            {metadata.title}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/75">
            {metadata.creator ? (
              <span className="inline-flex max-w-[12rem] items-center gap-1 truncate font-medium text-white/90">
                @{metadata.creator.replace(/^@/, "")}
              </span>
            ) : null}
            {metadata.viewCount != null ? (
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" /> {formatCompactNumber(metadata.viewCount)}
              </span>
            ) : null}
            {metadata.likeCount != null ? (
              <span className="inline-flex items-center gap-1">
                <Heart className="h-3.5 w-3.5" /> {formatCompactNumber(metadata.likeCount)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* thumbnail strip for multi-photo posts */}
      {isImageTab && imageFormats.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto border-b border-border/60 bg-secondary/30 px-4 py-3">
          {imageFormats.map((f, i) => (
            <button
              key={f.formatId}
              type="button"
              onClick={() => setActiveId(f.formatId)}
              className={cn(
                "relative h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-2 transition",
                f.formatId === activeId
                  ? "ring-primary"
                  : "ring-transparent opacity-60 hover:opacity-100",
              )}
              aria-label={`Photo ${i + 1}`}
            >
              {f.directUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.directUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                  <ImageIcon className="h-4 w-4" />
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      {/* ---------------- Controls ---------------- */}
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium text-muted-foreground">
            Choose {isImageTab ? "photo" : "quality"}
          </span>
          <div className="inline-flex rounded-xl bg-secondary p-1">
            {videoFormats.length > 0 ? (
              <TabButton active={tab === "video"} onClick={() => onTabChange("video")}>
                <Video className="h-4 w-4" /> Video
              </TabButton>
            ) : null}
            {imageFormats.length > 0 ? (
              <TabButton active={tab === "image"} onClick={() => onTabChange("image")}>
                <ImageIcon className="h-4 w-4" /> Photos
              </TabButton>
            ) : null}
            {audioFormats.length > 0 ? (
              <TabButton active={tab === "audio"} onClick={() => onTabChange("audio")}>
                <Music className="h-4 w-4" /> Audio
              </TabButton>
            ) : null}
          </div>
        </div>

        {/*
          The download-result placement, between the "Choose quality" header and
          the quality grid.

          Deliberately INSIDE the card rather than below it, which is where it
          used to sit. Here it is in the one place the visitor is certain to
          look — they have a result and are picking a format — while still being
          above the action rather than in front of it, so it never stands
          between them and the download button.

          Renders nothing at all when the zone is unseeded or, for AdSense, when
          the unit comes back unfilled.
        */}
        <ResultAd className="mt-4" />

        {isBatchable ? (
          /*
            ── The multi-select panel, built to public/mulitpleselection modal.jpg ──
            Owner: "make it look exactly like it and more professional and
            arranged and less cluttered."

            The reference's arrangement, and the reasoning where it differs:

            • ONE panel with its own surface and border, instead of controls
              floating loose on the card. The header, the grid and the count
              read as a single tool you are operating rather than three
              unrelated rows.

            • FOUR columns, as drawn. At four a tile is small, which is exactly
              why the number moved to a corner badge and the tick to the
              opposite one — the middle of the tile stays the picture.

            • The centred play button is gone. At this size it covered most of
              the frame it was describing; a video now says so with a small
              corner glyph, which is the same information and none of the
              obstruction.

            • No PRO chip. The reference has one, but batch downloads are free
              now and paid for by an ad, so badging them Pro would advertise a
              wall that no longer exists (owner, earlier the same day).
          */
          <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-secondary/25">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3.5 py-3">
              <p className="text-sm font-bold">
                Select items{" "}
                <span className="font-semibold text-muted-foreground tabular-nums">
                  ({selected.size}/{batchItems.length})
                </span>
                {/* The cap is stated UP FRONT, not sprung at item 21. */}
                {!isPremiumBatch && batchItems.length > FREE_BATCH_SELECT_LIMIT ? (
                  <span className="ml-1.5 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Free: {FREE_BATCH_SELECT_LIMIT} max
                  </span>
                ) : null}
              </p>
              <button
                type="button"
                onClick={onSelectAll}
                className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-violet-500 transition hover:text-violet-400 active:scale-95"
              >
                {allSelected ? "Deselect all" : "Select all"}
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border transition",
                    allSelected
                      ? "border-transparent bg-gradient-to-br from-blue-600 to-violet-600 text-white"
                      : "border-border text-transparent",
                  )}
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              </button>
            </div>

            <div className="grid max-h-[19rem] grid-cols-4 gap-2 overflow-y-auto p-3">
              {batchItems.map((f, i) => {
                const on = selected.has(f.formatId);
                return (
                  <button
                    key={f.formatId}
                    type="button"
                    onClick={() => {
                      setActiveId(f.formatId);
                      toggleSelect(f.formatId);
                    }}
                    aria-pressed={on}
                    aria-label={`${f.label || `Item ${i + 1}`}${on ? " selected" : ""}`}
                    className={cn(
                      "group/tile relative aspect-square overflow-hidden rounded-xl ring-2 transition-all active:scale-[0.96]",
                      on ? "shadow-lg shadow-violet-500/20 ring-violet-500" : "ring-border/60 hover:ring-foreground/25",
                    )}
                  >
                    {/*
                      Each item's OWN poster first (owner, 2026-08-04: "each
                      media should show their respective cover and not a general
                      cover"). An extractor that supplies one — Snapchat sends a
                      `mediaPreviewUrl` per snap — makes the grid usable; without
                      it every tile in a 6-snap story was the same picture and
                      choosing between them was guesswork.

                      Then an IMAGE item's own URL, which IS its picture. A video
                      item's directUrl is an mp4, so it never becomes an <img> —
                      that renders as a broken tile.
                    */}
                    {f.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : f.kind === "image" && f.directUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.directUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : metadata.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={metadata.thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                        {f.kind === "video" ? <Video className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                      </span>
                    )}

                    {/* Unselected tiles dim slightly, so what IS selected reads
                        at a glance without having to find four small ticks. */}
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-0 transition",
                        on ? "bg-transparent" : "bg-black/25",
                      )}
                    />

                    <span className="absolute left-1 top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-black/65 px-1 text-[10px] font-bold tabular-nums text-white backdrop-blur">
                      {i + 1}
                    </span>

                    <span
                      aria-hidden
                      className={cn(
                        "absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full transition duration-200",
                        on
                          ? "scale-100 bg-gradient-to-br from-blue-600 to-violet-600 text-white opacity-100 shadow"
                          : "scale-75 bg-black/35 text-white/70 opacity-90 ring-1 ring-inset ring-white/40",
                      )}
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>

                    {/* A video says so in a corner rather than under a badge
                        covering the frame. */}
                    {f.kind === "video" ? (
                      <span className="pointer-events-none absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                        <Play className="h-2.5 w-2.5 fill-white" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-4 grid max-h-44 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
            {formats.map((f, i) => (
              <FormatRow
                key={f.formatId}
                format={f}
                index={i}
                kind={tab}
                active={f.formatId === activeId}
                /* The SAME call the gate makes, with this row's own rank — so
                   the tag and the gate can never disagree about what costs an ad. */
                gated={
                  rewardAdsFor({
                    filesize: f.filesize ?? null,
                    showAds,
                    kind: tab,
                    qualityRank: i,
                    tierConfig: {
                      topTierCount: rewardTopTierCount,
                      videoTopTierSeconds: rewardVideoTopTierSeconds,
                      imageAudioTopTierSeconds: rewardImageAudioTopTierSeconds,
                      imageAudioSkipAfterSeconds: rewardImageAudioSkipAfterSeconds,
                    },
                  }).length > 0
                }
                onSelect={() => setActiveId(f.formatId)}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          disabled={phase !== "idle"}
          onClick={() => runDownload()}
          className={cn(
            "group relative mt-5 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl px-4 py-4 text-base font-semibold shadow-lg transition-all active:scale-[0.99] disabled:active:scale-100",
            phase === "done"
              ? "bg-emerald-600 text-white shadow-emerald-600/25"
              : isBatchable && selected.size !== 1
                ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-violet-500/30 hover:shadow-violet-500/50 hover:shadow-xl disabled:opacity-70"
                : gatedAdCount > 0
                  ? "bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 text-white shadow-amber-500/30 hover:shadow-amber-500/50 hover:shadow-xl disabled:opacity-70"
                  : "bg-primary text-primary-foreground shadow-primary/25 hover:shadow-glow-blue disabled:opacity-70",
          )}
        >
          {/* shimmer sweep */}
          <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          {phase === "working" ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> Preparing your file…
            </>
          ) : phase === "done" ? (
            <>
              <CheckCircle2 className="h-5 w-5" /> Download started — check your files
            </>
          ) : isBatchable && selected.size === 0 ? (
            <>
              <Download className="h-5 w-5 transition-transform group-hover:translate-y-0.5" />
              Download all {batchItems.length} {batchItems.every((f) => f.kind === "video") ? "videos" : "items"}
            </>
          ) : isBatchable && selected.size > 1 ? (
            <>
              <Download className="h-5 w-5 transition-transform group-hover:translate-y-0.5" />
              Download {selected.size} Items
            </>
          ) : (
            <>
              <Download className="h-5 w-5 transition-transform group-hover:translate-y-0.5" />
              {isImageTab
                ? `Download Photo${imageFormats.length > 1 ? ` ${photoIndex + 1}` : ""}`
                : `Download ${activeFormat?.label ?? (tab === "audio" ? "Audio" : "Video")}`}
            </>
          )}
        </button>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          {phase === "done"
            ? "Saving to your device — check your browser downloads or Files app."
            : isBatchable && selected.size > 1 && batchBytes > 0
              ? `Total size: ~${formatBytes(batchBytes)}`
              : "Fast, private & free — no app, no sign-up."}
        </p>

        {/*
          Feature strip — what every download gets.

          One quiet inline row, as in the reference (public/mulitpleselection
          modal.jpg), rather than the bordered four-cell table it was. Same four
          claims, none dropped: they are reassurance you read once, and giving
          them a box, dividers and a background made them compete with the
          download button directly above for the same attention.

          Every one is a checkable product fact — no counts, no ratings.
        */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-muted-foreground">
          {(
            [
              { icon: Zap, label: "Lightning fast" },
              { icon: ShieldCheck, label: "Private & secure" },
              { icon: Ban, label: "No watermark" },
              { icon: UserX, label: "No app, no sign-up" },
            ] as const
          ).map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-[11px] font-medium">
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              {label}
            </span>
          ))}
        </div>

        {/*
          The "Pro & Above — unlimited batch downloads" upsell is gone (owner,
          2026-08-09): batch is free now, paid for by an ad, so selling it back
          would be advertising a wall that no longer exists. The honest pitch
          moved onto the ad itself, where "skip these" is a real benefit.
        */}
      </div>
    </motion.div>

    {/*
      One gate, driven by the queue. `key` is the reason a SECOND ad actually
      plays: without it React reuses the same mounted component and its internal
      watch timer, so ad two would open already "watched" and grant instantly.
      Keying on the position forces a fresh mount, a fresh fetch and a fresh
      clock — which is what "after it finishes, show another" means.
    */}
    <RewardedAdGate
      key={`reward-${totalAds - queue.length}`}
      open={!!gate && queue.length > 0}
      durationSec={queue[0]?.durationSec ?? 30}
      skipAfterSec={queue[0]?.skipAfterSec ?? null}
      step={totalAds - queue.length + 1}
      totalSteps={totalAds}
      onReward={() => {
        // Video, image and audio all reach this gate now (video paused off
        // the real GPT flow — see the note on `downloadUnlock` above).
        const rest = queue.slice(1);
        setQueue(rest);
        // Only the LAST ad releases the download. Anything else would hand over
        // the file after ad one and leave ad two playing to nobody.
        if (rest.length === 0) {
          const g = gate;
          setGate(null);
          if (g) onDownload(g.formatId, g.kind);
          /*
            🔴 THE TOP-QUALITY COMPLETION AD (owner, 2026-09-01: "check the top
            quality hiltop vast video for download started and download
            completed").

            ON COMPLETION ONLY, and deliberately. The ad the visitor already
            watched IS the download-started ad, and it is the one that GRANTS the
            unlock through the server-verified reward session — Hilltop has no
            rewarded product, so it must not be what releases a file. Playing a
            second ad at the tap as well would be three full-screen ads for one
            HD download.

            It rides the `batch-complete` trigger rather than a new one, because
            the owner grouped these: "batch download and hd and top quality
            should use a different timer in download complete". So they share
            `batchCompleteSeconds`, and the moment picker's
            `batch_download_complete` row is its on/off switch.

            Fire-and-forget, AFTER `onDownload`: the file is already being
            delivered, so nothing about this ad can delay or block it, and a
            failure to load one is not the visitor's problem.
          */
          void import("@/features/monetization/vast-interstitial/request")
            .then((m) => m.requestVastInterstitial("batch-complete"))
            .catch(() => {
              /* An ad that cannot load is never worth a failed download. */
            });
        }
      }}
      onCancel={() => {
        // ✕ abandons the whole sequence, not just this ad. Dropping the viewer
        // into a second ad they just declined would be the opposite of a close
        // button.
        setQueue([]);
        setGate(null);
      }}
    />

    {/*
      The real GPT rewarded-ad consent flow for video HD downloads (owner,
      2026-08-16 GPT spec). Hidden entirely while Google's own ad UI is
      showing — `downloadUnlock.sheetProps.open` already accounts for that.
    */}
    <RewardConsentSheet {...downloadUnlock.sheetProps} />

    <BatchAdGate
      batch={pendingRewardItems}
      onProceed={(auth) => {
        const items = pendingBatch;
        setPendingBatch(null);
        if (items) runBatch(items, auth);
      }}
      showComplete={batchFinished}
      onCompleteClosed={() => setBatchFinished(false)}
    />

    {upgradePrompt ? (
      <BatchLimitSheet
        kind={upgradePrompt.kind}
        total={upgradePrompt.total}
        onSelectMax={() => {
          setSelected(new Set(batchItems.slice(0, FREE_BATCH_SELECT_LIMIT).map((f) => f.formatId)));
          setUpgradePrompt(null);
        }}
        onClose={() => setUpgradePrompt(null)}
      />
    ) : null}
    </>
  );
}

/**
 * The free batch-selection ceiling, explained.
 *
 * Deliberately offers a way to CONTINUE FOR FREE ("Select 20") next to the
 * upgrade, rather than being a pure paywall: the owner's instruction was
 * "upgrade to pro for unlimited selection OR select below 30 for free", and a
 * sheet with only an upgrade button would strand someone who just wants their
 * files. The free path is the secondary button, not a hidden link.
 */
function BatchLimitSheet({
  kind,
  total,
  onSelectMax,
  onClose,
}: {
  kind: "cap" | "selectAll";
  total: number;
  onSelectMax: () => void;
  onClose: () => void;
}) {
  // Escape closes, and the page behind cannot scroll while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflowY = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-limit-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl bg-card p-5 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 motion-reduce:animate-none sm:rounded-3xl pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] sm:pb-5"
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-9 rounded-full bg-border sm:hidden" />
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/25">
            <Crown className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p id="batch-limit-title" className="text-base font-bold leading-snug">
              {kind === "selectAll"
                ? `Select all is ${total} items`
                : `Free batches hold ${FREE_BATCH_SELECT_LIMIT} items`}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {kind === "selectAll"
                ? `Pro downloads all ${total} in one batch with no limit. On the free plan you can take ${FREE_BATCH_SELECT_LIMIT} at a time — grab these, then run another batch.`
                : `You've selected ${FREE_BATCH_SELECT_LIMIT}, the most a free batch can carry. Go Pro for unlimited selection, or download these and start another batch.`}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <Link href="/pricing" className="btn-lux btn-lux-primary w-full justify-center">
            <Crown className="h-4 w-4" /> Go Pro — unlimited batches
          </Link>
          {kind === "selectAll" ? (
            <button type="button" onClick={onSelectMax} className="btn-lux btn-lux-secondary w-full justify-center">
              {/* min(), because a 25-item batch can only ever give 20 — but a
                  22-item one gives 20 too, and "Select 20" must not appear on a
                  batch that has fewer than that. */}
              Select {Math.min(total, FREE_BATCH_SELECT_LIMIT)} for free
            </button>
          ) : (
            <button type="button" onClick={onClose} className="btn-lux btn-lux-secondary w-full justify-center">
              Continue with {FREE_BATCH_SELECT_LIMIT}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
        active ? "bg-background shadow" : "text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function FormatRow({
  format,
  index,
  kind,
  active,
  gated,
  onSelect,
}: {
  format: MediaFormat;
  index: number;
  kind: MediaKind;
  active: boolean;
  /**
   * This option costs an ad to unlock (owner, 2026-09-02: "put a small ad tag
   * on the highest quality").
   *
   * 🔴 IT IS A PROMISE, SO IT IS DERIVED FROM THE SAME RULE THE GATE USES.
   * `rewardAdsFor` decides both this badge and whether an ad actually plays, so
   * the tag cannot say "ad" on a format that downloads straight through, or
   * stay silent on one that stops you. A badge that lies about a cost is worse
   * than no badge — it teaches people to distrust the whole row.
   *
   * Already false for Pro and Business: `rewardAdsFor` returns [] when
   * `showAds` is false, so a paying member never sees an ad tag either.
   */
  gated: boolean;
  onSelect: () => void;
}) {
  const label =
    kind === "image" ? `Photo ${index + 1}` : format.label || (kind === "audio" ? "Audio" : "Video");
  /*
    ── The size has to be the size you actually get (owner, 2026-08-09) ───────
    "Make the file size in the quality review accurate according to the file
    size exactly, and not showing a small file size in review while the main
    size is higher."

    A number is printed ONLY for a format we hand over byte-for-byte. Two kinds
    of format are not that, and both used to show a figure that described a file
    nobody would ever receive:

    • a stream we must RE-ENCODE (TikTok's H.265 "best quality") — measured on
      the owner's link, it advertised 16.4 MB and delivered 43.4 MB, because the
      figure came from the H.265 source and we ship H.264;
    • a synthesized lower tier, which is produced by downscaling at download
      time and therefore has no size until it exists.

    Neither can be known in advance without encoding the file first, so each
    says what it IS instead of guessing a number. That is more useful than a
    wrong figure and considerably more useful than a blank.
  */
  const willConvert = kind === "video" && format.filesize == null;
  const size =
    kind === "image" ? null : format.filesize != null ? formatBytes(format.filesize) : null;
  const sizeNote = !willConvert
    ? null
    : format.transcodeMaxHeight
      ? "smaller file"
      : "size varies";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98]",
        active
          ? "border-primary/60 bg-primary/10 shadow-sm shadow-primary/10 ring-1 ring-primary/25"
          : "border-border/70 bg-card/80 hover:border-foreground/20 hover:bg-secondary/70",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold uppercase leading-none">
        {label}
        {format.fps && format.fps >= 50 ? (
          <span className="rounded bg-primary/15 px-1 py-0.5 text-[9px] font-bold text-primary">
            {format.fps}
          </span>
        ) : null}
        {gated ? (
          /* Amber, matching the download button's own gated treatment, so the
             row and the button tell the same story before the tap. */
          <span
            className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400"
            title="Watch a short ad to unlock this quality"
          >
            Ad
          </span>
        ) : null}
      </span>
      <span className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground">
        <span>{format.ext}</span>
        {size && size !== "—" ? (
          <span className="normal-case">· {size}</span>
        ) : sizeNote ? (
          <span className="normal-case italic opacity-80">· {sizeNote}</span>
        ) : null}
      </span>
    </button>
  );
}
