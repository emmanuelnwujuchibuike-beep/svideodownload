import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getDeliveryCapabilities,
  getNotificationAi,
  getNotificationChannels,
  getNotificationPreferences,
  getNotificationServices,
  getNotificationSources,
  type NotifStatus,
} from "./notification-platform";
import { getNotifications } from "./notifications-registry";

/**
 * Keeps the Notification Registry honest (docs/CONSTITUTION.md, Article I.3): a
 * `live`/`partial` row must point at a file that exists, and a `planned` row must
 * not pretend to. Without this the catalogue could quietly describe delivery
 * infrastructure that isn't there.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Pure detector: source-path problems for a set of catalogue rows. */
function sourceProblems(entries: { id: string; source: string; status: NotifStatus }[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) problems.push(`duplicate id: "${e.id}"`);
    seen.add(e.id);
    if (e.status === "planned") {
      if (e.source !== "") problems.push(`"${e.id}" is planned but names a source`);
    } else if (!e.source) {
      problems.push(`"${e.id}" is ${e.status} but names no source`);
    } else if (!existsSync(path.join(ROOT, e.source))) {
      problems.push(`"${e.id}" points at "${e.source}", which does not exist`);
    }
  }
  return problems;
}

const CATALOGUES: Record<string, { id: string; source: string; status: NotifStatus }[]> = {
  services: getNotificationServices(),
  channels: getNotificationChannels(),
  delivery: getDeliveryCapabilities(),
  preferences: getNotificationPreferences(),
  AI: getNotificationAi(),
};

describe("Notification Registry", () => {
  for (const [name, entries] of Object.entries(CATALOGUES)) {
    it(`${name}: every live/partial row points at a real file, planned rows name none`, () => {
      const problems = sourceProblems(entries);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }

  it("every live/partial source raises under a real registered category; planned name none", () => {
    // Ties the platform's sources to the actual Notification Type Registry, so a
    // source can't claim a category that doesn't exist.
    const known = new Set(getNotifications().map((n) => n.category));
    const seen = new Set<string>();
    for (const s of getNotificationSources()) {
      expect(seen.has(s.id), `duplicate source id "${s.id}"`).toBe(false);
      seen.add(s.id);
      if (s.status === "planned") {
        expect(s.category, `${s.id} is planned but names a category`).toBe("");
      } else {
        expect(known.has(s.category as never), `${s.id} → unknown category "${s.category}"`).toBe(true);
      }
    }
  });

  it("in-app, web push and email are live — the load-bearing channels", () => {
    const byId = new Map(getNotificationChannels().map((c) => [c.id, c.status]));
    expect(byId.get("in-app")).toBe("live");
    expect(byId.get("web-push")).toBe("live");
    expect(byId.get("email")).toBe("live");
    // Native + SMS must never be quietly claimed on a PWA.
    for (const future of ["sms", "native-ios", "native-android", "live-activity"]) {
      expect(byId.get(future), `${future} should be planned`).toBe("planned");
    }
  });

  it("quiet hours + digest are live; the AI stack is honestly planned", () => {
    const delivery = new Map(getDeliveryCapabilities().map((d) => [d.id, d.status]));
    expect(delivery.get("quiet-hours")).toBe("live");
    expect(delivery.get("digest")).toBe("live");
    for (const ai of getNotificationAi()) {
      expect(ai.status, `${ai.id} should be planned`).toBe("planned");
    }
  });
});

describe("the catalogue check has teeth", () => {
  it("catches a live row pointing at a missing file", () => {
    const problems = sourceProblems([{ id: "ghost", source: "lib/push/does-not-exist.ts", status: "live" }]);
    expect(problems.some((p) => p.includes("does not exist"))).toBe(true);
  });
  it("catches a planned row that pretends to have a source", () => {
    const problems = sourceProblems([{ id: "fake", source: "lib/x.ts", status: "planned" }]);
    expect(problems.some((p) => p.includes("planned but names a source"))).toBe(true);
  });
  it("catches a live row with no source", () => {
    const problems = sourceProblems([{ id: "empty", source: "", status: "live" }]);
    expect(problems.some((p) => p.includes("names no source"))).toBe(true);
  });
});
