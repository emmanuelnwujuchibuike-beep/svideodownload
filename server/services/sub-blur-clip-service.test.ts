import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The worker's blurred-clip job (code review, 2026-10-30), driven for real with storage, the database reads and ffmpeg
 * stubbed:
 *   · a slot a creator's browser filled since the list was read is skipped BEFORE ffmpeg — nothing made, nothing uploaded;
 *   · a slot filled while ffmpeg ran has the upload deleted — never orphaned in the public bucket, never a "failure";
 *   · the retry map forgets expired entries, so the long-lived worker does not grow with the catalogue;
 *   · the endpoint refuses every call when the worker has no WORKER_SECRET (fails closed).
 */
const ITEM = { postId: "p1", idx: 0, key: "sub/p1/0.mp4", oldClip: null as string | null };

const storage = {
  hasR2: true,
  hasPrivateR2: true,
  presignPrivateGet: vi.fn(async () => "https://private.example/sub/p1/0.mp4?sig=1"),
  putR2: vi.fn(async (key: string) => `https://media.example/${key}`),
  deleteR2: vi.fn(async () => true),
  r2KeyOfPublicUrl: (url: unknown) => (typeof url === "string" && url.startsWith("https://media.example/") ? url.slice("https://media.example/".length) : null),
};
const rows = {
  lockedVideosNeedingClips: vi.fn(async () => [ITEM]),
  blurClipSlotOpen: vi.fn(async () => true),
  saveServerBlurClip: vi.fn(async () => true),
  lockedPostsNeedingStills: vi.fn(async () => [] as string[]),
  ensureBlurPreview: vi.fn(async () => {}),
};
let ffmpegExit = 0;
let ffmpegStderr = "";
const spawn = vi.fn(() => {
  const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() });
  setTimeout(() => {
    if (ffmpegStderr) child.stderr.emit("data", Buffer.from(ffmpegStderr));
    child.emit("close", ffmpegExit);
  }, 0);
  return child;
});

vi.mock("@/lib/storage/r2", () => storage);
vi.mock("@/lib/sub/blur-preview", () => rows);
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:fs/promises", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs/promises")>()), readFile: vi.fn(async () => Buffer.from("tiny mp4")) }));

async function freshService() {
  vi.resetModules();
  return import("./sub-blur-clip-service");
}

beforeEach(() => {
  ffmpegExit = 0;
  for (const f of [...Object.values(rows), storage.presignPrivateGet, storage.putR2, storage.deleteR2, spawn]) f.mockClear();
  rows.lockedVideosNeedingClips.mockImplementation(async () => [ITEM]);
  rows.blurClipSlotOpen.mockImplementation(async () => true);
  rows.saveServerBlurClip.mockImplementation(async () => true);
});

