import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 6 §30 — ONE SHORT REAL RUN AGAINST EVERY NEW PROVIDER (opt-in)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Skipped unless FRENZ_LIVE_PROVIDER_TEST=1 with FRENZ_LIVE_PROBE_VIDEO and
 * FRENZ_LIVE_PROBE_FACE set to local files — it spends real Replicate credit
 * (cents: a 3-second clip through xrunda/hello, prunaai/p-video-replace,
 * minimax/speech-02-hd and sync/lipsync-2-pro) and needs .env.local. It
 * exercises the REAL adapters: the payload each builds, the prediction it
 * creates, and the output the provider returns — then reports prediction
 * ids and output facts. Never secrets, never media contents.
 *
 * Inputs: a 3 s cut of a clip the owner shared this session, and a frame of
 * an earlier result as the reference face — uploaded to the private source
 * bucket under a `_live-probe` member folder and signed the way the
 * pipeline signs them. The objects are removed at the end.
 */
const LIVE = process.env.FRENZ_LIVE_PROVIDER_TEST === "1";
const ROOT = process.cwd();
/** A local video with one clearly visible person (any length; 3 s from 6 s in are used) and a video or image to take the reference face from. */
const SOURCE = process.env.FRENZ_LIVE_PROBE_VIDEO ?? "";
const FACE_FROM = process.env.FRENZ_LIVE_PROBE_FACE ?? "";

function loadEnv() {
  const env = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^"|"$/g, "");
  }
}

