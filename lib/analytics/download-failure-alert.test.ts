import { describe, expect, it } from "vitest";

import { outcomeDedupeKey } from "./download-failure-alert";

/**
 * One admin alert per LINK (owner, 2026-08-26: "the failed, cancelled and
 * abandoned email and push notification sent to the admin should send one per
 * link, not each media in a batch download, causing email and push notification
 * spamming i dont want").
 *
 * `admin_alerts.key` is UNIQUE, so this key IS the fan-out gate: whichever media
 * item of a link reaches the insert first wins it and every sibling silently
 * no-ops. Which means the shape of this string is the whole feature, and the two
 * ways to get it wrong are opposite — too coarse under-reports real failures,
 * too fine restores the spam.
 */
describe("outcomeDedupeKey", () => {
  it("collapses every media item of ONE link to a single key", () => {
    // A slideshow: one pasted link, ten photos, ten download ids, one batch.
    const keys = new Set(
      Array.from({ length: 10 }, (_, i) =>
        outcomeDedupeKey({ status: "failed", downloadId: `dl-${i}`, batchId: "batch-1", linkKey: "batch-1" }),
      ),
    );
    expect(keys.size, "a slideshow still alerts once per photo").toBe(1);
  });

  it("🔴 keeps DIFFERENT links in one batch apart", () => {
    // The opposite failure, and the reason this is not keyed on batchId alone:
    // ten broken links reported as one is under-reporting, not tidiness.
    const keys = new Set(
      ["src-a", "src-b", "src-c"].map((linkKey) =>
        outcomeDedupeKey({ status: "failed", downloadId: crypto.randomUUID(), batchId: "batch-1", linkKey }),
      ),
    );
    expect(keys.size, "separate links in a multi-link batch collapsed into one alert").toBe(3);
  });

  it("falls back to the download id when there is no batch", () => {
    // A plain single download — and every row written before migration 0137,
    // which has no batch recorded. Must behave exactly as it did before.
    expect(outcomeDedupeKey({ status: "failed", downloadId: "dl-9", batchId: null, linkKey: null })).toBe("download:failed:dl-9");
    expect(outcomeDedupeKey({ status: "cancelled", downloadId: "dl-9" })).toBe("download:cancelled:dl-9");
  });

  it("treats a batch with no linkKey as one link", () => {
    // A single link that expanded into several media leaves linkKey unset; the
    // batch already means "this one link".
    const a = outcomeDedupeKey({ status: "timed_out", downloadId: "dl-1", batchId: "b1" });
    const b = outcomeDedupeKey({ status: "timed_out", downloadId: "dl-2", batchId: "b1" });
    expect(a).toBe(b);
  });

  it("never merges different OUTCOMES of the same link", () => {
    // A link that failed and a link that was cancelled are two things an
    // operator needs to see, even for the same batch.
    const failed = outcomeDedupeKey({ status: "failed", downloadId: "dl-1", batchId: "b1", linkKey: "s1" });
    const cancelled = outcomeDedupeKey({ status: "cancelled", downloadId: "dl-1", batchId: "b1", linkKey: "s1" });
    const abandoned = outcomeDedupeKey({ status: "timed_out", downloadId: "dl-1", batchId: "b1", linkKey: "s1" });
    expect(new Set([failed, cancelled, abandoned]).size).toBe(3);
  });

  it("never merges the same link across two different batches", () => {
    // Retrying the same link tomorrow is a new failure worth hearing about.
    const first = outcomeDedupeKey({ status: "failed", downloadId: "dl-1", batchId: "b1", linkKey: "s1" });
    const second = outcomeDedupeKey({ status: "failed", downloadId: "dl-2", batchId: "b2", linkKey: "s1" });
    expect(first).not.toBe(second);
  });
});
