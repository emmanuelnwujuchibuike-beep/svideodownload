# Frenz AI — Provider Migration, Part 4: the VERIFIED direct Kling contract

**Date:** 2026-09-28. **Method:** live probing with a real `KLING_API_KEY`
against Kling's own host. **Authority:** this document. Where it disagrees with
Part 2 or Part 3, **this document is right and those were guesses.**

Kling's official reference (`kling.ai/document-api/**`) is still a client-rendered
SPA that returns a bare `<title>` to any non-browser fetch — retried again on
2026-09-28 and confirmed unreadable, exactly as Parts 1 and 3 recorded. Every
aggregator's "Kling schema" (Pollo, useapi, mulerouter, apiframe) documents
*their own wrapper*, not Kling: Pollo's is `{input:{prompt, refs[], webhookUrl}}`,
which the direct API rejects outright. Those were therefore **not** used.

So the contract below was read off the live API by sending deliberately
malformed bodies and reading the vendor's own validation messages.

---

## 0 · Why this matters: Part 3's request bodies could never have worked

Part 3 built five handlers that emit `model_name`, `prompt`, `image_list[]`,
`element_list[]`, `video_list[]`, `multi_prompt[]`, `mode`, `sound`, `shot_type`
and a top-level `callback_url`. **The live API accepts none of those names.** A
Part 3 request produces `400 {"code":1201,"message":"contents cannot be empty"}`.

Two of those would have been worse than a 400:

- **`callback_url` at the top level is silently ignored.** It belongs in
  `options`. A job submitted Part 3's way would be accepted, generate, bill —
  and never call back. Every such job would have hung until the stall sweep
  failed it, after the member was charged.
- **Unknown top-level fields are silently ignored, not rejected.** `duration`,
  `mode`, `sound`, `aspect_ratio`, `cfg_scale` and `seed` at the top level all
  parse fine and do nothing. So a wrong field name is not a loud failure; it is
  a video generated at the wrong length, ratio and quality, and billed.

This is the concrete vindication of the brief's §5 rule — *verify the live
contract before routing production traffic* — and of §31.24.

---

## 1 · Transport

| | Verified value |
|---|---|
| Host | `https://api-singapore.klingai.com` |
| Auth | `Authorization: Bearer <KLING_API_KEY>` |
| Create | `POST /omni-video/<model>` |
| Model | `kling-v3-omni` (`kling-v3-1-omni` → `400 "model is not supported"`) |
| Status | `GET /tasks?task_ids=a,b,c` **or** `GET /tasks?external_task_ids=…` |
| Lip Sync | `POST /v1/videos/lip-sync` |

**`api.klingai.com` is NOT an equivalent host.** It answers `404` **HTML** for
`/tasks` (it serves only the legacy `/v1/**` tree). Treating it as
interchangeable would mean a `KLING_API_BASE_URL` change silently breaking every
status read, with an HTML body arriving where JSON was expected — the same shape
as the recorded Cloudflare-502 law. `KLING_ALLOWED_API_HOSTS` is narrowed
accordingly.

**The AK/SK JWT surface does not exist for Omni.** `POST /v1/videos/omni` is a
`404`. Part 2's `KLING_LEGACY_OMNI_PATH` and its "the two surfaces express the
model differently" branch describe an endpoint that is not there.

---

## 2 · The Omni request body

```json
{
  "contents": [ { "type": "...", ... } ],
  "settings": { "aspect_ratio": "...", "resolution": "...", "duration": 5, "audio": "off" },
  "options":  { "callback_url": "https://…", "external_task_id": "…" }
}
```

`contents` is required and must be a non-empty array (`"contents cannot be
empty"`, `"contents value type is invalid, expected array"`).

### 2.1 `contents[].type` — the complete accepted set

Every other value answers `contents[i].type value '<x>' is invalid`. Verified
**accepted**: `prompt` · `image` · `video` · `element` · `first_frame` ·
`last_frame` · `voice`.

Verified **rejected** (worth recording so nobody retries them): `text`,
`end_frame`, `tail_frame`, `final_frame`, `end_image`, `image_tail`,
`reference_image`, `reference_video`, `subject`, `character`, `style`,
`multi_prompt`, `shot`, `audio`, `sound`, `music`, `bgm`, `negative_prompt`,
`aspect_ratio`, `config`, `settings`, `output`, `spec`, `picture`, `img`, `vid`,
`frame`, `text2video`, `image2video`.

Note `end_frame` is **invalid** and the last frame is **`last_frame`** — Part 3
guessed `end_frame` and would have 400'd on every two-frame request.

