import { describe, expect, it } from "vitest";

import { AI_CLEAN_MAX_BYTES } from "./clean-media";
import {
  AI_FEATURES,
  decodeCursor,
  encodeCursor,
  AI_JOB_STATUSES,
  aiFeature,
  canTransition,
  createJobRequestSchema,
  featureAvailability,
  isActiveStatus,
  isValidClientRequestId,
  jobToView,
  validateJobInput,
  type AiJobRow,
  type AiJobStatus,
} from "./jobs";

/**
 * The registry and the vocabulary.
 *
 * Two of these tests are not about behaviour at all — the allow-list one and
 * the availability one. They exist because the failures they catch are silent:
 * a column added to the table that starts flowing to every client, and a
 * feature that reports itself runnable when nothing can run it.
 */

const feature = aiFeature("ai_clean")!;

describe("the feature registry", () => {
  it("has AI Clean, and it is the only feature built", () => {
    expect(AI_FEATURES.map((f) => f.id)).toEqual(["ai_clean"]);
  });

  it("gives the free tier the owner's three jobs a day", () => {
    expect(feature.freeDailyJobs).toBe(3);
  });

  it("🔴 accepts exactly what the picker accepts", () => {
    // A file the interface took must never be refused by the server for a rule
    // the interface did not know about. Both read the same constant.
    expect(feature.maxBytes).toBe(AI_CLEAN_MAX_BYTES);
    for (const mime of ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"]) {
      expect(feature.mimeTypes, `${mime} missing`).toContain(mime);
    }
  });

  it("returns null for a feature nobody built", () => {
    expect(aiFeature("ai_upscale")).toBeNull();
    expect(aiFeature("../etc/passwd")).toBeNull();
  });
});

describe("featureAvailability", () => {
  const ready = { replicate: true, finalizer: true, allowUndispatched: false };

  it("🔴 refuses when no provider is configured", () => {
    const verdict = featureAvailability(feature, { ...ready, replicate: false });
    expect(verdict.available).toBe(false);
    if (!verdict.available) expect(verdict.reason.length).toBeGreaterThan(10);
  });

  it("🔴 Part 4: refuses when the ffmpeg worker is missing, BEFORE anything is spent", () => {
    /*
      The model returns video with no audio, so a job that cannot be muxed is a
      job that would hand somebody a silent video. Checking at creation means
      that costs nothing; checking at the end would mean discovering it after
      the upload, the provider bill and the member's wait.
    */
    const verdict = featureAvailability(feature, { ...ready, finalizer: false });
    expect(verdict.available).toBe(false);
  });

  it("says the same thing whichever half is missing", () => {
    // Which piece of OUR infrastructure is down is not the member's problem,
    // and naming it publicly buys nothing.
    const noProvider = featureAvailability(feature, { ...ready, replicate: false });
    const noWorker = featureAvailability(feature, { ...ready, finalizer: false });
    if (!noProvider.available && !noWorker.available) {
      expect(noProvider.reason).toBe(noWorker.reason);
    } else {
      throw new Error("both should have been unavailable");
    }
  });

  it("is available and dispatchable once everything is configured", () => {
    expect(featureAvailability(feature, ready)).toEqual({ available: true, dispatchable: true });
  });

  it("the development flag opens creation but never claims dispatch", () => {
    // A job may be created for testing, and the response still says out loud
    // that nothing will run it.
    expect(
      featureAvailability(feature, { replicate: false, finalizer: false, allowUndispatched: true }),
    ).toEqual({ available: true, dispatchable: false });
  });
});

