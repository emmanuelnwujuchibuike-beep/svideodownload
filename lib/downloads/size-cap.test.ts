import { afterEach, describe, expect, it, vi } from "vitest";

import { isRetryable } from "@/features/downloads/retry-policy";
import { DEFAULT_MAX_DOWNLOAD_BYTES, isTooLarge, maxDownloadBytes, tooLargeMessage } from "@/lib/downloads/size-cap";
import { proxyToWorker } from "@/lib/worker";

/**
 * 🔴 2026-10-06 — Railway egress $7 in 2 hours. t.me/estrellitasof/848 is a
 * 750 MB video; it was requested 76 times in 3 hours, every attempt streamed
 * hundreds of MB out of Railway and none could finish.
 */

const TELEGRAM_848_BYTES = 749_928_164;

afterEach(() => vi.unstubAllGlobals());

describe("the download size cap", () => {
  it("refuses the file that caused the spike, allows ordinary ones", () => {
    expect(isTooLarge(TELEGRAM_848_BYTES)).toBe(true);
    expect(isTooLarge(3_775_770)).toBe(false); // t.me/durov/396, which downloaded fine
    expect(isTooLarge(null)).toBe(false); // unknown size is not refused (fails open)
    expect(maxDownloadBytes({})).toBe(DEFAULT_MAX_DOWNLOAD_BYTES);
    expect(maxDownloadBytes({ DOWNLOAD_MAX_BYTES: "1000" })).toBe(1000);
    expect(maxDownloadBytes({ DOWNLOAD_MAX_BYTES: "nonsense" })).toBe(DEFAULT_MAX_DOWNLOAD_BYTES);
  });

  it("the refusal is never retried", () => {
    expect(isRetryable(tooLargeMessage(TELEGRAM_848_BYTES))).toBe(false);
    expect(isRetryable("Failed to fetch")).toBe(true);
  });

  it("Vercel's proxy cancels the worker stream the moment its headers show an oversized file", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200, headers: { "content-length": String(TELEGRAM_848_BYTES), "content-type": "video/mp4" } })),
    );
    const res = await proxyToWorker("/api/download", { url: "https://t.me/estrellitasof/848" }, "1.2.3.4");
    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(((await res.json()) as { code: string }).code).toBe("FILE_TOO_LARGE");
  });

  it("an ordinary file streams through untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bytes", { status: 200, headers: { "content-length": "5", "content-type": "video/mp4" } })),
    );
    const res = await proxyToWorker("/api/download", {}, "1.2.3.4");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("bytes");
  });
});

describe("the cap is a free-plan rule (owner, 2026-10-06)", () => {
  it("free and signed-out are capped; Pro and Business are not", async () => {
    const { maxDownloadBytesFor } = await import("@/lib/downloads/size-cap");
    expect(isTooLarge(TELEGRAM_848_BYTES, maxDownloadBytesFor("free"))).toBe(true);
    expect(isTooLarge(TELEGRAM_848_BYTES, maxDownloadBytesFor(null))).toBe(true);
    expect(isTooLarge(TELEGRAM_848_BYTES, maxDownloadBytesFor("pro"))).toBe(false);
    expect(isTooLarge(TELEGRAM_848_BYTES, maxDownloadBytesFor("business"))).toBe(false);
  });

  it("a Pro caller's proxied download is NOT cut, and the worker is told so", async () => {
    let sentCap: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { headers: Record<string, string> }) => {
        sentCap = init.headers["x-max-download-bytes"] ?? null;
        return new Response("bytes", { status: 200, headers: { "content-length": String(TELEGRAM_848_BYTES) } });
      }),
    );
    const res = await proxyToWorker("/api/download", {}, "1.2.3.4", { maxBytes: Number.POSITIVE_INFINITY });
    expect(res.status).toBe(200);
    expect(sentCap).toBe("none");
  });

  it("the header round-trips, and an absent header means the free cap", async () => {
    const { capFromHeader, capToHeader } = await import("@/lib/downloads/size-cap");
    expect(capFromHeader(capToHeader(Number.POSITIVE_INFINITY))).toBe(Number.POSITIVE_INFINITY);
    expect(capFromHeader(capToHeader(1234))).toBe(1234);
    expect(capFromHeader(null)).toBe(DEFAULT_MAX_DOWNLOAD_BYTES);
    expect(capFromHeader("garbage")).toBe(DEFAULT_MAX_DOWNLOAD_BYTES);
  });

  it("the free message says how to get it, and is never retried", () => {
    const msg = tooLargeMessage(TELEGRAM_848_BYTES);
    expect(msg).toMatch(/Pro/);
    expect(isRetryable(msg)).toBe(false);
  });
});

describe("Telegram's ceiling is what can finish through Vercel (2026-10-06)", () => {
  it("the 99–283 MB files being retried are refused for every plan; a short clip is not", async () => {
    const { capForDownload } = await import("@/lib/downloads/size-cap");
    for (const plan of ["free", "pro", "business", null]) {
      const cap = capForDownload(plan, "https://t.me/todofamosas/80419", true);
      expect(isTooLarge(99 * 1048576, cap)).toBe(true);
      expect(isTooLarge(3_775_770, cap)).toBe(false);
    }
  });

  it("other platforms keep the plan cap; Telegram without Vercel in the path keeps it too", async () => {
    const { capForDownload, maxDownloadBytesFor } = await import("@/lib/downloads/size-cap");
    expect(capForDownload("free", "https://www.tiktok.com/@a/video/1", true)).toBe(maxDownloadBytesFor("free"));
    expect(capForDownload("pro", "https://t.me/x/1", false)).toBe(Number.POSITIVE_INFINITY);
  });

  it("the Telegram refusal does not sell Pro, and is never retried", async () => {
    const { telegramMaxBytes } = await import("@/lib/downloads/size-cap");
    const msg = tooLargeMessage(109 * 1048576, telegramMaxBytes());
    expect(msg).toMatch(/Telegram/);
    expect(msg).not.toMatch(/Pro/);
    expect(isRetryable(msg)).toBe(false);
  });
});
