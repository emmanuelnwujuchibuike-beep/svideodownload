import "server-only";

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

export { hasProviderFor, providerFor };
