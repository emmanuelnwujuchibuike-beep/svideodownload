"use client";

import { Gauge } from "lucide-react";
import { useEffect, useState } from "react";

import {
  getQualityPreference,
  QUALITY_LABELS,
  setQualityPreference,
  type QualityPreference,
} from "@/lib/media/network-conditions";

import { SettingsRow } from "./settings-ui";

const OPTIONS: QualityPreference[] = ["auto", "data-saver", "balanced", "high"];

/**
 * A discoverable home for the video-quality preference that already drives
 * every Feed and Reels player (lib/media/engine/governor.ts).
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * The preference itself, and the whole adaptive engine that reads it, already
 * existed — this control had ONE entry point: a tap-to-cycle button inside the
 * Reels player. A Feed-only viewer, or anyone who simply doesn't know Reels
 * has an overflow sheet, had no way to reach it despite the setting being
 * global (one localStorage key every player reads at attach time). This is
 * that missing entry point, reusing the exact mechanism — no new streaming
 * logic, no second source of truth.
 *
 * A native `<select>` rather than a segmented control: four clearly-worded
 * options read better as a dropdown than as an icon row (matches the existing
 * `<select>` pattern in notification-settings-editor.tsx), and unlike the
 * in-player control there is no "next tap" to cycle toward — the visible list
 * of choices IS the settings idiom the rest of this page uses.
 *
 * `mounted` guard: `getQualityPreference()` reads localStorage, which does not
 * exist during SSR — rendering the real value on the server risks a hydration
 * mismatch if the client's stored preference differs from the "auto" default
 * the server would have to guess. Same pattern `ThemeToggle` already uses.
 */
export function VideoQualitySetting() {
  const [pref, setPref] = useState<QualityPreference>("auto");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPref(getQualityPreference());
    setMounted(true);
  }, []);

  return (
    <SettingsRow
      icon={Gauge}
      tint="blue"
      title="Video quality"
      description="Applies to Feed and Reels. Changes take effect from your next video."
      right={
        <select
          value={pref}
          disabled={!mounted}
          onChange={(e) => {
            const next = e.target.value as QualityPreference;
            setPref(next);
            setQualityPreference(next);
          }}
          aria-label="Video quality"
          className="rounded-lg border border-border/60 bg-background px-2 py-1.5 text-sm font-medium text-foreground disabled:opacity-60"
        >
          {OPTIONS.map((o) => (
            <option key={o} value={o}>
              {QUALITY_LABELS[o]}
            </option>
          ))}
        </select>
      }
    />
  );
}