describe("the blurred-clip job", () => {
  it("makes, uploads and saves a missing clip", async () => {
    const { runSubBlurClips } = await freshService();
    expect(await runSubBlurClips()).toMatchObject({ clips: 1, failed: 0, alreadyFilled: 0 });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(storage.putR2).toHaveBeenCalledTimes(1);
    expect(storage.deleteR2).not.toHaveBeenCalled();
  });

  it("recipe 2: replacing an older clip removes the old file from the public bucket — and only once the new one is saved", async () => {
    rows.lockedVideosNeedingClips.mockImplementation(async () => [{ ...ITEM, oldClip: "https://media.example/uploads/old-clip.mp4" }]);
    const { runSubBlurClips } = await freshService();
    expect(await runSubBlurClips()).toMatchObject({ clips: 1 });
    expect(storage.deleteR2).toHaveBeenCalledWith("uploads/old-clip.mp4");
    // teeth: a refused save keeps the old clip (it is still what viewers play)
    storage.deleteR2.mockClear();
    rows.saveServerBlurClip.mockImplementation(async () => false);
    rows.blurClipSlotOpen.mockImplementationOnce(async () => true).mockImplementationOnce(async () => false);
    const again = await freshService();
    await again.runSubBlurClips();
    expect(storage.deleteR2).not.toHaveBeenCalledWith("uploads/old-clip.mp4");
  });

  it("🔴 a slot the creator's browser filled since the list was read: skipped before ffmpeg — nothing made or uploaded", async () => {
    rows.blurClipSlotOpen.mockImplementation(async () => false);
    const { runSubBlurClips } = await freshService();
    expect(await runSubBlurClips()).toMatchObject({ clips: 0, failed: 0, alreadyFilled: 1 });
    expect(spawn).not.toHaveBeenCalled();
    expect(storage.putR2).not.toHaveBeenCalled();
  });

  it("🔴 filled while ffmpeg ran: the upload is deleted (no orphan in the public bucket) and it is not a failure", async () => {
    rows.saveServerBlurClip.mockImplementation(async () => false);
    // open before ffmpeg, filled by the time the save ran
    rows.blurClipSlotOpen.mockImplementationOnce(async () => true).mockImplementationOnce(async () => false);
    const { runSubBlurClips } = await freshService();
    expect(await runSubBlurClips()).toMatchObject({ clips: 0, failed: 0, alreadyFilled: 1 });
    const uploadedKey = storage.putR2.mock.calls[0]![0];
    expect(uploadedKey).toMatch(/^sub-blur\/v3\/p1\/0-[a-z0-9]+\.mp4$/);
    expect(storage.deleteR2).toHaveBeenCalledWith(uploadedKey);
    // not held back: the next run looks at it again (and finds it filled)
    rows.blurClipSlotOpen.mockImplementation(async () => false);
    expect(await (await import("./sub-blur-clip-service")).runSubBlurClips()).toMatchObject({ alreadyFilled: 1 });
  });

  it("a save that fails with the slot still empty (a database error) is a real failure: upload deleted, retry window kept", async () => {
    rows.saveServerBlurClip.mockImplementation(async () => false);
    const { runSubBlurClips } = await freshService();
    expect(await runSubBlurClips()).toMatchObject({ clips: 0, failed: 1, alreadyFilled: 0 });
    expect(storage.deleteR2).toHaveBeenCalledWith(storage.putR2.mock.calls[0]![0]);
    // held back: the next run does not redo ffmpeg and the upload at once
    spawn.mockClear();
    expect(await runSubBlurClips()).toMatchObject({ clips: 0, failed: 0 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("🔴 a failure says WHY (admin check + log) — with the signed link to the private file removed", async () => {
    ffmpegExit = 1;
    ffmpegStderr = "https://acct.r2.cloudflarestorage.com/frenzsave-private/v.mp4?X-Amz-Signature=abc: Server returned 403 Forbidden";
    const { runSubBlurClips } = await freshService();
    const r = await runSubBlurClips();
    ffmpegExit = 0;
    ffmpegStderr = "";
    expect(r).toMatchObject({ failed: 1 });
    expect(r.firstError).toContain("403 Forbidden");
    expect(r.firstError).toContain("<link>");
    // teeth: the signature never reaches the admin or the log
    expect(r.firstError).not.toContain("X-Amz-Signature");
  });

  it("a real failure (ffmpeg exits non-zero) still waits out the retry window", async () => {
    ffmpegExit = 1;
    const { runSubBlurClips } = await freshService();
    expect(await runSubBlurClips()).toMatchObject({ clips: 0, failed: 1 });
    ffmpegExit = 0;
    spawn.mockClear();
    // same process, same item: skipped this time (no ffmpeg), not retried at once
    expect(await runSubBlurClips()).toMatchObject({ clips: 0, failed: 0 });
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("the retry map is bounded", () => {
  it("forgets entries older than the window and keeps the rest (teeth: an unpruned map keeps everything)", async () => {
    const { pruneFailedAt } = await freshService();
    const now = 10 * 60 * 60 * 1000;
    const map = new Map<string, number>([
      ["old-clip", now - 7 * 60 * 60 * 1000],
      ["old-post", now - 6 * 60 * 60 * 1000 - 1],
      ["recent", now - 60 * 1000],
    ]);
    pruneFailedAt(map, now);
    expect([...map.keys()]).toEqual(["recent"]);
  });
});

describe("POST /api/internal/sub/blur-clips", () => {
  async function route(secret: string | undefined) {
    vi.resetModules();
    if (secret === undefined) delete process.env.WORKER_SECRET;
    else process.env.WORKER_SECRET = secret;
    vi.doMock("@/server/services/sub-blur-clip-service", () => ({ runSubBlurClips: vi.fn(async () => ({ clips: 0, stillsTried: 0, failed: 0, alreadyFilled: 0 })) }));
    const { POST } = await import("@/app/api/internal/sub/blur-clips/route");
    const service = await import("@/server/services/sub-blur-clip-service");
    return { POST, run: service.runSubBlurClips as unknown as ReturnType<typeof vi.fn> };
  }
  const call = (headers: Record<string, string> = {}) => new Request("https://worker.example/api/internal/sub/blur-clips", { method: "POST", headers });

  it("🔴 no WORKER_SECRET on the worker: every call is refused and nothing runs (fails closed)", async () => {
    const { POST, run } = await route(undefined);
    const res = await POST(call());
    expect(res.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("a wrong or missing secret is refused; the right one starts the job", async () => {
    const { POST, run } = await route("s3cret");
    expect((await POST(call())).status).toBe(403);
    expect((await POST(call({ "x-worker-secret": "nope" }))).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
    expect((await POST(call({ "x-worker-secret": "s3cret" }))).status).toBe(202);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
