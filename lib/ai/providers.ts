import "server-only";

import { falProvider } from "@/lib/ai/fal/provider";
import { klingProvider } from "@/lib/ai/kling/provider";
import { hasProviderFor, providerFor, registerAiProvider } from "@/lib/ai/provider";
import { replicateProvider } from "@/lib/ai/replicate/provider";

/**
 * Where the adapters are plugged in.
 *
 * Part 2 declared the `AiProvider` seam and left the registry empty, because an
 * entry in it is a claim that something can run. Part 3 fills it with exactly
 * one adapter.
 *
 * ── Why registration lives in its own module ─────────────────────────────────
 *
 * `lib/ai/provider.ts` holds the interface and the registry. It cannot import
 * the Replicate adapter, because the adapter imports the interface — so
 * something has to do the wiring, and that something must be imported by every
 * caller or the registry is empty at exactly the moment it is read. One
 * server-only module, imported wherever a provider is needed, is the smallest
 * arrangement that cannot half-happen.
 *
 * The import has a side effect, which is usually worth avoiding. It is worth it
 * here: the alternative is every route remembering to register, and the failure
 * mode of forgetting is "the feature reports itself unavailable" — which looks
 * exactly like the honest answer and would be debugged for hours.
 */
registerAiProvider(replicateProvider);
/*
  2026-09-21 (the fal.ai brief): the second adapter. Registered for the paths
  that route by a job ROW's provider (reconcile, cancel, the stall sweep);
  new submissions choose between the two through lib/ai/providers/resolve.ts,
  never through this registry's feature default.
*/
registerAiProvider(falProvider);
/*
  2026-09-28 (the provider migration, Part 2): the direct Kling adapter, for
  the same paths as fal's — the reconciler, the stall sweep and the cancel
  route resolve an adapter from the job ROW's provider, and those must have an
  answer the day a Kling row first exists rather than one added beside it.

  🔴 Registering is NOT routing. `klingProvider.supports()` answers false for
  every feature, so `hasProviderFor` reports Kling as able to run nothing and
  `submitJobToProvider` refuses before any per-feature branch. Part 3 opens it
  one feature at a time.
*/
registerAiProvider(klingProvider);

export { hasProviderFor, providerFor };
