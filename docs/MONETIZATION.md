# SVideoDownload — Monetization (Phase 4)

A unified, modular revenue layer. Every subsystem is **dormant until configured**
and **RLS-enforced**. This guide covers setup, seeding, and operations.

## Architecture

```
URL input → metadata → result card
                          │
                          ▼
          /api/monetization/strategy  ──►  selectRevenueStrategy(ctx)
                          │
        ┌─────────────┬───┴────────┬───────────────┬───────────────┐
        ▼             ▼            ▼               ▼               ▼
    no ads        affiliate       ad fill     premium prompt    API upsell
   (premium)        CTA        (AdSlot)        (/pricing)     (/pricing#business)
```

- **Decision engine** — `lib/monetization/decision-engine.ts` (`selectRevenueStrategy`)
- **Context** — `lib/monetization/context.ts` (device / country / value heuristic)
- **Ads** — `lib/monetization/ads.ts` + `<AdSlot>` + `/api/ads`, `/api/track`
- **Affiliates** — `lib/monetization/affiliates.ts` + `/api/go/[id]` (tracked redirect)
- **Plans** — `lib/monetization/plan.ts` (`PLAN_LIMITS`, `getUserPlan`)
- **Billing (Paystack)** — `lib/paystack/*`, `/api/checkout`, `/api/paystack/webhook`, `/api/billing/portal`
- **Analytics** — `lib/analytics/events.ts` (`trackEvent`) → `events` + counters

## 1. Database

Run the migration in Supabase → SQL Editor:

```
supabase/migrations/0004_monetization.sql
```

Creates: `events`, `ads`, `ad_impressions`, `ad_clicks`, `affiliate_offers`,
`affiliate_clicks`, `subscriptions`, `api_keys`, `api_usage`, plus `user_plan()`.
All RLS-enabled; tracking/billing inserts go through the service role.

## 2. Environment variables (Vercel)

| Variable | Purpose |
|---|---|
| `PAYSTACK_SECRET_KEY` | Paystack API key (`sk_live_…` / `sk_test_…`) |
| `PAYSTACK_PLAN_PRO` | Plan code for Pro (`PLN_…`) |
| `PAYSTACK_PLAN_BUSINESS` | Plan code for Business (`PLN_…`) |
| `PRICE_DISPLAY_PRO` | *(optional)* price shown on /pricing, e.g. `₦2,500` |
| `PRICE_DISPLAY_BUSINESS` | *(optional)* price shown on /pricing, e.g. `₦5,000` |
| `MONETIZATION_AFFILIATE_RATE` | 0–1, how often to prefer an affiliate offer (default 0.4) |
| `MONETIZATION_VALUE_THRESHOLD` | 0–1, min traffic value to fill premium ads (default 0.55) |
| `RATE_LIMIT_TRACK_PER_MIN` | impression/click beacon cap per IP (default 120) |

Already required by the app: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## 3. Paystack setup

1. In the Paystack dashboard → **Plans**, create two recurring plans (set the
   amount/currency, e.g. ₦ or USD, monthly): "Pro" and "Business". Copy each
   **Plan code** (`PLN_…`) into `PAYSTACK_PLAN_PRO` / `PAYSTACK_PLAN_BUSINESS`.
2. **Settings → API Keys & Webhooks**: copy the **Secret key** into
   `PAYSTACK_SECRET_KEY`, and set the **Webhook URL** to
   `https://<your-domain>/api/paystack/webhook`. (Paystack signs every webhook
   with HMAC-SHA512 of the body using your secret key — we verify it.)
3. (Optional) Set `PRICE_DISPLAY_PRO` / `PRICE_DISPLAY_BUSINESS` to show the real
   ₦ amounts on the pricing page.

Checkout redirects to Paystack's hosted page; on success the webhook activates
the plan. "Manage billing" opens Paystack's subscription manage link
(update card / cancel). Test with `sk_test_…` keys first.

## 4. Ads — Adsterra & PropellerAds

You don't touch code: paste each network's ad tag into a row in the `ads` table
and it renders. Two things decide how it's rendered: **format** and **zone**.

