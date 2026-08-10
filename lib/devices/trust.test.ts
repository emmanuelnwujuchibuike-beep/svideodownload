import { describe, expect, it } from "vitest";

import {
  capabilitiesFor,
  compareByTrust,
  DORMANT_AFTER_MS,
  evaluateTrust,
  NEW_DEVICE_WINDOW_MS,
  observationsFor,
  TRUST_LEVELS,
  trustLevel,
  type TrustSignals,
} from "./trust";

/**
 * The Device Trust Engine.
 *
 * A trust level is a security statement, so the tests are mostly about what it
 * must REFUSE to conclude: never demote the device in your hand, never let a
 * revoked device climb back by being used, and never treat missing data as
 * evidence of anything.
 */

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function signals(over: Partial<TrustSignals> = {}): TrustSignals {
  return {
    isCurrent: false,
    isTrusted: false,
    firstSeenAt: ago(90 * 24 * 60 * 60 * 1000),
    lastSeenAt: ago(60 * 60 * 1000),
    ...over,
  };
}

describe("evaluateTrust — precedence", () => {
  it("never labels the device in your hand as anything else", () => {
    /*
      The fastest way to make a security screen untrustworthy is to flag the
      screen someone is looking at. This holds even when every other signal
      would fire.
    */
    const level = evaluateTrust(
      signals({ isCurrent: true, trustRevoked: true, firstSeenAt: ago(0), lastSeenAt: ago(DORMANT_AFTER_MS * 2) }),
      NOW,
    );
    expect(level).toBe("current");
  });

  it("keeps a revoked device restricted no matter how much it is used", () => {
    // A person took trust away. Being used again is not an argument.
    expect(evaluateTrust(signals({ trustRevoked: true, lastSeenAt: ago(1000) }), NOW)).toBe("restricted");
    expect(evaluateTrust(signals({ trustRevoked: true, isTrusted: true }), NOW)).toBe("restricted");
  });

  it("lets explicit trust outrank the time signals", () => {
    expect(evaluateTrust(signals({ isTrusted: true, firstSeenAt: ago(0) }), NOW)).toBe("trusted");
    expect(evaluateTrust(signals({ isTrusted: true, lastSeenAt: ago(DORMANT_AFTER_MS * 3) }), NOW)).toBe("trusted");
  });
});

describe("evaluateTrust — time", () => {
  it("calls a device new only inside the window", () => {
    expect(evaluateTrust(signals({ firstSeenAt: ago(NEW_DEVICE_WINDOW_MS - 1000) }), NOW)).toBe("new");
    expect(evaluateTrust(signals({ firstSeenAt: ago(NEW_DEVICE_WINDOW_MS + 1000) }), NOW)).toBe("recognised");
  });

  it("calls a device dormant only past the window", () => {
    expect(evaluateTrust(signals({ lastSeenAt: ago(DORMANT_AFTER_MS + 1000) }), NOW)).toBe("dormant");
    expect(evaluateTrust(signals({ lastSeenAt: ago(DORMANT_AFTER_MS - 1000) }), NOW)).toBe("recognised");
  });

  it("treats missing or unparseable timestamps as no evidence", () => {
    /*
      The alternative is flagging every row that predates a column as
      suspicious — which is how a security feature teaches people to ignore it.
    */
    for (const bad of [null, "", "not a date", "2026-13-45"]) {
      expect(evaluateTrust(signals({ firstSeenAt: bad, lastSeenAt: bad }), NOW)).toBe("recognised");
    }
  });
});

describe("capabilities make the level mean something", () => {
  it("gives every level a capability set", () => {
    for (const level of TRUST_LEVELS) expect(capabilitiesFor(level.id)).toBeTruthy();
  });

  it("never lets an untrusted device change security settings", () => {
    // The single most valuable thing for an attacker holding a stale session.
    for (const level of ["recognised", "new", "dormant", "restricted"] as const) {
      expect(capabilitiesFor(level).changeSecuritySettings, `${level} may change security settings`).toBe(false);
    }
  });

  it("only suppresses the new-device alert for devices the person vouched for", () => {
    expect(capabilitiesFor("new").skipNewDeviceAlert).toBe(false);
    expect(capabilitiesFor("restricted").skipNewDeviceAlert).toBe(false);
    expect(capabilitiesFor("trusted").skipNewDeviceAlert).toBe(true);
  });

  it("never offers to remember a device whose trust was removed", () => {
    // Re-offering is how a person's decision gets quietly undone by a prompt.
    expect(capabilitiesFor("restricted").offerRemember).toBe(false);
  });
});

describe("observations", () => {
  it("reports what was seen, not a verdict about the person", () => {
    const notes = observationsFor(signals({ firstSeenAt: ago(1000) }), NOW);
    const text = notes.map((n) => n.text).join(" ");
    expect(text).toMatch(/First seen/);
    // We cannot tell an attacker from a new laptop, and saying so would train
    // people to dismiss the screen.
    expect(text).not.toMatch(/suspicious|attack|hack|compromis/i);
  });

  it("notes a changed user agent without acting on it", () => {
    const notes = observationsFor(
      signals({ originalUserAgent: "Mozilla/5.0 A", currentUserAgent: "Mozilla/5.0 B" }),
      NOW,
    );
    const agent = notes.find((n) => n.id === "agent-changed");
    expect(agent).toBeTruthy();
    // A browser upgrade produces this too, so it must not be a caution.
    expect(agent!.tone).toBe("neutral");
  });

  it("says nothing about an unchanged agent, or when either side is unknown", () => {
    const same = observationsFor(signals({ originalUserAgent: "UA", currentUserAgent: "UA" }), NOW);
    expect(same.some((n) => n.id === "agent-changed")).toBe(false);
    const unknown = observationsFor(signals({ originalUserAgent: null, currentUserAgent: "UA" }), NOW);
    expect(unknown.some((n) => n.id === "agent-changed")).toBe(false);
  });

  it("stays silent for an ordinary recognised device", () => {
    expect(observationsFor(signals(), NOW)).toHaveLength(0);
  });
});

describe("the level registry", () => {
  it("describes every level for a reader", () => {
    for (const level of TRUST_LEVELS) {
      expect(level.label.length).toBeGreaterThan(2);
      expect(level.blurb.length).toBeGreaterThan(15);
    }
  });

  it("gives every level a distinct rank so the list order is stable", () => {
    const ranks = TRUST_LEVELS.map((l) => l.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("sorts your own device first and concerns last", () => {
    const order = ["dormant", "current", "new", "trusted", "recognised"] as const;
    expect([...order].sort(compareByTrust)).toEqual(["current", "trusted", "recognised", "new", "dormant"]);
  });

  it("falls back to a real level for an unknown id", () => {
    // A level id arriving from stored data must never render an empty badge.
    expect(trustLevel("nonsense" as never).id).toBe("recognised");
  });
});
