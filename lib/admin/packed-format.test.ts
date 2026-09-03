import { describe, expect, it } from "vitest";

import { resolveDownloadStatus } from "./packed-format";

/**
 * Owner, 2026-09-03: live activity "shows all download status as completed,
 * even failed, canceled and abandoned".
 *
 * This is the arithmetic behind that, and it is worth pinning because the bug
 * class — a failure that renders as a success — has cost this project a day
 * more than once. `downloads.status` is `not null default 'completed'`, so the
 * column is never falsy and a naive `column || packed` can never reach the
 * packed value.
 */

describe("resolveDownloadStatus", () => {
  it("prefers an explicit PACKED status over a column sitting at its default", () => {
    // The exact shape of the bug: the column defaulted, the client recorded the
    // truth in `format`, and the column won.
    expect(resolveDownloadStatus("failed", "completed")).toBe("failed");
    expect(resolveDownloadStatus("cancelled", "completed")).toBe("cancelled");
    // "abandoned" is the one the owner named, and it is not in any allowlist.
    expect(resolveDownloadStatus("abandoned", "completed")).toBe("abandoned");
  });

  it("passes through a status nobody has thought of yet", () => {
    // The encoder writes an empty field for a completed download, so ANY
    // non-empty value is by construction a real, non-completed outcome. A new
    // one must survive rather than silently become a success.
    expect(resolveDownloadStatus("expired", "completed")).toBe("expired");
  });

  it("falls back to the column when nothing was packed — server-side rows", () => {
    expect(resolveDownloadStatus(null, "failed")).toBe("failed");
    expect(resolveDownloadStatus(null, "completed")).toBe("completed");
    expect(resolveDownloadStatus("", "processing")).toBe("processing");
  });

  it("says completed only when BOTH sources are silent", () => {
    expect(resolveDownloadStatus(null, null)).toBe("completed");
    expect(resolveDownloadStatus("", "")).toBe("completed");
  });

  it("never reports a completed download as anything else", () => {
    // The direction that matters least but must still hold: a genuinely
    // finished download packs an empty field and the column agrees.
    expect(resolveDownloadStatus(null, "completed")).toBe("completed");
  });
});
