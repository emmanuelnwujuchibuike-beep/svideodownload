/**
 * Moved to `features/ai/core/use-job-watch.ts` on 2026-09-27.
 *
 * Owner: "character replace should work alone." Polling a job by id is what
 * EVERY tool does — it was never Character Replace's. This re-export keeps the
 * existing importers working unchanged.
 */
export { useJobWatch } from "@/features/ai/core/use-job-watch";
