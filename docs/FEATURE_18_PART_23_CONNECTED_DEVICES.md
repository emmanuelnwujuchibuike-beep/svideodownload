# Feature 18 · Part 23 — Connected Devices™

Design first, per the standing instruction. This records what was already here,
what Part 23 adds, and — at length, because it is the more useful half — what
is **not** built and why.

---

## 1. The audit: most of this existed

Reading before designing turned up a working device layer that nothing was
using properly.

| Piece | Where | State |
|---|---|---|
| `trusted_devices` table | `supabase/migrations/0054_trusted_devices.sql` | Applied. `device_key`, `label`, `is_trusted`, `first_seen_at`, `last_seen_at`, `last_user_agent`, session pointer, RLS on all three verbs |
| Long-lived device identity | `lib/auth/devices.ts` → `getOrCreateDeviceKey()` | httpOnly cookie, survives sign-out/in — so trust outlives a session |
| Session ⨝ device merge | `mergeSessionsWithDevices()` | Application-level join; `auth.sessions` is only reachable through a SECURITY DEFINER function, so a SQL join is impossible |
| UA classification | `lib/auth/device-label.ts` | OS, browser, form factor |
| New-device alerting | `lib/auth/device-check.ts` | `shouldAlertForNewDevice`, 15-minute recent-login window |
| Session list UI | `features/account/active-sessions.tsx` | Sign out, sign out others, rename, trust toggle |
| Endpoints | `/api/v1/app/sessions`, `/api/v1/app/devices/[id]` | Already REST-shaped |
| Offline queue | `lib/offline/action-queue.ts`, `message-queue.ts` | Real, used by messaging |
| QR encoding | `lib/qr/encode.ts`, `svg.ts` | Real, no pairing protocol on top |
| Passkeys | `0058_webauthn_credentials.sql` | Real |

**So the gap was not devices. It was meaning.** `is_trusted` was a boolean a
person could flip that *nothing read to decide anything*. A trust flag that
changes no behaviour is decoration, and decoration on a security screen is
worse than nothing because it implies a protection that is not there.

---

## 2. What Part 23 adds

### Device Trust Engine™ — `lib/devices/trust.ts`

Six levels (`current`, `trusted`, `recognised`, `new`, `dormant`, `restricted`),
each with a label, a one-line explanation and a tone.

**Derived on every read, never stored.** A stored level goes stale the moment a
device is used again, and this project has already paid for that shape of bug in
the analytics stack. `is_trusted` stays the single persisted fact, because it is
the only one a machine cannot decide.

**Precedence is the design:**

1. The device in your hand is `current` and nothing else — flagging the screen
   someone is looking at is the fastest way to make a security page ignorable.
2. An explicit revocation outranks everything derivable. A device must not climb
   back to `recognised` just by being used.
3. Explicit trust outranks the time signals, symmetrically.
4. Only then do age and recency decide.

**Missing timestamps mean no evidence, not suspicion.** Otherwise every row
predating a column gets flagged, and the screen cries wolf.

### Capabilities — the part that makes a level real

`capabilitiesFor(level)` maps to four decisions that actually exist:
`skipNewDeviceAlert`, `changeSecuritySettings`, `longLivedSession`,
`offerRemember`. Tests enforce the two that matter: **no untrusted level may
change security settings**, and **a revoked device is never re-offered
"remember me"** — re-prompting is how a person's decision gets quietly undone.

The device card states its capability in words, so the badge is a setting rather
than a sticker.

### Observations, not accusations

`observationsFor()` returns plain sightings: "First seen in the last 24 hours",
"No activity for over a month", "The browser or system on this device has
changed". A test asserts the copy never contains *suspicious / attack /
compromised*. We cannot tell an attacker from a new laptop, and a security
screen that guesses teaches people to dismiss it.

The user-agent-change note is the closest thing to a real anomaly signal
available: the same long-lived `device_key` arriving with a materially different
UA. It is **reported and not acted on**, because a browser upgrade produces it
too — so it ships as `neutral`, not `caution`.

### Connected Devices Hub™ — `/account/devices`

Cards sorted by trust rank: yours first, concerns last. Rename, trust, sign out,
sign out all others. `mergeSessionsWithDevices` now also returns the **device's**
first/last sighting rather than only the session's — a session is created on
every sign-in, so session age would call a three-year-old laptop "new" every
time someone signed back in.

The security page keeps its compact list. One endpoint, one merge, two surfaces.

---

## 3. What is NOT built, and why

The brief is enormous and much of it describes an architecture this product does
not have. Building thin imitations would be worse than absence, so:

### Handoff™, Universal Clipboard™, Sync Engine™

**Not built.** All three need two things that do not exist: a realtime transport
between a member's own devices, and a per-product serialisation of "where you
were" for feed, stories, messaging, AI Studio and checkout. There is no realtime
channel wired for account-scoped device messaging, and no product exposes a
resumable cursor.

A version that synced only, say, scroll position would be a demo — and a
Universal Clipboard that is not end-to-end encrypted between devices is a
liability, not a feature.

### QR device pairing, device transfer, remote lock

**Not built.** `lib/qr` can draw a code; there is no pairing *protocol* behind
it — no short-lived challenge, no channel binding, no confirmation on the
existing device. A QR flow without those is an authentication bypass with a nice
animation.

"Remote lock" likewise has no agent on the other device to obey it. What *is*
real is remote **sign-out**, which ends the session server-side, and that ships.

### Battery, network type, storage, app version, crash reports, sync health

**Not built, and mostly not buildable from a web page.** There is no agent on
another device to report any of it — only a row saying a session exists.

Even for the *current* device: `navigator.getBattery()` has been removed from
Firefox and Safari, and the Network Information API is Chromium-only. Anything
shown would be blank for most visitors and wrong for the rest.

### Impossible travel, rooted/jailbroken detection, account-sharing detection

**Not built.** Impossible travel needs a per-session IP and a geolocation
provider; `trusted_devices` stores neither and none is wired. Root/jailbreak
state is not observable from a browser at all — every client-side "check" is
trivially spoofed, so shipping one is theatre that raises confidence without
raising safety.

### Smart Continuity AI™, Cross-Device Intelligence™, enterprise fleet management

**Not built.** No LLM integration exists in this codebase, and the predictions
described ("preferred device", "likely next activity") need a behavioural
history that is not collected. Enterprise fleets need an organisation model that
Part 23 does not introduce.

### Multi-device notification coordination

**Partially real, not extended.** Push exists and the service worker dedupes,
but "dismiss everywhere" needs per-device delivery receipts that are not stored.

---

## 4. Integration

- `lib/settings/registry.ts` — `devices.sessions` repointed to `/account/devices`,
  and `devices.trust` added. The Part 21 test that forbids a `live` setting
  pointing at a route nothing serves covers both.
- `lib/analytics/pages.ts` — no change needed; `/^\/account\/.+$/` already owns
  the route. (Checked rather than assumed — an unregistered route is invisible
  in analytics, which this project has been bitten by.)
- No migration. Part 23 reads columns 0054 already created and never used.