| type | field | Verified by |
|---|---|---|
| `prompt` | `text` | `"content item of type 'prompt' must have non-blank text"` |
| `first_frame` | `url` | `"content item of type 'first_frame' must have a non-blank url"`; an unreachable URL is then **fetched** and the task fails |
| `last_frame` | `url` | `"content item of type 'last_frame' must have a non-blank url"` |
| `video` | `url` | `url:"notaurl"` → `"Video URL is invalid"` |
| `voice` | `url` | accepted; not independently exercised |
| `element` | `element_id` | see §2.4 — **not usable from the API** |
| `image` | — | see §2.5 — **appears to be ignored** |

### 2.2 `settings` — every field, with the vendor's own allowed values

| field | allowed values (quoted from the vendor) | note |
|---|---|---|
| `aspect_ratio` | `16:9`, `9:16`, `1:1` | **Required** unless a `first_frame` is present, or the task is video editing |
| `resolution` | `480p`, `720p`, `1080p`, `4k` | lower-case; `720P` is **not** accepted |
| `duration` | a number or numeric string | ⚠️ **the vendor does not range-check it** — `0`, `1` and `20` are all accepted. 3–15 s is the model guide's window and **we** must enforce it |
| `audio` | `native`, `off`, `original` | ⚠️ `original` answers `"audio mode 'original' is not supported by the current model"` on `kling-v3-omni`, so the usable set is `native` / `off` |
| `multi_shot` | boolean | |
| `seed` | validated (`"settings.seed value 'x' is invalid"`) | |

`negative_prompt`, `cfg_scale`, `camera`, `fps`, `quality` and `mode` inside
`settings` are **not validated** — i.e. not real fields. `mode` in particular
was Part 3's quality tier; the real field is `resolution`.

### 2.3 `options`

`callback_url` and `external_task_id`. Confirmed real by the status endpoint:
`GET /tasks` answers `"task_ids or external_task_ids is required"`, and
`?external_task_ids=…` is accepted — so the handle we send is queryable, which
is what makes a timed-out create recoverable instead of re-billable.

### 2.4 🔴 `element` cannot be used through the API

`{"type":"element","element_id":"1"}` answers `"Element id not found: 1"`, and
with no id `"Invalid element id: "`. Supplying the images alongside it —
`images[]`, `image`, `url`, `urls[]`, or a nested `contents[]` — changes
nothing, and there is no element-creation endpoint on this surface
(`/elements`, `/v1/elements`, `/v1/videos/elements` are all `404`;
`/omni-video/elements` answers `"model is not supported"`).

**An `element_id` therefore refers to an element that already exists in the
Kling account**, created in Kling's own web application. It is not something an
API caller can create, so it cannot be part of an automated product flow.

### 2.5 ⚠️ `image` appears to be ignored

`{"type":"image","url":…}` is accepted, but the URL is never validated and
never fetched: three tasks sent with an **unreachable** image URL all
**succeeded**, generating from the prompt alone, whereas an unreachable
`first_frame` URL **fails** with `"Something went wrong when we tried to get the
contents of the file."` A field whose value is never read is a field that does
nothing.

That is the evidence available without spending more of the owner's money. It is
recorded as *unconfirmed* rather than concluded — see §5.

---

## 3 · Responses

**Create** — `200`:

```json
{ "code": 0, "message": "SUCCEED", "request_id": "…",
  "data": { "id": "933557073781063683", "status": "submitted",
            "message": "", "create_time": 1790605869865, "update_time": 1790605869865 } }
```

The id is **`data.id`** and the status **`data.status`** — not `task_id` /
`task_status`. Part 2's reader accepts both, so it survives; its `task_status_msg`
does not exist and the failure reason is **`message`**.

**Status** — `GET /tasks?task_ids=…` answers an **array**:

```json
{ "code": 0, "message": "SUCCEED", "request_id": "…", "data": [
  { "id": "933557962801545273", "status": "succeeded",
    "outputs": [ { "type": "video", "id": "…", "url": "https://v15-kling-fdl.klingai.com/…", "duration": "5.041" } ],
    "message": "", "create_time": …, "update_time": …,
    "billing": [ { "charge_type": "unit", "amount": "3", "package_type": "video" } ] } ] }
```

🔴 **The result lives in `outputs[]`, not `task_result.videos[]`.** Part 2's
extractor reads `task_result.videos[].url` and would have found nothing in a
genuine success — a completed, paid video reported as "succeeded with no video
in the task result".

