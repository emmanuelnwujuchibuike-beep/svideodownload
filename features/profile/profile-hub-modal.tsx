"use client";

import { useEffect, useState } from "react";

import { ProfileHubPanel } from "@/features/profile/profile-hub-panels";
import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { LoadingStripe } from "@/features/ui/page-loader";
import { HUB_META, type HubKey } from "@/lib/profile/hub";
import { peekHubSection, readHubSection } from "@/lib/profile/hub-client";
import type { HubPayload } from "@/lib/profile/hub-data";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE HUB MODAL — one section at a time, on the app's own premium sheet
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Opens the instant a button is pressed, with whatever the device already
 * holds. A section that was prefetched as it scrolled into view paints on
 * the first frame; one that was not shows the strip loader across the top of
 * the sheet (owner: "any that haven't cached or prefetched should show a
 * strip loader") until its read lands — the same stripe every page of the
 * app loads behind, so it reads as the app working rather than a modal
 * broken.
 *
 * `GlassSheetShell` is the sheet every premium surface here uses (the AI
 * recharge, the profile menu), so the hub opens and dismisses exactly like
 * them: drag to close, backdrop tap, the same glass.
 */
export function ProfileHubModal({ handle, open, onClose }: { handle: string; open: HubKey | null; onClose: () => void }) {
  const [shown, setShown] = useState<HubKey | null>(open);
  const [state, setState] = useState<{ key: HubKey; payload: HubPayload | null | "loading" } | null>(null);

  // Keep the last section on screen while the sheet animates closed.
  useEffect(() => {
    if (open) setShown(open);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const known = peekHubSection(handle, open);
    if (known) {
      setState({ key: open, payload: known });
      return;
    }
    let cancelled = false;
    setState({ key: open, payload: "loading" });
    void readHubSection(handle, open).then((payload) => {
      if (!cancelled) setState({ key: open, payload });
    });
    return () => {
      cancelled = true;
    };
  }, [handle, open]);

  const key = open ?? shown;
  const meta = key ? HUB_META[key] : null;
  const current = state && state.key === key ? state : null;
  const loading = !current || current.payload === "loading";

  return (
    <GlassSheetShell open={open !== null} onClose={onClose} title={meta?.label ?? ""} defaultHeightVh={82}>
      {loading ? <LoadingStripe /> : <div aria-hidden style={{ height: 2 }} />}
      <div className="px-4 pb-8 pt-3 sm:px-5">
        {key && current && current.payload !== "loading" ? (
          current.payload ? (
            <ProfileHubPanel handle={handle} payload={current.payload} />
          ) : (
            <p className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
              This section couldn&apos;t be loaded. Pull down to close and try again.
            </p>
          )
        ) : (
          <div aria-busy="true" className="space-y-3">
            <div className="h-5 w-2/5 animate-pulse rounded-lg bg-secondary" />
            <div className="h-24 animate-pulse rounded-2xl bg-secondary" />
            <div className="h-24 animate-pulse rounded-2xl bg-secondary" />
          </div>
        )}
      </div>
    </GlassSheetShell>
  );
}
