# ExoClick placements — the setup, and how to keep it right

Last set up: **2026-09-01**. Every ExoClick display placement on the site, which
admin field feeds it, and the one rule that breaks everything when it is broken.

---

## ⛔ THE ONE RULE

**One placement → one admin field → one zone id.**

ExoClick's loader asks for **every placeholder on a page in a single request**.
It will not serve the same zone twice in that request: the API answers
`{"zones":[null,null]}` and **all** the copies come back empty, not just the
extra one. So two slots sharing a zone id do not give you two ads — they give
you zero.

The app defends against this twice, and neither is a substitute for a second
zone:

- **At runtime** the first placeholder to mount *claims* the zone and any other
  slot with the same zone renders nothing. That saves one ad instead of losing
  both — it does not make the second slot work.
- **In admin** a yellow *"The same zone is used in more than one place"* panel
  lists every field sharing a zone. **If you can see that panel, a placement is
  switched off.** Fix it before anything else.

**An empty field is always better than a duplicated one.** Empty means that one
slot shows nothing. Duplicated means that slot shows nothing *and* takes a
working slot down with it.

---

## 🟢 THE LIVE SET-UP (2026-09-01, end of day)

**One ExoClick unit per page, every one of them a zone type observed serving.**

| page | unit | zone | type | note |
|---|---|---|---|---|
| `/`, `/downloads` | sticky banner | `6016708` | 17 | pins itself; 54% fill and 14 clicks when alone on the page |
| `/history` | outstream, above the grid | `6015606` | 37 | 16 fills + 8 clicks per 4h — but see the scroll rule below |
| any page | fullpage interstitial | `6016704` | 33 | ExoClick owns the takeover |

Everything else is deliberately **empty**: both History in-feed slots, the
landing slot, the multi-format above the grid, the interstitial fallback and the
bottom banner. None of them are broken; each was switched off because a second
unit on a page measurably costs the first one (see the section below).

### ⚠️ WHICH SLOT IS ON WHICH PAGE — check before believing "it never showed"

Beacon paths over 12h, which is the authoritative answer:

| slot | `/` | `/downloads` | `/history` |
|---|---|---|---|
| sticky | 68 | 3 | **1** |
| history (outstream) | — | — | 72 |
| landing | 23 | — | — |

**There is no sticky banner on /history.** It mounts inside the downloader and
the download box only — `features/downloader/downloader.tsx` and
`features/downloads/download-box.tsx`. "I never saw the sticky on the history
page" is not a fill problem, a cap or a bug; that placement does not exist. The
single stray beacon is a component lingering through a client-side navigation.

### ⚠️ AN OUTSTREAM IS INVISIBLE UNTIL YOU SCROLL

The unit above the History grid is a type-37 outstream, and ExoClick holds it
collapsed behind their own `._effect { max-height: 0 }` until THEIR viewability
function adds `exo_wrapper_show` — a function bound only to scroll, resize and
focus. **Landing on /history and not scrolling shows nothing, by their design.**
That is the whole of "the history page never showed" while the same slot logged
16 fills and 8 clicks in four hours.

A multi-format (type 38) zone paints on arrival and is the fix for that — but it
has to REPLACE the outstream via the admin switch, never join it.

### ⚠️ EXOCLICK CAPS PER VIEWER — "it showed once" is the cap, not a bug

Zones carry a **Capping** setting in the ExoClick dashboard (impressions per user
per period). One person reloading a page sees the ad once and then never again,
while the activity feed shows it serving steadily to everyone else. Two
consequences:

- **Your own eyes are not a measurement.** Every "it is not showing" in this
  project's history was checked against the feed and most were the ad working.
- Repeated probing from one IP burns the cap for that machine, which is why a
  blank in `exoclick-try-tag.mjs` proves nothing after the first few runs.

## The placements

Admin → **Monetization controls**. Zones as set on 2026-09-01.

| # | Admin field | Page | Where on the page | Zone | Type |
|---|---|---|---|---|---|
| 1 | Sticky banner | everywhere | pinned by ExoClick itself | `6016708` | 17 display |
| 2 | Bottom banner | everywhere | above the bottom nav | *(empty — Adsterra runs here)* | — |
| 3 | History outstream | /history | above the grid | `6015606` | 37 outstream |
| 4 | Multi-format — above the History grid | /history | above the grid | *(empty)* | 38 |
| 5 | History in-feed — after Yesterday | /history | Yesterday → the week | `6017110` | 38 |
| 6 | History in-feed — after Last week | /history | Last week → Earlier | *(empty)* | 38 |
| 7 | Landing page — under the wallpaper button | `/` | below Explore/Wallpaper, above Cloud storage | `6017148` | 38 |
| 8 | Full-page interstitial | any | ExoClick's own takeover | `6016704` | 33 fullpage |
| 9 | Interstitial fallback — multi-format | any | our overlay, when #8 does not paint | `6017150` | 38 |

**#3 and #4 are one slot with two candidates.** The switch *"Use the
multi-format tag above the History grid"* picks which one runs. Because they can
never both render, they are the only pair allowed to hold related zones — and
they still cannot hold the *same* zone as anything else.

