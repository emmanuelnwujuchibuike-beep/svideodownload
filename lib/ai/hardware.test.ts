import { describe, expect, it } from "vitest";

import { AI_AUDIENCES, type AiAudience } from "@/lib/ai/audience";
import { aiCleanGpuOffered, audienceGetsGpu, hardwareFor } from "@/lib/ai/hardware";

/**
 * Owner, 2026-09-09: "pro users and business users and any higher plan yet to
 * come to use gpu while free use cpu."
 *
 * The third clause is the one with teeth, and the last test in the first block
 * is what keeps it true.
 */

describe("who is entitled to GPU", () => {
  it("gives it to pro, business and max_ai", () => {
    for (const a of ["pro", "business", "max_ai"] as AiAudience[]) {
      expect(audienceGetsGpu(a), a).toBe(true);
    }
  });

  it("does NOT give it to free or guest", () => {
    for (const a of ["guest", "free"] as AiAudience[]) {
      expect(audienceGetsGpu(a), a).toBe(false);
    }
  });

  /*
    🔴 "AND ANY HIGHER PLAN YET TO COME."

    The rule is an index comparison against `pro` in the ascending
    `AI_AUDIENCES` list, not a hard-coded set of names. This asserts the
    PROPERTY rather than today's three tiers: everything ranked at or above
    `pro` gets GPU, so a tier appended above them tomorrow is covered without
    anybody editing lib/ai/hardware.ts.

    Written as a loop over the real list on purpose — a test that named the same
    three plans would go stale in exactly the same way the bug would.
  */
  it("covers every audience at or above pro, whatever is added later", () => {
    const floor = AI_AUDIENCES.indexOf("pro");
    expect(floor).toBeGreaterThan(-1);
    AI_AUDIENCES.forEach((audience, i) => {
      expect(audienceGetsGpu(audience), `${audience} at rank ${i}`).toBe(i >= floor);
    });
  });

  it("treats an unknown audience as the LEAST privileged, never the most", () => {
    expect(audienceGetsGpu("enterprise_plus" as AiAudience)).toBe(false);
  });
});

describe("what a job actually runs on", () => {
  /*
    🔴 THE FAIL-DOWN. The GPU model does not exist yet — the version published
    2026-09-08 was disabled by Replicate. Until one is configured, an entitled
    member must still get a video, just on the slower hardware.
  */
  it("is CPU for EVERYONE when no GPU model is configured", () => {
    for (const a of AI_AUDIENCES) {
      expect(hardwareFor(a, { gpuConfigured: false }), a).toBe("cpu");
    }
  });

  it("routes paid tiers to GPU once one is configured", () => {
    expect(hardwareFor("pro", { gpuConfigured: true })).toBe("gpu");
    expect(hardwareFor("business", { gpuConfigured: true })).toBe("gpu");
    expect(hardwareFor("max_ai", { gpuConfigured: true })).toBe("gpu");
  });

  it("keeps free and guest on CPU even when one is configured", () => {
    expect(hardwareFor("free", { gpuConfigured: true })).toBe("cpu");
    expect(hardwareFor("guest", { gpuConfigured: true })).toBe("cpu");
  });
});

describe("the entitlement view carries both facts", () => {
  /*
    🔴 `gpuAccelerated` is about THIS member; `gpuOffered` is about the
    deployment. Conflating them is the bug that would put "faster on Pro" in
    front of nobody: a FREE member is never accelerated, and they are exactly
    who that line is written for.
  */
  it("separates what a member gets from what the product offers", () => {
    expect(hardwareFor("free", { gpuConfigured: true })).toBe("cpu");
    expect(aiCleanGpuOffered({ gpuConfigured: true })).toBe(true);
  });
});

describe("what may be SAID about it", () => {
  /*
    🔴 The honesty gate, and it is deliberately separate from entitlement.

    A paid tier is entitled to GPU whether or not one is deployed. The CLAIM
    may only appear when there is a model behind it — selling a speed tier that
    does not exist is the one promise a member can check in a minute and find
    false, and it would be the first thing they blamed when a Pro job took just
    as long as a free one.
  */
  it("says nothing about faster processing until a GPU model exists", () => {
    expect(aiCleanGpuOffered({ gpuConfigured: false })).toBe(false);
    expect(aiCleanGpuOffered({ gpuConfigured: true })).toBe(true);
  });
});
