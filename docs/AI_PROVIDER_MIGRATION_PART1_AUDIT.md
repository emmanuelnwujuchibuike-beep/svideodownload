# Frenz AI — Provider Migration, Part 1: Architecture Audit & Safety Baseline

**Status:** inspection only. Nothing in this pass changed code, schema, routes,
pricing, admin, UI, queues, notifications, auth, storage or performance.
**Date of audit:** 2026-09-28. **Branch:** `main` at `d8400e6`.
**Audience:** the engineer or agent who will execute Parts 2+ of the migration,
and the owner signing off on it.

**What the migration is eventually for** (from the Part 1 brief):
direct ElevenLabs for Text-to-Speech *and* Speech-to-Text; direct Kling
(Kling 3.0 Omni) for every other generation feature; Replicate and fal.ai
removed from the Frenz AI generation system; shared infrastructure kept;
**separate per-feature handlers**, not one giant pipeline.

---

## A · Existing architecture

### A.1 The two runtimes

The same Next.js 15 App Router codebase runs in **two roles**, decided purely by
`DOWNLOAD_WORKER_URL` (`lib/worker.ts`):

| Role | Host | `DOWNLOAD_WORKER_URL` | Holds |
|---|---|---|---|
| **Frontend** | Vercel | set | Every **provider credential**, VAPID keys, Supabase service role |
| **Worker** | Docker (`Dockerfile`; `fly.toml` present; the live worker is reached through `DOWNLOAD_WORKER_URL`) | unset | ffmpeg, yt-dlp, ONNX preflight models, a real filesystem, Supabase service role |

**This split is the single most important architectural fact for the migration.**
The worker deliberately holds **no provider token**. When the worker needs a
provider called, it calls *back* to the frontend:

```
worker --POST /api/internal/ai/submit (x-worker-secret, body = {jobId})--> frontend --> provider
```

`lib/ai/submit-dispatch.ts` records the reason verbatim: *"it would put
`REPLICATE_API_TOKEN` on a second host."* A direct-Kling migration that puts a
`KLING_*` key on the worker breaks that posture. It must either keep the same
hop, or be an explicit, recorded decision.

Traffic the other way (frontend → worker) is `lib/ai/finalize-dispatch.ts`:
`/api/internal/ai/finalize` and `/advance`, plus `/prepare`, `/acquire`,
`/preflight`, `/queue`, `/notify`. All guarded by the shared `WORKER_SECRET`
header.

### A.2 Provider vendors actually present

| Vendor | How it is called | SDK | Entry point |
|---|---|---|---|
| **Replicate** | raw `fetch` to `https://api.replicate.com/v1` | **none** (no `replicate` npm package) | `lib/ai/replicate/provider.ts` |
| **fal.ai** | `@fal-ai/client` ^1.10.1, **queue only** (`queue.submit/status/result/cancel`) | yes | `lib/ai/fal/client.ts` |
| **ElevenLabs** | raw `fetch` to `https://api.elevenlabs.io/v1` | none | `lib/ai/voice/elevenlabs.ts` |
| **Anthropic (Claude)** | raw `fetch` to `https://api.anthropic.com/v1/messages` | none | `app/api/ai/media/route.ts`, `lib/moderation/risk-score.ts` |

