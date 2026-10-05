import "server-only";

import { replacementRoutes } from "@/lib/ai/character-replace/providers/router";
import type { AiProvidersPanelProps } from "@/features/admin/ai-providers-settings";
import { vendorConfigured } from "@/lib/ai/providers/resolve";
import { compareProviderRuns, listProviderRuns, providerHealthFromRuns } from "@/lib/ai/providers/runs";
import type { LandingSettings } from "@/lib/landing/settings";

/** Everything the Providers tab shows, read once on the server (§20, §26). Booleans for credentials — never the values. */
export async function loadAiProvidersPanel(settings: LandingSettings): Promise<AiProvidersPanelProps> {
  /*
    ── 🔴 1,000 ROWS OVER 30 DAYS, ON EVERY ADMIN PAGE VIEW (2026-10-05) ─

    `FrenzAISection` awaits twelve loaders before it renders, and this was the
    heaviest of them — a thousand `ai_provider_runs` rows spanning a month,
    then a comparison computed across all of them, to paint a tab most admin
    visits never open. Worse, the providers it reports on (Replicate, fal) no
    longer execute anything: `supports()` returns false for every feature.

    So it was Supabase egress plus Fluid CPU plus Observability Events, per
    visit, for a table about two dead providers.

    Seven days at 200 rows keeps the health signal honest — these are hourly
    events at most, and a week is a longer window than an operator reads —
    while cutting the read by 5× and the comparison with it.

    ⚠️ The real fix is per-tab loading: the tab is CLIENT state
    (`AdminSubsections unmountInactive`), so the server cannot know which
    panel is open and fetches all twelve regardless. That is a Part 8 change
    to the subsection shell, not something to rush inside a cost pass.
  */
  const runs = await listProviderRuns(200, { days: 7 });
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