describe("validateJobInput", () => {
  const ok = { size: 1024, mimeType: "video/mp4" };

  it("accepts a plain video", () => {
    expect(validateJobInput(feature, ok)).toEqual({ ok: true });
  });

  it("is case-insensitive about the MIME type", () => {
    expect(validateJobInput(feature, { ...ok, mimeType: " VIDEO/MP4 " })).toEqual({ ok: true });
  });

  it("refuses a file over the ceiling, and takes one exactly at it", () => {
    expect(validateJobInput(feature, { ...ok, size: feature.maxBytes + 1 })).toEqual({
      ok: false,
      code: "FILE_TOO_LARGE",
    });
    expect(validateJobInput(feature, { ...ok, size: feature.maxBytes })).toEqual({ ok: true });
  });

  it("refuses a format the feature does not take", () => {
    expect(validateJobInput(feature, { ...ok, mimeType: "video/x-matroska" })).toEqual({
      ok: false,
      code: "UNSUPPORTED_FORMAT",
    });
  });

  it("refuses nonsense sizes and durations rather than storing them", () => {
    expect(validateJobInput(feature, { ...ok, size: 0 }).ok).toBe(false);
    expect(validateJobInput(feature, { ...ok, size: Number.NaN }).ok).toBe(false);
    expect(validateJobInput(feature, { ...ok, durationSeconds: 0 }).ok).toBe(false);
    expect(validateJobInput(feature, { ...ok, durationSeconds: -5 }).ok).toBe(false);
  });

  it("refuses a clip past the duration ceiling — provider time is billed by the second", () => {
    expect(validateJobInput(feature, { ...ok, durationSeconds: feature.maxDurationSeconds + 1 })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(validateJobInput(feature, { ...ok, durationSeconds: feature.maxDurationSeconds })).toEqual({ ok: true });
  });

  it("accepts an input whose duration the browser could not measure", () => {
    // A container with no readable header is not a bad file; it is a fact about
    // the decoder. Refusing it would reject real videos.
    expect(validateJobInput(feature, ok)).toEqual({ ok: true });
  });
});

describe("status transitions", () => {
  it("declares the same seven statuses the database allows", () => {
    // Mirrors ai_jobs_status_chk after migration 0142 added `finalizing`.
    expect([...AI_JOB_STATUSES].sort()).toEqual(
      ["cancelled", "completed", "expired", "failed", "finalizing", "processing", "queued"].sort(),
    );
  });

  it("knows which statuses are still going to change", () => {
    expect(isActiveStatus("queued")).toBe(true);
    expect(isActiveStatus("processing")).toBe(true);
    for (const s of ["completed", "failed", "cancelled", "expired"] as AiJobStatus[]) {
      expect(isActiveStatus(s), s).toBe(false);
    }
  });

  it("🔴 never walks a finished job backwards", () => {
    // A provider retrying a callback out of order is ordinary. It must not be
    // able to re-open a job somebody was already told about.
    expect(canTransition("completed", "processing")).toBe(false);
    expect(canTransition("failed", "completed")).toBe(false);
    expect(canTransition("cancelled", "processing")).toBe(false);
    expect(canTransition("expired", "queued")).toBe(false);
  });

  it("allows the real lifecycle", () => {
    expect(canTransition("queued", "processing")).toBe(true);
    expect(canTransition("processing", "finalizing")).toBe(true);
    expect(canTransition("finalizing", "completed")).toBe(true);
    expect(canTransition("queued", "cancelled")).toBe(true);
    // Anything may age out, including a job that finished.
    expect(canTransition("completed", "expired")).toBe(true);
  });

  it("🔴 Part 4: the AI finishing is NOT the job finishing", () => {
    /*
      The model returns video with no audio on it. Letting `processing` go
      straight to `completed` is what would hand somebody a silent video and
      call it ready — so the only route to completed is through finalizing,
      enforced here rather than left to whichever webhook writes the row.
    */
    expect(canTransition("processing", "completed")).toBe(false);
    expect(canTransition("queued", "completed")).toBe(false);
  });

  it("lets finalization fail or be cancelled like any other work", () => {
    expect(canTransition("finalizing", "failed")).toBe(true);
    expect(canTransition("finalizing", "cancelled")).toBe(true);
    // But never backwards: a retry is a new run, not a rewound one.
    expect(canTransition("finalizing", "processing")).toBe(false);
    expect(canTransition("completed", "finalizing")).toBe(false);
  });
});

describe("isValidClientRequestId", () => {
  it("takes a plain, bounded token", () => {
    expect(isValidClientRequestId("a".repeat(8))).toBe(true);
    expect(isValidClientRequestId("9f2c1b8e4a7d4f0e9c3b1a2d5e6f7a8b")).toBe(true);
    expect(isValidClientRequestId("req-2026_09_07-01")).toBe(true);
  });

  it("refuses anything too short, too long, or shaped like an injection", () => {
    expect(isValidClientRequestId("short")).toBe(false);
    expect(isValidClientRequestId("a".repeat(101))).toBe(false);
    expect(isValidClientRequestId("has spaces here")).toBe(false);
    expect(isValidClientRequestId("../../etc/passwd")).toBe(false);
    expect(isValidClientRequestId("id'or'1'='1")).toBe(false);
  });
});

describe("jobToView", () => {
  const row: AiJobRow = {
    id: "11111111-2222-3333-4444-555555555555",
    user_id: "99999999-8888-7777-6666-555555555555",
    feature: "ai_clean",
    provider: "replicate",
    model: "some-org/video-text-remover",
    model_version: "abc123def456",
    status: "completed",
    client_request_id: "9f2c1b8e4a7d4f0e",
    source_path: "user/ai_clean/job/source.mp4",
    result_path: "user/ai_clean/job/result.mp4",
    source_size: 1024,
    result_size: 2048,
    result_duration: "12.400",
    result_mime_type: "video/mp4",
    audio_restored: true,
    source_duration: "12.500",
    source_mime_type: "video/mp4",
    replicate_prediction_id: "pred_secret_123",
    error_code: null,
    error_message: "provider said something internal",
    created_at: "2026-09-07T10:00:00.000Z",
    started_at: "2026-09-07T10:00:05.000Z",
    completed_at: "2026-09-07T10:01:05.000Z",
    expires_at: "2026-09-10T10:00:00.000Z",
    metadata: { source_name: "holiday.mp4" },
  };

  it("🔴 leaks nothing about the provider, the paths or the raw error", () => {
    // The test that matters. If a future column starts appearing here, this
    // fails — which is the entire reason the view is an allow-list.
    const serialised = JSON.stringify(jobToView(row, () => "x"));
    for (const secret of [
      "replicate",
      "video-text-remover",
      "abc123def456",
      "pred_secret_123",
      "source.mp4",
      "result.mp4",
      "provider said something internal",
    ]) {
      expect(serialised, `"${secret}" reached the client`).not.toContain(secret);
    }
  });

  it("returns the facts a member is entitled to", () => {
    const view = jobToView(row, () => "x");
    expect(view.id).toBe(row.id);
    expect(view.feature).toBe("ai_clean");
    expect(view.status).toBe("completed");
    expect(view.source).toEqual({
      size: 1024,
      mimeType: "video/mp4",
      durationSeconds: 12.5,
      name: "holiday.mp4",
    });
  });

  it("measures its own duration from the timestamps", () => {
    expect(jobToView(row, () => "x").durationMs).toBe(60_000);
  });

  it("reports no duration for a job that has not finished — never a zero", () => {
    const running = { ...row, status: "processing" as const, completed_at: null };
    expect(jobToView(running, () => "x").durationMs).toBeNull();
  });

  it("renders a failure as a code plus a written sentence", () => {
    const failed = { ...row, status: "failed" as const, error_code: "PROVIDER_ERROR" };
    const view = jobToView(failed, (code) => `resolved:${code}`);
    expect(view.error).toEqual({ code: "PROVIDER_ERROR", message: "resolved:PROVIDER_ERROR" });
  });

  it("survives a row with nothing measured", () => {
    const bare: AiJobRow = {
      ...row,
      status: "queued",
      source_size: null,
      source_duration: null,
      source_mime_type: null,
      started_at: null,
      completed_at: null,
      metadata: null,
    };
    const view = jobToView(bare, () => "x");
    expect(view.source).toEqual({ size: null, mimeType: null, durationSeconds: null, name: null });
    expect(view.durationMs).toBeNull();
  });

  it("ignores a metadata name that is not a string", () => {
    const odd = { ...row, metadata: { source_name: { nope: true } } };
    expect(jobToView(odd, () => "x").source.name).toBeNull();
  });
});

describe("pagination cursors", () => {
  const at = "2026-09-07T10:00:00.000Z";
  const id = "11111111-2222-3333-4444-555555555555";

  it("round-trips a page position", () => {
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ createdAt: at, id });
  });

  it("🔴 refuses a cursor carrying a PostgREST filter", () => {
    // Both halves are interpolated into an .or() filter string. A cursor is
    // client-supplied text, so the shape check is the boundary — without it a
    // crafted cursor could rewrite the query it is meant to page.
    const hostile = Buffer.from("2026-09-07,user_id.neq.x|" + id, "utf8").toString("base64url");
    expect(decodeCursor(hostile)).toBeNull();
    const hostileId = Buffer.from(at + "|abc),or(user_id.not.is.null", "utf8").toString("base64url");
    expect(decodeCursor(hostileId)).toBeNull();
  });

  it("refuses rubbish rather than throwing on it", () => {
    for (const bad of ["", "!!!!", "notbase64", Buffer.from("nopipe", "utf8").toString("base64url")]) {
      expect(decodeCursor(bad), bad).toBeNull();
    }
  });
});