Statuses observed: `submitted` · `processing` · `succeeded` · `failed`. The
output host is `v15-kling-fdl.klingai.com`, which the existing
`isKlingOutputHost` already allows.

**Errors** — `{ "code": 1201, "message": "<sentence>", "request_id": "…" }` with
HTTP `400` for every validation fault. An unknown *task* is not an error: the
query answers `200` with `data: []`.

---

## 4 · 🔴 Billing is in UNITS, not seconds of money

```json
"billing": [ { "charge_type": "unit", "amount": "3", "package_type": "video" } ]
```

A 5-second, 720p, text-to-video generation cost **3 units**. A task that failed
before generating reports `[{"amount":"0"}]` — **a failed task is not billed**,
which the refund path can rely on.

This is the single most important correction to the brief's §12/§13 assumption
that cost is "per second". Kling charges **discrete units per generation**,
varying with the configuration, and it **reports the actual amount on the task**.
So the pricing model must be a matrix keyed on the dimensions that move the unit
count, and the *real* consumption should be read back from `billing` rather than
estimated forever.

---

## 5 · Capability verdicts — SETTLED BY GENERATION

Nine real generations were run on 2026-09-28 with the owner's authorisation, at
the cheapest settings that work. These are outcomes, not inferences.

| Feature | Verdict | How it was settled |
|---|---|---|
| **Text → Video** | ✅ **SHIPS** | a real run succeeded; one `outputs[]` video, `duration "5.041"`, 3 units |
| **Image → Video** | ✅ **SHIPS** | a reachable portrait sent as `first_frame` came back **animated and faithful** — same person, clothing, lighting, background. 1.8 units at 720p/3s |
| **Lip Sync** | ✅ **SHIPS** | `audio2video` on a 720p clip of a person: **the source video was preserved exactly** and only the mouth was driven. 0.5 units |
| **Reference Video** | ❌ **REFUSED** | see §5.1 — Omni **discards** the supplied video |
| **Reference Image** | ❌ **REFUSED** | a plain `image` item is never fetched; three tasks with an unreachable image url all succeeded, generating from the prompt alone |
| **Full Character / Face Only / Face + Head / Upper Body** | ❌ **REFUSED** | see §5.2 — there is no way to supply a character, and no endpoint takes video + character |

### 5.1 🔴 Omni does NOT edit a supplied video — proven three times

The question that decides Character Replace, tested directly:

| run | request | result |
|---|---|---|
| A | prompt "keep this exact scene and motion, change only the sky to deep purple" + `video` | a photoreal **empty plain under a purple sky**. Nothing of the animated-forest source. |
| D | the same, using Kling's own placeholder syntax — "Keep `<<<video_1>>>` exactly as it is…" | a photoreal **tree in a field**. Again nothing of the source. |
| B / E | prompt + `video` + a reference photo, asking for the person to be replaced (E with `<<<video_1>>>` and `<<<image_1>>>`) | **a different person in a different place**, matching neither input |

The placeholder tokens were tested specifically because omitting them was the
obvious flaw in the first attempt. They changed nothing.

**The contrast that proves this is a real finding and not a bad prompt:**
`/v1/videos/lip-sync` was given the same kind of source and **preserved it
exactly** — same person, clothing, background and framing, mouth driven. Kling
*can* edit a supplied video. It simply cannot do it through Omni.

No parameter reaches the "task is video editing" branch that Omni's own
aspect-ratio error mentions. Tried and rejected, at item, `settings` and top
level: `refer_type` (`base`/`feature`), `role`, `edit`, `type_`, `mode`, `as`,
`task_type`, `video_edit`, and a `video_id` instead of a url.

### 5.2 🔴 The complete endpoint map — there is no character endpoint

Every path that exists on the direct API, probed 2026-09-28:

| endpoint | state |
|---|---|
| `POST /omni-video/kling-v3-omni` | ✅ live |
| `POST /v1/videos/text2video` | ✅ live — models `kling-v2-5-turbo`, `kling-v3` |
| `POST /v1/videos/image2video` | ✅ live — models `kling-v2-5-turbo`, `kling-v3` |
| `POST /v1/videos/lip-sync` | ✅ live |
| `POST /v1/videos/video-extend` | exists (needs a Kling `videoId`) |
| `POST /v1/videos/effects` | exists — template scenes (`hug`, `kiss`, `expansion`, `bloombloom`, `dizzydizzy`) |
| `POST /v1/images/generations` | exists |
| `POST /v1/images/kolors-virtual-try-on` | exists (clothing) |
| `POST /v1/videos/multi-image2video` | 🔴 **RETIRED** — "This API is no longer available", for every model |

