import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";

import { VALIDATION_THRESHOLDS } from "@/lib/ai/preflight/config";
import type { Box, FaceDetection, FrameMeasurement, PersonDetection } from "@/lib/ai/preflight/measure";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREFLIGHT — the computer-vision layer, on the WORKER (brief §19 layer 2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two small ONNX models through onnxruntime-node, on frames ffmpeg decodes
 * to raw pixels — no image library, no full-resolution passes, no GPU:
 *
 *   YuNet (face_detection_yunet_2023mar, OpenCV Zoo, Apache 2.0, 232 KB)
 *     faces with a confidence and five landmarks, on a 640×640 letterbox.
 *   YOLOX-nano (Megvii 0.1.1rc0, Apache 2.0, 3.6 MB)
 *     people (COCO class 0) with a confidence, on a 416×416 letterbox.
 *     🔴 This export takes RAW 0–255 BGR and answers probabilities already —
 *     measured 2026-09-20: a normalised input finds nothing.
 *
 * Both were verified on real uploads before this shipped (scripts/
 * _preflight-proto.tmp.mjs): a phone portrait → face 0.93 at 29 % of the
 * frame height, person box running off the bottom; an interview frame →
 * face 0.94 at 44 %, a head-and-shoulders person box.
 *
 * Sharpness is the variance of a 3×3 Laplacian over a 256px grey render —
 * the classic blur measure, cheap, and only compared against thresholds
 * tuned on the same render size.
 *
 * Sessions are created once per process and reused. A frame costs roughly
 * 0.3–0.6 s on the worker's CPU including the two ffmpeg decodes; six
 * frames plus the photo is under ten seconds for any video this product
 * accepts (brief §15).
 */

const MODELS_DIR = path.join(process.cwd(), "server", "preflight", "models");
const YUNET_FILE = path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx");
const YOLOX_FILE = path.join(MODELS_DIR, "yolox_nano.onnx");
const FACE_SIZE = 640;
const PERSON_SIZE = 416;
const SHARPNESS_SIZE = 256;
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

type OrtModule = typeof import("onnxruntime-node");
type Session = import("onnxruntime-node").InferenceSession;

let ortPromise: Promise<OrtModule> | null = null;
let yunetPromise: Promise<Session> | null = null;
let yoloxPromise: Promise<Session> | null = null;

async function ort(): Promise<OrtModule> {
  /*
    🔴 A COMPUTED specifier, on purpose. A literal `import("onnxruntime-node")`
    is followed by webpack and by Vercel's file tracer, which would drag the
    runtime's ~180 MB of native binaries (three platforms) into a serverless
    function that never runs it. Built from two halves, the import is opaque
    to both; at runtime on the WORKER Node resolves it from node_modules,
    which the Dockerfile copies in explicitly (linux x64 only).
  */
  const specifier = ["onnxruntime", "node"].join("-");
  ortPromise ??= import(/* webpackIgnore: true */ specifier) as Promise<OrtModule>;
  return ortPromise;
}
async function yunet(): Promise<Session> {
  yunetPromise ??= ort().then((m) => m.InferenceSession.create(YUNET_FILE, { intraOpNumThreads: 2 }));
  return yunetPromise;
}
async function yolox(): Promise<Session> {
  yoloxPromise ??= ort().then((m) => m.InferenceSession.create(YOLOX_FILE, { intraOpNumThreads: 2 }));
  return yoloxPromise;
}

/** Whether the models and the runtime are present here (the worker), so a missing piece is a loud "unavailable", not a pass. */
export async function detectorsAvailable(): Promise<boolean> {
  try {
    await Promise.all([yunet(), yolox()]);
    return true;
  } catch (e) {
    console.error("[preflight] detectors unavailable", { error: String(e).slice(0, 300) });
    return false;
  }
}

function runFfmpeg(args: string[], maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      size += d.length;
      if (size > maxBytes) {
        child.kill("SIGKILL");
        reject(new Error("ffmpeg output over the ceiling"));
        return;
      }
      chunks.push(d);
    });
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`))));
  });
}

/** One frame, letterboxed into size×size grey padding, as raw rgb24. */
async function decodeLetterboxed(file: string, size: number, seekSeconds: number | null): Promise<Buffer> {
  const vf = `scale=${size}:${size}:force_original_aspect_ratio=decrease:flags=area,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x727272`;
  const args = ["-v", "error", "-nostdin", ...(seekSeconds !== null ? ["-ss", seekSeconds.toFixed(3)] : []), "-i", file, "-frames:v", "1", "-vf", vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"];
  const buf = await runFfmpeg(args, size * size * 3 + 1024);
  if (buf.length !== size * size * 3) throw new Error(`decoded ${buf.length} bytes, expected ${size * size * 3}`);
  return buf;
}

/** A small grey render, straight from ffmpeg, for the sharpness measure. */
/** One grey frame, the source aspect fitted into `size`; its real dimensions are recovered by the caller from the byte count and the source aspect. */
async function decodeGrey(file: string, size: number, seekSeconds: number | null): Promise<Buffer> {
  const args = ["-v", "error", "-nostdin", ...(seekSeconds !== null ? ["-ss", seekSeconds.toFixed(3)] : []), "-i", file, "-frames:v", "1", "-vf", `scale=${size}:${size}:force_original_aspect_ratio=decrease:flags=area`, "-f", "rawvideo", "-pix_fmt", "gray", "-"];
  return runFfmpeg(args, size * size + 1024);
}

export interface MediaDims {
  width: number;
  height: number;
  durationMs: number | null;
}

/** ffprobe: the frame size (and duration) of an image or a video. Null when unreadable. */
export async function probeDims(file: string): Promise<MediaDims | null> {
  return new Promise((resolve) => {
    const child = spawn(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        const j = JSON.parse(out) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
        const s = j.streams?.[0];
        if (!s?.width || !s?.height) return resolve(null);
        const d = Number(j.format?.duration);
        resolve({ width: s.width, height: s.height, durationMs: Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null });
      } catch {
        resolve(null);
      }
    });
  });
}

interface Letterbox {
  scale: number;
  padX: number;
  padY: number;
}
function letterbox(srcW: number, srcH: number, size: number): Letterbox {
  const scale = Math.min(size / srcW, size / srcH);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  return { scale, padX: Math.floor((size - w) / 2), padY: Math.floor((size - h) / 2) };
}
function unbox(b: Box, lb: Letterbox): Box {
  return { x: (b.x - lb.padX) / lb.scale, y: (b.y - lb.padY) / lb.scale, w: b.w / lb.scale, h: b.h / lb.scale };
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
function nms<T extends { score: number; box: Box }>(items: T[], threshold: number): T[] {
  items.sort((a, b) => b.score - a.score);
  const keep: T[] = [];
  for (const it of items) if (keep.every((k) => iou(k.box, it.box) < threshold)) keep.push(it);
  return keep;
}

/** YuNet on a letterboxed rgb24 buffer: boxes and landmarks in SOURCE pixels. */
async function detectFaces(rgb: Buffer, lb: Letterbox): Promise<FaceDetection[]> {
  const size = FACE_SIZE;
  const n = size * size;
  const data = new Float32Array(3 * n);
  // BGR 0–255, NCHW — OpenCV's own blob for this model
  for (let i = 0; i < n; i++) {
    data[i] = rgb[i * 3 + 2]!;
    data[n + i] = rgb[i * 3 + 1]!;
    data[2 * n + i] = rgb[i * 3]!;
  }
  const o = await ort();
  const session = await yunet();
  const out = await session.run({ [session.inputNames[0]!]: new o.Tensor("float32", data, [1, 3, size, size]) });
  const found: FaceDetection[] = [];
  for (const stride of [8, 16, 32]) {
    const cls = out[`cls_${stride}`]!.data as Float32Array;
    const obj = out[`obj_${stride}`]!.data as Float32Array;
    const bb = out[`bbox_${stride}`]!.data as Float32Array;
    const kp = out[`kps_${stride}`]!.data as Float32Array;
    const cols = size / stride;
    const rows = size / stride;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const score = Math.sqrt(Math.max(0, Math.min(1, cls[i]!)) * Math.max(0, Math.min(1, obj[i]!)));
        if (score < 0.5) continue;
        const cx = (c + bb[i * 4]!) * stride;
        const cy = (r + bb[i * 4 + 1]!) * stride;
        const w = Math.exp(bb[i * 4 + 2]!) * stride;
        const h = Math.exp(bb[i * 4 + 3]!) * stride;
        const landmarks: [number, number][] = [];
        for (let k = 0; k < 5; k++) landmarks.push([(c + kp[i * 10 + k * 2]!) * stride, (r + kp[i * 10 + k * 2 + 1]!) * stride]);
        found.push({ score, box: { x: cx - w / 2, y: cy - h / 2, w, h }, landmarks });
      }
    }
  }
  return nms(found, 0.3).map((f) => ({
    score: f.score,
    box: unbox(f.box, lb),
    landmarks: f.landmarks.map(([x, y]) => [(x - lb.padX) / lb.scale, (y - lb.padY) / lb.scale] as [number, number]),
  }));
}

/** YOLOX-nano on a letterboxed rgb24 buffer: person boxes in SOURCE pixels. */
async function detectPeople(rgb: Buffer, lb: Letterbox): Promise<PersonDetection[]> {
  const size = PERSON_SIZE;
  const n = size * size;
  const data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    data[i] = rgb[i * 3 + 2]!;
    data[n + i] = rgb[i * 3 + 1]!;
    data[2 * n + i] = rgb[i * 3]!;
  }
  const o = await ort();
  const session = await yolox();
  const out = await session.run({ [session.inputNames[0]!]: new o.Tensor("float32", data, [1, 3, size, size]) });
  const t = out[session.outputNames[0]!]!;
  const d = t.data as Float32Array;
  const width = t.dims[2]!;
  const found: PersonDetection[] = [];
  let idx = 0;
  for (const stride of [8, 16, 32]) {
    const g = size / stride;
    for (let r = 0; r < g; r++) {
      for (let c = 0; c < g; c++) {
        const b = idx * width;
        const score = d[b + 4]! * d[b + 5]!; // objectness × class 0 (person); already probabilities
        if (score >= 0.3) {
          const x = (d[b]! + c) * stride;
          const y = (d[b + 1]! + r) * stride;
          const w = Math.exp(d[b + 2]!) * stride;
          const h = Math.exp(d[b + 3]!) * stride;
          found.push({ score, box: { x: x - w / 2, y: y - h / 2, w, h } });
        }
        idx++;
      }
    }
  }
  return nms(found, 0.45).map((p) => ({ score: p.score, box: unbox(p.box, lb) }));
}

/** Variance of the Laplacian over a grey render — the blur measure. */
function laplacianVariance(grey: Buffer, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = 4 * grey[i]! - grey[i - 1]! - grey[i + 1]! - grey[i - width]! - grey[i + width]!;
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

/** Measure one image, or one frame of a video (at `position` 0–1 of its duration). */
export async function measureFrame(file: string, dims: MediaDims, position: number | null): Promise<FrameMeasurement> {
  const seek = position !== null && dims.durationMs ? Math.max(0, (dims.durationMs / 1000) * position) : null;
  const lbF = letterbox(dims.width, dims.height, FACE_SIZE);
  const lbP = letterbox(dims.width, dims.height, PERSON_SIZE);
  const [rgbF, rgbP, grey] = await Promise.all([decodeLetterboxed(file, FACE_SIZE, seek), decodeLetterboxed(file, PERSON_SIZE, seek), decodeGrey(file, SHARPNESS_SIZE, seek)]);
  // the grey render's real size: the source aspect fitted into SHARPNESS_SIZE
  const gScale = Math.min(SHARPNESS_SIZE / dims.width, SHARPNESS_SIZE / dims.height);
  let gw = Math.round(dims.width * gScale);
  let gh = Math.round(dims.height * gScale);
  if (gw * gh !== grey.length) {
    // ffmpeg rounds to even sizes for some scalers; recover the width from the byte count
    const guess = Math.round(Math.sqrt(grey.length * (dims.width / dims.height)));
    gw = guess;
    gh = Math.floor(grey.length / Math.max(1, guess));
  }
  const [faces, people] = await Promise.all([detectFaces(rgbF, lbF), detectPeople(rgbP, lbP)]);
  return { width: dims.width, height: dims.height, faces, people, sharpness: laplacianVariance(grey, gw, gh), position };
}

/** The photo: dims, then one measurement. Null when unreadable. */
export async function measureImage(file: string): Promise<FrameMeasurement | null> {
  const dims = await probeDims(file);
  if (!dims) return null;
  try {
    return await measureFrame(file, { ...dims, durationMs: null }, null);
  } catch (e) {
    console.warn("[preflight] image could not be measured", { error: String(e).slice(0, 200) });
    return null;
  }
}

/**
 * The video: sampled at the configured positions (brief §6), each frame
 * measured; a frame that fails to decode is simply not counted. Frames are
 * processed two at a time — enough to overlap ffmpeg with inference, not
 * enough to spike the worker's memory.
 */
export async function measureVideo(file: string): Promise<{ dims: MediaDims; frames: FrameMeasurement[] } | null> {
  const dims = await probeDims(file);
  if (!dims || !dims.durationMs) return null;
  const positions = VALIDATION_THRESHOLDS.videoSamplePositions;
  const frames: FrameMeasurement[] = [];
  for (let i = 0; i < positions.length; i += 2) {
    const batch = positions.slice(i, i + 2);
    const results = await Promise.all(batch.map((p) => measureFrame(file, dims, p).catch((e) => (console.warn("[preflight] frame skipped", { position: p, error: String(e).slice(0, 160) }), null))));
    for (const r of results) if (r) frames.push(r);
  }
  return { dims, frames };
}
