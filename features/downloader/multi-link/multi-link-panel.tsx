"use client";

import {
  AlertCircle,
  Crown,
  Download,
  FileArchive,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { BatchAdGate, type BatchAuthorization } from "@/features/downloader/batch-ad-gate";
import { startDownload as enqueueDownload } from "@/features/downloads/manager";
import type { RewardSessionItem } from "@/features/monetization/use-reward-session";
import { track } from "@/lib/analytics/client";
import type { BatchPolicy } from "@/lib/downloads/multi-link-config";
import { cn } from "@/lib/utils";

import { SourceCard } from "./source-card";
import {
  batchProgress,
  batchReducer,
  countItems,
  countSelected,
  filledSources,
  hasFailures,
  initialBatchState,
  normalizeSourceUrl,
  selectedItems,
  zipEligible,
  type BatchItem,
} from "./state";
import { useBatchDownloadWatcher } from "./use-batch-download";
import { useBatchFetch } from "./use-batch-fetch";
import { useBatchPolicy } from "./use-batch-policy";

/**
 * The Multi-Link Batch Downloader panel.
 *
 * ── This file is never on a first paint ───────────────────────────────────
 * It is reached only through `multi-link-button.tsx`, which renders `null`
 * until the visitor actually opens it. That gate is what keeps this module —
 * and `BatchAdGate`, the reward hooks and the ZIP writer it pulls in — out of
 * the landing route's build manifest entirely. `dynamic(ssr:false)` alone does
 * NOT do that if the JSX is reached on the first render pass; only an
 * actually-false-until-mounted gate does (learned the hard way on the cold-entry
 * loader work). Keep the gate.
 *
 * ── Flow (§9, §16) ────────────────────────────────────────────────────────
 *   add sources → fetch each → review per source → select
 *   → authorize (server: plan + source ceiling + daily allowance, spends nothing)
 *   → reward ad, in full, if the plan requires one
 *   → commit (server: spend exactly one allowance, idempotent per batchId)
 *   → enqueue into the existing download manager
 */
export function MultiLinkPanel({ onClose }: { onClose: () => void }) {
  const [state, dispatch] = useReducer(batchReducer, initialBatchState);
  const { policy, refresh, spendLocally } = useBatchPolicy(true);
  const [error, setError] = useState<string | null>(null);
  const [upsell, setUpsell] = useState(false);
  const [zipping, setZipping] = useState(false);

  const onDiscovered = useCallback((_sourceId: string, count: number) => {
    track("multilink_source_fetched", { formats: count });
  }, []);
  const { fetchSource, fetchAll, cancel } = useBatchFetch(dispatch, policy.fetchConcurrency, onDiscovered);

  // Task ids this batch owns, so the watcher ignores unrelated single-link
  // downloads running in the same manager.
  const ownedTaskIds = useMemo(
    () => new Set(state.sources.flatMap((s) => s.items.map((i) => i.taskId).filter((t): t is string => !!t))),
    [state.sources],
  );
  const running = state.phase === "downloading";
  useBatchDownloadWatcher(dispatch, ownedTaskIds, running);

  // ── Open with one empty slot, and announce the open once ────────────────
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    dispatch({ type: "addSource" });
    track("multilink_opened", {});
  }, []);

  const sources = state.sources;
  const filled = filledSources(state);
  const total = countItems(state);
  const selectedCount = countSelected(state);
  const progress = batchProgress(state);
  const atSourceLimit = sources.length >= policy.sourceLimit;
  const outOfBatches = policy.remaining !== null && policy.remaining <= 0;

  // ── A batch finishes when nothing is still moving ───────────────────────
  useEffect(() => {
    if (!running || progress.total === 0) return;
    if (progress.active > 0) return;
    dispatch({ type: "setPhase", phase: "done" });
    setCompleteAd(true);
    track("multilink_batch_completed", {
      completed: progress.done,
      failed: progress.failed,
      sources: filled.length,
    });
  }, [running, progress.active, progress.total, progress.done, progress.failed, filled.length]);

  // ── Source actions ──────────────────────────────────────────────────────
  const addSource = () => {
    if (atSourceLimit) {
      setUpsell(true);
      track("multilink_limit_reached", { limit: policy.sourceLimit, kind: "sources" });
      return;
    }
    dispatch({ type: "addSource" });
    track("multilink_source_added", { count: sources.length + 1 });
  };

  const changeUrl = (sourceId: string, url: string) => {
    /*
      §22 — duplicate detection, on the NORMALIZED form.

      Checked here rather than at fetch time so someone learns immediately,
      while the field is still focused, instead of after paying for an
      extraction that returns the post they already have.
    */
    cancel(sourceId);
    dispatch({ type: "editSource", sourceId, url });
  };

  const removeSource = (sourceId: string) => {
    cancel(sourceId);
    dispatch({ type: "removeSource", sourceId });
    track("multilink_source_removed", {});
  };

  const doFetch = (sourceId: string) => {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return;
    const dupe = sources.some(
      (s) => s.id !== sourceId && s.url.trim() && normalizeSourceUrl(s.url) === normalizeSourceUrl(source.url),
    );
    if (dupe) {
      dispatch({ type: "notice", message: "This source has already been added." });
      return;
    }
    void fetchSource(source).catch(() => {
      track("multilink_source_fetch_failed", {});
    });
  };

  // ── Download ────────────────────────────────────────────────────────────
  const [pendingReward, setPendingReward] = useState<readonly RewardSessionItem[] | null>(null);
  const [completeAd, setCompleteAd] = useState(false);
  /** The exact items, in the exact order, the reward session was opened for —
   *  `itemIndex` in the redemption URL is an index into THIS array, so it must
   *  be the same array the gate resolved against. */
  const pendingItems = useRef<BatchItem[]>([]);
  /*
    The granted authorization, kept for RETRIES.

    A retry must redeem against the SAME session and the SAME index the item
    originally had — the reward session stores an ordered item list, and
    `redeemRewardItem` returns `payload.items[itemIndex]`. Re-indexing a
    3-item retry as 0,1,2 would hand back the first three items of the
    original batch instead of the three that failed. `redeemRewardItem` also
    allows re-redeeming an index on purpose ("a network failure mid-transfer
    must not cost a second ad"), which is exactly this case.
  */
  const rewardRef = useRef<{ auth: BatchAuthorization; indexById: Map<string, number> } | null>(null);

  /**
   * Enqueue into the existing download manager.
   *
   * `batchId` is the server-minted id from `/authorize`: the manager threads it
   * onto every request as `b=`, and `checkDownloadQuota` charges the daily
   * DOWNLOAD cap once for the whole thing — so a 3-source, 16-file batch costs
   * one download, exactly as a single slideshow already does.
   */
  const runBatch = useCallback(
    async (
      items: BatchItem[],
      auth: BatchAuthorization | null,
      batchId: string,
      /** A retry re-runs items inside a batch that has ALREADY been paid for.
       *  It must not look like a second batch to the counter or the UI. */
      isRetry = false,
    ) => {
      if (!isRetry) {
        // §16 step 10 — spend the allowance now, not before the ad.
        try {
          const res = await fetch("/api/downloads/batch/commit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batchId }),
          });
          if (res.ok) {
            const json = (await res.json()) as { allowed: boolean };
            // A refusal here does NOT stop the files — the ad was already
            // watched. See the note on the commit route.
            if (!json.allowed) track("multilink_limit_reached", { kind: "daily" });
          }
        } catch {
          /* fail open — a broken counter must never eat a paid-for batch */
        }
        spendLocally();

        // Remember the authorization and each item's index within it, so a
        // retry can redeem the SAME session at the SAME index.
        rewardRef.current = auth
          ? { auth, indexById: new Map(items.map((it, i) => [it.id, i])) }
          : null;
      }

      const reward = rewardRef.current;
      dispatch({ type: "setPhase", phase: "downloading" });
      items.forEach((item) => {
        const source = state.sources.find((s) => s.id === item.sourceId);
        const url = source?.resolvedUrl ?? source?.url ?? "";
        if (!url) return;
        const rewardIndex = reward?.indexById.get(item.id);
        const taskId = enqueueDownload({
          url,
          formatId: item.formatId,
          kind: item.kind,
          title: item.title,
          thumbnail: item.thumbnail,
          platform: source?.platform ?? "generic",
          platformName: source?.platformName ?? "Link",
          qualityLabel: item.label,
          batchId,
          // A reward-authorized redemption: the server substitutes what IT
          // stored for this index, never what the client re-sends.
          directUrl:
            reward && rewardIndex !== undefined
              ? `/api/download?rewardToken=${encodeURIComponent(reward.auth.rewardSessionId)}&itemIndex=${rewardIndex}&t=${crypto.randomUUID()}&b=${batchId}`
              : undefined,
        });
        dispatch({ type: "itemQueued", itemId: item.id, taskId });
      });
      if (!isRetry) void refresh();
    },
    [state.sources, spendLocally, refresh],
  );

  /** Step 4: ask the server whether this batch may run at all. */
  const authorizeAndStart = async (items: BatchItem[]) => {
    if (items.length === 0) return;
    setError(null);
    track("multilink_download_clicked", { items: items.length, sources: filled.length });
    dispatch({ type: "setPhase", phase: "authorizing" });

    let batchId: string;
    let rewardRequired: boolean;
    try {
      const res = await fetch("/api/downloads/batch/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: filled.map((s) => s.url.trim()),
          itemCount: items.length,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        dispatch({ type: "setPhase", phase: "editing" });
        const code = (json as { code?: string }).code;
        if (code === "DAILY_LIMIT_REACHED") {
          track("multilink_limit_reached", { kind: "daily" });
          void refresh();
        }
        setError((json as { error?: string }).error ?? "Couldn't start this batch.");
        return;
      }
      batchId = (json as { batchId: string }).batchId;
      rewardRequired = (json as { rewardRequired: boolean }).rewardRequired;
    } catch {
      dispatch({ type: "setPhase", phase: "editing" });
      setError("Network error. Please check your connection.");
      return;
    }

    dispatch({ type: "setBatchId", batchId });
    pendingItems.current = items;

    if (!rewardRequired) {
      await runBatch(items, null, batchId);
      return;
    }

    // Hand off to the SAME gate the single-link batch uses — one ad policy,
    // one reward-session path, one place where "the ad must run in full"
    // is enforced.
    dispatch({ type: "setPhase", phase: "awaiting-reward" });
    setPendingReward(
      items.map((item) => {
        const source = state.sources.find((s) => s.id === item.sourceId);
        return {
          url: source?.resolvedUrl ?? source?.url ?? "",
          formatId: item.formatId,
          kind: item.kind,
          title: item.title,
        };
      }),
    );
  };

  const onGateResolved = useCallback(
    (auth: BatchAuthorization | null) => {
      setPendingReward(null);
      const items = pendingItems.current;
      const batchId = state.batchId;
      if (!batchId || items.length === 0) {
        dispatch({ type: "setPhase", phase: "editing" });
        return;
      }
      void runBatch(items, auth, batchId);
    },
    [state.batchId, runBatch],
  );

  const retryFailed = (sourceId?: string) => {
    track("multilink_retry_used", { scope: sourceId ? "source" : "all" });
    /*
      Read the failures from THIS render's state, before dispatching.

      `state` here is the pre-dispatch tree, which is exactly what is wanted:
      it still marks the items as `failed`, and the dispatch about to run is
      what clears them back to `idle` for the re-queue. Reading after the
      dispatch would find nothing to retry — React has not re-rendered yet.
    */
    const scope = sourceId
      ? (state.sources.find((s) => s.id === sourceId)?.items ?? [])
      : state.sources.flatMap((s) => s.items);
    const toRetry = scope.filter((i) => i.status === "failed");
    dispatch({ type: "retryFailed", sourceId });
    // Re-run on the batch id the allowance was already spent on, flagged as a
    // retry so it costs neither a second allowance nor a second ad.
    if (toRetry.length > 0 && state.batchId) void runBatch(toRetry, null, state.batchId, true);
  };

  /** §15 — images only, source folders preserved. Loaded on tap. */
  const downloadZip = async () => {
    setZipping(true);
    setError(null);
    try {
      const [{ buildZip, extensionFor, safeEntryName, MAX_ZIP_BYTES }, { saveBlob }] = await Promise.all([
        import("./zip"),
        import("@/lib/client-download"),
      ]);
      const entries: Array<{ path: string; bytes: Uint8Array }> = [];
      let bytes = 0;
      for (const [sourceIndex, source] of state.sources.entries()) {
        const chosen = source.items.filter((i) => i.selected && i.directUrl);
        for (const [i, item] of chosen.entries()) {
          const res = await fetch(item.directUrl!);
          if (!res.ok) continue;
          const buf = new Uint8Array(await res.arrayBuffer());
          bytes += buf.length;
          if (bytes > MAX_ZIP_BYTES) throw new Error("TOO_BIG");
          entries.push({
            path: `Source ${sourceIndex + 1}/${safeEntryName(item.title, i, extensionFor(item.directUrl!, res.headers.get("content-type")))}`,
            bytes: buf,
          });
        }
      }
      if (entries.length === 0) throw new Error("EMPTY");
      saveBlob(buildZip(entries), `Frenzsave Batch (${entries.length} items).zip`);
      track("multilink_zip_downloaded", { items: entries.length });
    } catch (e) {
      setError(
        e instanceof Error && e.message === "TOO_BIG"
          ? "That selection is too large to zip. Download the items individually instead."
          : "We couldn't build the ZIP. You can still download the items individually.",
      );
    } finally {
      setZipping(false);
    }
  };

  const busyFetching = sources.some((s) => s.status === "fetching");
  const canDownload = selectedCount > 0 && !running && state.phase === "editing";

  return (
    <section
      aria-label="Batch download"
      className="animate-fade-up mt-3 rounded-2xl border border-border bg-card/60 p-3 shadow-soft ring-1 ring-inset ring-border/40 sm:p-4"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-extrabold text-foreground">
            <Layers aria-hidden className="h-4 w-4 text-primary" /> Batch Download
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add up to {policy.sourceLimit} sources and choose exactly what you want to download.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close batch download"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <PlanStrip policy={policy} />

      {/* ── Sources ────────────────────────────────────────────────────── */}
      <ul className="mt-3 space-y-2.5">
        {sources.map((source, i) => (
          <SourceCard
            key={source.id}
            source={source}
            index={i}
            disabled={running || state.phase === "authorizing" || state.phase === "awaiting-reward"}
            onChangeUrl={(url) => changeUrl(source.id, url)}
            onRemove={() => removeSource(source.id)}
            onFetch={() => doFetch(source.id)}
            onToggleItem={(itemId) => {
              dispatch({ type: "toggleItem", sourceId: source.id, itemId });
              track("multilink_post_selected", {});
            }}
            onSelectAll={(selected) => dispatch({ type: "setSourceSelection", sourceId: source.id, selected })}
            onDownloadSource={() => void authorizeAndStart(source.items.filter((i2) => i2.selected))}
            onRetrySource={() => retryFailed(source.id)}
          />
        ))}
      </ul>

      {/* ── Add / fetch all ────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addSource}
          disabled={running}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-dashed border-border px-4 text-sm font-semibold text-foreground transition hover:border-primary/50 hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> Add source
        </button>
        {filled.length > 1 ? (
          <button
            type="button"
            onClick={() => void fetchAll(sources)}
            disabled={busyFetching || running}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-secondary px-4 text-sm font-semibold text-foreground transition hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
          >
            {busyFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Fetch all
          </button>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {sources.length}/{policy.sourceLimit} sources
        </span>
      </div>

      {/* §21 — the upgrade nudge, shown only when a free member actually
          reaches the ceiling. Subtle, never a blocking interruption. */}
      {upsell && policy.plan === "free" ? (
        <div className="animate-fade-up mt-3 rounded-xl bg-gradient-to-r from-blue-600/10 to-violet-600/10 p-3 ring-1 ring-inset ring-violet-500/20">
          <p className="text-sm font-bold text-foreground">Need more sources?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{policy.upsellMessage}</p>
          <Link
            href="/pricing"
            onClick={() => track("multilink_upgrade_clicked", { from: "sources" })}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <Crown className="h-3.5 w-3.5" /> Upgrade to Pro
          </Link>
        </div>
      ) : null}

      {state.notice ? (
        <p role="status" className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          {state.notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-400">
          <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      ) : null}

      {/* ── Batch summary + primary action (§7, §13, §44) ──────────────── */}
      {total > 0 ? (
        <div className="mt-4 rounded-xl border border-border/70 bg-background/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-xs font-medium text-muted-foreground">
              {running || state.phase === "done" ? (
                <>
                  <span className="font-bold text-foreground">
                    {progress.done} of {progress.total}
                  </span>{" "}
                  completed
                  {progress.failed > 0 ? ` · ${progress.failed} failed` : ""}
                </>
              ) : (
                <>
                  {filled.length} {filled.length === 1 ? "source" : "sources"} ·{" "}
                  <span className="font-bold text-foreground">{total}</span>{" "}
                  {total === 1 ? "post" : "posts"} found ·{" "}
                  <span className="font-bold text-foreground">{selectedCount}</span> selected
                </>
              )}
            </p>
            {!running && state.phase !== "done" ? (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "setAllSelection", selected: selectedCount < total })}
                  className="text-xs font-semibold text-primary transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  {selectedCount < total ? "Select all" : "Deselect all"}
                </button>
              </div>
            ) : null}
          </div>

          {/* A real progress bar, only while there is real progress to show. */}
          {progress.total > 0 ? (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-label="Batch download progress"
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
          ) : null}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void authorizeAndStart(selectedItems(state))}
              disabled={!canDownload || outOfBatches}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 text-sm font-bold text-white shadow-lg transition hover:opacity-95 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-45 disabled:active:scale-100"
            >
              {state.phase === "authorizing" || state.phase === "awaiting-reward" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Preparing…
                </>
              ) : running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Downloading{" "}
                  {Math.min(progress.done + 1, progress.total)} of {progress.total}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" /> Download selected · {selectedCount}
                </>
              )}
            </button>

            {zipEligible(state) && !running ? (
              <button
                type="button"
                onClick={() => void downloadZip()}
                disabled={zipping}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-semibold text-foreground transition hover:bg-secondary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
                {zipping ? "Zipping…" : "Download as ZIP"}
              </button>
            ) : null}
          </div>

          {/* §12 — retry only what failed, never the whole batch. */}
          {hasFailures(state) && !running ? (
            <button
              type="button"
              onClick={() => retryFailed()}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:text-amber-400"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry {progress.failed} failed{" "}
              {progress.failed === 1 ? "item" : "items"}
            </button>
          ) : null}
        </div>
      ) : null}

      {/*
        The reward gate — the SAME component the single-link batch uses.

        It owns every ad decision: premium bypass, "the feature is switched
        off", "no creative loaded" (fails open), and the rule that the skip
        control stays hidden until the countdown reaches zero, so a resolved
        gate only ever means the ad ran in full.
      */}
      <BatchAdGate
        batch={pendingReward}
        onProceed={onGateResolved}
        showComplete={completeAd}
        onCompleteClosed={() => setCompleteAd(false)}
      />
    </section>
  );
}