> **🔴 Finding — there is a FOURTH AI vendor the brief does not mention.**
> Anthropic powers (a) the Frenz AI *media tools* (`/api/ai/media`: summarise,
> describe, caption, translate over a member's saved media) and (b) content
> **moderation risk scoring**. Neither is Replicate nor fal.ai. **Neither may be
> touched by this migration.** See §L.

> **🔴 Finding — there is NO direct Kling integration anywhere.**
> Kling models today are reached only *through* the two vendors being removed:
> `kwaivgi/kling-lip-sync` on Replicate and
> `fal-ai/kling-video/o1/standard/video-to-video/edit` on fal.ai. Part 2 is a
> **new** integration, not a re-point. What *is* reusable is the input-shaping
> knowledge already written down: `lib/ai/character-replace/providers/kling-input.ts`
> (`KLING_O1_EDIT_LIMITS`), the Kling scale/fps filters in
> `lib/ai/character-replace/ffmpeg.ts`, and
> `lib/ai/lip-sync/providers/kling-lipsync.ts` (`KLING_LIP_SYNC_LIMITS`, the
> 46-voice enum).

### A.3 The three registries that decide what a tool is

1. **`lib/ai/jobs.ts` → `AI_FEATURES`** — the backend feature registry
   (what may be *created*, what it costs, what it accepts, retention).
2. **`features/ai/frenz-ai-tools-grid.tsx` → `aiToolCards()`** — the UI
   registry (what is *shown* in Explore AI Studio, one card per operation).
3. **`lib/ai/tools.ts` → `FRENZ_AI_TOOLS`** — the *Anthropic* media-tool
   registry (summarise / describe / caption / translate / transcribe /
   subtitles). A separate system, used only by `/api/ai/media`.

A migration that edits one and not the others produces the classic failure this
codebase has hit before: a tool offered in the UI and refused by the server.

### A.4 The provider decision

`lib/ai/providers/config.ts` is a **pure** module stored under one key of the
landing settings row (`frenzAiProviders`). `lib/ai/providers/resolve.ts` is the
**server-side** router. The brief's rule is enforced in code: *"The frontend
should not decide the provider. The server decides. Never trust a
client-supplied provider value."*

Feature table as it stands:

| Feature | Vendors | Locked | Replicate model | fal.ai model |
|---|---|---|---|---|
| `character_replace` | replicate \| fal | — | per scope (Wan 2.2 Animate Replace, `xrunda/hello`, `prunaai/p-video-replace`) | `fal-ai/kling-video/o1/standard/video-to-video/edit` |
| `lip_sync` | replicate \| fal | — | `sync/lipsync-2`, `sync/lipsync-2-pro`, `kwaivgi/kling-lip-sync` | `fal-ai/sync-lipsync/v3` |
| `text_to_speech` | elevenlabs | **locked** | (`elevenlabs/v3` via Replicate is a *route*, not a vendor switch) | — |
| `voice_change` | elevenlabs | **locked** | — | — |

The decision is made **once, at `/start`**, written onto the row
(`ai_jobs.provider` + `metadata.provider_plan`), and never re-read. Flipping the
admin switch mid-flight affects new jobs only. There is **no automatic
fallback** (`fallback: "off"`), and a paused or unconfigured vendor refuses the
start with a sentence rather than silently rerouting.

---

## B · AI feature inventory

Four features are live in `AI_FEATURES`. `ai_clean` is **retired** — the value
stays in the `AiFeature` type and in the DB check constraint so historical rows
remain readable, but it has **no registry row**, so nothing can create one.
(Standing owner rule: AI Clean is retired and must never be re-added.)

### B.1 Character Replace (`ai_character_replace`)

| | |
|---|---|
| **Entry points** | `/studio/ai/character-replace` (scope page) → `/studio/ai/character-replace/create?mode=` (workspace); public twin at `/ai/character-replace` |
| **Components** | `features/ai/character-replace/character-replace-workspace.tsx` + `step-photo/video/settings/voice/review`, `processing.tsx`, `result.tsx`, `batch-board.tsx` |
| **API routes** | `POST /api/ai/character-replace/jobs` (draft) · `/quote` · `/jobs/[id]/preflight` · `POST /jobs/[id]/start` · `/jobs/[id]/retry` · `/batches` + `/batches/[id]/start` · `/config` · `/balance` · `/topup` |
| **Backend** | `lib/ai/character-replace/start-job.ts` (the spending sequence) → `lib/ai/character-replace/submit.ts` |
| **Providers / models** | **Replicate**: Face Only = `xrunda/hello` (pin `104b4a39…`); Face + Head = `prunaai/p-video-replace` (pin `4638788b…`); Upper Body & Full Character = `wan-video/wan-2.2-animate-replace` (pin `33ec6b98…`). **fal.ai**: Kling O1 Video Edit, upper-body + full-character only |
| **Scopes** | `face_only`, `skin_face`, `upper_body`, `full_character` (`lib/ai/character-replace/modes.ts`) |
| **Input** | 1 video (upload or allow-listed URL) + 1–N reference images + optional audio/text voice |
| **Output** | MP4 in `frenz-ai-results`, plus a poster frame |
| **Pipeline** | **MULTI-STAGE** — see §G |
| **Callback** | webhook (`/api/ai/replicate/webhook` or `/api/webhooks/fal`) + reconcile poll |
| **Money** | complimentary creation → plan credits → product wallet (`ai_product_balances`) |
| **Finalizer** | `server/services/ai-character-replace-finalize-service.ts` (worker) |

### B.2 Lip Sync Pro (`ai_lip_sync`)

| | |
|---|---|
| **Entry** | `/studio/ai/lip-sync`, result at `/studio/ai/lip-sync/result/[id]` |
| **Routes** | `/api/ai/lip-sync/jobs` · `/jobs/[id]/start` · `/quote` · `/config` |
| **Backend** | `lib/ai/lip-sync/{start-job,submit,config,job-meta}.ts` |
| **Providers** | Replicate: `sync/lipsync-2` (Standard) / `sync/lipsync-2-pro` (Studio) / `kwaivgi/kling-lip-sync` (text-native). fal.ai: `fal-ai/sync-lipsync/v3` |
| **Input** | 1 video + **exactly one** speech source: typed text, an uploaded audio file, or an Audio-Library asset |
| **Notable** | text → ElevenLabs speech happens **first**, on the worker, unless the model is text-native (Kling). A lip-sync model never receives raw text except on Kling. |
| **Prepare** | `server/services/ai-lip-sync-prepare-service.ts` |

> ⚠️ Recorded regression, kept here for context: every lip-sync job failed
> `SUBMIT_FAILED` because `ai_lip_sync` was missing from
> `replicateProvider.supports()`. Refunds fired correctly. The comment is still
> in `lib/ai/replicate/provider.ts`. Any new provider adapter must declare its
> supported features or it fails **late and expensively**.

### B.3 Text to Audio (`ai_text_to_audio`)

| | |
|---|---|
| **Entry** | `/studio/ai/text-to-audio`; library at `/studio/ai/audio` |
| **Routes** | `/api/ai/text-to-audio/jobs` · `/quote` · `/config` · `/api/ai/audio`, `/api/ai/audio/[id]`, `/api/ai/audio/[id]/file` |
| **Backend** | `lib/ai/text-to-audio/{generate,route,finalize,pricing,config,assets}.ts` |
| **Route switch** | `config.route` — `"elevenlabs"` (**direct API**, synchronous, runs in the request's `after()`, **no worker, no webhook**) or `"replicate"` (`elevenlabs/v3` as a prediction + webhook + finalizer) |
| **Output** | MP3 → `ai_audio_assets` (the Audio Library), reusable in Lip Sync Pro at no second charge |
| **Money** | 500 free characters/month (`ai_tta_free_usage`) → credits → wallet |
| **Finalizer** | in-process (`dispatchFinalization` short-circuits `ai_text_to_audio` and never calls the worker) |

**This feature already contains a working model of the target architecture** — a
direct-vendor route that bypasses the prediction/webhook/worker machinery
entirely while reusing every shared system. Part 2 should copy its shape.

### B.4 Voice Cloning (`ai_voice_clone`)

| | |
|---|---|
| **Entry** | `/studio/ai/voice-cloning`; library at `/studio/ai/voices` |
| **Routes** | `/api/ai/voice-clones` · `/jobs` · `/jobs/[id]/start` · `/[id]` · `/[id]/sample` · `/config` |
| **Backend** | `lib/ai/voice-clone/{start,run,create,clones,provider,usable}.ts` |
| **Provider** | **direct ElevenLabs only** (`POST /v1/voices/add`) |
| **Firsts** | `requires: "elevenlabs"` (not `"replicate"`) and `needsFinalizer: false` — the only feature with either |
| **Output** | a row in `ai_voice_clones` (not a file); usable in Text to Audio and Lip Sync Pro as `clone:<uuid>` |
| **Money** | one free voice/month (`ai_vc_free_usage`); **voice slots** are the scarce resource |
| **Rights** | a typed consent record (`consent_at` / `consent_name` / `consent_statement`) is stored per voice |

> **🔴 Invariant to preserve:** once the voice exists at the vendor, the job may
> **never** be reported failed. Everything that can fail honestly happens before
> the provider call; everything after it is best-effort. If the library row
> cannot be written, the vendor voice is **deleted** first.
> (`lib/ai/voice-clone/run.ts`)

### B.5 Frenz AI media tools — Anthropic, not in scope

`lib/ai/tools.ts` + `POST /api/ai/media`. Six tools; `transcribe` and
`subtitles` are declared `requires: "audio"` and are **permanently unavailable**
because no speech-to-text provider exists.

> **🔴 Finding — Speech-to-Text does not exist anywhere in this codebase.**
> A search for `speech-to-text|whisper|scribe_v1|audio-to-text` finds only
> declarations of its *absence*. `lib/platform/media-platform.ts` lists
> transcription as `status: "planned"`. The brief's "Audio-to-Text /
> Speech-to-Text via direct ElevenLabs" is therefore **greenfield work, not a
> migration**. It needs a new `AiFeature`, a DB check-constraint migration, a
> job-meta contract, pricing, a config block, an admin panel, a workspace and a
> library — the full Text-to-Audio shape. Budget it as its own Part.

---

## C · Replicate dependency map

**967 occurrences across 138 files** (excluding the untracked `scripts/_*.tmp.mjs`
probe scripts). No `replicate` npm package — every call is hand-rolled `fetch`.

### C.1 Core (delete last)

| File | Role |
|---|---|
| `lib/ai/replicate/provider.ts` | `replicateCall`, `createReplicatePrediction`, `toState`, `replicateProvider` (the `AiProvider` seam entry), `stateFromWebhookBody` |
| `lib/ai/replicate/status.ts` | `mapReplicateStatus`, `extractOutputUrl` |
| `lib/ai/replicate/signature.ts` | webhook HMAC verification, `WEBHOOK_TOLERANCE_SECONDS` |
| `lib/ai/providers.ts` | `registerAiProvider(replicateProvider)` — an import side effect |
| `app/api/ai/replicate/webhook/route.ts` | the public callback |

### C.2 Direct importers of `lib/ai/replicate/*` (14 files)

`app/api/ai/replicate/webhook/route.ts` · `lib/ai/character-replace/provider.ts` ·
`lib/ai/character-replace/providers/face-only.ts` · `…/skin-face.ts` ·
`lib/ai/fal/status.ts` *(shares the status vocabulary)* ·
`lib/ai/lip-sync/providers/kling-lipsync.ts` · `…/sync-labs.ts` ·
`lib/ai/providers.ts` · `lib/ai/providers/test.ts` ·
`lib/ai/voice/lipsync-provider.ts` · `lib/ai/voice/tts-provider.ts` ·
plus tests (`live-providers.test.ts`, `lip-sync.test.ts`).

### C.3 Model pins (all currently on Replicate)

| Purpose | Model | Version env override |
|---|---|---|
| Full Character / Upper Body | `wan-video/wan-2.2-animate-replace` | `REPLICATE_WAN_ANIMATE_REPLACE_VERSION` |
| Face Only | `xrunda/hello` | `REPLICATE_FACE_ONLY_VERSION` |
| Face + Head | `prunaai/p-video-replace` | `REPLICATE_SKIN_FACE_VERSION` |
| Lip Sync (Standard / Studio) | `sync/lipsync-2`, `sync/lipsync-2-pro` | `REPLICATE_LIPSYNC_VERSION`, `REPLICATE_LIPSYNC_PRO_VERSION` |
| Lip Sync (text-native) | `kwaivgi/kling-lip-sync` | `REPLICATE_KLING_LIPSYNC_VERSION` |
| TTS via Replicate | `elevenlabs/v3`, MiniMax `speech-02-hd` | `REPLICATE_ELEVENLABS_VERSION`, `REPLICATE_TTS_VERSION` |
| **AI Clean (retired)** | text-detect, ProPainter, GPU, BRIA | 8 more `REPLICATE_AI_CLEAN_*` / `REPLICATE_PROPAINTER_*` / `REPLICATE_TEXT_DETECT_*` in `lib/ai/config.ts` |

### C.4 Database / row surface

- `ai_jobs.provider` — check constraint `in ('replicate','fal')` (0168)
- `ai_jobs.replicate_prediction_id` — **provider-neutral in practice**: the fal
  adapter stores its `request_id` in this same column, and the unique index on
  it is what makes *both* webhooks idempotent. **Badly named, load-bearing.**
- `ai_jobs.model`, `ai_jobs.model_version`
- `ai_jobs.metadata.pipeline.records[stage].provider.{id,model,version}` and `.predictionId`
- `ai_jobs.metadata.provider_plan`
- `ai_provider_runs.provider` — check `in ('replicate','fal','elevenlabs')`
- `ai_provider_health` — the circuit breaker, keyed by model string

### C.5 Admin surface

`features/admin/ai-providers-settings.tsx` (the switch, models, pauses, health,
comparison, test buttons) · `character-replace-pricing.tsx` (per-scope
`provider.model`) · `character-replace-providers.tsx` (breaker state) ·
`lip-sync-settings.tsx` · `text-to-audio-settings.tsx` ·
`app/api/admin/ai/providers/test/route.ts` (`GET /v1/account` as the credential
check) · `app/api/admin/ai/character-replace/providers/route.ts`.

### C.6 Elsewhere

`lib/ai/{reconcile,recovery,submit,notify,job-stages,admin-stats,hardware,surya,propainter}.ts` ·
`server/services/ai-*-service.ts` (comments + status vocabulary) ·
`docs/replicate-gpu/`, `docs/replicate-vsr/` (Cog model source for the retired AI
Clean) · `.github/workflows/replicate-gpu-model.yml` and `replicate-vsr-model.yml` ·
`docs/PROJECT_NOTES.md`.

---

## D · fal.ai dependency map

**430 occurrences across 66 files.** Newer, smaller and much better contained
than Replicate — the whole vendor is 5 files plus adapters.

| File | Role |
|---|---|
| `lib/ai/fal/client.ts` | the **only** reader of `FAL_KEY`; `falQueueSubmit/Status/Result/Cancel`, `falCredentialCheck`, `classifyFalError` |
| `lib/ai/fal/provider.ts` | the `AiProvider` seam entry |
| `lib/ai/fal/signature.ts` | ED25519 / JWKS webhook verification |
| `lib/ai/fal/jwks.ts` | the cached key set + rotation refresh |
| `lib/ai/fal/status.ts` | `stateFromFalWebhookBody` |
| `app/api/webhooks/fal/route.ts` | the public callback |
| `lib/ai/character-replace/providers/fal-kling-edit.ts` | Kling O1 Video Edit adapter |
| `lib/ai/character-replace/providers/kling-input.ts` | `KLING_O1_EDIT_LIMITS` + input validation — **reusable for direct Kling** |
| `lib/ai/voice/fal-sync3.ts`, `lib/ai/lip-sync/providers/fal-sync3.ts` | Sync-3 adapters |

- **Package:** `@fal-ai/client` ^1.10.1 in `package.json` dependencies.
- **Env:** `FAL_KEY` (a single variable).
- **Config:** `AI_PROVIDERS_DEFAULTS` in `lib/ai/providers/config.ts`, the
  `isWanEndpoint` refusal, `falScopes`, `paused.fal`, and the model keys
  `character_replace:fal` / `lip_sync:fal`.
- **DB:** `ai_jobs.provider = 'fal'` (0168 constraint); the fal request id shares
  `replicate_prediction_id`; `ai_provider_runs.provider = 'fal'`.
- **Tests:** `lib/ai/providers/providers.test.ts`, `lib/ai/lip-sync/lip-sync.test.ts`,
  `lib/ai/character-replace/part8.test.ts`.

> ⚠️ **fal.ai has never run a live job.** `FAL_KEY` is absent from `.env.local`,
> and the project's own notes record it as unset in production. Every fal path is
> code-complete and **untested against the real vendor**. Removing it therefore
> carries **no historical-data risk** — there are no `provider = 'fal'` rows to
> preserve. That makes fal.ai the **cheapest and safest thing to delete first**.

---

## E · ElevenLabs dependency map (what is reusable)

`lib/ai/voice/elevenlabs.ts` is already a clean, complete, **direct** client
against `https://api.elevenlabs.io/v1`, reading `ELEVENLABS_API_KEY`:

| Function | Endpoint | Used by |
|---|---|---|
| `elevenLabsTextToSpeech` | `/text-to-speech/{voice}` | Text to Audio (direct route), CR / Lip-Sync voice prepare |
| `elevenLabsSpeechToSpeech` | `/speech-to-speech/{voice}` | Voice Replace |
| `elevenLabsListVoices` | `/voices` | admin voice import; the provider credential test |
| `elevenLabsAddVoice` | `/voices/add` | Voice Cloning |
| `elevenLabsEditVoice` / `elevenLabsDeleteVoice` | `/voices/{id}` | Voice Library |
| `buildElevenLabsTtsBody` | — | `voice_settings` construction (stability / similarity / style / speed) |

Supporting: `lib/ai/voice/elevenlabs-models.ts` (model catalogue + capabilities),
`voice-settings.ts`, `tts-languages.ts`, `capabilities.ts`,
`lib/ai/voice-clone/provider.ts`, `lib/ai/text-to-audio/route.ts` (the
direct-vs-Replicate switch), `lib/ai/voice/audio-{ffmpeg,tempo,validate}.ts`.

**Reusable as-is for the target architecture:** everything above. The only
ElevenLabs work the migration creates is (1) deleting the
`replicateElevenLabsProvider` / `replicateMiniMaxProvider` routes in
`lib/ai/voice/tts-provider.ts` and the `route: "replicate"` branch in
`lib/ai/text-to-audio/config.ts`, and (2) **adding Speech-to-Text, which does
not exist** (§B.5).

> ⚠️ Recorded lesson: *"sounds like AI"* was not the model — it was ElevenLabs
> v3 being called with **no `voice_settings` at all**. Probe the live settings
> row before blaming a model.

---

## F · Admin dashboard AI architecture

`app/admin/page.tsx → FrenzAISection()` renders `AdminSubsections` with
`unmountInactive`, so each panel's chunk is fetched on first open. Ten tabs:

| Tab | Components | Reads |
|---|---|---|
| **Overview** | `FrenzAIHealth`, `CharacterReplaceFreeAccessPanel`, `CharacterReplaceJobsTable` | `getAiAdminStats()`, free-access stats, `listCharacterReplaceAdminJobs(60)` |
| **Character Replace pricing** | `character-replace-pricing.tsx` | `frenzAiCharacterReplace` — per-scope `provider.model`, tiers, per-second cost, voices, TTS model, lip-sync tiers |
| **Processing** | `character-replace-processing.tsx` | concurrency per plan, the queue, batch size, retries, timeout, the failed-job refund |
| **Lip Sync** | `lip-sync-settings.tsx` | **provider switch (Replicate \| fal.ai Sync-3)**, models, text/audio modes, limits, presets, prices |
| **Text to Audio** | `text-to-audio-settings.tsx` | **route switch (direct ElevenLabs \| Replicate)**, model, prices, the 500 free characters, library figures |
| **Voice Cloning** | `voice-clone-settings.tsx` | voice slots, price per voice, recording limits, the rights wording, live-voice figures |
| **AI Plans & Credits** | `ai-plans-settings.tsx`, `ai-credits-monitor.tsx` | `frenzAiPlans` (AI Pro / AI Max), `ai_credit_ledger` |
| **Providers** | `ai-providers-settings.tsx`, `character-replace-providers.tsx` | `loadAiProvidersPanel()`, `ai_provider_runs`, `ai_provider_health`, `listConfigChanges` |
| **Member balances** | `ai-balance-adjust.tsx` | `ai_product_balances`, `ai_product_ledger` |
| **Access & allowances** | `frenz-ai-settings.tsx` | `frenzAiPublicEnabled`, free/pro/business daily credits, weekly free, price, currency, min top-up |

**Admin API routes:** `/api/admin/ai/providers/test`, `/api/admin/ai/credit`,
`/api/admin/ai/plans/verify`,
`/api/admin/ai/character-replace/{adjust,fx,providers,voices/import}`,
`/api/admin/ai/character-replace/jobs/[id]/recover`, plus `/api/admin/landing`
(the settings writer — it carries both Replicate and fal references).

### F.1 Which controls are provider-specific

| Control | Fate |
|---|---|
| Providers tab: the per-feature Replicate ↔ fal switch | **REMOVE** — one provider means no switch |
| `paused.replicate` / `paused.fal` | **REPLACE** with a Kling pause |
| `models["character_replace:fal"]` etc. (4 model keys) | **REPLACE** with Kling Omni model keys |
| `falScopes`, `unsupportedScopes` | **REMOVE** — but only after confirming Kling Omni serves every scope |
| Provider comparison panel | **REMOVE or reduce** — it exists to compare two vendors |
| Per-scope `provider.model` on the pricing tab | **REPLACE** with Kling model ids |
| Text to Audio `route` switch | **REMOVE the Replicate half**, keep direct |
| Lip Sync provider switch | **REMOVE**, keep the model/tier selection |
| Circuit breaker (`ai_provider_health`) | **KEEP** — generic, keyed by model string |
| Provider health / runs panel | **KEEP** — generic, keyed by vendor string |
| Credits, plans, balances, allowances, free access | **KEEP UNCHANGED** — provider-independent |

---

## G · Job / queue architecture

### G.1 Statuses (`lib/ai/jobs.ts`, mirroring `ai_jobs_status_chk`)

```
queued ──┬─> waiting ──> acquiring ──> processing ──> finalizing ──> completed
         ├─> acquiring                                                   │
         └─> processing                                                  ├─> expired
                    (any live state) ──> failed | cancelled | expired    └─> deleted
```

- **`queued`** = a DRAFT. Nothing charged; swept after 30 minutes.
- **`waiting`** = PAID and holding a concurrency slot (0166). Must survive the
  draft sweep. Left only by the pump, a cancel, a stall or an expiry.
- **`acquiring`** = OUR worker is fetching/preparing bytes. **Nothing billable yet.**
- **`processing`** = submitted to a provider. **Costs money.**
- **`finalizing`** = provider done, our worker is storing/muxing.

> **🔴 HARD LAW — `processing → completed` is forbidden, and `transitionJob`
> THROWS on it.** Always go via `finalizing`, even when there is no file (Voice
> Cloning walks all three states with nothing to finalize). This has already
> destroyed three perfectly-made voice clones.

### G.2 The multi-stage pipeline (`lib/ai/character-replace/pipeline.ts`)

`ai_jobs.status` is **not** extended per stage. A multi-stage job is
`processing` for the whole provider portion; *which* stage lives in
`metadata.pipeline`.

```
PipelineStage = "voice" | "replace" | "lipsync" | "finalize"
```

`planPipeline()` decides the list **once at `/start`**:

| Settings | Stages |
|---|---|
| original audio | `replace → finalize` |
| new voice, TTS on Replicate (a prediction) | `voice → replace → finalize` |
| new voice, TTS direct ElevenLabs (`ttsInWorker`) | `replace → finalize` (speech is made during *prepare*) |
| + lip sync | `… → replace → lipsync → finalize` |

Between two provider stages the worker **advances**: it brings the finished
stage's output home (validated, stored in our own bucket), then asks the
frontend to submit the next (`/api/internal/ai/advance` → `dispatchProviderSubmit`).

### G.3 The worst-case chain (brief §7)

For a Character Replace job with a generated voice and Studio lip sync:

```
member's video + photo + text
  │
  ├─ [worker] ffprobe both, trim, re-encode  ──── libx264, preset veryfast, CRF 20,
  │                                               yuv420p, long-edge cap;
  │                                               the Kling route adds a 720px floor
  │                                               and an fps clamp to 24–60
  ├─ [worker] reference image → mjpeg, yuvj420p, lanczos, long-edge cap
  │           (a provider must NEVER receive a raw phone upload — an iPhone
  │            JPEG with EXIF+XMP+ICC killed p-video-replace's own resize)
  │
  ├─ STAGE voice   ElevenLabs v3 (direct, during prepare) OR MiniMax /
  │                elevenlabs-v3 on Replicate (a prediction) → MP3 →
  │                validated, tempo-fitted
  │
  ├─ STAGE replace Wan 2.2 Animate Replace | xrunda/hello | p-video-replace
  │                (Replicate)  OR  Kling O1 Video Edit (fal.ai)
  │                → [worker] downloads the output, stores it, submits the next
  │
  ├─ STAGE lipsync sync/lipsync-2(-pro) | kwaivgi/kling-lip-sync (Replicate)
  │                OR fal-ai/sync-lipsync/v3
  │
  └─ STAGE finalize [worker] download, ffprobe, restore audio if the model
                    dropped it, store in frenz-ai-results, poster frame,
                    settle the charge, announce
```

**Up to 2 vendors and 3 models in one job, with 2 full re-encodes on our side
plus every model's own internal encode.** Quality-affecting points, in order of
impact: the prepare re-encode (CRF 20 + scale), the Kling 720px floor (a *mild
upscale* on smaller sources), the fps clamp, each intermediate store/re-fetch,
and the finalizer's audio restore.

> Recorded: a commit deliberately made the master **byte-for-byte the provider's
> output** (no tone-map, no colour tags), pinned by tests. Do not reintroduce a
> transform in the finalizer.

### G.4 Idempotency, retries, timeouts

| Mechanism | Where |
|---|---|
| Idempotent create | `client_request_id`, unique per member |
| Idempotent callback | `transitionJob` is a **compare-and-set** from allowed statuses; `replicate_prediction_id` is UNIQUE; the row's `provider` must match the caller |
| Idempotent finalize | `claimFinalization` **lease** (`finalize_lease_until`) + a `finalize_attempts` budget + `finalize_next_at` backoff (0156) |
| Idempotent notify | `claimAiNotification`, a CAS on `notified_at` (0148) |
| Idempotent refund | `releaseJobFunding` reads `funding_source` from the row; the refund is once per job |
| Concurrency | `claim_ai_job_start` counts the member, platform and daily caps inside one lock; `admit_ai_waiting_jobs` is the pump |
| Circuit breaker | `ai_provider_health` per model — failure streak + pause |
| Stall sweep | `lib/ai/stall.ts` + a configurable `timeoutMinutes` per model |
| Recovery sweep | `lib/ai/recovery.ts` via `/api/cron/ai-reconcile`, **GitHub Actions every 10 minutes** |
| Retention sweep | `lib/ai/retention.ts` via `/api/cron/ai-retention`, **hourly** |

**Leaving the app is fully supported and is the design centre.** Nothing depends
on a browser being open: the provider webhook, the worker dispatches, the
10-minute reconcile sweep and the push notification all run server-side.

---

## H · Notification architecture (PROTECTED)

```
job reaches a terminal state
   │
   ├─ [worker] has NO VAPID keys  ──> dispatchAiNotification()
   │                                   POST /api/internal/ai/notify (frontend)
   │                                   on failure: metadata.notify_pending = true
   │
   └─ [frontend] claimAiNotification()  ← CAS on notified_at, exactly once
         │
         ├─ in-app notification row (type `processing_finished`, category `downloads`)
         └─ sendSmartPush() → lib/push/web-push.ts (VAPID, web-push)
                └─ tag "frenz-ai-done", url = the RESULT route for that job id
                        /studio/ai/character-replace/result/<id>
                        /studio/ai/lip-sync/result/<id>
                        /studio/ai/text-to-audio?job=<id>
                   │
                   └─ public/sw.js (v23) → public/sw/push.js
                          showNotification(...)  ← must ALWAYS be called
                          notificationclick → clients.openWindow(data.url)
```

**Rules already learned the hard way — do not break any of them:**

1. **A process without push keys must not claim.** It hands off; the member's
   next poll picks up `notify_pending`. Sending from the wrong host silently
   lost two completed jobs.
2. **A push handler that returns without `showNotification` is a silent push,
   and iOS revokes the subscription.** (`lib/pwa/sw-push-always-shows.test.ts`.)
3. **The APNs Topic must be `webPushTopic(tag)`** — base64url of the bytes; a
   length ≡ 1 mod 4 gets `400 BadWebPushTopic`. `frenz-ai-done` was rejected
   60/60 for a week on exactly this.
4. **Bump `SWX.VERSION` in `public/sw/config.js` and `public/sw.js`'s own bytes**
   whenever any `/sw/*.js` file changes.
5. It reuses the existing `processing_finished` type, so per-category
   preferences, Do-Not-Disturb and quiet hours already apply. Do not invent a
   new type.

**Migration requirement:** the Kling integration must reach its terminal state
through `transitionJob` plus the existing finalizer path, so
`notifyAiJobFinished` fires unchanged. **It must not be replaced with
frontend-only polling.**

---

## I · Performance architecture (PROTECTED)

| Mechanism | Detail |
|---|---|
| **Route-weight ratchet** | `lib/perf/budget.test.ts` — `ENTRY_CEILING` 218 KiB (5 marketing entry routes), `APP_ENTRY_CEILING` 300 KiB (`/downloads`), plus a global ceiling. Ratchet rule: the numbers only go **down**. Reads `.next`, so it needs a build first. |
| Framer-motion ban on the landing page | asserted by its own test |
| Admin code-splitting | `features/admin/frenz-ai-settings-lazy.tsx` — every AI panel is `next/dynamic`; `AdminSubsections unmountInactive` means a panel's chunk loads on first open |
| AI surface splitting | `next/dynamic` in `frenz-ai-history.tsx`, `frenz-ai-dashboard.tsx`, `wallet/recharge-sheet.tsx`, `credits/ai-plans-sheet.tsx`, `tutorial-example.tsx`, `ai-job-alert-mount.tsx`, `ai-download-overlay.tsx` |
| Settings cache | `getLandingSettings()` — 10 s per instance, cleared on the instance that saved |
| Other AI caches | `lib/ai/{balance-cache,entitlement-cache,history-cache,view-cache}.ts` |
| Rate limits | Upstash: `aiJobCreateLimiter`, `aiJobReadLimiter`, `aiPreflightLimiter` |
| CDN | Cloudflare in front of Vercel; R2 for public media |
| Worker offload | heavy ffmpeg / yt-dlp work never runs on Vercel |

> **🔴 Cloudflare will cache a header-less API answer for 2 hours**, and a
> `next.config` header rule **overrides** a handler's own. A new Kling callback
> or config route must be covered by the wide no-store rule or explicitly carved
> out — `part9.test.ts` fails the build for a new cached route that is not.

> **🔴 `force-static` under a cookie-reading layout prerenders the redirect.**
> Never use `force-static` under `app/(app)/studio/**`.

**Migration requirement:** a direct-Kling client is server-only. Keep it behind
`import "server-only"` so it can never enter a client bundle — exactly as
`lib/ai/fal/client.ts` and `lib/ai/voice/elevenlabs.ts` do.

---

## J · File & media handling

| | |
|---|---|
| **Buckets** | `frenz-ai-source`, `frenz-ai-results` — both **private**, created in 0141 with **no RLS policy on `storage.objects` at all**. Access is one short-lived signed URL, minted after an ownership check. |
| **Key shape** | `<userId>/<feature>/<jobId>/<role>.<ext>` — the owner id **first**, so a bucket policy can be written against it later. `pathBelongsTo()` proves it. |
| **Roles** | `source.*`, `character.*`, `prepared.mp4`, `prepared-reference-N.jpg`, `result.*`, `poster.jpg` |
| **Upload** | `createSourceUploadTicket()` → a signed **upload** URL; the browser PUTs directly. (A source PUT that died during a deploy reload has left a job stuck at 58% before.) |
| **Limits** | video 100 MB (`AI_VIDEO_MAX_BYTES`), image 20 MB, prepared ≤ 400 MB, source duration ≤ 30 min, per-feature `maxDurationSeconds` 120 s |
| **Validation** | client (`lib/ai/media.ts`) → server (`validateJobInput`) → **the worker's ffprobe is the authority** ("the billed duration and actual processing duration must match"; a mismatch is a refund, never a silent re-price) |
| **Preflight** | `lib/ai/preflight/*` + `server/preflight/vision.ts` with ONNX models (`yolox_nano.onnx`, `face_detection_yunet_2023mar.onnx`) on the worker. Fails **open** with a signed `validator_unavailable` pass unless `AI_PREFLIGHT_STRICT=1`. |
| **Retention** | 72 h for video jobs, 1 year for audio/voice jobs; hourly sweep |
| **Result delivery** | a signed URL through `/api/ai/jobs/[id]/result` after an ownership check — never a provider URL |

> **🔴 A provider must receive a `*-prepared.jpg`, never a raw upload.**
> Answering the brief's "which parts can pass original assets directly to
> Kling": **none of them should.** The prepare step exists because a raw iPhone
> JPEG broke a provider's own resize, and because the trimmed duration must
> equal the billed duration. Kling's direct API will still need the trim, the
> re-encode, the 720px floor and the fps clamp.

---

## K · Database map

20 AI tables, all catalogued in `lib/platform/data-domains.ts` (the orphan test
fails otherwise — **a new table needs a home there and in `portability/tables`**).

### K.1 Provider-INDEPENDENT (keep, untouched)

| Table | Migration | Purpose |
|---|---|---|
| `ai_usage_daily` | 0141 | per-member / day / feature allowance counters |
| `ai_guest_links` | 0145 | guest id ↔ account binding |
| `ai_balances`, `ai_balance_ledger` | 0149 | the legacy general balance |
| `ai_topup_attempts` | 0151 | deposit attempts + the provider's reason lines |
| `ai_product_balances`, `ai_product_ledger` | 0154 / 0155 / 0159 / 0160 | **the live wallet** — per-product, USD |
| `ai_job_events` | 0156 | the append-only audit trail (its timestamp column is **`at`**) |
| `ai_free_entitlements`, `ai_free_uses`, `ai_device_associations` | 0162 | complimentary creations + anti-farming |
| `ai_subscriptions`, `ai_credit_ledger` | 0167 | AI Pro / AI Max plans and credits |
| `ai_tta_free_usage` | 0170 | the monthly free characters |
| `ai_vc_free_usage` | 0171 | the monthly free voices |

### K.2 Mixed — `ai_jobs` (0141 plus twelve later migrations)

Provider-independent: `id, user_id, guest_id, batch_id, batch_index, feature,
status, client_request_id, source_path, result_path, poster_path,
funding_source, charged_cents, source_size, result_size, result_duration,
result_mime_type, audio_restored, source_duration, source_mime_type,
source_kind, source_url, error_code, error_message, created_at, started_at,
completed_at, expires_at, notified_at, finalize_attempts, finalize_lease_until,
finalize_next_at, finalize_error`.

Provider-specific:

| Column | Note |
|---|---|
| `provider` | check `in ('replicate','fal')` — **a Kling value needs a migration** |
| `replicate_prediction_id` | **misnamed**: it already holds fal request ids, and the UNIQUE index on it is the idempotency key for both webhooks. Rename only with great care, or keep the name and widen the comment. |
| `model`, `model_version` | free text |
| `metadata.provider_plan`, `metadata.pipeline.records[].provider` / `.predictionId` | JSON |

### K.3 Provider-SPECIFIC tables

| Table | Migration | Note |
|---|---|---|
| `ai_provider_runs` | 0168 | check `provider in ('replicate','fal','elevenlabs')`; unique `(provider, provider_job_id)`. **Needs a migration to accept `'kling'`.** |
| `ai_provider_health` | 0158 | keyed by model string — generic enough to keep |
| `ai_audio_assets` | 0170 | `provider`, `model`, `voice_id` columns (free text) |
| `ai_voice_clones` | 0171 | `provider` default `'elevenlabs'`, `provider_voice_id`; unique `(provider, provider_voice_id) where deleted_at is null` |

### K.4 Key SQL functions (all provider-independent)

`reserve_ai_usage`, `consume_ai_usage`, `release_ai_usage`, `unlock_ai_day`,
`link_ai_guest`, `credit_ai_balance`, `charge_ai_balance`, `refund_ai_charge`,
`credit_product_balance`, `reserve_product_charge`, `settle_product_charge`,
`refund_product_charge`, `adjust_product_balance`, `claim_ai_job_start`
(**redefined in 0158 → 0163 → 0166 → 0167**; the latest wins),
`admit_ai_waiting_jobs`, `grant_free_entitlement`, `consume_free_use`,
`restore_free_use`, `settle_free_use`, `reserve_ai_credits`,
`settle_ai_credits`, `release_ai_credits`, `ai_credit_usage`,
`consume_tta_free_characters`, `release_tta_free_characters`,
`consume_vc_free_clones`, `release_vc_free_clones`.

> **🔴 Migration hazards recorded on this project:** `create table if not exists`
> silently skips new columns; DDL placed after a dollar-quoted body can be
> silently skipped; Postgres grants EXECUTE on a new function to **PUBLIC** by
> default — `security definer` plus a `p_user_id` argument means anyone can spend
> anyone's quota, so **REVOKE from `anon` and `authenticated`**. Also:
> `exception when others then return 0` hides plan-time type errors — raise a
> warning first. Migrations auto-apply through the Supabase GitHub integration:
> **probe the DB, not the file**, and probe with `.select("col").limit(1)`, never
> `head: true`.

---

## L · Shared infrastructure — untouched by this migration

| System | Where | Why it survives |
|---|---|---|
| **Supabase** (Postgres + RLS + Storage + Auth) | everywhere | not a provider concern |
| **Vercel** (frontend, provider credentials, webhooks) | — | keep |
| **Docker worker** (ffmpeg, yt-dlp, ONNX) | `Dockerfile`, `fly.toml` | keep — and keep it credential-free |
| **Upstash Redis** | `lib/rate-limit.ts` | keep |
| **Cloudflare** (CDN, cache rules) | — | keep — and mind the 2-hour header rule |
| **R2** (public media) + Cloudflare Stream | `lib/storage/` | unrelated to AI |
| **VAPID / web-push / service worker** | `lib/push/`, `public/sw*` | §H — protected |
| **GitHub Actions** (the AI clock) | `cron-ai-reconcile.yml` (10 min), `cron-ai-retention.yml` (hourly) | keep |
| **Auth / admin** | `is_admin()`, `lib/admin/require-admin.ts`, step-up | keep |
| **Wallet, credits, plans, free creations, Paystack** | `lib/ai/{credits,funding,balance,economy}`, `lib/ai/character-replace/wallet.ts` | **explicitly provider-independent** |
| **Job system** | `lib/ai/{jobs,job-store,job-events,job-stages,recovery,stall,retention}.ts` | keep — only the adapter seam changes |
| **Anthropic media tools + moderation** | `/api/ai/media`, `lib/moderation/risk-score.ts` | **not part of this migration** |
| **Downloader, feed, reels, messaging, studio, analytics** | — | entirely unrelated |

---

## M · Provider-specific infrastructure — eventually replaced

| Item | Disposition |
|---|---|
| `lib/ai/replicate/*` (4 files) | delete after Kling is live |
| `lib/ai/fal/*` (5 files) + `@fal-ai/client` | delete **first** — it never ran live |
| `app/api/ai/replicate/webhook/route.ts`, `app/api/webhooks/fal/route.ts` | replace with one Kling callback |
| the 8 replacement / lip-sync adapters under `providers/` | replace with per-feature Kling handlers |
| `replicateElevenLabsProvider`, `replicateMiniMaxProvider` (`tts-provider.ts`) | delete; keep `elevenLabsProvider` |
| `lib/ai/providers/config.ts` vendor table, `paused`, `falScopes`, the 4 model keys | rewrite for Kling |
| `lib/ai/providers/resolve.ts` two-vendor branching | collapse |
| Admin Providers switch + comparison panel | remove |
| `REPLICATE_*` (24 variables), `FAL_KEY` | remove after the cutover |
| `docs/replicate-gpu/`, `docs/replicate-vsr/`, 2 GitHub workflows | retired AI Clean Cog sources — delete with them |
| `lib/ai/{propainter,surya,text-detect,mask-refine,propainter-plan}.ts`, the AI-Clean block of `lib/ai/config.ts` | **retired AI Clean** dead weight; safe to remove in the same sweep |

---

## N · Migration risks (ranked)

### 🔴 Severity 1 — data loss or money

1. **`ai_jobs.provider` and `ai_provider_runs.provider` are CHECK-constrained.**
   Inserting `'kling'` fails until a migration widens both. A failing insert at
   `/start` *after* `reserve_product_charge` = a charged member with no job.
2. **`replicate_prediction_id` is the idempotency key for every provider.** Its
   UNIQUE index is what stops duplicate webhooks double-charging,
   double-refunding and double-notifying. Do not drop or rename it casually.
3. **Historical rows must stay readable.** `provider = 'replicate'` rows exist
   with completed results, ledger entries and refunds. Dropping the column, the
   constraint value or the adapter's status mapping breaks the history page, the
   admin jobs table and the retention sweep.
4. **`funding_source` decides which undo runs.** Releasing usage on a *paid* job
   hands back a free daily slot the member never spent — a free video, silently,
   on every paid failure. A new failure path must call `releaseJobFunding`, never
   a bespoke refund.
5. **The `processing → completed` ban.** A direct Kling handler that completes
   in-request (as Voice Cloning does) must still walk `finalizing`.

### 🟠 Severity 2 — feature breakage

6. **A new provider must declare its supported features.** `supports()` is
   checked *before* the per-feature branch. Missing an id fails **after** the
   charge, the download and the prepare — precisely the Lip Sync Pro regression.
7. **Notification hand-off.** If the Kling callback lands on a host without VAPID
   keys and claims the notification, the push is lost for ever.
8. **Cloudflare caching of a new route** — a callback or config route without an
   explicit `no-store` gets cached for 2 hours.
9. **The worker/frontend credential split.** Putting `KLING_API_KEY` on the
   worker changes the security posture; not putting it there means keeping the
   `/api/internal/ai/submit` hop.
10. **Four `claim_ai_job_start` definitions exist across migrations.** Any change
    must extend the *latest* (0167), not an earlier one.
11. **`data-domains.ts` + `portability/tables`** — a new table without a home
    fails the orphan test.
12. **Kling Omni capability gaps.** Face Only and Face + Head are *face-swap*
    tasks; Kling O1 Edit explicitly does **not** claim them (`falScopes` has them
    hard-`false`, unpatchable). If Kling 3.0 Omni also cannot do them, two of the
    four scopes lose their engine. **Confirm this against Kling's real API before
    deleting the Replicate face-swap adapters.**

### 🟡 Severity 3 — scope and cost

13. **Speech-to-Text does not exist** (§B.5). It is new work, not a migration.
14. **The multi-stage pipeline may collapse.** If Kling Omni does replace +
    lip-sync in one call, `planPipeline` shrinks — which changes `stageName()` /
    `stageSteps()`, the progress percentages (`job-stages.ts`), the stage list in
    the UI and the advance dispatch. Those percentages are a recorded debugging
    tool ("stuck at N% = look up N in `job-stages.ts` first"); do not renumber
    them silently.
15. **Pricing is per-second and per-model.** Kling's price shape may not be
    per-second. `providerCostPerSecondUsdCents`, `costUsdCentsPerSecond` and
    `costUsdCentsPerRun` already exist; the quote HMAC (`AI_QUOTE_SIGNING_SECRET`)
    must recompute to the same total or `/start` refuses with `PRICE_CHANGED`.
16. **The route-weight ratchet.** Run `npm run build` then `npm test` if any
    budgeted route's import graph changes.
17. **`lib/ai/tools.ts` and `frenz-ai-tools-grid.tsx`** must agree with
    `AI_FEATURES`, or a tool is offered and refused.
18. **Tests with teeth.** `providers.test.ts`, `lip-sync.test.ts`,
    `part8.test.ts` and `part12.test.ts` encode the two-vendor world and will need
    rewriting, not deleting.

---

## O · Recommended migration sequence (Parts 2 onward)

**Part 2 — the Kling seam, additive only.**
`lib/ai/kling/client.ts` (the only reader of `KLING_*`, `server-only`),
`lib/ai/kling/signature.ts`, `lib/ai/kling/status.ts`,
`app/api/webhooks/kling/route.ts` (reusing `handleProviderCallback` verbatim).
Migration: widen `ai_jobs_provider_chk` and `ai_provider_runs_provider_chk` to
accept `'kling'`. **Nothing routes to it yet.** Add a "Test provider" button for
Kling. Nothing is deleted.

**Part 3 — per-feature Kling handlers.**
One module per feature, each with its own validation, request construction,
prompt handling and submission — `kling/features/{face-only, face-skin,
full-character, upper-body, image-to-video, text-to-video, reference-image,
reference-video, lip-sync}.ts` — all sharing `lib/ai/kling/client.ts` and the
existing job / wallet / storage / notify infrastructure. Reuse `kling-input.ts`
limits and the Kling ffmpeg filters. **No giant pipeline.**

**Part 4 — route Character Replace and Lip Sync to Kling behind the admin
switch.** Add `'kling'` as a third vendor in `providers/config.ts` temporarily,
so one real paid run can be compared against Replicate on the same input. This is
the only point at which three vendors coexist, and it is deliberate.

**Part 5 — ElevenLabs consolidation.** Delete the `route: "replicate"` half of
Text to Audio and the `replicateElevenLabsProvider` / `replicateMiniMaxProvider`
adapters. Direct ElevenLabs becomes the only TTS path; the admin switch collapses.

**Part 6 — Speech-to-Text (a new feature).** `ai_speech_to_text` in
`AI_FEATURES`, a DB check-constraint migration, job-meta, pricing, a free
allowance, config, an admin panel, a workspace and a transcript library. Wire
`lib/ai/tools.ts`'s `transcription` capability to it so `transcribe` and
`subtitles` finally light up.

**Part 7 — delete fal.ai.** Cheapest and safest: it never ran live and has no
historical rows. Remove `lib/ai/fal/*`, `@fal-ai/client`, `/api/webhooks/fal`,
`FAL_KEY`, the fal model keys, `falScopes`, and the fal half of every test.

**Part 8 — delete Replicate.** Only after Kling has served real jobs for every
scope. Keep `provider = 'replicate'` readable in the DB for ever. Remove the
adapters, the webhook route, the `REPLICATE_*` variables, the retired AI Clean
modules (`propainter`, `surya`, `text-detect`, `mask-refine`) and `docs/replicate-*`.

**Part 9 — admin and UI consolidation.** Collapse the Providers tab to a single
Kling panel; redesign the AI Studio for the larger Omni feature set in the
FrenzSave design language.

**Gates for every part:** `npm run typecheck` · `npm run lint` · `npm run build`
· `npm test` — all four, because the build and the tests do **not** typecheck
test files. Plus the mandatory performance-review and security-review gates.

---

## Appendix — environment variables

| Variable | Class | Note |
|---|---|---|
| `REPLICATE_API_TOKEN` | **EVENTUALLY REMOVE** | set locally and in production |
| `REPLICATE_WEBHOOK_SECRET` | **EVENTUALLY REMOVE** | required, or webhooks are refused |
| `REPLICATE_WAN_ANIMATE_REPLACE_VERSION`, `_FACE_ONLY_`, `_SKIN_FACE_`, `_LIPSYNC_`, `_LIPSYNC_PRO_`, `_KLING_LIPSYNC_`, `_ELEVENLABS_`, `_TTS_` | **EVENTUALLY REMOVE** | version-pin overrides |
| 8 × `REPLICATE_AI_CLEAN_*` / `_PROPAINTER_*` / `_TEXT_DETECT_*` | **REMOVE** | retired AI Clean |
| `FAL_KEY` | **EVENTUALLY REMOVE** | **not set** — fal.ai has never run |
| `ELEVENLABS_API_KEY` | **KEEP** | the target TTS / STT / cloning credential; needed on Vercel **and** the worker |
| `KLING_*` | **NEW** | needs a key, a public callback URL and one paid test run |
| `AI_QUOTE_SIGNING_SECRET` | **KEEP** | HMAC over every quote, free-use and preflight token |
| `AI_GUEST_SECRET` | **KEEP** | guest subject signing |
| `AI_PREFLIGHT_ENFORCE`, `AI_PREFLIGHT_STRICT` | **KEEP** | the preflight gate |
| `AI_FFMPEG_IDLE_TIMEOUT_MS`, `AI_FFMPEG_HARD_TIMEOUT_MS` | **KEEP** | worker |
| `DOWNLOAD_WORKER_URL`, `WORKER_SECRET`, `FRENZ_FRONTEND_URL` | **KEEP** | the two-runtime split |
| `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*` | **KEEP** | |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | **KEEP** | rate limits |
| `VAPID_*`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | **KEEP** | push — protected |
| `CRON_SECRET` | **KEEP** | an **empty** value 403s every cron |
| `R2_*`, `CF_STREAM_*` | **KEEP** | unrelated to AI |
| `PAYSTACK_SECRET_KEY` | **KEEP** | top-ups and AI plans |
| `ANTHROPIC_API_KEY` | **KEEP** | media tools + moderation — **not part of this migration** |

> `.env.example` does **not** list `REPLICATE_API_TOKEN`, `REPLICATE_WEBHOOK_SECRET`
> or `FAL_KEY`, although the code requires them. Worth fixing in a later part.

---

*End of Part 1. No migration work has begun. Awaiting the Part 2 instruction.*
