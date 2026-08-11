# Feature 15 · Part 2 — FrenzStream™ Playback Engine

**Status:** Tranche 1 shipped. Tranches 2–4 specified below, not yet built.
**Owner brief:** "one of the world's most advanced and premium video playback
engines… playback should feel invisible."

This document is requirement #1–#9 of the brief: the architecture, the
algorithms, and — with equal weight — an honest statement of what the web
platform can and cannot deliver, so nothing in the brief is quietly dropped.

---

## 0. What already existed

Part 1 and earlier work already shipped a real streaming stack. Building Part 2
without reading it first would have meant rewriting a working ABR pipeline:

| Capability | Where | State |
|---|---|---|
| ABR over Cloudflare Stream HLS, hls.js elsewhere | `lib/media/hls.ts` | working |
| Quality cap by connection / data-saver / battery | `lib/media/network-conditions.ts` | working |
| Source attach, MP4 fallback, native-HLS error fallback | `features/media/use-adaptive-source.ts` | working |
| One-video-at-a-time + background pause | `lib/media/video-coordinator.ts` | working |
| TTFF / rebuffer / dropped-frame beacon (sampled) | `lib/media/playback-metrics.ts` | working |
| Resume positions across remounts | `lib/media/resume-positions.ts` | working |
| Mute/unmute fade that never steals audio focus | `lib/media/audio-playback.ts` | working |
| Scroll-driven neighbour preloading | `features/feed/reel-viewer.tsx` | working |
| Fit rule (full bleed vs letterbox) | `features/reels/viewer/fit.ts` | working |

Part 2 therefore is **not** "write a player". It is: unify these into one engine
with a single decision-maker, add the signals and controls that are missing, and
make the result reusable by every surface.

---

## 1. Architecture

```
                        ┌──────────────────────────────┐
   device + network ───▶│      FrenzStream Governor    │
   playback telemetry ─▶│  (lib/media/engine/governor) │
   user preference ────▶└──────────────┬───────────────┘
                                       │  PlaybackPolicy
                        ┌──────────────┴───────────────┐
                        ▼                              ▼
              ┌──────────────────┐          ┌────────────────────┐
              │  Source binding  │          │   Pulse Buffer     │
              │ use-adaptive-src │          │ (preload planner)  │
              └────────┬─────────┘          └─────────┬──────────┘
                       ▼                              ▼
              ┌──────────────────┐          ┌────────────────────┐
              │  hls.js / native │          │  warm <link>/probe │
              └──────────────────┘          └────────────────────┘
```

**One decision-maker.** Every quality, buffer and preload decision is a pure
function of a single `PlaybackSignals` snapshot producing a single
`PlaybackPolicy`. Before this, the cap lived in `network-conditions`, the buffer
lengths were hardcoded in `hls.ts`, and the preload depth was hardcoded in the
reel deck — three places that could disagree, and did: a data-saver user still
got a 12-second forward buffer and three fully-buffered neighbours.

**Pure core, imperative edge.** The governor is a pure function with no DOM, no
timers and no I/O, so it is unit-testable across the whole signal space. The
adapters that read `navigator` and write to `hls.js` are thin and untested by
design — there is nothing in them to get wrong.

---

## 2. Adaptive streaming algorithm

`decidePolicy(signals) → policy`, evaluated at attach and whenever a signal
changes materially.

**Inputs** (`PlaybackSignals`): quality preference, save-data, effective
connection type, downlink Mbps, battery level + charging, device memory, CPU
cores, live rebuffer count, live dropped-frame ratio, reduced-motion.

**Outputs** (`PlaybackPolicy`): `maxHeight`, `forwardBufferSec`,
`maxForwardBufferSec`, `backBufferSec`, `preloadAhead`, `preloadBehind`,
`fullyBufferAhead`, `startBitrateEstimate`, `reason[]`.

The rules, in priority order — the first that applies wins, because a user's
explicit choice must never be overridden by a heuristic, and a device in
distress must never be pushed harder by a good bandwidth reading:

1. **Explicit preference.** `data-saver` → 480p hard cap, minimum buffers, no
   speculative preload. `high` → no cap. `balanced` → 720p. `auto` → continue.
2. **Distress.** A dropped-frame ratio above 8% or three or more rebuffers means
   the device or the link cannot sustain the current rung *regardless of what
   the bandwidth estimate says*. Step the cap down and shorten the buffer. This
   is the thermal/CPU governor (§4).
