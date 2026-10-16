# Frenzsave commercial: production files

Lives in `marketing/commercial/`, separate from the app. Nothing here is imported, built or deployed by the app, and no app file was changed to make it.

A 46-second commercial built from real recordings of the Frenzsave app. It is
rendered in two formats from one timeline:

| File | Size | For |
|---|---|---|
| `output/frenzsave-commercial-16x9.mp4` | 1920×1080, 30 fps | YouTube, website, X, LinkedIn |
| `output/frenzsave-commercial-9x16.mp4` | 1080×1920, 30 fps | TikTok, Reels, Shorts, Stories |

Both are about 40 MB (H.264 High, CRF 19, AAC 256k, −14 LUFS, −1 dBTP).

## Folder map

```
capture/     Playwright scripts that drive the real app and record the phone screens
  common.cjs     browser setup: iPhone-sized viewport, demo session, demo history
  recorder.cjs   CDP screencast recorder and on-screen tap indicator
  scenes.cjs     the scenes (download, ai, reels, history, montage)
mock/        local stand-in for Supabase used only while filming (demo account + 3 demo posts)
demo-media/  demo reel clips (procedural WebGL shaders; no third-party footage)
  src/shader-reels.html
composition/ the edit, as a single HTML timeline. seek(t) poses every frame
  commercial.html   ?fmt=h → 16:9, ?fmt=v → 9:16
  assets/frenz-logo.png   copied from public/brand/frenz-logo.png
audio/
  music.py     original 120 BPM music bed, synthesised with numpy (no samples)
  vo.py        voice-over lines, synthesised locally with Kokoro TTS (voice af_heart)
  vo/          generated lines (am_michael is also rendered as an alternative)
tools/
  start-servers.sh   mock backend + `next dev` pointed at it
  render-frames.cjs  frame-accurate renderer (headless Chromium → ffmpeg)
  stills.cjs         render single frames for review
  mix.sh             music + VO → -14 LUFS mix with ducking
  build.sh           sequences → both renders → mix → final MP4s
captures/raw/  recorded phone clips (H.264)
captures/seq/  the same clips as 30 fps JPEG sequences (built by build.sh; gitignored)
output/        the two finished MP4s (picture-*.mp4 masters and mix.wav are gitignored)
```

## Rebuild

Requirements: Node 22, the repo's `node_modules` (for Playwright and Next),
ffmpeg with libx264 and libvpx, Python 3 with numpy, and a venv with
`kokoro-onnx` and `soundfile` plus the Kokoro model files (`kokoro-v1.0.onnx`,
`voices-v1.0.bin` from the kokoro-onnx GitHub releases).

```bash
cd marketing/commercial
echo "127.0.0.1 media.frenz.test" | sudo tee -a /etc/hosts       # demo media host
openssl req -x509 -newkey rsa:2048 -nodes -keyout mock/key.pem -out mock/cert.pem \
  -days 30 -subj "/CN=media.frenz.test" -addext "subjectAltName=DNS:media.frenz.test"
bash tools/start-servers.sh                                      # mock + next dev on :3100
node capture/scenes.cjs captures/raw                             # record (or name scenes)
python3 audio/music.py audio/music.wav
<venv>/bin/python audio/vo.py <model-dir> audio/vo/af_heart af_heart
bash tools/build.sh                                              # → output/*.mp4
```

The scripts use Playwright's own Chromium. To use another build, set
`CHROMIUM_PATH=/path/to/chrome`. Playwright's bundled Chromium has no H.264
decoder, which is why the demo reels are served as WebM.

```

To change words, timing or layout, edit `composition/commercial.html`. The
scene windows are in `T`, and the per-format layout is in `L`. Then run
`tools/build.sh` again. To review frames without a full render, use
`node tools/stills.cjs composition/commercial.html /tmp/out h 6 18 30`.
Voice cue times are in `tools/mix.sh` (`CUES`).

## What is real and what is demo

Every interface on the phones is the real app: real routes, components,
styles and navigation, running from this repository. Because filming had no
access to production, three things are local stand-ins:

- **Backend.** `mock/mock-supabase.cjs` serves a demo account (Frenz Demo,
  @frenzdemo) and three demo posts from fictional creators (@neon.studio,
  @motionlab, @pixelwave). Every engagement count is 0, and the app hides
  zero counts, so no likes or views appear on screen.
- **Link extraction.** The download demo answers the extractor call locally
  with a "Liquid glow" result: 1080p, 720p and audio, with no file sizes and
  no view counts. The link is a placeholder TikTok short link.
- **Pricing.** The Text to Video price quote request is held open, so the cost
  shows the app's neutral "—". Generate is never pressed.

The History tiles are six demo records in the capture browser's
localStorage. The "Storage" figure on that screen is the app's own size
estimate for those six demo records (`features/history/usage.ts`).