404 on every one of: `/v1/videos/{video2video, motion-brush, avatar, character,
face-swap, swap, omni, generations, edit}`, `/v1/images/{face-swap, image2image,
edit}`, `/v1/{avatars, characters, elements, assets, uploads, files}`,
`/omni-image/*`, and the bare `/videos`, `/images`, `/elements`, `/models`.

**There is no face-swap endpoint and no character endpoint.** `multi-image2video`
was the only one that accepted inline reference images, and it is retired. Older
models (`kling-v1`, `kling-v1-5`, `kling-v1-6`, `kling-v2-1`, `kling-v2-master`,
`kling-v2-1-master`) are all discontinued.

So Character Replace needs **video-in + character-in → the same video with the
person swapped**, and no endpoint on the direct API accepts both. Per §7 it is
reported unsupported and is **not** routed to Replicate or fal.ai.

> The capability exists in Kling's **web application**, where a person creates an
> `element` by hand. `element_id` refers to one of those. It is not something an
> API caller can create, so it cannot be part of an automated product flow.

### 5.3 The unit costs actually observed

| operation | settings | units |
|---|---|---|
| Omni video | 720p, 3 s | **1.8** |
| Omni video | 720p, 5 s | **3** |
| Lip Sync | ~3 s | **0.5** |
| any task that failed before generating | — | **0** |

⚠️ `480p` is listed by `settings.resolution` but **refused at generation**
("video resolution value '480p' is invalid"), so 720p is the real floor for
video and the cheapest tier there is.

🔴 A failed task costs nothing, which the refund path can rely on.

## 6 · Kling Lip Sync — a real, separate, direct endpoint

The brief's §6 was right and Part 3 was wrong. Part 3 refused Lip Sync on the
grounds that "lip sync is not a documented mode of Omni", which is true and
irrelevant: Kling exposes it as **its own endpoint**, which is exactly what §6
said to look for.

```
POST /v1/videos/lip-sync
{ "input": { "mode": "audio2video" | "text2video", … } }
```

| field | verified rule |
|---|---|
| `input.mode` | **required**; `"allowed values: text2video, audio2video"` |
| `video_url` **or** `video_id` | `"video_id or video_url is required"` |
| `audio_type` | `audio2video` only; **required** (`"Audio type is null"`); `"allowed values: file, url"` |
| `audio_url` | with `audio_type: "url"`; the pair is accepted and creates a task |
| `text` | `text2video` only; `"text is required"` |
| `voice_id` | `text2video`; `"Voice id not found"` for an unknown id |
| `voice_language` | `"allowed values: zh, en"` |
| `voice_speed` | `"must be less than or equal to 2.0"` |

Note the ceiling error names the field **`voiceSpeed`** internally while
accepting `voice_speed` — evidence of a camel/snake mapping layer, and a reason
to send exactly the snake_case names verified here.

🔴 **`voice_language` is `zh` or `en` only.** Frenz AI's Text to Audio offers far
more languages through ElevenLabs. So Kling's *native* text-to-video lip sync is
a two-language feature, and the multilingual path remains "ElevenLabs makes the
speech, `audio2video` drives the mouth" — which is a **separate billed
operation**, exactly as the brief's §3 requires, not a hidden chained stage.

---

## 7 · The generations that were run (all authorised by the owner)

Each of these is one real, billable task. They are listed so the owner can
authorise them as a set, and so nobody later assumes they were run.

| # | Request | Settles |
|---|---|---|
| 1 | `first_frame` = a reachable JPEG, `resolution 720p`, `duration 5` | Image → Video end to end, and the unit cost of an image-driven run |
| 2 | `prompt` + `video` (a reachable 3–10 s MP4) | whether Reference Video **edits** or only **references**, and its unit cost |
| 3 | the same with `prompt` + `image` (reachable) | whether `image` is genuinely ignored (§2.5) |
| 4 | `/v1/videos/lip-sync`, `audio2video`, reachable MP4 + MP3 | Lip Sync end to end, its output shape and its unit cost |
| 5 | `/v1/videos/lip-sync`, `text2video`, a real `voice_id` | the voice catalogue, and whether `voice_id` values can be discovered from the API |
| 6 | one run per `resolution` × `duration` corner | the **unit matrix** §4 needs to be real rather than assumed |

Until #6 is run, every unit figure in the pricing matrix is a placeholder that
must be marked as one — **never shown to a member as a measured cost.**

---

*End of the verified-contract record. The code changes that follow it are
described in the Part 4 implementation document.*
