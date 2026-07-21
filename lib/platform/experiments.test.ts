import { describe, expect, it } from "vitest";

import {
  assignVariant,
  controlOf,
  type Experiment,
  type ExperimentContext,
} from "./experiments";

function exp(over: Partial<Experiment> = {}): Experiment {
  return {
    id: "e",
    label: "e",
    description: "",
    status: "running",
    variants: [
      { id: "control", weight: 50 },
      { id: "treatment", weight: 50 },
    ],
    ...over,
  };
}

const user = (id: string): ExperimentContext => ({ plan: "free", isAdmin: false, userId: id });
const anon: ExperimentContext = { plan: "free", isAdmin: false, userId: null };

describe("assignVariant — enrolment gates", () => {
  it("a draft assigns control and does not enrol", () => {
    const a = assignVariant(exp({ status: "draft" }), user("u1"));
    expect(a).toEqual({ variant: "control", enrolled: false });
  });
  it("a concluded experiment does not enrol", () => {
    expect(assignVariant(exp({ status: "concluded" }), user("u1")).enrolled).toBe(false);
  });
  it("an anonymous visitor is not enrolled (can't be bucketed)", () => {
    expect(assignVariant(exp(), anon)).toEqual({ variant: "control", enrolled: false });
  });
  it("a running experiment enrols a signed-in user", () => {
    expect(assignVariant(exp(), user("u1")).enrolled).toBe(true);
  });
});

describe("assignVariant — assignment", () => {
  it("is deterministic for the same user + experiment", () => {
    const a = assignVariant(exp(), user("u1"));
    const b = assignVariant(exp(), user("u1"));
    expect(a.variant).toBe(b.variant);
  });
  it("respects weights across a population (80/20 ± 3pp)", () => {
    const e = exp({ variants: [{ id: "control", weight: 80 }, { id: "treatment", weight: 20 }] });
    let treatment = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) {
      if (assignVariant(e, user(`u-${i}`)).variant === "treatment") treatment++;
    }
    const share = treatment / n;
    expect(share).toBeGreaterThan(0.17);
    expect(share).toBeLessThan(0.23);
  });
  it("a zero-total-weight experiment falls back to control", () => {
    const e = exp({ variants: [{ id: "control", weight: 0 }, { id: "treatment", weight: 0 }] });
    expect(assignVariant(e, user("u1")).variant).toBe("control");
  });
});

describe("assignVariant — plan gate", () => {
  it("excludes an ineligible plan (control, not enrolled)", () => {
    const e = exp({ plans: ["business"] });
    expect(assignVariant(e, user("u1"))).toEqual({ variant: "control", enrolled: false });
  });
  it("enrols an eligible plan", () => {
    const e = exp({ plans: ["free"] });
    expect(assignVariant(e, user("u1")).enrolled).toBe(true);
  });
});

describe("assignVariant — runtime overrides", () => {
  it("pause forces control and un-enrols", () => {
    expect(assignVariant(exp(), user("u1"), { paused: true })).toEqual({
      variant: "control",
      enrolled: false,
    });
  });
  it("a forced variant sends everyone there, enrolled", () => {
    const a = assignVariant(exp(), user("u1"), { forceVariant: "treatment" });
    expect(a).toEqual({ variant: "treatment", enrolled: true });
  });
  it("an unknown forced variant is ignored (normal assignment)", () => {
    // Guards against a typo silently pinning everyone to a nonexistent arm.
    const a = assignVariant(exp(), user("u1"), { forceVariant: "nope" });
    expect(["control", "treatment"]).toContain(a.variant);
    expect(a.enrolled).toBe(true);
  });
  it("pause wins over a forced variant", () => {
    const a = assignVariant(exp(), user("u1"), { paused: true, forceVariant: "treatment" });
    expect(a.enrolled).toBe(false);
    expect(a.variant).toBe("control");
  });
});

describe("controlOf", () => {
  it("is the first declared variant", () => {
    expect(controlOf(exp())).toBe("control");
    expect(controlOf(exp({ variants: [{ id: "a", weight: 1 }, { id: "b", weight: 1 }] }))).toBe("a");
  });
});
