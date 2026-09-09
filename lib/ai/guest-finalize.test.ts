import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { aiResultKey, aiSourceKey, pathBelongsTo } from "./storage";
import { guestSubject, subjectFromRow, subjectOwnerId, userSubject } from "./subject";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVERY ANONYMOUS JOB DIED ON THE LAST STEP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Observed in production 2026-09-08, on the owner's own guest run:
 *
 *   status         failed
 *   error_code     FINAL_UPLOAD_FAILED
 *   error_message  TypeError: Cannot read properties of null (reading 'toLowerCase')
 *   source_path    uitfsct5ouqgdhzas3uioa/aiclean/…/source.mp4   ← a GUEST id
 *   result_path    null
 *
 * The source uploaded under the guest's identifier and the model ran and was
 * paid for. Then `uploadFinalResult({ userId: job.user_id })` handed NULL to
 * `safeSegment`, which calls `.toLowerCase()` on it.
 *
 * ── 🔴 WHY NOTHING CAUGHT IT ────────────────────────────────────────────────
 *
 * Three separate omissions, each individually invisible:
 *
 *   1. `AiJobRow.user_id` was typed `string`, not `string | null`. Guest
 *      support added the column and the subject helpers and never revisited the
 *      interface — so passing it where a `string` was required COMPILED.
 *   2. `AiJobRow` had no `guest_id` field at all.
 *   3. `JOB_COLUMNS` did not SELECT `guest_id`, so even reading it would have
 *      returned undefined and `subjectFromRow` would have answered null.
 *
 * Together they made an anonymous job indistinguishable, to both TypeScript and
 * the finalizer, from a member job with a missing id. These tests pin all three
 * plus the behaviour, because fixing only the crash would leave the type free to
 * lie again.
 */

const GUEST_ID = "uitfsct5ouqgdhzas3uioa";
const USER_ID = "bb520a2e-4457-472e-bc7a-455d2547e85e";
const JOB_ID = "7b88ed00-5823-4e00-9ae5-b8a1d1a5aac4";

describe("the owner of a job row", () => {
  it("🔴 resolves for a guest row, whose user_id is null", () => {
    const subject = subjectFromRow({ user_id: null, guest_id: GUEST_ID });
    expect(subject).not.toBeNull();
    expect(subject?.kind).toBe("guest");
    expect(subjectOwnerId(subject!)).toBe(GUEST_ID);
  });

  it("resolves for a member row", () => {
    const subject = subjectFromRow({ user_id: USER_ID, guest_id: null });
    expect(subjectOwnerId(subject!)).toBe(USER_ID);
  });

  it("is null only when the row genuinely has neither", () => {
    // `ai_jobs_subject_chk` forbids this, so reaching it means the SELECT is
    // missing a column — which is exactly how the guest bug happened. The
    // finalizer's error text names JOB_COLUMNS for that reason.
    expect(subjectFromRow({ user_id: null, guest_id: null })).toBeNull();
  });
});

describe("storage keys for a guest", () => {
  it("🔴 builds a result key, where the old code threw", () => {
    const key = aiResultKey(subjectOwnerId(guestSubject(GUEST_ID)), "ai_clean", JOB_ID, "mp4");
    expect(key).toBe(`${GUEST_ID}/aiclean/${JOB_ID}/result.mp4`);
  });

  it("puts the result beside the source that already worked", () => {
    const owner = subjectOwnerId(guestSubject(GUEST_ID));
    const source = aiSourceKey(owner, "ai_clean", JOB_ID, "mp4");
    const result = aiResultKey(owner, "ai_clean", JOB_ID, "mp4");
    // The observed source_path proves the source half was always correct; the
    // result must land in the same folder or the download route cannot find it.
    expect(source.replace("source.mp4", "")).toBe(result.replace("result.mp4", ""));
  });

  it("🔴 passes the ownership check the upload runs against itself", () => {
    // uploadFinalResult refuses a key that fails this, so a guest key that
    // built successfully but failed here would still have blocked every job.
    const owner = subjectOwnerId(guestSubject(GUEST_ID));
    expect(pathBelongsTo(aiResultKey(owner, "ai_clean", JOB_ID, "mp4"), owner, JOB_ID)).toBe(true);
  });

  it("and the same key is what the download route will demand", () => {
    /*
      /api/ai/jobs/[id]/result checks `pathBelongsTo(job.result_path,
      subjectOwnerId(subject), job.id)` against the REQUESTING subject. So the
      finalizer must key off the same function, or a guest would be refused
      their own finished video.
    */
    const owner = subjectOwnerId(guestSubject(GUEST_ID));
    const stored = aiResultKey(owner, "ai_clean", JOB_ID, "mp4");
    expect(pathBelongsTo(stored, subjectOwnerId(guestSubject(GUEST_ID)), JOB_ID)).toBe(true);
    // …and emphatically not to somebody else's.
    expect(pathBelongsTo(stored, subjectOwnerId(userSubject(USER_ID)), JOB_ID)).toBe(false);
  });
});

describe("the three omissions that allowed it", () => {
  const jobsSrc = readFileSync(join(process.cwd(), "lib/ai/jobs.ts"), "utf8");
  const storeSrc = readFileSync(join(process.cwd(), "lib/ai/job-store.ts"), "utf8");
  const finalizeSrc = readFileSync(
    join(process.cwd(), "server/services/ai-finalize-service.ts"),
    "utf8",
  );

  it("🔴 AiJobRow.user_id is nullable", () => {
    expect(jobsSrc).toMatch(/user_id:\s*string\s*\|\s*null;/);
  });

  it("🔴 AiJobRow declares guest_id", () => {
    expect(jobsSrc).toMatch(/guest_id:\s*string\s*\|\s*null;/);
  });

  it("🔴 JOB_COLUMNS selects guest_id", () => {
    /*
      A column that exists in Postgres but is absent from this string is
      invisible to every service-role read — the shape of bug that cost a whole
      feature for anonymous visitors. Adding a column is not finished until it
      is here.
    */
    const decl = storeSrc.match(/const JOB_COLUMNS\s*=\s*\n?\s*"([^"]+)"/);
    const columns = (decl?.[1] ?? "").split(",").map((c) => c.trim());
    expect(columns, "JOB_COLUMNS").toContain("guest_id");
    expect(columns).toContain("user_id");
  });

  it("🔴 the finalizer uploads under the SUBJECT's id, never job.user_id", () => {
    expect(finalizeSrc).toContain("const owner = subjectFromRow(job);");
    expect(finalizeSrc).toContain("const ownerId = subjectOwnerId(owner);");
    expect(finalizeSrc).toContain("ownerId,");
    // The exact call that crashed. It must not come back.
    expect(finalizeSrc).not.toContain("userId: job.user_id");
  });

  it("resolves the owner BEFORE the claim, so a broken row costs no work", () => {
    // Downloading and muxing a video only to fail on a key we could have
    // rejected up front is provider money spent to reach the same error.
    const resolved = finalizeSrc.indexOf("const owner = subjectFromRow(job);");
    const claim = finalizeSrc.indexOf('transitionJob(jobId, ["processing"], "finalizing")');
    expect(resolved).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(-1);
    expect(resolved).toBeLessThan(claim);
  });
});
