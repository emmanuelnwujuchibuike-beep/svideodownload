import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The worker's sound-mix job (0308), driven for real with storage, the database and ffmpeg stubbed:
 *   · a pending reel is mixed, uploaded, and pointed at the new file;
 *   · a reel that stopped being pending meanwhile has the upload deleted — never orphaned in the public bucket;
 *   · a reel that keeps failing is given up after MAX_MIX_ATTEMPTS and keeps its own audio.
 */
const ITEM = { postId: "p1", publisherId: "u1", videoUrl: "https://media.example/r.mp4", soundUrl: "https://media.example/s.mp4" };

const storage = {
  hasR2: true,
  putR2: vi.fn(async (key: string) => `https://media.example/${key}`),
  deleteR2: vi.fn(async () => true),
};
const rows = {
  pendingSoundMixes: vi.fn(async () => [ITEM]),
  finishSoundMix: vi.fn(async () => true),
  failSoundMix: vi.fn(async () => {}),
};
let ffmpegExit = 0;
const spawn = vi.fn(() => {
  const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() });
  setTimeout(() => child.emit("close", ffmpegExit), 0);
  return child;
});

vi.mock("@/lib/storage/r2", () => storage);
vi.mock("@/lib/social/sound-mix", () => rows);
vi.mock("@/lib/social/home-feed", () => ({ bustHomeFeedCache: vi.fn(async () => {}) }));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:fs/promises", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs/promises")>()), readFile: vi.fn(async () => Buffer.from("mixed mp4")) }));

async function freshService() {
  vi.resetModules();
  return import("./sound-mix-service");
}

beforeEach(() => {
  ffmpegExit = 0;
  for (const f of [...Object.values(rows), storage.putR2, storage.deleteR2, spawn]) f.mockClear();
  // the queue empties once a reel is done (the job reads it again until it is empty)
  let served = false;
  rows.pendingSoundMixes.mockImplementation(async () => (served ? [] : ((served = true), [ITEM])));
  rows.finishSoundMix.mockImplementation(async () => true);
});

describe("the sound-mix job", () => {
  it("mixes a pending reel, stores it under a new key and points the reel at it", async () => {
    const { runSoundMixes } = await freshService();
    expect(await runSoundMixes()).toMatchObject({ mixed: 1, failed: 0 });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(storage.putR2.mock.calls[0]![0]).toMatch(/^reels\/sound-mix\/p1-/);
    expect(rows.finishSoundMix).toHaveBeenCalledWith("p1", expect.stringMatching(/^https:\/\/media\.example\/reels\/sound-mix\/p1-/));
    expect(storage.deleteR2).not.toHaveBeenCalled();
  });

  it("🔴 no longer pending when it finished (deleted meanwhile): the upload is deleted, never orphaned", async () => {
    rows.finishSoundMix.mockImplementation(async () => false);
    const { runSoundMixes } = await freshService();
    expect(await runSoundMixes()).toMatchObject({ mixed: 0, failed: 0 });
    expect(storage.deleteR2).toHaveBeenCalledWith(storage.putR2.mock.calls[0]![0]);
  });

  it("a reel that keeps failing is given up after MAX_MIX_ATTEMPTS — and not before (teeth)", async () => {
    ffmpegExit = 1;
    rows.pendingSoundMixes.mockImplementation(async () => [ITEM]);
    const svc = await freshService();
    const realNow = Date.now;
    let t = realNow();
    Date.now = () => t;
    try {
      for (let i = 1; i < svc.MAX_MIX_ATTEMPTS; i++) {
        expect(await svc.runSoundMixes()).toMatchObject({ failed: 1, gaveUp: 0 });
        expect(rows.failSoundMix).not.toHaveBeenCalled();
        // the same run never retries it at once
        t += 11 * 60 * 1000;
      }
      expect(await svc.runSoundMixes()).toMatchObject({ failed: 1, gaveUp: 1 });
      expect(rows.failSoundMix).toHaveBeenCalledWith("p1");
    } finally {
      Date.now = realNow;
    }
  });

  it("waits out the retry window after a failure (a broken reel never holds the queue on every kick)", async () => {
    ffmpegExit = 1;
    rows.pendingSoundMixes.mockImplementation(async () => [ITEM]);
    const { runSoundMixes } = await freshService();
    await runSoundMixes();
    spawn.mockClear();
    expect(await runSoundMixes()).toMatchObject({ mixed: 0, failed: 0 });
    expect(spawn).not.toHaveBeenCalled();
  });
});
