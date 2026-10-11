import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { presencePatchColumns, scheduleProblem } from "./server";

describe("presence patch validation", () => {
  it("trims and bounds the custom status, and clearing it clears its end time", () => {
    expect(presencePatchColumns({ customText: "  Working   late " })).toEqual({ ok: true, columns: { custom_text: "Working late" } });
    expect(presencePatchColumns({ customText: "x".repeat(61) }).ok).toBe(false);
    expect(presencePatchColumns({ customText: "   " })).toEqual({ ok: true, columns: { custom_text: null, custom_until: null } });
  });

  it("refuses unknown statuses, focus modes, availability and audiences", () => {
    expect(presencePatchColumns({ status: "online" }).ok).toBe(false);
    expect(presencePatchColumns({ focusMode: "partying" }).ok).toBe(false);
    expect(presencePatchColumns({ openTo: ["chat", "dating"] }).ok).toBe(false);
    expect(presencePatchColumns({ audience: "public" }).ok).toBe(false);
  });

  it("a circle audience needs a circle, and any other audience drops it", () => {
    expect(presencePatchColumns({ audience: "circle" }).ok).toBe(false);
    expect(presencePatchColumns({ audience: "friends", audienceCircle: "c" })).toEqual({ ok: true, columns: { audience: "friends", audience_circle: null } });
  });

  it("ending a focus clears its end time, and a bad end time is refused", () => {
    expect(presencePatchColumns({ focusMode: null, focusUntil: "2026-10-12T07:00:00Z" })).toEqual({ ok: true, columns: { focus_mode: null, focus_until: null } });
    expect(presencePatchColumns({ focusMode: "sleep", focusUntil: "tomorrow" }).ok).toBe(false);
  });

  it("an auto reply is bounded at 140 characters", () => {
    expect(presencePatchColumns({ autoReply: "y".repeat(141) }).ok).toBe(false);
    expect(presencePatchColumns({ autoReply: "Later" })).toEqual({ ok: true, columns: { auto_reply: "Later" } });
  });
});

describe("automation validation", () => {
  const ok = { mode: "sleep", days: 127, startMin: 1380, endMin: 420, tz: "Africa/Lagos", enabled: true };
  it("accepts a real window and refuses each broken part", () => {
    expect(scheduleProblem(ok)).toBeNull();
    expect(scheduleProblem({ ...ok, mode: "nap" })).not.toBeNull();
    expect(scheduleProblem({ ...ok, days: 0 })).not.toBeNull();
    expect(scheduleProblem({ ...ok, endMin: 1440 })).not.toBeNull();
    expect(scheduleProblem({ ...ok, tz: "Mars/Olympus" })).not.toBeNull();
  });
});