**Formats**
| format | use for | how it renders |
|---|---|---|
| `display` | banners (300×250, 728×90, 320×50, 160×600) | isolated `<iframe>` — works even with `document.write` codes. Set `width`/`height`. |
| `pop` | Pop-under, Social Bar, OnClick, Multitag, In-Page Push, Interstitial | script injected into the page (needs top-window). Put these in zone `global`. |
| `native` | your own house promo (image + link) | declarative card; clicks tracked. |

**Zones**
`global` (page-level pop/social-bar — loads on every page), `homepage_top`,
`download_result_page`, `sidebar`, `mobile_bottom_banner`, `exit_intent_popup`.
The result page already renders an ad via the decision engine; drop
`<AdSlot zone="…" />` anywhere to add more.

### Adsterra (adsterra.com)
1. Sign up → **Websites → Add website** (`svideodownload.com`) → wait for approval.
2. **Add new ad unit**, copy the code, and insert:

```sql
-- Social Bar (high RPM, page-level) → zone 'global', format 'pop'
insert into public.ads (zone, network, format, script_code, priority)
values ('global', 'adsterra', 'pop',
        '<script src="//pl########.profitabledisplaynetwork.com/##/##/##/######.js"></script>', 10);

-- Pop-under (page-level) → zone 'global', format 'pop'
insert into public.ads (zone, network, format, script_code, priority)
values ('global', 'adsterra', 'pop',
        '<script type="text/javascript" src="//pl########.profitabledisplaynetwork.com/##.js"></script>', 20);

-- 300x250 Banner on the result page → format 'display' with width/height
insert into public.ads (zone, network, format, script_code, width, height, priority)
values ('download_result_page', 'adsterra', 'display',
        $$<script type="text/javascript">atOptions={'key':'YOURKEY','format':'iframe','height':250,'width':300,'params':{}};</script>
          <script src="//www.highperformanceformat.com/YOURKEY/invoke.js"></script>$$,
        300, 250, 30);
```

### PropellerAds (propellerads.com)
1. Sign up → **Sites → Add site** → verify.
2. Create ad units, copy the tag, insert:

```sql
-- OnClick / Pop-under (page-level) → zone 'global', format 'pop'
insert into public.ads (zone, network, format, script_code, priority)
values ('global', 'propellerads', 'pop',
        '<script src="https://upgulpinon.com/1?z=######"></script>', 15);

-- Multitag (auto-optimised, page-level) → zone 'global', format 'pop'
insert into public.ads (zone, network, format, script_code, priority)
values ('global', 'propellerads', 'pop',
        '<script src="//thubanoa.com/1?z=######"></script>', 25);

-- In-Page Push (page-level) → zone 'global', format 'pop'
insert into public.ads (zone, network, format, script_code, priority)
values ('global', 'propellerads', 'pop',
        '<script src="//xyz.propellerads.tag.js"></script>', 35);
```

Notes:
- Use `$$ … $$` quoting in SQL for codes that contain single quotes.
- Premium (Pro/Business) users never see ads — `/api/ads` returns nothing for them.
- Don't stack too many `pop` units in `global` (one pop-under + one social bar is
  plenty); networks frequency-cap, and too many hurts UX and approval.
- After inserting, ads appear within ~60s (zone cache). Set `active=false` to pause.

### Non-intrusive ad experience

The UI is built to be polite and dormant-until-configured:

- **Banners are closable** — every `display`/`native` `<AdSlot>` has an **✕** so users can dismiss it (the only exception is the rewarded gate below).
- **`result_top` — the 5-second banner**: a bold, centered ad shown above a freshly-fetched result for ~5s, then it auto-dismisses (and is closable). Seed it like any banner with `zone='result_top'`.
- **`reward_video` — 30-second rewarded gate** for **high-quality video + image** downloads. Free users watch a short ad; the **✕ and the Download button only appear once it's watched**. For a *video* ad the timer accrues **only while it's playing** — pausing freezes it (no reward until ~20–30s are actually watched). Premium users skip it. **Dormant**: with no `reward_video` ad configured, HD downloads work normally.

Configure a reward **video** ad (pause-aware) like this — the mp4 URL goes in `script_code`:

```sql
insert into public.ads (zone, network, format, script_code, image_url, target_url, headline, active)
values ('reward_video', 'house', 'video',
        'https://cdn.example.com/ad-30s.mp4',   -- the video file (script_code)
        'https://cdn.example.com/ad-poster.jpg', -- poster (image_url)
        'https://advertiser.example/landing',    -- click-through (target_url)
        'Advertiser Name', true);
```

Or use a network display/script ad in the same zone (`format='display'`/`'pop'`) — it then uses a plain 30-second wall-clock timer (no pause detection).

## 5. Seeding affiliate offers

```sql
insert into public.affiliate_offers
  (name, description, url, cta, category, country_targeting, device_targeting, priority, weight, active)
values
  ('NordVPN', 'Browse privately. 70% off.', 'https://go.nordvpn.net/aff_c?...',
   'Get the deal', 'vpn', '{US,GB,CA}', '{}', 10, 3, true),
  ('Mobile Cleaner', 'Free up space fast.', 'https://partner.example/app?aff=...',
   'Install free', 'app', '{}', '{mobile}', 20, 1, true);
```

Empty `country_targeting` / `device_targeting` = match everyone. Lower `priority`
wins; `weight` controls the split within the top tier. Clicks go through
`/api/go/<offer_id>` (tracked + URL-sanitized).

## 6. Plans & entitlements

`lib/monetization/plan.ts` → `PLAN_LIMITS` is the single source of truth:

| | Free | Pro | Business |
|---|---|---|---|
| Ads | yes | no | no |
| Downloads/day | 30 | 1,000 | 10,000 |
| Batch | – | ✓ | ✓ |
| API access | – | – | ✓ |

## 7. Security

- All tables RLS-enabled; only the service role writes tracking/billing rows.
- Paystack webhook verified via HMAC-SHA512 over the **raw** body.
- Affiliate redirects only ever go to a DB-stored http(s) URL — no open redirect.
- Beacons (`/api/track`, `/api/go`) are IP rate-limited to resist click floods.

## 8. API monetization (4c)

Public REST API with hashed keys + per-plan daily quotas.

- **Keys** — `lib/api/keys.ts`: `svd_live_…`, SHA-256 hashed, shown once. Managed
  from the account page (`/api/keys`, `/api/keys/[id]`).
- **Auth + quota** — `lib/api/auth.ts` (`authenticateApi`): bearer token →
  per-key burst limit → plan daily limit (free 50 / pro 500 / business 10,000).
- **Endpoints** — `POST /api/v1/analyze`, `POST /api/v1/download`,
  `GET /api/v1/usage`. Metered into `api_usage` (request count + endpoint).
- **Docs** — `/developers`.

No new env vars; runs on the existing Supabase setup.

## 9. Admin revenue dashboard (4d)

The admin dashboard (`/admin`) now has a **Revenue & monetization** panel: estimated
MRR, active Pro/Business subscribers, ad CTR + impressions/clicks, affiliate clicks,
and API calls / active keys. Source: `lib/monetization/stats.ts`.

Tune the MRR estimate with `MONETIZATION_CURRENCY` (default `$`),
`MONETIZATION_MRR_PRO`, `MONETIZATION_MRR_BUSINESS` (numeric, for the calc only).

## 10. Browser-extension hooks (4d)

`GET /api/me` is the single sync endpoint the extension calls. It's CORS-enabled
(via middleware) and accepts **either** an API key (`Authorization: Bearer svd_live_…`)
**or** the session cookie; anonymous callers get the free-tier view.

```js
// extension background/popup
const me = await fetch("https://svideodownload.com/api/me", {
  headers: { Authorization: `Bearer ${userApiKey}` }, // optional
}).then((r) => r.json());

// → { authenticated, plan, isPremium, showAds, limits, offer }
if (me.showAds && me.offer) renderOffer(me.offer);     // offer.url is a tracked redirect
if (me.isPremium) hideAds();
```

For the extension to download, call `POST /api/v1/download` with the user's API key
and open the returned `download_url`. Use `host_permissions` for the domain so
background requests aren't CORS-blocked.

**Phase 4 complete** (4a ads/affiliates, 4b Paystack billing, 4c API, 4d dashboard
+ extension). Remaining work is configuration (keys/migrations) + provisioning a
Paystack live account.