### What is on /history at once
#3-or-#4, #5, #6, plus #1 and possibly #9. **Five potential placeholders, five
different zone ids needed.**

### What is on / at once
#1, #7, plus possibly #9. Three different zone ids.

---

## To add a zone

1. Create a **new zone** in the ExoClick dashboard — not a copy of an existing
   id. Multi-format is zone type 38, class ends `…e38`.
2. Copy the **whole snippet**, including the `<script src="…ad-provider.js">`
   line. The domain matters: ExoClick issues zones against `a.magsrv.com`,
   `a.pemsrv.com` and others, and a zone activated on one will not serve from
   another. The app reads the domain out of the snippet; if you paste only the
   `<ins>` line it falls back to `a.magsrv.com`, which may be the wrong one.
3. Paste it into **one** field. Save.
4. Check the field's own readout says `Read zone <id> · class eas…`.
5. Check **no yellow duplicate panel** appeared.

## To check whether it is working

Do **not** judge it by loading the page yourself. A zone that has just been
asked for repeatedly from one IP gets frequency-capped, so a blank tells you
nothing, and every reload spends a real impression.

Use **admin → live activity** instead. Every placement reports on its own:

| Row | Meaning |
|---|---|
| `<slot> · Impression` | a creative actually painted |
| `<slot> · No fill` | we asked and nothing came back — **or** the slot was standing down because its zone was already claimed elsewhere |
| `<slot> · Click` | someone clicked it |
| *(no rows at all)* | the slot never mounted — a **code or placement** problem, not the network |

That last row is the one worth knowing. On 2026-09-01 the landing slot had
**zero** rows for two and a half hours while every other slot reported normally.
It was not a fill problem: the unit had been placed 7,698px down an 11,315px
page and no reader ever reached it. It now sits at y≈700.

## 🔴 ONE BAD ZONE TAKES THE WHOLE PAGE DOWN WITH IT

This is the rule that cost the most to learn, on 2026-09-01.

Because ExoClick asks for every placeholder on a page in **one** request, a zone
that cannot serve does not just fail on its own — it appears to take the rest of
that request with it. Measured on /history:

| the outstream above the grid (`6015606`) | filled | empty | clicks | fill rate |
|---|---|---|---|---|
| before `6017110` joined the page | 15 | 20 | 8 | **43%** |
| after | 2 | 15 | 0 | **12%** |

And the two slots on that page returned the **same outcome in 10 out of 10**
same-second pairs — they filled together or they failed together, never one
without the other. Zone `6017110` filled once in six hours; the healthy
outstream beside it dropped to almost nothing.

So the symptom of a bad zone is **not** "that one slot is blank". It is **"that
whole page went quiet"**, which reads exactly like a network outage and sends you
looking in the wrong place.

**What to do:** when a page stops filling, take the newest zone OFF that page
first and see whether the others recover. A zone earns its place on a page by
filling on its own; it does not get to sit there costing the ones that work.

⚠️ The corollary: **do not add a placement to a page that is already earning.**
Add it, watch the whole page's fill rate in the activity feed for an hour, and
take it out again if the page got worse. `6017110` was added to a page filling
at 43% with regular clicks, and the page ended at 12% with none.

## If nothing serves anywhere

Check the zone before the account, and the account before the code.

⚠️ "All my multi-format zones are dead" was believed for most of 2026-09-01 and
was **wrong**. Zone `6017148` — type 38, the landing slot — filled and was
clicked within minutes of being moved somewhere readers actually reach. It was
never the zone TYPE. It was one specific zone (`6017110`) that would not serve,
plus a placement nobody could see.

A probe from this machine cannot settle it either: the same run that reported
`6017110` and `6017148` null also reported the **sticky** null, while the
activity feed showed that sticky filling and being clicked in the same minutes.
Repeated asks from one IP get frequency-capped, so a blank in a probe means
nothing. **The activity feed is the evidence. A probe is a hint.**

`scripts/exoclick-type-compare.mjs` judges zone type against fill.
`scripts/exoclick-try-tag.mjs <class> <zone>` judges a single new tag before you
wire it. `scripts/find-ad-slots.mjs <base> <path>` walks a live page and reports
every placeholder it finds and how deep it is.

---

## Where each placement lives in the code

| Placement | File |
|---|---|
| the `<ins>` unit itself, all slots | `features/monetization/exoclick-sticky.tsx` |
| landing slot | `features/downloads/download-page-core.tsx` (`multiFormatSlot`) |
| history above-grid + both in-feed | `features/history/media-gallery.tsx` |
| bottom banner | `features/monetization/top-banner-ad.tsx` |
| interstitial + its fallback | `features/monetization/exoclick-interstitial.ts` |
| which zone each slot resolves to | `app/api/ads/config/route.ts` |
| the settings themselves | `lib/monetization/settings.ts` |
| admin panel | `features/admin/monetization-settings.tsx` |

Adding a placement means adding its slot id in **four** places: the
`ExoClickInsSlot` union, the `/api/ads/config` payload, the `/api/track` slot
enum, and `SLOT_LABELS` in `lib/admin/activity-format.ts`. A slot id missing from
the track enum is a silent `400` through `sendBeacon` — the ad still shows, but it
never appears in the activity feed, so it looks dead.
