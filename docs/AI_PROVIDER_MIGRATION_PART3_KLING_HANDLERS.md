# Frenz AI — Provider Migration, Part 3: Direct Kling 3.0 Omni Feature Handlers

**Date:** 2026-09-28. **Branch:** `main` at `d8400e6`.
**Audience:** whoever runs Part 4 (controlled provider routing), and the owner.
**Depends on:** `docs/AI_PROVIDER_MIGRATION_PART1_AUDIT.md` (the architecture map)
and Part 2 (`lib/ai/kling/{config,signature,status,client,provider}.ts`, migration 0178).

**Scope of this part:** build isolated, independently testable feature handlers
against the direct Kling API. **No production feature was routed to Kling.**

---

## 1 · How capability was decided

Kling's API reference (`kling.ai/document-api/**`) is a client-rendered
application that returns a bare `<title>` to any non-browser fetch. It was
retried on 2026-09-28 across six URLs — `apiReference/commonInfo`,
`api/get-started/authentication`, `api/get-started/callbacks`,
`api/video/3-0-omni/video-omni`, `apiReference/model/OmniVideo` and
`guides/get-started/overview` — and every one returned the same empty shell.

**What was readable, and is the authority used here:**
Kling's own **VIDEO 3.0 Omni model guide**
(`kling.ai/quickstart/klingai-video-3-omni-model-user-guide`), which *is*
server-rendered. It states the model's supported modes, its duration ceiling,
its resolution modes, its reference-image and reference-video limits, its
character-element rules and its audio behaviour. Every **capability** verdict in
§2 comes from that page.

**What is corroborated but not officially read:** the **request field names**
(`image_list`, `element_list`, `video_list`, `multi_prompt`, `mode`, `sound`,
`shot_type`, `refer_type`, `external_task_id`). Several independent mirrors name
them identically, and they agree with the response envelope Part 2 already
implements. Nothing was invented — but **a live key must confirm them before a
member's money depends on one**, and that is Part 4's first task.

This split is deliberate: a capability decision made from a guess is how a
feature gets offered and then refused after a charge.

---

## 2 · Capability verdicts

### Supported by direct Kling 3.0 Omni — implemented

| Feature | Basis |
|---|---|
| **Text → Video** | Guide: "Text-to-Video — Supports Native Audio and Multi-shot" |
| **Image → Video** | Guide: "Image-to-Video: Includes start & end frames…" |
| **Reference Image** | Guide: multi-image reference, **up to 7 images** without a video (min 300 px, ≤10 MB, .jpg/.jpeg/.png) |
| **Reference Video** | Guide: "Video Element Reference — Supports uploading/recording video elements" (3–10 s, ≤200 MB, ≤2K) |
| **Full Character** | Guide: element reference over a supplied video — a base clip plus a character element |

### Not supported — left unavailable, with the concrete limitation

| Feature | The limitation |
|---|---|
| **Face Only** | Omni has **no face-swap operation and no parameter that scopes a replacement to a region of the body**. Its element reference replaces a subject *whole*. Building this would mean sending the identical request Full Character sends and hoping the model restrained itself. |
| **Face + Head** | The same limitation. "Face and head but not the body" is region-scoped replacement; Omni documents no region control. |
| **Upper Body** | Also region-scoped. ⚠️ Note this is **not** inherited from the fal adapter — that mapping *allowed* Upper Body on Kling O1. It is refused because the **direct Omni API** documents no way to express "upper body only". |
| **Lip Sync** | **Not a documented mode of Omni.** The guide lists the model's modes and lip-sync is not among them; its FAQ says lip sync "functions the same as in O1" — i.e. through a *separate* Kling endpoint and model. Omni's Element Voice Control binds a voice to a character it is *generating*, which is a different operation from driving the mouth of an existing person in existing footage. |

Each refusal also records a `revisitWhen` — what would have to become true for
Part 4+ to reopen it. No unsupported feature was routed to Replicate, to fal.ai,
to another model, or chained through several. `lib/ai/kling/features/unavailable.ts`.

---

## 3 · Handler map

