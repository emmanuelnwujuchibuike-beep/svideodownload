import { describe, expect, it } from "vitest";

import type { AiCleanStage } from "./job-stages";
import { PRESENCE, presenceFor, presenceSpec, presenceVars, type PresenceLevel } from "./presence";

/**
 * The environment's sense of being alive.
 *
 * Two of these are not about aesthetics at all — the reduced-motion one and the
 * hidden-tab one. They guard a preference and a battery, and both are the kind
 * of thing that quietly stops working when somebody adds an exciting new state
 * six months from now.
 */

const ALL_STAGES: AiCleanStage[] = [
  "idle",
  "uploading",
  "queued",
  "processing",
  "finalizing",
  "completed",
  "failed",
  "cancelled",
  "expired",
];

describe("presenceFor", () => {
  it("🔴 refuses all motion when the viewer asked for less, whatever is happening", () => {
    // A preference that an interesting state can override is not a preference.
    for (const stage of ALL_STAGES) {
      expect(presenceFor({ stage, reducedMotion: true }), stage).toBe("dormant");
    }
  });

  it("🔴 stops entirely when the tab is hidden", () => {
    // Animation nobody can see is a battery cost with no upside — and a phone
    // in a pocket is where this page spends most of a ten-minute job.
    for (const stage of ALL_STAGES) {
      expect(presenceFor({ stage, hidden: true }), stage).toBe("dormant");
    }
  });

  it("is calm when nothing is happening", () => {
    expect(presenceFor({ stage: "idle" })).toBe("calm");
  });

  it("wakes when the member has chosen something but not started it", () => {
    expect(presenceFor({ stage: "idle", armed: true })).toBe("attentive");
  });

  it("climbs through the work and settles after it", () => {
    const order: PresenceLevel[] = [
      presenceFor({ stage: "uploading" }),
      presenceFor({ stage: "processing" }),
      presenceFor({ stage: "finalizing" }),
    ];
    const intensities = order.map((level) => presenceSpec(level).intensity);
    // Strictly increasing: the environment gets brighter as the work gets
    // closer to done, which is the whole signal.
    expect(intensities[1]!).toBeGreaterThan(intensities[0]!);
    expect(intensities[2]!).toBeGreaterThan(intensities[1]!);
    // And then comes back down.
    expect(presenceSpec(presenceFor({ stage: "completed" })).intensity).toBeLessThan(intensities[2]!);
  });

  it("goes still on a failure rather than carrying on breathing", () => {
    // A page that kept up its ambient shimmer after a job failed would read as
    // not having noticed.
    const level = presenceFor({ stage: "failed" });
    expect(level).toBe("faulted");
    expect(presenceSpec(level).animated).toBe(false);
  });

  it("has a level for every stage the job machine can produce", () => {
    for (const stage of ALL_STAGES) {
      expect(PRESENCE[presenceFor({ stage })], stage).toBeDefined();
    }
  });
});

describe("the presence table", () => {
  it("🔴 never loops fast forever — the battery rule as a number", () => {
    for (const [level, spec] of Object.entries(PRESENCE)) {
      if (!spec.animated) continue;
      // Nothing cycles quicker than two seconds, and idle is far slower than
      // that: motion the eye registers subconsciously, not a spinner.
      expect(spec.breathSeconds, level).toBeGreaterThanOrEqual(2);
      expect(spec.orbitSeconds, level).toBeGreaterThanOrEqual(4);
    }
    expect(PRESENCE.calm.orbitSeconds).toBeGreaterThanOrEqual(20);
  });

  it("leaves headroom — nothing is ever at full brightness", () => {
    // An interface already at 1 has nowhere to go when something happens.
    for (const [level, spec] of Object.entries(PRESENCE)) {
      expect(spec.intensity, level).toBeLessThan(1);
      expect(spec.intensity, level).toBeGreaterThanOrEqual(0);
    }
  });

  it("only pulses while real work is happening", () => {
    expect(PRESENCE.calm.pulses).toBe(false);
    expect(PRESENCE.attentive.pulses).toBe(false);
    // Settled is AFTER the work — a pulse there would be celebrating on a loop.
    expect(PRESENCE.settled.pulses).toBe(false);
    expect(PRESENCE.working.pulses).toBe(true);
    expect(PRESENCE.resolving.pulses).toBe(true);
  });
});

describe("presenceVars", () => {
  it("hands the whole state down as four CSS properties", () => {
    const vars = presenceVars("working");
    expect(Object.keys(vars).sort()).toEqual(["--ai-breath", "--ai-intensity", "--ai-orbit", "--ai-play"]);
    expect(vars["--ai-play"]).toBe("running");
  });

  it("🔴 pauses every animation at once when the level is dormant", () => {
    // One property, read by every keyframe in the system. That is what makes
    // "stop everything" a single style write rather than a tree of re-renders.
    const vars = presenceVars("dormant");
    expect(vars["--ai-play"]).toBe("paused");
    expect(vars["--ai-intensity"]).toBe("0");
  });

  it("pauses on a failure too", () => {
    expect(presenceVars("faulted")["--ai-play"]).toBe("paused");
  });
});
