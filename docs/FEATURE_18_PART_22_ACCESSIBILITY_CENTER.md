# Feature 18 · Part 22 — Accessibility Center™

The design, and the reasoning, before the code.

---

## 0. What is already here

Accessibility in Frenz is not absent — it is **declared but unmeasured**, and
**honoured from the OS but not controllable in the app**. Those are two different
gaps and they need two different answers.

**Already real:**
- `A11Y_STANDARDS` in `lib/platform/design-system.ts` — a seven-point contract
  (contrast, focus, screen reader, keyboard, reduced motion, dynamic text, RTL)
  that every component in the registry is held to.
- `prefers-reduced-motion` is honoured in **23 files** — every animation added in
  this codebase gates on it.
- `dir="rtl"` ships for Arabic, Hebrew, Persian and Urdu (Part 21's language
  work), applied by a `<head>` script before first paint.
- `aria-label` on icon buttons, `role="status"`/`aria-live` on the download card
  and toasts, `focus-visible:ring-2` as the shared focus pattern.

**Two findings worth stating plainly:**

1. **The RTL standard is now STALE.** It reads *"deferred until an RTL locale
   ships (see gap ledger)"* — but four RTL locales shipped earlier today. A
   contract that describes the app as it was is worse than none, because it is
   consulted and believed. Fixed in this pass.

2. **`accessibility.motion` is `backend-only`** in the Part 21 settings
   registry, and the note is accurate: *"Every animation honours
   `prefers-reduced-motion` from the OS; there is no in-app override."* That is
   the actual hole. Someone whose OS setting is off — or who is on a device that
   does not expose one — has no way to ask Frenz for less motion.

So Part 22 is: **turn a declared contract into a controllable, measurable one.**

---

## 1. Architecture — CSS variables on `<html>`, applied before paint

**Decision: accessibility preferences are a small set of CSS custom properties
and data attributes on the root element. Nothing else.**

The brief asks for "instant accessibility changes, no restart required". That
requirement alone rules out most architectures:

- A React context re-render cannot change type size before first paint, so every
  page would flash default-sized text and then reflow — which is worse for the
  people this is for than not having the setting.
- A server round-trip per preference means the setting is unavailable offline,
  and the brief also asks for offline functionality.

A `<head>` script that reads `localStorage` and stamps `<html>` runs **before
anything paints**, costs no React, and works offline. It is the same pattern
`ThemeBootScript` and `LocaleBootScript` already use here, both for the same
reason — and critically it is **not** a root-layout client component, which has
silently broken App Router prefetch on this project before.

```
lib/a11y/
  preferences.ts   the model + presets (pure)
  contrast.ts      WCAG 2.2 contrast maths (pure) — the Validator's core
  apply.ts         preferences → CSS custom properties (pure, shared)
components/a11y/
  a11y-boot-script.tsx   stamps <html> before paint
```

`apply.ts` being pure and shared is what makes the boot script and the settings
UI agree by construction rather than by two people remembering the same rules.

### Why preferences are device-local first

The brief asks for cloud sync. Accessibility settings are the one category where
**device-local is the correct default**, not a compromise: someone's phone needs
large text and their desktop may not, and a blind user's screen-reader setup on
one machine should not be pushed onto a shared family tablet. Sync is offered,
never assumed. (Not built this pass — see §6.)

---

## 2. What is actually controllable

Every item in the brief's vision/hearing/motor/cognitive lists was assessed
against one question: **can the web platform deliver it, and does Frenz own the
surface?**

| Brief item | Verdict |
|---|---|
| Dynamic type, larger text | ✅ CSS `--a11y-text-scale` on `:root` |
| Bold text | ✅ `--a11y-font-weight-boost` |
| High contrast | ✅ `data-a11y-contrast="high"` token override |
| Reduce transparency | ✅ kills `backdrop-blur` and translucent surfaces |
| Reduce motion | ✅ in-app override on top of the OS signal |
| Larger touch targets | ✅ `--a11y-tap-min` raises every control's min size |
| Focus highlighting | ✅ thicker, higher-contrast `:focus-visible` ring |
| Reading guide / dyslexia | ✅ line-height + letter-spacing + max line length |
| Grayscale / colour filters | ✅ CSS `filter` on the root |
| Invert colours | ⚠️ OS-level; the app must not fight it. Deferred, documented |
| Magnification, cursor size | ❌ OS-owned. A web app cannot and should not |
| Switch Control, eye tracking | ❌ OS/AT-owned; our job is correct semantics so they work |
| Live captions, AI captions | ❌ No media pipeline for it. See §6 |
| Voice control / speech | ❌ OS-owned (VoiceOver, Voice Control). Our job is labels |

