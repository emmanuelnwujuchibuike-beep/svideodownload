import { describe, expect, it } from "vitest";

import { extractOutputUrl, mapReplicateStatus } from "./status";

describe("mapReplicateStatus", () => {
  it("translates the provider's vocabulary into ours", () => {
    expect(mapReplicateStatus("starting")).toBe("queued");
    expect(mapReplicateStatus("processing")).toBe("processing");
    expect(mapReplicateStatus("succeeded")).toBe("completed");
    expect(mapReplicateStatus("failed")).toBe("failed");
    expect(mapReplicateStatus("canceled")).toBe("cancelled");
  });

  it("accepts both spellings the provider's own docs use", () => {
    // "successful" appears in Replicate's documentation alongside "succeeded",
    // and "cancelled" alongside "canceled". Supporting both costs nothing;
    // being wrong about either loses a finished job.
    expect(mapReplicateStatus("successful")).toBe("completed");
    expect(mapReplicateStatus("cancelled")).toBe("cancelled");
  });

  it("is not confused by case or whitespace", () => {
    expect(mapReplicateStatus(" SUCCEEDED ")).toBe("completed");
  });

  it("🔴 returns null for anything it does not recognise — never a guess", () => {
    // The caller leaves the job untouched on null. A fallback to "failed" would
    // lose a running job; a fallback to "completed" would announce one that
    // never ran.
    for (const unknown of ["queued_internally", "unknown", "", null, undefined, "succeeded_partially"]) {
      expect(mapReplicateStatus(unknown), String(unknown)).toBeNull();
    }
  });
});

describe("extractOutputUrl", () => {
  it("reads a plain string output", () => {
    expect(extractOutputUrl("https://replicate.delivery/out.mp4")).toBe("https://replicate.delivery/out.mp4");
  });

  it("takes the LAST entry of an array", () => {
    // Models that emit progressive results put the finished one at the end.
    expect(
      extractOutputUrl(["https://replicate.delivery/partial.mp4", "https://replicate.delivery/final.mp4"]),
    ).toBe("https://replicate.delivery/final.mp4");
  });

  it("reads a named field from an object output", () => {
    expect(extractOutputUrl({ video: "https://replicate.delivery/out.mp4" })).toBe(
      "https://replicate.delivery/out.mp4",
    );
    expect(extractOutputUrl({ url: "https://replicate.delivery/out.mp4" })).toBe(
      "https://replicate.delivery/out.mp4",
    );
  });

  it("🔴 refuses anything that is not an https URL", () => {
    // The value becomes a fetch. A non-https output is either a mistake or an
    // attempt to make the server request something else.
    for (const bad of [
      null,
      undefined,
      42,
      "",
      "not a url",
      "http://insecure.example/out.mp4",
      "file:///etc/passwd",
      "javascript:alert(1)",
      { nothing: "useful" },
      [],
      [1, 2, 3],
    ]) {
      expect(extractOutputUrl(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("trims a URL that arrived padded", () => {
    expect(extractOutputUrl("  https://replicate.delivery/out.mp4  ")).toBe(
      "https://replicate.delivery/out.mp4",
    );
  });
});
