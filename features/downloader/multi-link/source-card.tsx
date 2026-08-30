"use client";

import {
  AlertCircle,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { memo } from "react";

import { AdSurface } from "@/features/monetization/ad-surface";
import { cn, formatBytes } from "@/lib/utils";

import { sourceProgress, type BatchItem, type BatchSource } from "./state";

/**
 * ONE source, and everything it produced (§3, §4, §5, §6).
 *
 * `memo`'d on purpose: `batchReducer` returns every untouched source by
 * identity, so ticking a post in Source 1 re-renders exactly one card instead
 * of all six — which is what keeps §44's "update efficiently without causing
 * unnecessary component re-renders" true on a phone with three sources' worth
 * of thumbnails on screen.
 */

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function truncateUrl(url: string, max = 52): string {
  return url.length <= max ? url : `${url.slice(0, max - 1)}…`;
}

export const SourceCard = memo(function SourceCard({
  source,
  index,
  disabled,
  /**
   * §9 — "automatically focus the first input where appropriate".
   *
   * "Where appropriate" is doing real work: on a PHONE, focusing an input
   * raises the keyboard, which would cover the panel the visitor just opened
   * before they have seen it. So this is the desktop-only case, and the caller
   * decides — `autoFocus` is passed only for the first card, and only above
   * the coarse-pointer breakpoint.
   */
  autoFocus,
  onChangeUrl,
  onRemove,
  onFetch,
  onToggleItem,
  onSelectAll,
  onDownloadSource,
  onRetrySource,
}: {
  source: BatchSource;
  index: number;
  autoFocus?: boolean;
  /** True while a batch is running — the source list is frozen so the queue
   *  can't be edited out from under itself. */
  disabled: boolean;
  onChangeUrl: (url: string) => void;
  onRemove: () => void;
  onFetch: () => void;
  onToggleItem: (itemId: string) => void;
  onSelectAll: (selected: boolean) => void;
  onDownloadSource: () => void;
  onRetrySource: () => void;
}) {
  const label = `Source ${index + 1}`;
  const selected = source.items.filter((i) => i.selected).length;
  const progress = sourceProgress(source);
  const host = hostOf(source.url);
  const busy = source.status === "fetching";
  const hasResults = source.status === "ready" && source.items.length > 0;
  const inputId = `batch-source-${source.id}`;

  return (
    <li className="animate-fade-up rounded-2xl border border-border/70 bg-card p-3 shadow-soft sm:p-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-bold text-foreground">{label}</h4>
            {host ? (
              <span className="truncate rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {host}
              </span>
            ) : null}
          </div>
          {/*
            The status line, and the ONE place this card says what happened.

            `aria-live="polite"` because fetching is asynchronous and a screen
            reader would otherwise never learn that 7 posts appeared (§25).
            Every state carries an icon AND words — never colour alone (§25's
            last line), which is also why the error state is not simply red
            text.
          */}
          <p
            aria-live="polite"
            className={cn(
              "mt-0.5 flex items-center gap-1.5 text-xs",
              source.status === "error" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
            )}
          >
            {busy ? (
              <>
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> Fetching…
              </>
            ) : source.status === "error" ? (
              <>
                <AlertCircle aria-hidden className="h-3.5 w-3.5" />{" "}
                {source.error ?? "Couldn't fetch this source"}
              </>
            ) : hasResults ? (
              <>
                <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />{" "}
                {source.items.length} {source.items.length === 1 ? "post" : "posts"} found
                {selected > 0 ? ` · ${selected} selected` : ""}
              </>
            ) : (
              "Ready to fetch"
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${label}`}
          title="Remove"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40 dark:hover:text-rose-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* ── URL row ────────────────────────────────────────────────────── */}
      {hasResults ? (
        /* Once fetched, the URL is a compact record of WHERE these posts came
           from rather than an editable field — editing it would discard the
           results sitting underneath it. Copy stays; Edit is the ✕. */
        <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-secondary/50 px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={source.url}>
            {truncateUrl(source.url)}
          </span>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(source.url).catch(() => {})}
            aria-label={`Copy the ${label} link`}
            title="Copy link"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChangeUrl("")}
            disabled={disabled}
            aria-label={`Clear ${label} and paste a different link`}
            title="Use a different link"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <label htmlFor={inputId} className="sr-only">
              {label} link
            </label>
            <input
              id={inputId}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- desktop-only, first card only; see the prop doc.
              autoFocus={autoFocus}
              type="url"
              inputMode="url"
              autoComplete="off"
              value={source.url}
              disabled={disabled || busy}
              onChange={(e) => onChangeUrl(e.target.value)}
              onKeyDown={(e) => {
                // Enter fetches this source — the obvious meaning of pressing
                // Enter in a field with a Fetch button beside it, and the only
                // way to drive the card without reaching for a pointer (§25).
                if (e.key === "Enter" && source.url.trim()) {
                  e.preventDefault();
                  onFetch();
                }
              }}
              placeholder="Paste link…"
              className="h-12 w-full rounded-xl bg-background px-3 pr-11 text-sm text-foreground outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary disabled:opacity-60"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (text) onChangeUrl(text.trim());
                } catch {
                  /* clipboard blocked — the field is still typeable */
                }
              }}
              disabled={disabled || busy}
              aria-label={`Paste into ${label}`}
              title="Paste"
              className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
            >
              <ClipboardPaste className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={onFetch}
            disabled={disabled || busy || !source.url.trim()}
            /* h-12 on mobile = a comfortable 48px target (§23). */
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-45 disabled:active:scale-100 sm:px-6"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Fetching
              </>
            ) : source.status === "error" ? (
              <>
                <RefreshCw className="h-4 w-4" /> Retry
              </>
            ) : (
              <>
                <Search className="h-4 w-4" /> Fetch
              </>
            )}
          </button>
        </div>
      )}

      {/*
        The in-card placement (owner, 2026-08-30: "in the middle of each link
        card in multi link").

        The middle of a source card is the seam between the link it was given
        and the posts that link produced — so this sits after the URL row and
        before the results grid, which is where the card visually divides.

        Gated on `hasResults` on purpose: before a fetch the card is a single
        input row, and an ad inside it would be taller than the card it is
        "in the middle" of. It appears once there is a middle to be in.
      */}
      {hasResults ? (
        <div className="mt-3">
          <AdSurface zone="multilink_card_inline" maxWidth="max-w-none" />
        </div>
      ) : null}

      {/* ── Results, owned by THIS card ────────────────────────────────── */}
      {hasResults ? (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <button
              type="button"
              onClick={() => onSelectAll(selected < source.items.length)}
              disabled={disabled}
              className="text-xs font-semibold text-primary transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-40"
            >
              {selected < source.items.length ? "Select all" : "Deselect all"}
            </button>
            <span aria-hidden className="text-border">
              ·
            </span>
            <button
              type="button"
              onClick={onDownloadSource}
              disabled={disabled || selected === 0}
              className="text-xs font-semibold text-foreground transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-40"
            >
              Download source
            </button>
            {progress.failed > 0 ? (
              <>
                <span aria-hidden className="text-border">
                  ·
                </span>
                <button
                  type="button"
                  onClick={onRetrySource}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:text-amber-400"
                >
                  <RefreshCw className="h-3 w-3" /> Retry {progress.failed} failed
                </button>
              </>
            ) : null}
            {progress.total > 0 ? (
              <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">
                {progress.done}/{progress.total} done
                {progress.failed > 0 ? ` · ${progress.failed} failed` : ""}
              </span>
            ) : null}
          </div>

          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {source.items.map((item, i) => (
              <PostTile
                key={item.id}
                item={item}
                index={i}
                disabled={disabled}
                onToggle={() => onToggleItem(item.id)}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
});

const KIND_LABEL: Record<BatchItem["kind"], string> = {
  video: "Video",
  image: "Image",
  audio: "Audio",
};

function PostTile({
  item,
  index,
  disabled,
  onToggle,
}: {
  item: BatchItem;
  index: number;
  disabled: boolean;
  onToggle: () => void;
}) {
  const done = item.status === "done";
  const failed = item.status === "failed";
  const active = item.status === "queued" || item.status === "downloading";

  return (
    <li>
      {/*
        A real <button> with `aria-pressed`, not a div with an onClick.

        The tile IS the checkbox — tapping the thumbnail is what everyone
        expects on a phone — but that only reaches keyboard and screen-reader
        users if it is genuinely a control. `aria-pressed` is what announces
        "selected"/"not selected" rather than leaving the tick as a purely
        visual fact (§25: never communicate status by colour alone).
      */}
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={item.selected}
        aria-label={`${KIND_LABEL[item.kind]} ${index + 1}${item.filesize ? `, ${formatBytes(item.filesize)}` : ""}`}
        className={cn(
          "group relative block w-full overflow-hidden rounded-xl ring-1 ring-inset transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          item.selected ? "ring-2 ring-primary" : "ring-border/70 hover:ring-border",
          disabled ? "cursor-default opacity-90" : "active:scale-[0.98]",
        )}
      >
        <span className="relative block aspect-square bg-secondary">
          {item.thumbnail ? (
            /*
              A plain <img>, not next/image (§28).

              These are third-party CDN URLs from a dozen platforms that the
              image optimizer's `remotePatterns` cannot enumerate, and the file
              is a preview that already exists at the size the extractor gave
              us. `loading="lazy"` + `decoding="async"` keep a 20-tile grid off
              the main thread, and the fixed aspect-square box means the layout
              never shifts as they arrive (§28's last line).
            */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnail}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[11px] font-medium text-muted-foreground">
              {KIND_LABEL[item.kind]}
            </span>
          )}

          {/* Selection tick */}
          <span
            aria-hidden
            className={cn(
              "absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-md ring-1 transition",
              item.selected
                ? "bg-primary text-primary-foreground ring-primary"
                : "bg-background/80 text-transparent ring-border backdrop-blur-sm",
            )}
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>

          {/* Per-item download state (§5's "individual download state") */}
          {done || failed || active ? (
            <span
              className={cn(
                "absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 py-1 text-[10px] font-bold uppercase tracking-wide",
                done
                  ? "bg-emerald-600/90 text-white"
                  : failed
                    ? "bg-rose-600/90 text-white"
                    : "bg-foreground/80 text-background",
              )}
            >
              {done ? (
                <>
                  <Check className="h-3 w-3" strokeWidth={3} /> Saved
                </>
              ) : failed ? (
                <>
                  <AlertCircle className="h-3 w-3" /> Failed
                </>
              ) : (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />{" "}
                  {item.status === "queued" ? "Waiting" : "Saving"}
                </>
              )}
            </span>
          ) : null}
        </span>
      </button>

      <p className="mt-1 truncate px-0.5 text-[11px] text-muted-foreground">
        {KIND_LABEL[item.kind]}
        {item.filesize ? ` · ${formatBytes(item.filesize)}` : ""}
      </p>
    </li>
  );
}