/** §20 / §2 — the quota indicator, or the Pro badge that replaces it. */
function PlanStrip({ policy }: { policy: BatchPolicy }) {
  if (policy.plan !== "free") {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600/10 to-violet-600/10 px-2.5 py-1 text-xs font-bold text-foreground ring-1 ring-inset ring-violet-500/20">
        <Crown aria-hidden className="h-3.5 w-3.5 text-violet-500" /> PRO · Up to {policy.sourceLimit} sources
      </p>
    );
  }

  const remaining = policy.remaining ?? 0;
  if (remaining <= 0) {
    return (
      <div className="mt-2 rounded-xl bg-gradient-to-r from-blue-600/10 to-violet-600/10 p-3 ring-1 ring-inset ring-violet-500/20">
        <p className="text-sm font-bold text-foreground">Daily batch limit reached</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          You&apos;ve reached today&apos;s {policy.dailyLimit} free batch downloads. Upgrade to Pro for
          unlimited batch downloads.
        </p>
        <Link
          href="/pricing"
          onClick={() => track("multilink_upgrade_clicked", { from: "daily" })}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
        >
          <Crown className="h-3.5 w-3.5" /> Upgrade to Pro
        </Link>
      </div>
    );
  }

  return (
    <p className={cn("mt-2 text-xs font-medium text-muted-foreground")}>
      <span className="font-bold text-foreground">{remaining}</span>{" "}
      {remaining === 1 ? "batch download" : "batch downloads"} remaining today
    </p>
  );
}
