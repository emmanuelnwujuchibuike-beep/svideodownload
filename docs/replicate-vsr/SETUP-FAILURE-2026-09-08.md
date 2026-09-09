# The first GPU push built, pushed, and then failed to boot

**Status: the pushed version is DISABLED by Replicate. Do not point
`REPLICATE_AI_CLEAN_MODEL_VERSION` at it.**

```
model    emmanuelnwujuchibuike-beep/video-subtitle-remover   (private, GPU)
version  f14a29b1365c0fa9baef23d5f5dba7f547ddf5ea0c9932870f155d93c6e7abb1
pushed   2026-09-08T22:40:26Z   — the GitHub workflow succeeded
```

## What was observed

A real prediction was submitted against it at 23:04:42 on the owner's own video
(155 KB, the smallest source available) and watched for **80 minutes**:

```
age=0s      starting  started=null  logs=0b
age=1200s   starting  started=null  logs=0b
age=3601s   starting  started=null  logs=0b
age=4804s   starting  started=null  logs=0b
```

`started_at` never became non-null and **not one log line was ever produced**.
For comparison, every one of the 25 predictions the old CPU model served that
same day started within ~19 seconds.

A second submission then answered:

```json
{"title":"Version disabled",
 "detail":"This version has been disabled because it consistently fails to complete setup.",
 "status":422}
```

So the container is failing inside `setup()` on Replicate's GPU node, on every
attempt, and Replicate has taken the version out of service.

## 🔴 The reasoning trap to avoid next time

The version has a complete, correct `openapi_schema` — `{video, mode,
subtitle_area}` with `mode` enumerating `sttn|propainter|lama`, exactly matching
`buildAiCleanInput`. **That schema proves nothing about whether Replicate can
run the image.** `cog push` derives it by introspecting the predictor on the
BUILDER — the GitHub runner, which has no GPU — before uploading. A green
workflow and a valid schema together only mean "it built and it uploaded".

The only evidence that a model works is a prediction that returns output.

## Where to look

Setup logs are not attached to the prediction (that is why `logs` was empty for
80 minutes). They are on the model's **version page in the Replicate web UI**,
under the boot/setup output. That is the one artefact nobody has read yet, and
it will name the failure directly. Read it before changing anything here.

Likely candidates, in the order worth checking:

1. **Setup exceeds Replicate's boot timeout.** `setup()` imports torch,
   PaddleOCR and the bundled weights from a ~1.5 GB repo inside a 10–14 GB
   image. "Consistently fails to complete setup" is the exact wording used for
   a boot that runs out of time as well as one that raises.
2. **A CUDA runtime mismatch at import.** The image pins three things that must
   agree on CUDA 11.8 — `torch==2.7.0+cu118`, `paddlepaddle-gpu==3.0.0` (cu118
   index) and `onnxruntime-gpu==1.20.1` (the Microsoft CUDA-11 feed). All three
   install cleanly; an `import` on a GPU node is where a mismatch actually
   surfaces.
3. **Weights not in the image.** The workflow only prints
   `::warning::backend/models not present` and continues. If the clone did not
   carry them, `setup()` would try to fetch at boot.

## If it needs another push

Consider `gpu-t4` instead of `gpu-l40s` (cheaper, more plentiful, and adequate
for STTN), and consider slimming the image — it installs **both** torch and
paddlepaddle, two complete deep-learning runtimes, because upstream uses
PaddleOCR for detection and STTN for inpainting.

## Meanwhile

`lib/ai/config.ts` stays on `hjunior29/video-text-remover`. It blurs rather than
removes — which is the whole reason for this work — but it completes, and a
feature that produces a mediocre result beats one that never returns.

`aiCleanMisconfiguration()` now refuses a model/method pair from different
families, so a partial set of the three environment variables reports the tool
unavailable instead of 422-ing every job after the member has uploaded.
