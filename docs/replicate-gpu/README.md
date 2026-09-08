# Publishing AI Clean's model on GPU

**Why:** the model AI Clean calls, [`hjunior29/video-text-remover`](https://replicate.com/hjunior29/video-text-remover),
is published on **CPU hardware**. Measured 2026-09-08 from the model's own page:

```json
"hardware": { "arch": "cpu", "display_name": "CPU", "sku": "cpu" }
"price": "$0.0001 per second"
```

Its README says *"GPU is auto-detected and used if available (3-6x faster)"* — the CUDA
path is already written. It is dormant only because `cog.yaml` ships `gpu: false` and
`requirements.txt` pins the CPU build of ONNX Runtime.

**What that costs us in practice.** Two real jobs on 2026-09-08:

| Job | Source | Outcome |
|---|---|---|
| `b5001f22` | 1.5 MB clip | `processing` for **41 minutes**, abandoned with no result |
| `999d0da9` | short clip | same path |

Against a published typical run of **124 seconds**. The gap is queue and cold boot on a
shared CPU pool that nobody keeps warm — not our pipeline, which dispatched both
correctly with a pinned version and a prediction id within 4 seconds.

## The economics

| Hardware | $/sec | vs CPU | 124s run | at 4× faster |
|---|---|---|---|---|
| CPU *(today)* | $0.000100 | — | $0.0124 | — |
| **Nvidia T4** | $0.000225 | 2.25× | — | 31s → **$0.0070** |
| Nvidia L40S | $0.000975 | 9.75× | — | 21s → $0.0201 |

**T4 is the choice.** GPU costs more per second but runs far fewer seconds, so it lands
*cheaper per job* as well as faster. Do not reach for L40S or A100 — this is a YOLOv8
detector, not a diffusion model, and it cannot use the extra silicon. Replicate assigns
T4 automatically for a `gpu: true` model of this size.

## Steps

```bash
git clone https://github.com/hjunior29/video-text-remover.git
cd video-text-remover

# the two files in this folder replace the two upstream ones
cp /path/to/frenzsave/docs/replicate-gpu/cog.yaml         ./cog.yaml
cp /path/to/frenzsave/docs/replicate-gpu/requirements.txt ./requirements.txt

# put your Replicate username in cog.yaml's `image:` line, then:
pip install cog
cog login
cog push r8.im/YOUR-USERNAME/video-text-remover-gpu
```

Create the model first at <https://replicate.com/create> (name it `video-text-remover-gpu`,
visibility **private** — it costs nothing and nobody else needs it).

The first push builds a CUDA image and is slow — 10-20 minutes is normal. Later pushes
are cached.

## Then point us at it — no deploy needed

Both values are environment variables precisely so this is a dashboard edit:

| Vercel env var | Set to |
|---|---|
| `REPLICATE_AI_CLEAN_MODEL` | `YOUR-USERNAME/video-text-remover-gpu` |
| `REPLICATE_AI_CLEAN_MODEL_VERSION` | the 64-char hash from the new model's **Versions** tab |

Set both together. A new owner/name with the old version hash resolves to nothing and
every job fails `PROVIDER_ERROR` until it is corrected.

Rolling back is the same edit in reverse: clear both and the committed defaults in
`lib/ai/config.ts` take over again.

## Verifying it actually used the GPU

The trap is a container that has a GPU and cannot address it — you would pay 2.25×/second
for CPU speed and nothing would look wrong. So check, once:

1. Run one prediction from the Replicate page.
2. Open its **Logs**. ONNX Runtime announces its provider on session creation; you want a
   line mentioning `CUDAExecutionProvider`. `CPUExecutionProvider` alone means the
   `onnxruntime-gpu` swap did not take.
3. Compare `predict_time` in the prediction's metrics against ~124s.

If it fell back to CPU, the cause is almost always both ONNX Runtime packages ending up
installed — see the note in `requirements.txt`.

## What this does not fix

Processing resolution stays at `720p` (`lib/ai/config.ts`). That is a quality decision,
not a speed one: `predict.py` downscales for processing and then **upscales the output
back to the original dimensions**, so a lower setting softens the whole video rather than
just the patched area. On a portrait 1080×1920 phone video, 720p already means processing
at 405×720. Going lower is visible. Leave it.
