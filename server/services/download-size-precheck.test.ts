import { describe, expect, it, vi } from "vitest";

/**
 * Production, 2026-10-06, after the cap went live: a free request for the
 * 750 MB Telegram video sent NO headers for 120 s. The worker called Telegram
 * first (and its buffered fallback pulls the whole file to disk) and only then
 * learned the size. The size is already in the metadata — refuse on it before
 * any transfer starts.
 */

const telegramStream = vi.fn();
const telegramMedia = vi.fn();

vi.mock("./telegram-mtproto", () => ({
  downloadTelegramStream: (...a: unknown[]) => telegramStream(...a),
  downloadTelegramMedia: (...a: unknown[]) => telegramMedia(...a),
}));

vi.mock("@/server/extractors", () => ({
  getCachedMetadata: async () => ({
    title: "Chicas OF",
    formats: [
      { formatId: "tg-mt-0", kind: "video", ext: "mp4", filesize: 749_928_164, telegramRef: { username: "estrellitasof", messageId: 848 } },
    ],
  }),
  getMetadata: async () => {
    throw new Error("not reached");
  },
}));

describe("the size cap is checked before Telegram is touched", () => {
  it("a free caller is refused on the metadata size — no stream, no buffered download", async () => {
    const { resolveDownload, DownloadTooLargeError } = await import("./download-service");
    await expect(
      resolveDownload("https://t.me/estrellitasof/848", "tg-mt-0", "video", "v", { maxBytes: 200 * 1024 * 1024 }),
    ).rejects.toBeInstanceOf(DownloadTooLargeError);
    expect(telegramStream).not.toHaveBeenCalled();
    expect(telegramMedia).not.toHaveBeenCalled();
  });

  it("a Pro caller (no cap) goes on to Telegram", async () => {
    telegramStream.mockResolvedValueOnce({ stream: new ReadableStream(), ext: "mp4", contentType: "video/mp4", filesize: 749_928_164 });
    const { resolveDownload } = await import("./download-service");
    await resolveDownload("https://t.me/estrellitasof/848", "tg-mt-0", "video", "v", { maxBytes: Number.POSITIVE_INFINITY });
    expect(telegramStream).toHaveBeenCalledTimes(1);
  });
});
