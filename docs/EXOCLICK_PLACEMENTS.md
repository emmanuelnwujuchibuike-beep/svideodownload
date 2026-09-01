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

## If nothing serves anywhere

Check the account before the code. On 2026-09-01 every **type-38** zone answered
null for hours while the type-37 outstream and the type-17 sticky served in the
same minutes, with a provably correct request. That is a zone status / approval /
attached-formats question in the ExoClick dashboard, and no change on this side
fixes it.

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
