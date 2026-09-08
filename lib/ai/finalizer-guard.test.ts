import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVERY INTERNAL WORKER ROUTE MUST REFUSE THE SAME WAY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 THE REGRESSION THIS EXISTS TO STOP — and it is not hypothetical.
 *
 * `/api/internal/ai/finalize` shipped with its guard inverted:
 *
 *     if (!WORKER_SECRET || header !== WORKER_SECRET) → 403
 *
 * while every other internal route on the same worker reads:
 *
 *     if (WORKER_SECRET && header !== WORKER_SECRET) → 403
 *
 * The difference only shows when the worker has NO secret configured. Then the
 * download path keeps working and the AI finalizer refuses every request,
 * forever — which is precisely what happened. Measured on production
 * 2026-09-08, across all 17 AI jobs ever created:
 *
 *     completed .......... 0
 *     result_path ........ 0
 *     ever reached `finalizing` .. 0
 *
 * `finalizing` is the status only that route's service sets, so zero is the
 * signature of a handoff that has never once landed. The provider had genuinely
 * succeeded; one job even carried `provider_output_url` in its metadata and was
 * still failed hours later with "succeeded with no usable output", by which time
 * Replicate had expired the file.
 *
 * A source-level test because this is not behaviour a unit test reaches: the
 * bug lives in one boolean, in a route that only ever runs on the worker, and
 * it fails silently by design. Reading the source is what catches it.
 */

const ROOT = process.cwd();

const INTERNAL_ROUTES = [
  "app/api/internal/ai/finalize/route.ts",
  "app/api/internal/store-media/route.ts",
];

describe("internal worker routes", () => {
  it.each(INTERNAL_ROUTES)("%s does not refuse when no secret is configured", (rel) => {
    const src = readFileSync(join(ROOT, rel), "utf8");

    /*
      The inverted form, in the shapes it could plausibly be rewritten as. A
      route may only deny when a secret IS set — otherwise an unconfigured
      worker silently loses the whole feature and the symptom appears nowhere
      near the cause.
    */
    expect(src).not.toMatch(/if\s*\(\s*!\s*WORKER_SECRET\s*\|\|/);
    expect(src).not.toMatch(/if\s*\(\s*WORKER_SECRET\s*===\s*""\s*\|\|/);
    expect(src).not.toMatch(/if\s*\(\s*!\s*WORKER_SECRET\s*\)\s*\{?\s*return[^\n]*40[13]/);
  });

  it("the AI finalizer guards on a CONFIGURED secret, like the others", () => {
    const src = readFileSync(join(ROOT, "app/api/internal/ai/finalize/route.ts"), "utf8");
    // The positive form: enforce only when there is something to enforce.
    expect(src).toMatch(/if\s*\(\s*WORKER_SECRET\s*&&\s*request\.headers\.get\(/);
  });

  it("says so out loud when it is running unauthenticated", () => {
    // Accepting an unsecured endpoint is a deliberate trade (refusing broke the
    // feature completely and invisibly). It must not also be silent.
    const src = readFileSync(join(ROOT, "app/api/internal/ai/finalize/route.ts"), "utf8");
    expect(src).toMatch(/console\.warn\(/);
    expect(src).toMatch(/WORKER_SECRET/);
  });
});

describe("a refused handoff is permanent, and must end the job", () => {
  it("dispatch distinguishes a refusal from a transient failure", () => {
    const src = readFileSync(join(ROOT, "lib/ai/finalize-dispatch.ts"), "utf8");
    expect(src).toMatch(/reason:\s*"refused"/);
    // 401/403/404 cannot improve on a retry and must be reported as such.
    for (const code of ["401", "403", "404"]) expect(src).toContain(code);
  });

  it.each([
    ["app/api/ai/replicate/webhook/route.ts", "the webhook"],
    ["lib/ai/reconcile.ts", "the reconciler"],
  ])("%s ends the job on a refusal rather than orphaning it", (rel) => {
    const src = readFileSync(join(ROOT, rel), "utf8");
    expect(src).toContain('reason === "refused"');
    expect(src).toContain("FINALIZER_UNAVAILABLE");
  });
});