| Feature | Handler | Endpoint / model | Required inputs | Request shape | Output |
|---|---|---|---|---|---|
| Text → Video | `features/text-to-video.ts` | `POST /omni-video/kling-v3-omni` · `kling-v3-omni` | `prompt` **or** `shots[]` | `prompt` \| `multi_shot`+`shot_type`+`multi_prompt[]` | task id |
| Image → Video | `features/image-to-video.ts` | same | `firstFrameUrl` | `image_list[]` with `type: first_frame\|end_frame` | task id |
| Reference Image | `features/reference-image.ts` | same | `prompt` + ≥1 reference | `element_list[]` (subjects) + `image_list[]` (style, **no** `type`) | task id |
| Reference Video | `features/reference-video.ts` | same | `videoUrl` + `prompt` | `video_list[]` with `refer_type: "feature"` | task id |
| Full Character | `features/full-character.ts` | same | `videoUrl` + `character` | `video_list[]` `refer_type: "base"` + `element_list[]` | task id |

**Transport note.** The two Kling surfaces express the model differently, so the
client picks path and body together from `klingAuthMode()`:
`POST /omni-video/<model>` (API key, model in the path — `model_name` removed)
or `POST /v1/videos/omni` (AK/SK JWT, model in the body). A handler always emits
`model_name`; one line in the client strips it on the surface that does not want it.

### Two distinctions the brief specifically warned about

- **Image → Video vs Reference Image.** A frame carries `type` and the output
  *opens on that picture*. A reference carries no `type` — the model takes the
  person or the look and builds something new. Handling both in one builder
  would mean a boolean deciding whether a member's photo is *shown* or merely
  *consulted*.
- **Reference Video vs Full Character.** `refer_type: "feature"` means "take
  cues"; `refer_type: "base"` means "this clip, rebuilt". A member who uploads
  their footage expecting it edited, and receives something merely *inspired* by
  it, has been given the wrong product and charged for it.

---

## 4 · Architecture — what is shared and what is not

```
  text-to-video   image-to-video   reference-image   reference-video   full-character
        │               │                │                 │                │
        └───────────────┴────────┬───────┴─────────────────┴────────────────┘
                                 │
              features/registry.ts   ← a DIRECTORY, not a pipeline
              features/shared.ts     ← model-wide rules only
              features/capabilities.ts ← the verified Omni limits
                                 │
                        features/submit.ts (server-only)
                                 │
                     lib/ai/kling/client.ts  (transport)
                                 │
                       the EXISTING job system
```

**Shared:** the client, signing, status normalisation, webhook handling, error
normalisation, the verified limit table, and small validators that encode *model*
rules (a duration window, an https URL, the image budget).

**Never shared:** a feature's input type, its validation, its prompt, its request
body. `registry.ts` imports handlers and lists them; it contains no
`switch (feature)` that assembles a body and no common validation path every
feature is squeezed through. A test asserts each handler's built request
independently.

`features/capabilities.ts` deliberately does **not** import
`character-replace/providers/kling-input.ts` (the fal-era O1 table), and a test
asserts neither imports the other. The O1 numbers are wrong for Omni in three
ways that would each be a bug:

| | O1 Video Edit (fal) | 3.0 Omni (direct) |
|---|---|---|
| Output duration | 3–10 s | **3–15 s** |
| References | 4 always | **7** without video; 4 with |
| Input geometry | 720–2160 px, min edge 720 | `mode`: 720P / 1080P / 4K |

---

## 5 · Billing safety

The order §5 of the brief fixes is preserved, and the gate is what makes it work:

```
klingFeatureGate(feature)     ← PURE. no network, no DB, no clock. FREE.
   ↓ (caller's own quote check — unchanged)
   ↓ (caller reserves / charges — unchanged)
   ↓ (caller creates the ai_jobs row — unchanged)
submitKlingFeature(...)       ← gates AGAIN, then validates, then submits
```

`validate` and `buildRequest` are pure on every handler, so a future `/start`
can refuse an unsupported feature **before** reserving credits, taking a
complimentary creation or charging a wallet. This directly answers the Part 1
audit's most expensive recorded bug: every Lip Sync Pro job failed
`SUBMIT_FAILED` because a `supports()` entry was missing — *after* the charge,
the download and the prepare.

`submit.ts` re-runs the gate immediately before spending provider money. That is
not redundant: the audit's bug was a check that existed but was not reached on
one path, and a check costing nanoseconds that can only prevent a wrong charge
is worth running twice.

**Nothing about pricing changed.** No handler mentions a price, a credit, a
wallet, a quote or `funding_source`; a test asserts that by grep. Kling's cost
model is Part 4's problem, and the existing quote/HMAC system is untouched and
un-bypassed.

---

## 6 · Job lifecycle

Unchanged, and reused rather than reimplemented:

