import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { downloadRecordKey } from "./record-once";

const file = { url: "https://www.tiktok.com/@a/video/1", formatId: "best", kind: "video" };

describe("one download, one anonymous row (owner, 2026-10-31)", () => {
  it("the same id and file give the same key — a retry or a fallback is the same download", () => {
    expect(downloadRecordKey("abc-123", file)).toBe(downloadRecordKey("abc-123", { ...file }));
  });

  it("the same id on a DIFFERENT file is a different key — one id never hides another download", () => {
    expect(downloadRecordKey("abc-123", file)).not.toBe(downloadRecordKey("abc-123", { ...file, formatId: "720" }));
    expect(downloadRecordKey("abc-123", file)).not.toBe(downloadRecordKey("abc-123", { ...file, url: "https://x.com/b/status/2" }));
  });

  it("no usable id → null, so the row is written as before", () => {
    expect(downloadRecordKey(null, file)).toBeNull();
    expect(downloadRecordKey("", file)).toBeNull();
    expect(downloadRecordKey("!!!", file)).toBeNull();
  });

  // Teeth: the route must gate the write on the key and skip Vercel→worker proxied calls.
  it("the download route records through firstSighting and never for an internal worker call", () => {
    const src = readFileSync("app/api/download/route.ts", "utf8");
    expect(src).toMatch(/if \(!recordAs\.internal\) \{/);
    expect(src).toMatch(/!key \|\| \(await firstSighting\(key, RECORD_ONCE_TTL_SECONDS\)\)\) recordDownloadEvent\(/);
    expect(src.match(/internal: isInternalWorkerCall\(request\)/g)?.length).toBe(2);
    expect(src).toMatch(/downloadId: idParam\(body\.t\)/);
    // the old unconditional write must be gone
    expect(src).not.toMatch(/\n {2}recordDownloadEvent\(data\.url, data\.kind, data\.title\);/);
  });
});
