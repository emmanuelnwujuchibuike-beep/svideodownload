"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

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
