"use client";

import { Layers } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The "＋ Multiple Links" control — the ONLY part of the Multi-Link feature
 * that any first paint pays for.
 *
 * ── The two-part split is the performance requirement (§26, §48) ──────────
 * `dynamic(ssr:false)` alone does NOT keep a chunk out of a route's build
 * manifest — if the JSX is reached on the first render pass, the chunk is
 * listed and preloaded regardless. So the panel is BOTH dynamically imported
 * AND behind `open`, which starts false: the landing page's manifest never
 * lists it, and the module (with `BatchAdGate`, the reward-session hooks, the
 * ZIP writer and the source-card grid behind it) is fetched on the tap that
 * opens it, not before. That gate is load-bearing — the same lesson the
 * `chromeReady` flags in `downloader.tsx` encode. Keep it.
 *
 * Everything shipped on first load is this file: a button, one icon, and a
 * boolean.
 */
const MultiLinkPanel = dynamic(
  () => import("./multi-link-panel").then((m) => m.MultiLinkPanel),
  { ssr: false },
);

export function MultiLinkButton({
  /** Off = the admin switched the feature off; render nothing at all rather
   *  than a control that opens a panel which immediately refuses (§34's
   *  "Feature visibility"). Threaded from the server page that knows. */
  enabled = true,
  /** Matches `DownloadBox`'s own palette prop: "card" is the light download
   *  card, "hero" the white-on-gradient treatment. */
  surface = "card",
  className,
}: {
  enabled?: boolean;
  surface?: "hero" | "card";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!enabled) return null;

  return (
    <div className={className}>
      {/*
        A real toggle carrying `aria-expanded`/`aria-controls`, not a button
        that vanishes once the panel opens. A control that disappears leaves a
        keyboard user's focus on nothing, and a screen reader with no way to
        learn the panel it just opened is still there (§25).
      */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="multi-link-panel"
        className={cn(
            /*
              Secondary by design (§40: "noticeable but secondary"). The single
              paste field and its Download button stay the primary action —
              this sits under them as a quieter, bordered pill rather than a
              second filled CTA competing with the first.
            */
          "inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          surface === "hero"
            ? "border-white/25 bg-white/10 text-white hover:bg-white/20"
            : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-secondary/60",
          open && "border-primary/50 bg-secondary/60",
        )}
      >
        <Layers aria-hidden className="h-4 w-4" />
        {open ? "Hide multiple links" : (
          <>
            <span aria-hidden>＋</span> Multiple Links
          </>
        )}
      </button>

      <div id="multi-link-panel">
        {open ? <MultiLinkPanel onClose={() => setOpen(false)} /> : null}
      </div>
    </div>
  );
}
