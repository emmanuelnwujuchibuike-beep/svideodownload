import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { defaultPriorityFor } from "@/lib/notifications/priority";
import { NOTIFICATIONS } from "@/lib/platform/notifications-registry";

/*
  Streak events in the Notification Center (migration 0132).

  Owner, 2026-08-24: "every streak reminder, lost and all stays in
  notification". A push is transient — dismissed, or missed while the phone is
  locked, and the event is gone. These rows are the record.

  ── 🔴 WHY A PARITY TEST AND NOT JUST A UNIT TEST ─────────────────────────
  A notification type lives in FOUR places: the registry, the push-priority
  map, the renderer, and a CHECK constraint in Postgres. Miss the constraint
  and every insert of that type fails at RUNTIME with a 23514 that the
  fire-and-forget insert swallows — the notification simply never appears, with
  nothing logged. Miss the renderer and the card shows a generic fallback.
  Neither is visible in review, and this session has already produced three
  bugs of exactly that shape.
*/

const MIGRATION = readFileSync("supabase/migrations/0132_streak_notifications.sql", "utf8");
const STREAK_TYPES = ["streak_reminder", "streak_milestone", "streak_lost"] as const;
const META = readFileSync("features/notifications/meta.tsx", "utf8");

/** The type list inside 0132's CHECK constraint. */
function allowedTypes(): string[] {
  const block = /notifications_type_chk check \(\s*type in \(([\s\S]*?)\)\s*\);/.exec(MIGRATION)?.[1];
  return [...(block ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]!);
}

describe("migration 0132 — the type whitelist", () => {
  it("🔴 allows every type the registry declares", () => {
    /*
      The constraint is a single CHECK, so it cannot be appended to — each
      migration that touches it restates the WHOLE list. Dropping one by
      accident is silent until that type is next inserted in production.
    */
    const allowed = new Set(allowedTypes());
    const missing = NOTIFICATIONS.map((n) => n.id).filter((id) => !allowed.has(id));
    expect(missing, `types in the registry but NOT in 0132's constraint: ${missing.join(", ")}`).toEqual([]);
  });

  it("adds the three streak types", () => {
    const allowed = allowedTypes();
    for (const t of STREAK_TYPES) expect(allowed).toContain(t);
  });

  it("claims each announcement before sending it", () => {
    // A broken streak stays broken until the member returns, so an unclaimed
    // "you lost your streak" would repeat every hour, forever.
    expect(MIGRATION).toContain("lost_notified_date");
    expect(MIGRATION).toContain("milestone_notified_date");
  });

  it("contains no dollar-quoted block", () => {
    // 0130 put plain DDL after one and the DDL silently did not run (0131
    // fixed it). Everything here must stay plain DDL.
    expect(MIGRATION).not.toMatch(/\$\$/);
  });
});

describe("streak notification types are wired everywhere", () => {
  it.each(STREAK_TYPES)("%s is in the registry", (type) => {
    const def = NOTIFICATIONS.find((n) => n.id === type);
    expect(def, `${type} missing from the registry`).toBeTruthy();
    // "system", not "social": a streak has no actor, and social muting is
    // where people silence OTHER people — it must not silence their own streak.
    expect(def?.category).toBe("system");
  });

  it.each(STREAK_TYPES)("%s has a push priority", (type) => {
    // Falls back to "low" for an unmapped type, which would make a
    // time-critical streak nudge batchable — so assert the real value.
    expect(defaultPriorityFor(type), `${type} has no priority mapping`).toBe("medium");
  });

  it.each(STREAK_TYPES)("%s renders an icon and its own sentence", (type) => {
    expect(META, `${type} has no icon`).toContain(`${type}: Flame`);
    expect(META, `${type} has no verb`).toContain(`case "${type}":`);
  });

  it("reads as a complete sentence, since these have no actor", () => {
    // verbFor is normally appended after an actor name. Streak cards have no
    // actor, so a fragment like "started following you" would render bare.
    const verbs = /case "streak_reminder":\s*return "([^"]+)"/.exec(META)?.[1];
    expect(verbs).toMatch(/^[A-Z]/);
  });
});
