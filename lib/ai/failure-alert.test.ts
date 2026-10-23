import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { failureLines } from "./failure-alert";

const job = { id: "job-1", feature: "ai_person_replace", model: "kling-omni", error_code: "PROVIDER_ERROR", charged_cents: 120, funding_source: "balance", created_at: "2026-10-23T10:00:00Z" } as const;

describe("failed AI jobs email the admins (owner, 2026-10-23)", () => {
  it("the email carries the reason and the member who ran it", () => {
    const lines = failureLines(job, "face not found in the reference", "Ada (@ada) <ada@example.com> · id u1").join("\n");
    expect(lines).toContain("Reason: PROVIDER_ERROR — face not found in the reference");
    expect(lines).toContain("Member: Ada (@ada) <ada@example.com>");
    expect(lines).toContain("Job: job-1");
  });

  it("is wired into the one door every failure goes through, once per job", () => {
    const store = readFileSync("lib/ai/job-store.ts", "utf8");
    const body = store.slice(store.indexOf("export async function transitionJob("));
    expect(body.slice(0, body.indexOf("\n}\n"))).toContain('to === "failed" && from.some((s) => s !== "failed")');
    expect(readFileSync("lib/ai/failure-alert.ts", "utf8")).toContain("key: `ai_job_failed:${job.id}`");
  });

  it("teeth: no other code writes an ai_jobs row to failed behind its back", () => {
    // a direct `.from("ai_jobs").update({ status: "failed" ...` would skip the email
    const offenders = ["lib/ai/stall-server.ts", "lib/ai/recovery.ts", "lib/ai/reconcile.ts", "lib/ai/character-replace/queue.ts"].filter((f) =>
      /from\("ai_jobs"\)\s*\.update\(\{\s*status:\s*"failed"/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
