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
- **Billing** — `lib/stripe/*`, `/api/checkout`, `/api/stripe/webhook`, `/api/billing/portal`
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
| `STRIPE_SECRET_KEY` | Stripe API key (`sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_…`) |
| `STRIPE_PRICE_PRO` | Price id for Pro ($4.99/mo) |
| `STRIPE_PRICE_BUSINESS` | Price id for Business ($9.99/mo) |
| `MONETIZATION_AFFILIATE_RATE` | 0–1, how often to prefer an affiliate offer (default 0.4) |
| `MONETIZATION_VALUE_THRESHOLD` | 0–1, min traffic value to fill premium ads (default 0.55) |
| `RATE_LIMIT_TRACK_PER_MIN` | impression/click beacon cap per IP (default 120) |

Already required by the app: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## 3. Stripe setup

1. Create two **recurring products** in Stripe → Products: Pro ($4.99/mo),
   Business ($9.99/mo). Copy each **Price ID** into the env vars above.
2. Add a webhook endpoint: `https://<your-domain>/api/stripe/webhook`, subscribing to:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
   Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. (Optional) Enable the **Billing Portal** in Stripe settings so "Manage billing" works.

Test with Stripe test keys + `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

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
- Stripe webhook verified via HMAC over the **raw** body (300s tolerance).
- Affiliate redirects only ever go to a DB-stored http(s) URL — no open redirect.
- Beacons (`/api/track`, `/api/go`) are IP rate-limited to resist click floods.

## Pending (next phases)

- **4c — API monetization**: hashed API keys, `/v1/analyze|download|usage`,
  per-key daily quota + usage metering (tables `api_keys`, `api_usage` already exist).
- **4d — Admin revenue dashboard** (impressions/clicks/affiliate/MRR), **browser
  extension hooks** (`/api/me` plan + offers sync), and production hardening.
