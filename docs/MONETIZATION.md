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

## 4. Seeding ads

```sql
-- A network script ad (Adsterra / PropellerAds) on the result page:
insert into public.ads (zone, network, format, script_code, priority, active)
values ('download_result_page', 'adsterra', 'display',
        '<script ...your embed...></script>', 10, true);

-- A house/native ad (declarative card):
insert into public.ads (zone, network, format, image_url, target_url, headline, active)
values ('sidebar', 'house', 'native',
        'https://.../banner.jpg', 'https://partner.example/offer', 'Try Partner Pro', true);
```

Zones: `homepage_top`, `download_result_page`, `sidebar`, `exit_intent_popup`,
`mobile_bottom_banner`. Drop `<AdSlot zone="..." />` anywhere to render one.

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
