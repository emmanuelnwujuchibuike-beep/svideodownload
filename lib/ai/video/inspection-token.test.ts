import { describe, expect, it } from "vitest";

import { signInspection, verifyInspection, type InspectionClaims } from "./inspection-token";

/** The signed record the quote and the job trust instead of the browser — each refusal with its own bad fixture. */

const KEY = "test-signing-key";
const USER = "11111111-1111-1111-1111-111111111111";
const NOW = 1_800_000_000_000;
const claims: Omit<InspectionClaims, "expiresAt"> = {
  kind: "people",
  userId: USER,
  path: `${USER}/video-reference/22222222-2222-2222-2222-222222222222.mp4`,
  fingerprint: "4194304:etag",
  facts: { durationMs: 5000, width: 1280, height: 720, fps: 30, container: "mp4", sizeBytes: 4194304 },
  people: [{ id: "p1", score: 0.9, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.6 } }],
  frameMs: 600,
};

describe("inspection token", () => {
  it("round-trips its claims for the owner", () => {
    const { token } = signInspection(claims, KEY, NOW);
    const v = verifyInspection(token, { userId: USER, kind: "people" }, KEY, NOW + 1000);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.claims.facts.durationMs).toBe(5000);
  });

  it("🔴 refuses an edited body (a client cannot shorten the billed clip)", () => {
    const { token } = signInspection(claims, KEY, NOW);
    const [body, sig] = token.split(".");
    const forged = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    forged.facts.durationMs = 1000;
    const edited = `${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
    expect(verifyInspection(edited, { userId: USER }, KEY, NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses another key, another member, another kind, an expired token and junk", () => {
    const { token } = signInspection(claims, KEY, NOW);
    expect(verifyInspection(token, { userId: USER }, "other-key", NOW)).toEqual({ ok: false, reason: "signature" });
    expect(verifyInspection(token, { userId: "33333333-3333-3333-3333-333333333333" }, KEY, NOW)).toEqual({ ok: false, reason: "owner" });
    expect(verifyInspection(token, { userId: USER, kind: "video" }, KEY, NOW)).toEqual({ ok: false, reason: "kind" });
    expect(verifyInspection(token, { userId: USER }, KEY, NOW + 4 * 60 * 60 * 1000)).toEqual({ ok: false, reason: "expired" });
    expect(verifyInspection("nodot", { userId: USER }, KEY, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyInspection(42, { userId: USER }, KEY, NOW)).toEqual({ ok: false, reason: "malformed" });
  });
});
