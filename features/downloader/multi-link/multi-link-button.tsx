"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import {
  DEFAULT_MULTI_LINK_PUBLIC,
  type BatchPolicy,
  type MultiLinkPublicConfig,
} from "@/lib/downloads/multi-link-config";

import { MultiLinkIntro } from "./multi-link-intro";

/**
 * The Multi-Link entry point — the intro copy, the collapsed card, and the
 * lazy mount of everything behind it.
 *
 * ── The two-part split is the performance requirement (§13) ───────────────
 * `dynamic(ssr:false)` alone does NOT keep a chunk out of a route's build
 * manifest — if the JSX is reached on the first render pass, the chunk is
 * listed and preloaded regardless. So the panel is BOTH dynamically imported
 * AND behind `open`, which starts false: the landing page's manifest never
 * lists it, and the module (with `BatchAdGate`, the reward hooks, the ZIP
 * writer and the source-card grid behind it) is fetched on the tap that opens
 * it. That gate is load-bearing — keep it.
 *
 * What DOES ship on first load is this file plus `multi-link-intro.tsx`: text,
 * two icons, a border, and a boolean. No fetch, no animation library.
 *
 * ── Why the plan comes from two different places ──────────────────────────
 * The SOURCE LIMIT is admin-configurable and not per-visitor, so it arrives as
 * a server-threaded prop — accurate, and free. WHICH plan the visitor is on
 * comes from `useEntitlements`, which the download box on this page has
 * already fetched and memoised process-wide, so it costs nothing either.
 *
 * The DAILY ALLOWANCE is not drawn here at all any more (owner, 2026-08-25:
 * "put the batch remaining to show after the plus multi link button is
 * clicked") — it lives in the opened panel. That is also the last thing the
 * COLLAPSED card needed per-visitor data for, so nothing on a cold landing
 * visit now waits on `/api/downloads/batch/policy`, which is a per-visitor,
 * uncacheable round trip the 1.6-second budget refuses. The policy is still
 * lifted up here once the panel opens, because the source LIMIT can differ
 * from the optimistic guess below.
 */
const MultiLinkPanel = dynamic(
  () => import("./multi-link-panel").then((m) => m.MultiLinkPanel),
  { ssr: false },
);

export function MultiLinkButton({
  /** Admin settings, resolved on the server page. */
  config = DEFAULT_MULTI_LINK_PUBLIC,
  /** Matches `DownloadBox`'s own palette prop. */
  surface = "card",
  className,
}: {
  config?: MultiLinkPublicConfig;
  surface?: "hero" | "card";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  /** Lifted out of the panel so the collapsed card can show the allowance
   *  after the first open, without ever fetching to draw the closed state. */
  const [policy, setPolicy] = useState<BatchPolicy | null>(null);
  const { plan, ready } = useEntitlements();

  /*
    ═══════════════════════════════════════════════════════════════════════════
     WARM THE PANEL CHUNK, WITHOUT PUTTING IT IN FIRST-LOAD JS
    ═══════════════════════════════════════════════════════════════════════════

    Owner, 2026-08-25: "multi link button should always prefetch immediately the
    landing or download page opens, so it doesnt take a bit to open when
    clicked."

    🔴 THE `open=false` JSX GATE BELOW STAYS. It is not redundant with this, and
    removing it would undo the thing that protects the landing budget:
    `dynamic(ssr:false)` alone does NOT keep a chunk out of a route's build
    manifest — if the JSX is REACHED during the render pass, Next lists and
    preloads it as first-load JS. That is why the panel (with BatchAdGate, the
    reward hooks, the ZIP writer and the source-card grid behind it) is both
    dynamically imported AND gated.

    A bare `import()` from an effect is a different mechanism entirely: it is
    not part of any render pass, so the chunk stays out of the manifest and off
    the first-load number, and it simply arrives in the background. By the time
    a visitor reads the card and taps it, the module is already in memory and
    the panel opens in the same frame.

    ── Idle, not immediate ────────────────────────────────────────────────────
    "Immediately" is taken as "without waiting for the tap", NOT "during
    hydration". Firing this on mount would put a network request in direct
    competition with the LCP element on the page whose budget is 1.6 seconds —
    which would trade a fast panel for a slow landing, the wrong way round.
    `requestIdleCallback` waits for the browser to be genuinely free; the
    `timeout` guarantees it still happens on a page that never goes idle, and
    the `setTimeout` branch covers Safari, which has no rIC.
  */
  useEffect(() => {
    if (!config.enabled) return;
    const warm = () => {
      void import("./multi-link-panel");
    };
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(warm, { timeout: 2500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(id);
  }, [config.enabled]);

  if (!config.enabled) return null;

  // Optimistic-free until entitlements resolve: drawing six slots for a free
  // member and then refusing the batch after they filled them is a far worse
  // surprise than a limit that goes UP a moment after load.
  const isPro = ready && plan !== "free";
  const sourceLimit = policy?.sourceLimit ?? (isPro ? config.proSourceLimit : config.freeSourceLimit);

  return (
    <div className={className}>
      <MultiLinkIntro
        open={open}
        onToggle={() => setOpen((v) => !v)}
        sourceLimit={sourceLimit}
        isPro={isPro}
        surface={surface}
      />

      <div id="multi-link-panel">
        {open ? <MultiLinkPanel onClose={() => setOpen(false)} onPolicy={setPolicy} /> : null}
      </div>
    </div>
  );
}