**The honest position on the ❌ rows:** a web app does not implement switch
control or eye tracking — the operating system does, and it drives our UI
through the accessibility tree. Our obligation is to expose correct roles,
names and focus order so those technologies work. Claiming to "support eye
tracking" would be a fabricated capability, which this codebase fails builds
over.

---

## 3. Accessibility Presets™

A preset is a **named bundle of the above**, not a separate mode. Low Vision =
large text + high contrast + bold + thick focus. Dyslexia Friendly = increased
line-height and letter-spacing + reduced motion + narrower measure. Minimal
Motion = motion off, transparency off.

Presets are a starting point that stays fully editable — the brief's own
requirement, and the right one: a preset that locks its settings is a mode, and
modes are what make people feel handled rather than served.

Applying a preset is a **pure function over the preference object**, so the
result is identical whether it runs in the boot script, the settings UI or a
test.

---

## 4. Accessibility Validator™

**Decision: build the maths, not the crawler.**

The genuinely valuable, genuinely correct part is `contrast.ts` — WCAG 2.2
relative luminance and contrast ratio, plus the AA/AAA thresholds including the
large-text exception. That is a specification with exact numbers; it can be
implemented correctly and tested against the published reference values, and it
is what every other check ultimately leans on.

What is **not** built: a DOM crawler that scores a live page. It would need to
resolve computed styles against layered backgrounds, gradients and images to
know what a colour is actually sitting on — and a contrast checker that guesses
the backdrop reports confident wrong numbers, which is precisely the failure the
analytics audit spent a day removing. A scoring surface built on an unreliable
measurement would be worse than no score.

The maths ships now and is exact; the crawler is a later part with a real
strategy for backdrop resolution.

---

## 5. Every new feature inherits it

Requirement 9 — "every new Frenzsave feature automatically inherits
accessibility support without requiring separate implementation".

That is achieved by the variables being **applied to `:root` and consumed by the
existing token layer**, not by each component opting in. A new component that
uses the app's normal type scale, focus ring and tap targets is accessible
because those are already wired to `--a11y-*`. Nothing to remember, nothing to
add per feature — which is the only version of this that survives contact with
a growing codebase.

---

## 6. What is NOT built, and why

| Item | Why not |
|---|---|
| Cloud sync of preferences | Needs a table + RLS; device-local is the correct default anyway (§1). One migration, deliberately deferred so this part ships without one. |
| Live/AI captions, transcripts, audio description | Frenz has no media-processing pipeline. This is a product, not a setting — it needs a transcription service, a cost model and a storage plan. |
| AI Reading Assistant | Same: needs an LLM integration that does not exist. The brief says optional; unbuilt and honest beats a stub. |
| DOM Validator + Accessibility Score | The maths ships; the crawler needs reliable backdrop resolution (§4). |
| Invert colours | The OS already does this well and an app that fights it makes things worse. |
| Emergency accessibility button | Designed: it is a preset applied from a fixed control. Not built — it needs a home in the app shell, and putting a permanent floating control on every surface has its own accessibility cost that needs a decision. |

---

## 7. What this pass delivers

| Item | Status |
|---|---|
| Preference model + 8 presets | **Built** |
| WCAG 2.2 contrast maths | **Built, tested against published values** |
| Pure `apply()` → CSS variables | **Built, tested** |
| Boot script (before paint, offline, no restart) | **Built** |
| Accessibility Center UI | **Built** |
| Stale RTL standard corrected | **Fixed** |
| `accessibility.motion` promoted from `backend-only` to `live` | **Fixed** |