3. **Save-data / weak connection.** 2G → 360p, 3G → 720p.
4. **Battery.** Unplugged and ≤ 20% → 720p and a shorter forward buffer;
   unplugged and ≤ 10% → 480p and no speculative preload.
5. **Device class.** ≤ 2 GB device memory or ≤ 4 cores → 720p cap and a shallower
   preload window, because decode, not download, is the binding constraint.
6. **Otherwise** uncapped, and `capLevelToPlayerSize` still prevents fetching a
   rung larger than the element.

**Why quality is never switched abruptly.** hls.js changes rungs at segment
boundaries with `autoLevelCapping`; the governor only ever moves the *ceiling*,
never forces a level. A ceiling change is invisible mid-segment and the ABR
controller converges to it on the next fragment.

---

## 3. Pulse Buffer™ — intelligent preloading

The brief asks to predict behaviour and preload "only when beneficial to
bandwidth and battery". Preloading is a spend, so the planner is a **budget**,
not a list.

`planPreload(policy, deck) → PreloadPlan`

- The window is **asymmetric and directional**: forward-scrolling is the
  overwhelming case, so `preloadAhead` ≥ `preloadBehind` always.
- Only `fullyBufferAhead` clips get `preload="auto"`. The rest get
  `preload="metadata"` — enough for dimensions, duration and a poster, which is
  what makes the *next* start instant, without paying for segments that a fast
  scroll will discard.
- The budget collapses to **zero speculative preload** under data-saver, ≤ 10%
  battery, or 2G. On those devices the correct prediction is "spend nothing".
- Depth grows with confidence, not with bandwidth alone: a viewer who has
  watched three clips to completion gets a deeper window than one who has
  flicked past six in four seconds.

**What it deliberately does not do.** The brief lists "likely reposted videos",
"likely friend videos" and "nearby trending videos" as preload candidates. Those
are *recommendation* problems, not playback problems — they require a ranked
candidate set the feed API does not return today. Preloading a guess is a
straight bandwidth loss when the guess is wrong. The planner is shaped to accept
them (`candidates` is an ordered list, not a fixed ±N) and the feed will supply
them when the ranking exists.

---

## 4. Battery and thermal strategy

**There is no thermal API on the web.** No browser exposes device temperature,
CPU load or GPU load to JavaScript. Any claim to "monitor device temperature"
directly would be false. What *is* available is the observable consequence of
thermal throttling, and that is what the engine acts on:

- `HTMLVideoElement.getVideoPlaybackQuality()` → `droppedVideoFrames` /
  `totalVideoFrames`. A rising dropped-frame ratio at a steady bitrate is the
  signature of a decoder that cannot keep up — thermal throttling, a busy CPU, or
  a rung too high for the device. All three want the same response.
- `navigator.deviceMemory` and `navigator.hardwareConcurrency` → a static device
  class, applied before any frames have been dropped.
- Battery API level + charging state.

The response ladder: cap down one rung → shorten the forward buffer (less
decode-ahead and less memory) → drop speculative preload → in the limit, hold at
480p. Recovery is deliberately slower than degradation (a sustained clean window
is required before the cap lifts) because oscillating between rungs is more
visible and more expensive than sitting one rung low.

Already in place and kept: `enableWorker` (segment parsing off the main thread),
`backBufferLength` (bounded memory over a long session), pause-on-hidden
(no decode for frames nobody sees), one-video-at-a-time.

---

## 5. Error recovery

| Failure | Response | State |
|---|---|---|
| HLS manifest not ready (mid-encode) | fall back to MP4 | shipped |
| Fatal media error | `recoverMediaError()` once, then MP4 | shipped |
| Native-HLS (Safari) error | swap to MP4 source | shipped |
| Network loss | pause, retain buffer, resume on `online` | tranche 4 |
| Transient CDN 5xx | retry with jitter — a 5xx is "ask again" | tranche 4 |
| CDN hard failure | alternate host, then MP4 | tranche 4 |
| Decoder failure | drop to a lower rung, then software path | tranche 4 |

A 4xx is never retried. That is a verdict, not a hiccup — the same rule the
ads.txt incident established.

---

## 6. Accessibility