describe.skipIf(!LIVE || !SOURCE || !FACE_FROM)("live providers (opt-in, spends cents)", () => {
  it(
    "xrunda/hello · p-video-replace · MiniMax TTS · lipsync-2-pro each accept our payload and return a usable output",
    async () => {
      loadEnv();
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const { faceOnlyProvider } = await import("./providers/face-only");
      const { skinFaceProvider } = await import("./providers/skin-face");
      const { textToSpeechProviderFor } = await import("@/lib/ai/voice/tts-provider");
      const { lipSyncProviderFor } = await import("@/lib/ai/voice/lipsync-provider");
      const { replicateProvider } = await import("@/lib/ai/replicate/provider");
      const { AI_SOURCE_BUCKET } = await import("@/lib/ai/storage");
      const { extractOutputUrl } = await import("@/lib/ai/replicate/status");

      /* ── the assets: a 3 s cut and one face frame ─────────────────────── */
      const dir = path.join(ROOT, ".next", "live-probe");
      mkdirSync(dir, { recursive: true });
      const clip = path.join(dir, "clip.mp4");
      const face = path.join(dir, "face.jpg");
      if (!existsSync(clip)) execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", "6", "-i", SOURCE, "-t", "3", "-vf", "scale=-2:640", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", clip]);
      if (!existsSync(face)) execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", "4", "-i", FACE_FROM, "-frames:v", "1", "-vf", "crop=iw:ih*0.6:0:0,scale=720:-2", "-q:v", "2", face]);

      const admin = createAdminClient();
      const folder = "_live-probe/aicharacterreplace/part6";
      const put = async (key: string, file: string, type: string) => {
        const { error } = await admin.storage.from(AI_SOURCE_BUCKET).upload(key, readFileSync(file), { contentType: type, upsert: true });
        if (error) throw new Error(error.message);
        const { data, error: signError } = await admin.storage.from(AI_SOURCE_BUCKET).createSignedUrl(key, 2 * 60 * 60);
        if (signError || !data?.signedUrl) throw new Error(signError?.message ?? "no url");
        return data.signedUrl;
      };
      const clipUrl = await put(`${folder}/clip.mp4`, clip, "video/mp4");
      const faceUrl = await put(`${folder}/face.jpg`, face, "image/jpeg");
      const webhookUrl = "https://frenzsave.com/api/ai/replicate/webhook";

      const wait = async (reference: string, label: string) => {
        const started = Date.now();
        for (;;) {
          const s = await replicateProvider.poll(reference);
          if (s.status === "completed") return s;
          if (s.status === "failed" || s.status === "cancelled") throw new Error(`${label} ${s.status}: ${s.detail ?? ""}`);
          if (Date.now() - started > 8 * 60_000) throw new Error(`${label} timed out`);
          await new Promise((r) => setTimeout(r, 5_000));
        }
      };
      const probe = async (url: string, label: string) => {
        const res = await fetch(url);
        expect(res.ok, `${label} output fetch`).toBe(true);
        const buf = Buffer.from(await res.arrayBuffer());
        const file = path.join(dir, `${label}.out`);
        await (await import("node:fs/promises")).writeFile(file, buf);
        const out = execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]).toString();
        const j = JSON.parse(out) as { streams: { codec_type: string; width?: number; height?: number }[]; format: { duration: string } };
        return { bytes: buf.length, duration: Number(j.format.duration), video: j.streams.find((s) => s.codec_type === "video"), audio: !!j.streams.find((s) => s.codec_type === "audio") };
      };
      const report: Record<string, unknown> = {};
      // A low-credit account is throttled to one prediction a minute: wait out a 429 rather than fail the probe.
      const create = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
        for (let attempt = 1; ; attempt++) {
          try {
            return await fn();
          } catch (e) {
            const code = (e as { code?: string }).code;
            if (code !== "PROVIDER_UNAVAILABLE" || attempt >= 8) throw e;
            console.info(`[live-probe] ${label} throttled — waiting 15 s (${attempt})`);
            await new Promise((r) => setTimeout(r, 15_000));
          }
        }
      };

      /* ── 1. Face Only → xrunda/hello ─────────────────────────────────── */
      const fo = await create("face-only", () => faceOnlyProvider.createPrediction({ jobId: "live-probe", mode: "face_only", videoUrl: clipUrl, referenceImageUrls: [faceUrl], quality: "standard", keepOriginalAudio: true, goFast: false, webhookUrl }));
      report.faceOnly = { predictionId: fo.reference, model: fo.model, settings: fo.settings };
      const foDone = await wait(fo.reference, "face-only");
      const foOut = await probe(extractOutputUrl(foDone.resultUrl)!, "face-only");
      report.faceOnlyOutput = foOut;
      expect(foOut.video).toBeTruthy();
      expect(Math.abs(foOut.duration - 3)).toBeLessThan(1.2);

      /* ── 2. Skin + Face → p-video-replace (Standard: 720p turbo) ─────── */
      const sf = await create("skin-face", () => skinFaceProvider.createPrediction({ jobId: "live-probe", mode: "skin_face", videoUrl: clipUrl, referenceImageUrls: [faceUrl], quality: "standard", keepOriginalAudio: true, goFast: false, webhookUrl }));
      report.skinFace = { predictionId: sf.reference, model: sf.model, settings: sf.settings };

      /* ── 3. TTS → MiniMax (wav) ──────────────────────────────────────── */
      const tts = textToSpeechProviderFor("minimax/speech-02-hd");
      const tt = await create("tts", () => tts.createPrediction({ jobId: "live-probe", text: "Hello from Frenz AI. This is a short test.", languageCode: "en", providerVoiceId: "English_Wiselady", webhookUrl }));
      report.tts = { predictionId: tt.reference, model: tt.model, settings: tt.settings };
      const ttDone = await wait(tt.reference, "tts");
      const ttOut = await probe(ttDone.resultUrl!, "tts");
      report.ttsOutput = ttOut;
      expect(ttOut.audio).toBe(true);
      expect(ttOut.duration).toBeGreaterThan(1);

      /* ── 4. Lip sync → lipsync-2-pro on the FACE-ONLY output + the TTS wav */
      const wavUrl = await put(`${folder}/voice.wav`, path.join(dir, "tts.out"), "audio/wav");
      const replacedUrl = await put(`${folder}/replaced.mp4`, path.join(dir, "face-only.out"), "video/mp4");
      const lip = lipSyncProviderFor("sync/lipsync-2-pro");
      const ls = await create("lipsync", () => lip.createPrediction({ jobId: "live-probe", videoUrl: replacedUrl, audioUrl: wavUrl, syncMode: "silence", webhookUrl }));
      report.lipSync = { predictionId: ls.reference, model: ls.model, settings: ls.settings };

      const sfDone = await wait(sf.reference, "skin-face");
      const sfOut = await probe(extractOutputUrl(sfDone.resultUrl)!, "skin-face");
      report.skinFaceOutput = sfOut;
      expect(sfOut.video).toBeTruthy();
      expect(Math.abs(sfOut.duration - 3)).toBeLessThan(1.2);

      const lsDone = await wait(ls.reference, "lipsync");
      const lsOut = await probe(lsDone.resultUrl!, "lipsync");
      report.lipSyncOutput = lsOut;
      expect(lsOut.video).toBeTruthy();
      expect(lsOut.audio).toBe(true);

      console.info("[live-probe] REPORT", JSON.stringify(report, null, 1));
      await admin.storage.from(AI_SOURCE_BUCKET).remove([`${folder}/clip.mp4`, `${folder}/face.jpg`, `${folder}/voice.wav`, `${folder}/replaced.mp4`]);
    },
    20 * 60_000,
  );
});