```
(Part 4) /start → reserve → create ai_jobs row → submitKlingFeature()
                                                        ↓
                                          Kling task id returned
                                                        ↓
                        caller stamps it via the EXISTING stampJobProvider
                        into ai_jobs.replicate_prediction_id (provider-neutral,
                        UNIQUE — the shared idempotency key)
                                                        ↓
                                     Kling processes; POSTs callback_url
                                                        ↓
                             /api/webhooks/kling  (Part 2, unchanged)
                                                        ↓
                        handleProviderCallback  ← the SHARED handler
                                                        ↓
                    transitionJob (CAS) → existing finalizer → result storage
                                                        ↓
                      claimAiNotification (CAS) → sendSmartPush → VAPID → SW
```

`submit.ts` deliberately does **not** write the job row or the provider-run
ledger. That is the caller's, exactly as `lib/ai/character-replace/submit.ts`
already works: the row, its metadata and the ledger are the *job's* business,
and an adapter that wrote to them would be a second place deciding what a job is.

**Idempotency** is entirely inherited from Part 2 — `transitionJob` is a
compare-and-set, the reference column is UNIQUE, the row's `provider` must match
the caller, and `claimAiNotification` is its own CAS. A duplicate Kling callback
cannot complete, charge, refund, finalize or notify twice. No new task-ID column
was created and `replicate_prediction_id` was not renamed.

---

## 7 · Credential boundary

Unchanged. The Kling credential lives on **Vercel only**. `client.ts` is the sole
reader (`server-only`), and it is the only file under `features/` that touches
the network — every other module there is pure, asserted by a test that greps for
`server-only`, `kling/client`, `supabase`, `createAdminClient`, `fetch(` and
`Date.now()`.

The worker holds no Kling credential and imports no Kling module. If a worker
stage ever needs a Kling request, it goes the existing way:
`worker → /api/internal/ai/submit → Vercel → Kling`.

---

## 8 · Media quality

No media-pipeline change was made. The handlers take **URLs** and measured facts;
they do not encode, scale, clamp frame rates or re-encode anything. The
verified Omni limits are enforced as *validation* (refuse early, before a charge)
rather than as *transformation* (silently re-encode) — so Part 4 can decide how
little preparation Omni actually needs, with the real numbers in front of it.

Two things Part 4 should notice:

- Omni accepts a **3–10 s** reference video but produces up to **15 s**. The
  handlers enforce those as separate windows; conflating them is the trap.
- Omni can bind a voice to a character element natively
  (`element_list[].audio`, 5–30 s). That is offered as an **input**, not a
  chained stage — one request, no intermediate download, no re-encode, no second
  vendor. It is the quality win available the day Part 4 chooses to use it.

Per §6 of the brief, **no handler chains** replace → voice → lip-sync. Whether
the product should keep composing those stages is Part 4's decision, not a
silent redesign here.

---

## 9 · Production routing — explicitly unchanged

- `klingProvider.supports()` still returns **false for every feature**.
- Nothing in `app/`, `server/`, `lib/ai/providers/resolve.ts`,
  `lib/ai/submit.ts`, `character-replace/start-job.ts` or `lip-sync/start-job.ts`
  imports `lib/ai/kling/features/` — asserted by a test.
- `kling` remains absent from `SwitchableVendor`, from `PROVIDER_FEATURE_DEFS`
  and from `MODEL_KEYS`, so no admin setting can route to it.
- Character Replace and Lip Sync still resolve to Replicate/fal; Text to Audio
  and Voice Cloning still resolve to ElevenLabs.
- Replicate and fal.ai were not deleted. Anthropic was not touched. No STT.

---

## 10 · What Part 4 has to do first

1. **Confirm the contract with a live key.** Set `KLING_API_KEY`, run
   `klingCredentialCheck()`, then one real paid generation per implemented
   handler. Confirm: the create path, `model_name` placement, every field name in
   §1, the callback signature scheme, and `external_task_id`.
2. **Widen `jobVendor()`** in `lib/ai/character-replace/job-meta.ts` — it narrows
   to `"replicate" | "fal"` and would map a Kling row to `"replicate"`. Inert
   today; a real bug the moment a Kling job exists.
3. **Decide Kling's cost model** and express it in the existing quote/HMAC
   system. It may not be per-second.
4. **Decide the four refusals.** Face Only / Face + Head / Upper Body and Lip
   Sync need either a different direct Kling model, or a product decision that
   they collapse into Full Character, or that they stay on Replicate.
5. **Record the provider run.** `openProviderRun` / `closeProviderRun` already
   accept `provider: "kling"` (migration 0178); wire them at the call site.