Shipped: the scrubber is a real `slider` with arrow-key seeking and an
`aria-valuetext` in `m:ss`; every rail control has a visible focus ring and an
accessible name; the mockup subtree is `aria-hidden`; motion respects
`prefers-reduced-motion`.

Tranche 3 adds: caption/subtitle rendering from HLS `SUBTITLES` tracks with user
customisation (size, background, colour), a captions toggle in the reel sheet,
and `prefers-reduced-motion` suppression of the new Living Playback transitions.
Auto-captions require a transcription pipeline that does not exist — specified,
not promised.

---

## 7. Scalability

Delivery is already Cloudflare Stream: a global edge ladder with AV1/H.265/H.264
renditions, multi-region, with the origin never serving playback bytes. The
engine adds no per-view server work — every decision is client-side and the only
server traffic is a sampled metrics beacon (~16% of playbacks, `sendBeacon`, no
response). That is what makes it indifferent to view volume: a billion views
cost the same per-view as one.

---

## 8. 🔴 What the brief asks for that cannot be built, and why

Stated plainly rather than silently skipped or faked:

| Asked | Reality |
|---|---|
| Monitor device temperature / CPU / GPU / packet loss | No web API exposes any of these. Inferred from dropped-frame ratio and device class (§4). |
| 8K, Dolby Vision, HDR selection | The ladder is produced by Cloudflare Stream, which offers neither 8K nor Dolby Vision. HDR cannot be requested or verified from JS. |
| Spatial audio, 360°, spatial video | No source content, no capture path, no player. Future work, not a playback gap. |
| Background audio playback | Directly conflicts with a documented product decision: the feed autoplays muted specifically so it never takes audio focus and never interrupts the viewer's music. Background playback requires MediaSession, which takes that focus. **Needs an owner decision, not a code change.** |
| Live low-latency streaming, viewer sync | No live ingest or delivery infrastructure exists. Out of scope until it does. |
| Encrypted offline storage, DRM | Requires EME/Widevine/FairPlay licensing. Offline caching in tranche 4 is unencrypted Cache Storage, which is appropriate for public reels and is not DRM. |
| "1 billion users" | Not a testable claim. The architecture is per-view stateless (§7); that is the honest version of it. |
| **Volume gestures** | **Not built, and should not be.** On iOS the audio level is under the user's physical control and `HTMLMediaElement.volume` is not settable from JavaScript — assigning to it is silently ignored. A vertical volume drag would therefore do nothing at all on the iPhone, which is this app's primary device, while adding a fifth gesture to a surface that already carries snap-scroll, album drag, double-tap seek, long-press and now pinch. Mute/unmute (which DOES work everywhere, via the `muted` attribute) is already on the rail and in the options sheet. |

---

## 9. Delivery plan

- **Tranche 1 (shipped).** Capability detection, the governor, Pulse Buffer
  planner, the four-level quality preference, and the wiring that lets the
  policy drive hls.js buffers instead of hardcoded constants.
- **Tranche 2 (partly shipped).** Playback speed (0.5×–2×, remembered) and
  Picture-in-Picture are in, both in the reel options sheet.
  - 🔴 The rate is re-applied on every source attach, not set once:
    `playbackRate` is a property of the ELEMENT and resets to 1 on every new
    source — which here means every card mount, album slide and HLS→MP4
    fallback. Set once, the choice evaporates on the next reel.
  - `preservesPitch` is set explicitly (plus the Safari spelling) because
    engines disagree on the default, and the gap between a normal voice at 1.5×
    and a chipmunk is not something to leave to chance.
  - PiP asks the ELEMENT, not the browser: `document.pictureInPictureEnabled`
    says the document may, while a given `<video>` can still refuse
    (`disablePictureInPicture`, no video track yet). iPhone Safari has no
    standard API at all — `webkitSupportsPresentationMode` is the only honest
    answer and it is false until metadata loads.
  - **Still open in this tranche:** pinch-to-zoom, volume gestures, frame
    preview on scrub. Pinch in particular has to coexist with four existing
    gestures on the same surface (vertical snap-scroll, horizontal album drag,
    double-tap seek, long-press) and is deferred rather than bolted on.
- **Tranche 3.** Living Playback™ — fade-in, pause glass ripple, resume, the
  completion transition — plus captions and subtitle customisation.
- **Tranche 4.** Offline cache and resume, and the full error-recovery ladder
  (§5), including headphone-disconnect and call-interruption recovery.
