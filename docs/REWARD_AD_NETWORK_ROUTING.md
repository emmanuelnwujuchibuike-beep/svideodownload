# Reward ad network, per feature

Owner, 2026-08-25: *"I want to be able to decide in admin dashboard which reward
ad network for a particular feature … so I can use google adsense offerwall with
GPT for multilink reward ads or offerium, and use offerium or google adsense
offerwall with GPT for event trigger for batch download, wallpaper and any other
place."*

Admin → **Ads & networks** → *Reward ad network per feature*.

## What this adds that didn't exist

The network was already a property of an **ad row** (`ads.network`) chosen per
**zone**. That answers *"what creative fills this box"* — not *"which reward
mechanism does this feature use"*, which is a different question. A rewarded GPT
slot, a full-screen interstitial and an offerwall are not three creatives in one
box; they are three flows with different consent, different grant signals and
different server verification.

So this is a per-**surface** routing table. The zone/ad-row system underneath is
untouched — it is what the `interstitial` network resolves to.

## The table

| Surface | Default | Can be routed to |
| --- | --- | --- |
| Multi-Link batch download | interstitial | GPT · interstitial · none |
| Batch download (single link) | interstitial | GPT · interstitial · none |
| After a batch finishes | interstitial | interstitial · none |
| HD / top-quality unlock | rewarded video | GPT · rewarded video · none |
| Video preview ("Review video") | rewarded video | GPT · rewarded video · none |
| Wallpaper download | interstitial | interstitial · none |
| History video watch | interstitial | interstitial · none |

Each GPT-routed surface also takes its **own ad unit path**
(`/networkCode/adUnitName`). That is per-surface deliberately: one shared unit
reports every gate as a single number, so there would be no way to tell whether
the multi-link gate or the HD gate earned the money.

### Defaults describe what the product actually does

`hd_download` and `video_preview` default to **rewarded video**, not GPT — the
real GPT flow on those two was deliberately paused (owner, 2026-08-16: *"top
quality video still doesnt click… reduced my visitor"*) because no Google Ad
Manager account exists, so the gate was requesting Google's **public test**
rewarded unit in production, which does not reliably fill.

That pause is now **an admin switch instead of a hard-coded state**. The moment a
real ad unit exists, selecting "Google rewarded ad (GPT)" on those rows turns the
already-wired flow on with no deploy — exactly the "one-line swap back" the code
comment anticipated, turned into configuration.

## Two things you asked for that this deliberately does NOT pretend to do

### 1. Offerium is listed, disabled, with the blocker named

`lib/monetization/offerium.ts` has held the admin surface, the credential
storage and the readiness checks since 2026-08-23 — and its
`verifyOfferiumPostback()` is an explicit, unimplemented seam that *throws*.
Writing it needs Offerium's publisher documentation: their SDK shape, callback
parameters, and above all the signature scheme that proves a postback is
genuine. Guessing any of those produces code that looks finished and either
silently fails or **accepts forged rewards**.

So Offerium appears in the table, greyed, with that reason printed beside it.
`resolveRewardNetwork` also falls a surface back defensively if the value is ever
stored, so a visitor is never shown a gate nothing can satisfy. Wiring it later
is: implement the seam, flip `available: true`, delete one branch in the
resolver. Nothing else changes.

### 2. Wallpaper and history-video can't take a rewarded format

Both fire **after** the thing already happened — the wallpaper ad on every 2nd
*completed* download (`use-wallpaper-interstitial.ts`), the history ad when a
clip ends *naturally* (`download-interstitial.tsx`, deliberately never
mid-watch). A rewarded ad's entire contract is "watch this and I unlock that",
and there is no "that". Same for the post-batch closing ad.

Listing GPT there would be a control that cannot do what its label says, so those
three rows offer **interstitial or none** — and "none" is still genuinely useful:
it silences one moment without touching the others, which the single global
switch could not do.

**If you want wallpaper downloads to become a real watch-first gate**, that is a
sound product change and I can build it — but it is a different feature, not a
setting: it needs its own reward-session type, which means a migration to widen
`reward_sessions.type`'s CHECK constraint beyond `hd`/`batch`/`preview`.

## How it is wired

- **Storage**: its own `settings` key (`reward_networks`), not a field on
  `MonetizationSettings`. That object is written wholesale from one large admin
  form; a field living there would be reset to its zod `.default()` every time an
  operator saved the Monetization panel, silently undoing routing configured
  elsewhere. Same reason `momentum` and `multi_link` have their own keys.
- **To the client**: through the existing `/api/ads/config`, which
  `useInterstitialConfig` already fetches once and memoises process-wide — so
  every gate reads the table at **no extra request**. Offerium readiness crosses
  as a plain boolean; its credentials are server-only env vars and never leave
  the server.
- **At the gate**: every call site asks `useRewardNetwork(surface)`, which runs
  the fallback rules in one place rather than each gate re-deriving them
  differently.

**Premium always wins.** `showAds` is checked before any routing branch — an ad
shown to someone who paid not to see ads is the worst outcome available here, and
`reward-networks.test.ts` asserts that ordering in the source.

## Verified

`tsc` + `next build` + ESLint clean on the touched code; full suite
**2306/2306**, including 24 tests over the routing table (defaults match real
behaviour, post-event surfaces refuse rewarded formats, Offerium always falls
back even when configured, every surface is wired at a real call site, premium
is checked first).

Live against a running dev server: `/api/ads/config` returns the full table and
`offeriumConfigured: false`; `POST /api/admin/reward-networks` returns 403
without an admin session.
