import { describe, expect, it } from "vitest";

import {
  readWebhookHeaders,
  signWebhookForTest,
  verifyReplicateWebhook,
  WEBHOOK_TOLERANCE_SECONDS,
} from "./signature";

/**
 * The webhook verifier.
 *
 * 🔴 The most security-critical function in Frenz AI, and the reason it is pure:
 * the endpoint it guards is public, and without it anyone who guesses the URL
 * can mark somebody's job complete with a file of their choosing.
 *
 * A suite that only proved "a bad signature is rejected" would pass just as
 * happily if the function rejected everything — including real deliveries. So
 * the first test signs a payload the way Replicate does and asserts it is
 * ACCEPTED, and every rejection test below is a single-field mutation of that
 * same known-good delivery.
 */

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const NOW = 1_757_260_000;
const BODY = JSON.stringify({ id: "pred_abc123", status: "succeeded", output: "https://example.com/out.mp4" });

function delivery(overrides: Partial<{ id: string; timestamp: number; body: string; secret: string }> = {}) {
  const id = overrides.id ?? ID;
  const timestamp = overrides.timestamp ?? NOW;
  const body = overrides.body ?? BODY;
  const secret = overrides.secret ?? SECRET;
  return {
    headers: { id, timestamp: String(timestamp), signature: signWebhookForTest({ id, timestamp, body, secret }) },
    rawBody: body,
    secret: SECRET,
    nowSeconds: NOW,
  };
}

describe("a genuine delivery", () => {
  it("🔴 is accepted", () => {
    expect(verifyReplicateWebhook(delivery())).toEqual({ valid: true });
  });

  it("is accepted with the secret written without its whsec_ prefix", () => {
    // A secret pasted without the label is an ordinary mistake to make once,
    // and refusing every delivery for it would be a very expensive lesson.
    const bare = SECRET.slice("whsec_".length);
    expect(verifyReplicateWebhook({ ...delivery(), secret: bare })).toEqual({ valid: true });
  });

  it("is accepted when the header carries several signatures", () => {
    // A secret being rotated is signed with both. Checking only the first would
    // break every delivery for the length of the rotation.
    const good = signWebhookForTest({ id: ID, timestamp: NOW, body: BODY, secret: SECRET });
    const other = signWebhookForTest({ id: ID, timestamp: NOW, body: BODY, secret: "whsec_b3RoZXJzZWNyZXQ=" });
    expect(
      verifyReplicateWebhook({
        ...delivery(),
        headers: { id: ID, timestamp: String(NOW), signature: `${other} ${good}` },
      }),
    ).toEqual({ valid: true });
  });

  it("is accepted at the very edge of the tolerance window", () => {
    expect(
      verifyReplicateWebhook({ ...delivery(), nowSeconds: NOW + WEBHOOK_TOLERANCE_SECONDS }),
    ).toEqual({ valid: true });
  });
});

describe("a forged or altered delivery", () => {
  it("🔴 is rejected when the body was changed by a single character", () => {
    // The attack this exists to stop: a real signature, replayed over a body
    // that now points at somebody else's file.
    const good = delivery();
    const tampered = { ...good, rawBody: good.rawBody.replace("pred_abc123", "pred_abc124") };
    expect(verifyReplicateWebhook(tampered)).toEqual({ valid: false, reason: "no-match" });
  });

  it("🔴 is rejected when signed with a different secret", () => {
    expect(verifyReplicateWebhook(delivery({ secret: "whsec_c29tZW9uZWVsc2Vzc2VjcmV0" }))).toEqual({
      valid: false,
      reason: "no-match",
    });
  });

  it("is rejected when the id it was signed with is swapped", () => {
    const good = delivery();
    expect(
      verifyReplicateWebhook({
        ...good,
        headers: { ...good.headers, id: "msg_somethingelse" },
      }),
    ).toEqual({ valid: false, reason: "no-match" });
  });

  it("is rejected with no signature at all", () => {
    expect(
      verifyReplicateWebhook({ ...delivery(), headers: { id: ID, timestamp: String(NOW), signature: null } }),
    ).toEqual({ valid: false, reason: "missing-headers" });
    expect(
      verifyReplicateWebhook({ ...delivery(), headers: { id: null, timestamp: null, signature: null } }),
    ).toEqual({ valid: false, reason: "missing-headers" });
  });

  it("is rejected when the signature is empty or nonsense", () => {
    for (const signature of ["", "v1,", "not-a-signature", "v1,!!!!"]) {
      const verdict = verifyReplicateWebhook({
        ...delivery(),
        headers: { id: ID, timestamp: String(NOW), signature },
      });
      expect(verdict.valid, signature).toBe(false);
    }
  });
});

describe("replay protection", () => {
  it("🔴 rejects a delivery captured and re-sent later", () => {
    expect(
      verifyReplicateWebhook({ ...delivery(), nowSeconds: NOW + WEBHOOK_TOLERANCE_SECONDS + 1 }),
    ).toEqual({ valid: false, reason: "stale" });
  });

  it("rejects a timestamp in the future, not just an old one", () => {
    // A far-future timestamp is as much a forgery signal as an old one, and
    // allowing it would hand an attacker an unbounded replay window.
    expect(
      verifyReplicateWebhook({ ...delivery(), nowSeconds: NOW - WEBHOOK_TOLERANCE_SECONDS - 1 }),
    ).toEqual({ valid: false, reason: "stale" });
  });

  it("rejects a timestamp that is not a number", () => {
    const good = delivery();
    expect(
      verifyReplicateWebhook({ ...good, headers: { ...good.headers, timestamp: "yesterday" } }),
    ).toEqual({ valid: false, reason: "stale" });
  });
});

describe("an unusable secret", () => {
  it("refuses rather than accepting anything", () => {
    // Fail closed. A deployment with no secret must verify nothing, not
    // everything.
    for (const secret of ["", "   ", "whsec_"]) {
      expect(verifyReplicateWebhook({ ...delivery(), secret }), secret).toEqual({
        valid: false,
        reason: "bad-secret",
      });
    }
  });
});

describe("readWebhookHeaders", () => {
  it("reads the three documented header names", () => {
    const headers = new Headers({
      "webhook-id": ID,
      "webhook-timestamp": String(NOW),
      "webhook-signature": "v1,abc",
    });
    expect(readWebhookHeaders(headers)).toEqual({ id: ID, timestamp: String(NOW), signature: "v1,abc" });
  });

  it("returns nulls when they are absent", () => {
    expect(readWebhookHeaders(new Headers())).toEqual({ id: null, timestamp: null, signature: null });
  });
});