describe("the create-job request schema", () => {
  const valid = {
    feature: "ai_clean",
    clientRequestId: "9f2c1b8e4a7d4f0e",
    source: { size: 1024, mimeType: "video/mp4" },
  };

  it("accepts the only body the route takes", () => {
    expect(createJobRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts the optional measurements", () => {
    const withExtras = { ...valid, source: { ...valid.source, durationSeconds: 12.5, name: "clip.mp4" } };
    expect(createJobRequestSchema.safeParse(withExtras).success).toBe(true);
  });

  it("🔴 REFUSES every field the server owns", () => {
    /*
      The security test for this whole route. A permissive schema would STRIP
      these and succeed, which is worse than failing: the request would look
      accepted while the fields it tried to set did nothing, and nobody reading
      the response could tell the difference.
    */
    for (const injected of [
      { user_id: "00000000-0000-0000-0000-000000000000" },
      { userId: "00000000-0000-0000-0000-000000000000" },
      { provider: "some-other-service" },
      { model: "expensive/model" },
      { model_version: "abc" },
      { status: "completed" },
      { result_path: "someone/else/result.mp4" },
      { source_path: "someone/else/source.mp4" },
      { expires_at: "2099-01-01T00:00:00Z" },
      { metadata: { admin: true } },
    ]) {
      const body = { ...valid, ...injected };
      const key = Object.keys(injected)[0];
      expect(createJobRequestSchema.safeParse(body).success, `${key} was accepted`).toBe(false);
    }
  });

  it("refuses an unknown field inside source, too", () => {
    const body = { ...valid, source: { ...valid.source, path: "x/y/z.mp4" } };
    expect(createJobRequestSchema.safeParse(body).success).toBe(false);
  });

  it("refuses a body missing what it must have", () => {
    expect(createJobRequestSchema.safeParse({}).success).toBe(false);
    expect(createJobRequestSchema.safeParse({ feature: "ai_clean" }).success).toBe(false);
    const { clientRequestId: _omit, ...noId } = valid;
    expect(createJobRequestSchema.safeParse(noId).success).toBe(false);
  });

  it("refuses sizes that are not whole positive numbers of bytes", () => {
    for (const size of [0, -1, 1.5, Number.NaN, "1024"]) {
      const body = { ...valid, source: { ...valid.source, size } };
      expect(createJobRequestSchema.safeParse(body).success, String(size)).toBe(false);
    }
  });
});
