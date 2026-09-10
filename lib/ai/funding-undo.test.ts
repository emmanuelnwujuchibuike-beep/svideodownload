import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 EVERY UNDO PATH MUST ASK THE ROW HOW THE JOB WAS FUNDED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, standing rule §12: "Release/refund the reservation if the
 * job fails according to the defined failure policy… Never deduct money twice
 * because of retries."
 *
 * A job is funded one of two ways and undoing it differs for each:
 *
 *     free    → release_ai_usage   gives back a daily slot
 *     balance → refund_ai_charge   gives back money
 *
 * FOUR places undo a job, none of them present when the decision was made:
 * the start route's failure paths, the finalizer, the reconcile sweep and the
 * stall sweep. Calling the wrong one is expensive in a direction that is easy
 * to miss — `release_ai_usage` on a PAID job decrements `reserved_jobs`, which
 * on a member with another job running today takes the slot off THAT one and
 * silently creates a free video, on every paid failure.
 *
 * ── Why these are source assertions rather than behavioural tests ───────────
 *
 * The behaviour lives in Postgres functions and a service-role client; proving
 * it here would mean a live database. What CAN be proved without one — and what
 * actually regresses — is that no undo path reaches for `releaseAiUsage`
 * directly again. That is a one-line mistake a future edit makes by reflex, and
 * it is invisible until somebody audits a ledger.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Every file that ends a job and gives something back. */
const UNDO_SITES = [
  "app/api/ai/jobs/[id]/start/route.ts",
  "server/services/ai-finalize-service.ts",
  "lib/ai/reconcile.ts",
  "lib/ai/stall-server.ts",
];

describe("no undo path releases usage directly", () => {
  for (const file of UNDO_SITES) {
    it(`${file} goes through releaseJobFunding`, () => {
      const src = read(file);
      /*
        🔴 The import is the thing to catch. A call could be renamed or wrapped;
        an import of `releaseAiUsage` into one of these files is unambiguous —
        there is no legitimate reason for any of them to hold it once
        `releaseJobFunding` exists.
      */
      expect(src, `${file} imports releaseAiUsage`).not.toMatch(
        /import\s*\{[^}]*\breleaseAiUsage\b[^}]*\}\s*from/,
      );
      expect(src).toContain("releaseJobFunding");
    });
  }
});

describe("the funding decision is recorded on the row", () => {
  const start = read("app/api/ai/jobs/[id]/start/route.ts");

  /*
    🔴 Written IMMEDIATELY after the charge, not at the end of the request. The
    finalizer, reconcile and the stall sweep all run later and elsewhere; if the
    route failed between charging and recording, every one of them would read
    null and treat a paid job as free.
  */
  it("writes funding_source as soon as the charge succeeds", () => {
    expect(start).toContain("funding_source: funding.source");
    const chargeAt = start.indexOf("reserveJobFunding({");
    const recordAt = start.indexOf("funding_source: funding.source");
    expect(chargeAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(chargeAt);
    // …and before any of the work that can fail.
    expect(recordAt).toBeLessThan(start.indexOf("THE WORK BEGINS"));
  });

  it("records what was charged, and null rather than 0 for a free job", () => {
    // 0 could be mistaken for a bug or for a zero-priced charge; null says
    // "this cost nothing" unambiguously.
    expect(start).toContain("funding.chargedCents > 0 ? funding.chargedCents : null");
  });
});

describe("the undo reads the row rather than being told", () => {
  const funding = read("lib/ai/funding.ts");

  /*
    🔴 A NULL `funding_source` MUST BE TREATED AS FREE. Every row written before
    migration 0150 was funded by the daily allowance, so releasing a slot is
    exactly right for them. Treating null as paid would attempt a refund that
    finds no charge — harmless — but would SKIP the release those rows need,
    quietly costing real members a daily video on every historical failure.
  */
  it("falls back to the free branch, not the paid one", () => {
    const branch = funding.slice(funding.indexOf("export async function releaseJobFunding"));
    expect(branch).toContain('if (source === "balance")');
    // The free path is the fall-through, so a null lands there.
    expect(branch.indexOf("releaseAiUsage")).toBeGreaterThan(branch.indexOf("refundAiCharge"));
  });

  /*
    A paid job must NOT also release a daily slot. This is the specific bug the
    whole column exists to prevent, so the paid branch returns.
  */
  it("never does both for one job", () => {
    const branch = funding.slice(funding.indexOf("export async function releaseJobFunding"));
    const paidBranch = branch.slice(branch.indexOf('if (source === "balance")'));
    const returnAt = paidBranch.indexOf("return;");
    expect(returnAt).toBeGreaterThan(-1);
    expect(paidBranch.slice(0, returnAt)).not.toContain("releaseAiUsage");
  });
});

describe("free allowance is spent before money, always", () => {
  const funding = read("lib/ai/funding.ts");

  it("only reaches the charge after decideFunding chose balance", () => {
    const src = funding.slice(funding.indexOf("export async function reserveJobFunding"));
    const freeAt = src.indexOf('decision.source === "free"');
    const chargeAt = src.indexOf("chargeAiBalance");
    expect(freeAt).toBeGreaterThan(-1);
    expect(chargeAt).toBeGreaterThan(freeAt);
  });

  /*
    🔴 A LOST RACE ON THE DAILY SLOT REPORTS THE LIMIT — it does not silently
    fall through to charging. Somebody whose allowance ran out in the last
    millisecond should be told, not billed.
  */
  it("does not fall back to the paid path when the atomic reservation loses", () => {
    const src = funding.slice(funding.indexOf("export async function reserveJobFunding"));
    const notAllowed = src.slice(src.indexOf("if (!reservation.allowed)"));
    const returnAt = notAllowed.indexOf('reason: "daily_limit"');
    expect(returnAt).toBeGreaterThan(-1);
    expect(notAllowed.slice(0, returnAt)).not.toContain("chargeAiBalance");
  });
});
