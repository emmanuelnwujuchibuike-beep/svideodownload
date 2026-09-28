import "server-only";

import { replacementRoutes } from "@/lib/ai/character-replace/providers/router";
import type { AiProvidersPanelProps } from "@/features/admin/ai-providers-settings";
import { vendorConfigured } from "@/lib/ai/providers/resolve";
import { compareProviderRuns, listProviderRuns, providerHealthFromRuns } from "@/lib/ai/providers/runs";
import type { LandingSettings } from "@/lib/landing/settings";

/** Everything the Providers tab shows, read once on the server (§20, §26). Booleans for credentials — never the values. */
export async function loadAiProvidersPanel(settings: LandingSettings): Promise<AiProvidersPanelProps> {
  const runs = await listProviderRuns(1000, { days: 30 });
  /*
    2026-09-28: `kling` is present because `AiVendor` now includes it, NOT
    because the panel shows it. `providerHealthFromRuns` still walks
    ["replicate","fal","elevenlabs"], so the Providers tab renders exactly the
    three rows it rendered yesterday — Part 2 adds no admin UI (§34).
  */
  const credentials = { replicate: vendorConfigured("replicate"), fal: vendorConfigured("fal"), elevenlabs: vendorConfigured("elevenlabs"), kling: vendorConfigured("kling") };
  return {
    config: settings.frenzAiProviders,
    credentials,
    health: providerHealthFromRuns(runs, credentials),
    comparison: compareProviderRuns(runs),
    replicateRoutes: replacementRoutes(settings.frenzAiCharacterReplace).map((r) => ({ mode: r.mode, model: r.model, routed: r.routed, configured: r.configured })),
  };
}
