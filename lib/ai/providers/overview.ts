import "server-only";

import { aiFeature, isActiveStatus, type AiJobStatus } from "@/lib/ai/jobs";
import { KLING_RUNNABLE_FEATURES } from "@/lib/ai/kling/pipelines/registry";
import { vendorConfigured } from "@/lib/ai/providers/resolve";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADMIN → AI → PROVIDERS: what actually runs (Part 8 §2, §4, §8, §9, §14, §64)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Replaces the Replicate / fal.ai switchboard (2026-10-05). The production
 * architecture is fixed in code, not chosen in a dropdown:
 *
 *   Video   → Kling       (text-to-video, image-to-video, lip sync — each its
 *                          own pipeline, KLING_RUNNABLE_FEATURES)
 *   Audio   → ElevenLabs  (text-to-audio, voice cloning — the direct API)
 *
 * Health comes from `ai_jobs`, where these jobs really are recorded. The old
 * panel read `ai_provider_runs`, which holds 8 rows (all Replicate / fal, last
 * one 2026-09-22): Kling and ElevenLabs jobs never write there, so it could
 * only ever have reported "no runs" for the providers that run everything.
 *
 * One bounded query (7 days, ≤ 500 rows) — the read the old panel replaced
 * was three loaders plus 200 provider-run rows.
 */

export type OverviewVendor = "kling" | "elevenlabs";

export interface OverviewFeature {
  id: string;
  label: string;
  vendor: OverviewVendor;
  pipeline: string;
}

/** Every live tool, its provider and its pipeline — derived from the registries. */
export function overviewFeatures(): OverviewFeature[] {
  const kling: OverviewFeature[] = KLING_RUNNABLE_FEATURES.map((p) => {
    const id = `ai_${p}`;
    return { id, label: aiFeature(id)?.label ?? p, vendor: "kling", pipeline: `Kling ${p.replace(/_/g, "-")}` };
  });
  const audio: OverviewFeature[] = [
    { id: "ai_text_to_audio", label: aiFeature("ai_text_to_audio")?.label ?? "Text to Audio", vendor: "elevenlabs", pipeline: "ElevenLabs text-to-speech (direct API)" },
    { id: "ai_voice_clone", label: aiFeature("ai_voice_clone")?.label ?? "Voice Cloning", vendor: "elevenlabs", pipeline: "ElevenLabs voice cloning (direct API)" },
  ];
  return [...kling, ...audio];
}

export interface JobRow {
  feature: string;
  status: string;
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface FeatureHealth extends OverviewFeature {
  completed: number;
  failed: number;
  inFlight: number;
  lastSuccessAt: string | null;
  lastFailure: { code: string | null; at: string } | null;
  /** Most frequent failure code in the window (§39: grouped, not listed). */
  topFailure: { code: string; count: number } | null;
  /** healthy · degraded · unavailable · unknown (§9) — never green on no data. */
  state: "healthy" | "degraded" | "unavailable" | "unknown";
}

// In-flight is ASKED, never hand-listed (the standing rule — a hand-written
// status list drifts the day a status is added).
const isFailed = (status: string) => status === "failed";

export function summarizeFeatureHealth(features: OverviewFeature[], rows: readonly JobRow[], configured: Record<OverviewVendor, boolean>): FeatureHealth[] {
  return features.map((f) => {
    const mine = rows.filter((r) => r.feature === f.id);
    const ok = mine.filter((r) => r.status === "completed");
    const bad = mine.filter((r) => isFailed(r.status));
    const latest = (xs: JobRow[]) => xs.map((r) => r.completed_at ?? r.created_at).sort().at(-1) ?? null;
    const lastBad = [...bad].sort((a, b) => (a.completed_at ?? a.created_at).localeCompare(b.completed_at ?? b.created_at)).at(-1);
    const codes = new Map<string, number>();
    for (const r of bad) codes.set(r.error_code ?? "unknown", (codes.get(r.error_code ?? "unknown") ?? 0) + 1);
    const top = [...codes.entries()].sort((a, b) => b[1] - a[1])[0];
    const done = ok.length + bad.length;
    const state: FeatureHealth["state"] = !configured[f.vendor]
      ? "unavailable"
      : done === 0
        ? "unknown"
        : bad.length / done > 0.25
          ? "degraded"
          : "healthy";
    return {
      ...f,
      completed: ok.length,
      failed: bad.length,
      inFlight: mine.filter((r) => isActiveStatus(r.status as AiJobStatus)).length,
      lastSuccessAt: latest(ok),
      lastFailure: lastBad ? { code: lastBad.error_code, at: lastBad.completed_at ?? lastBad.created_at } : null,
      topFailure: top ? { code: top[0], count: top[1] } : null,
      state,
    };
  });
}

export interface AiProviderOverview {
  configured: Record<OverviewVendor, boolean>;
  features: FeatureHealth[];
  windowDays: number;
  /** True when the read failed — the panel says so instead of showing zeros. */
  unreadable: boolean;
  adminJobsAreTests: boolean;
}

const WINDOW_DAYS = 7;

export async function loadAiProviderOverview(adminJobsAreTests: boolean): Promise<AiProviderOverview> {
  const configured = { kling: vendorConfigured("kling"), elevenlabs: vendorConfigured("elevenlabs") };
  const features = overviewFeatures();
  let rows: JobRow[] = [];
  let unreadable = false;
  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    const { data, error } = await createAdminClient()
      .from("ai_jobs")
      .select("feature, status, error_code, created_at, completed_at")
      .in("feature", features.map((f) => f.id))
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) unreadable = true;
    rows = (data ?? []) as JobRow[];
  } catch {
    unreadable = true;
  }
  return { configured, features: summarizeFeatureHealth(features, rows, configured), windowDays: WINDOW_DAYS, unreadable, adminJobsAreTests };
}
