import "server-only";

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { watermarkMarkResponse } from "@/lib/media/watermark-mark";
import { buildWatermarkArgs, displayedSize } from "@/lib/media/watermark-args";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
/** A post video over this is refused rather than re-encoded. */
export const WATERMARK_MAX_BYTES = 400 * 1024 * 1024;
const ENCODE_TIMEOUT_MS = 270_000;

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < 4000) err += d.toString();
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(0, 500)}`));
    });
  });
}

/** The first video stream's displayed size — rotation from the side data, or the legacy `rotate` tag. */
function probeSize(file: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const child = spawn(
      FFPROBE,
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data=rotation:stream_tags=rotate", "-of", "json", file],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        const s = (JSON.parse(out) as { streams?: { width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[] }).streams?.[0];
        if (!s) return resolve(null);
        const rotation = s.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation ?? Number(s.tags?.rotate ?? 0);
        resolve(displayedSize({ width: s.width, height: s.height, rotation }));
      } catch {
        resolve(null);
      }
    });
  });
}

export class WatermarkError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Downloads the post video, burns in the mark, and returns the result as a
 * stream that deletes its temp directory once it has been read (or abandoned).
 */
export async function watermarkVideo(src: string, handle: string): Promise<{ body: ReadableStream<Uint8Array>; size: number }> {
  const dir = await mkdtemp(join(tmpdir(), "wm-"));
  const cleanup = () => void rm(dir, { recursive: true, force: true }).catch(() => {});
  try {
    const input = join(dir, "in");
    const mark = join(dir, "mark.png");
    const output = join(dir, "out.mp4");

    const res = await fetch(src);
    if (!res.ok || !res.body) throw new WatermarkError("Couldn't fetch this video.", 502);
    if (Number(res.headers.get("content-length")) > WATERMARK_MAX_BYTES) throw new WatermarkError("This video is too large to watermark.", 413);
    let seen = 0;
    // streamed to disk with a byte cap — a lying or absent content-length can't fill the disk
    const cap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        seen += chunk.length;
        cb(seen > WATERMARK_MAX_BYTES ? new WatermarkError("This video is too large to watermark.", 413) : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), cap, createWriteStream(input));

    const frame = await probeSize(input);
    if (!frame) throw new WatermarkError("This file isn't a video we can watermark.", 422);
    await writeFile(mark, Buffer.from(await watermarkMarkResponse(handle).arrayBuffer()));
    await run(FFMPEG, buildWatermarkArgs(input, mark, output, frame), ENCODE_TIMEOUT_MS);

    const { size } = await stat(output);
    const file = createReadStream(output);
    file.on("close", cleanup);
    return { body: Readable.toWeb(file) as unknown as ReadableStream<Uint8Array>, size };
  } catch (e) {
    cleanup();
    if (e instanceof WatermarkError) throw e;
    console.error("[watermark] failed", e instanceof Error ? e.message : e);
    throw new WatermarkError("Couldn't add the watermark. Please try again.", 500);
  }
}
