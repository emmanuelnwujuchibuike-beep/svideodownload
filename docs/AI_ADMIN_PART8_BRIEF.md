# FrenzSave AI — PART 8

## Premium AI Admin Control Center, Kling Operations & Monetization

> **Why this file exists.** The owner pasted this brief into a chat session on
> 2026-10-05. A sibling session lost its Part 7 copy to a context compaction and
> the owner had to re-paste it, which cost real time. The brief is reproduced
> here verbatim so it survives, with a per-section ledger at the end recording
> what is actually done.
>
> **Status at time of writing: section 1 (audit) partially done. Nothing else
> started.** See the ledger — do not read the brief's presence here as progress.

Continuing FrenzSave AI after Parts 1–7. Part 8 is the final AI administration
and operations layer: a professional, organized, premium control center where
the administrator can manage Kling, AI feature availability, Kling pricing,
customer pricing, PAYG, AI subscriptions, usage, AI balances, provider health,
generation jobs, failures, configuration, feature limits and operational
monitoring. Powerful without becoming cluttered.

---

## 1 · FIRST — FULL ADMIN AUDIT

Before changing anything, scan the entire repository and inspect: the existing
admin dashboard; every AI-related admin page; provider settings; pricing
controls; subscription controls; PAYG controls; AI balances; usage dashboards;
provider health; job monitoring; AI feature configuration; database tables
involved; server-side authorization; admin-only API routes; existing Replicate
settings; existing fal.ai settings; Kling settings from Parts 1–7; existing
ElevenLabs settings; existing billing controls.

Read all Part 1–7 changes/commits before modifying anything. Do not duplicate
existing functionality simply because it exists in another admin page.

## 2 · CORE ADMIN OBJECTIVE

The final admin system should immediately answer:

- **Provider** — Is Kling connected? Healthy? Is the API responding? What
  capabilities are available?
- **Features** — Which AI features are enabled? Which are unavailable? Why?
- **Pricing** — What does Kling cost FrenzSave? What does the user pay? What is
  the configured rate per second/resource unit?
- **Monetization** — How much PAYG usage? How much subscription usage? How many
  credits consumed?
- **Operations** — What jobs are running? What failed? Which feature is failing?
  Is a failure systemic or isolated?

## 3 · REMOVE OLD VIDEO PROVIDER CONTROLS

The final admin UI must NOT expose active production controls for: Replicate
video, fal.ai video, Kie video, old provider fallback, old
Kling-through-Replicate configuration.

If old provider settings are no longer needed for production video: remove them
from the active UI, remove active routes, remove misleading configuration,
preserve migrations/compatibility only where technically required.

Do not leave an admin toggle that appears to allow `Replicate → Kling`. That
architecture is obsolete.

## 4 · KLING SHOULD BE THE PRIMARY VIDEO PROVIDER

The admin should clearly represent `Video AI Provider → Kling`. Do **not**
create a provider-selection dropdown (Kling / Replicate / fal.ai). Kling is not
one option among several; it is the production video provider.

## 5 · ADMIN INFORMATION ARCHITECTURE

Recommended structure:

```
AI Overview
├── Kling      → Connection · Health · Capabilities · Configuration
├── Features   → Video · Audio · Feature Availability
├── Pricing    → Kling Cost · Customer Pricing · Pricing Rules
├── Monetization → PAYG · AI Subscription · Credits
├── Usage      → Usage Overview · Feature Usage · Revenue/Cost
└── Operations → Jobs · Failures · Provider Health
```

Do not blindly follow this navigation if the current admin architecture has a
better structure. The principle is clear separation of responsibilities without
unnecessary pages.

## 6 · PREMIUM ADMIN VISUAL DESIGN

Same design language as Part 6 — light-first, premium, clean, subtle glass,
restrained gradients, professional typography, consistent cards, controlled
spacing — but more information-dense than the consumer AI Studio. Do not turn
the admin into a giant decorative glass showcase. Admin needs clarity first.

## 7 · AI OVERVIEW DASHBOARD

Concise. High-value metrics: Active AI Jobs, Completed Today, Failed Today,
Kling Status, AI Revenue, Provider Cost, AI Usage. Clear cards. Do not show 30
metrics simultaneously; prioritize what helps an administrator decide.

## 8 · KLING CONNECTION CARD

Show `Kling — Connected` or `Kling — Connection Error`. Never expose the API
key. Display: connection state, last successful verification, endpoint/auth
mode, API balance if safely available, last error, last health check. Secrets
remain masked/server-side.

## 9 · KLING API HEALTH

States: Healthy · Degraded · Unavailable · Unknown. Show last successful
request, recent failures, callback status, response latency where measured,
recent error count. **Do not continuously ping Kling from the browser.** Health
checks are controlled server-side.

## 10 · HEALTH MUST NOT BECOME FALLBACK

If Kling becomes unhealthy → show a warning. **NOT** → automatically use
Replicate. Never introduce automatic provider switching.

## 11 · FEATURE CONTROL CENTER

Each feature shows: Feature, Status, Pipeline, Supported capabilities, Pricing,
Limits. E.g. `Text-to-Video ● Enabled — Pipeline: Kling Text-to-Video`;
`Text-to-Audio ● Enabled — Pipeline: ElevenLabs`.

## 12 · FEATURE ENABLE/DISABLE

Authorized admins may disable a feature. If disabled: the frontend reflects the
unavailable state, the **backend must enforce it**, and generation must not
bypass the setting. Never rely on frontend-only disabling.

## 13 · FEATURE STATUS

Use clear states: Enabled · Disabled · Unsupported · Temporarily unavailable ·
Configuration error. Do not use ambiguous labels such as "Inactive" without
explaining why.

## 14 · KLING PIPELINE VISIBILITY

For every video feature show the actual production pipeline (Provider: Kling,
Pipeline: Text-to-Video / Image-to-Video / Lip Sync). Important for preventing
future accidental provider regression.

## 15 · INDEPENDENT PIPELINES

Text-to-Video, Image-to-Video, Reference Image, Reference Video, Full Character
and Lip Sync each keep their OWN Kling pipeline. Do not create one admin toggle
called "Kling Video Pipeline" that hides individual feature configuration.
Feature-level visibility is required.

## 16 · UNSUPPORTED FEATURES

If a feature is not currently supported by direct Kling, show `Unsupported`
with a short explanation. Do **not** offer a dropdown saying "Use Replicate
instead".

## 17 · KLING MODEL/CAPABILITY SETTINGS

Expose only settings that are meaningful, tested, safe, supported and useful
for operations — e.g. resolution, duration limits, native audio availability,
supported generation modes. Do not expose every low-level API parameter.

## 18 · DO NOT EXPOSE UNSUPPORTED SETTINGS

The admin UI must consume the backend capability definitions. If Kling does not
support a setting for a feature, do not show it. This prevents configuration
drift.

## 19 · PRICING ARCHITECTURE

Separate three concepts and never combine them into one field:

1. **Kling provider cost** — what Kling charges FrenzSave.
2. **FrenzSave internal cost** — optional internal accounting representation.
3. **FrenzSave customer price** — what the user pays/consumes.

## 20 · KLING COST MATRIX

A clear admin table: Feature · Model · Resolution · Audio · Video Input · Kling
Cost. Use the actual supported Kling dimensions from the backend
capability/cost model. Do not invent unsupported combinations.

## 21 · CUSTOMER PRICING

A separate customer pricing table: Feature · Billing Unit · Customer Rate. Use
the actual billing dimensions implemented in Parts 4–5. Do not hard-code values
in the UI.

## 22 · PER-SECOND PRICING

Allow configuring per-second pricing where the feature is billed by duration.
Do not force all features into per-second billing if Kling's actual billing
model for that feature requires another unit. Remain faithful to the real
provider billing dimension.

## 23 · PRICING PREVIEW

When an admin changes a rate, show an immediate preview
(`5 seconds × customer rate = estimated customer charge`), and show provider
cost separately so margin is understandable.

## 24 · MARGIN VISIBILITY

Where appropriate show Provider Cost, Customer Price, Gross Difference.
Admin-only; never exposed to normal users.

## 25 · PRICING SAFETY

Pricing changes must be authenticated, authorized, validated, logged and
server-side. Never allow the browser to write arbitrary pricing values.
Validate numeric ranges, decimals, currency/credit units, min/max values and
supported billing dimensions.

## 26 · PRICING VERSIONING

Preserve pricing versions / effective timestamps if the architecture supports
them. Avoid silently changing the price of an already-created job; a job
retains the authoritative quote/pricing context used when it was submitted.

## 27 · PAYG ADMIN

A dedicated PAYG section showing current pricing, balance activity, top-ups,
usage, failed transactions, active users, credits consumed. **Do not create a
second balance system** — use the existing ledger architecture.

## 28 · PAYG CREDIT CONTROLS

Allow managing supported PAYG configuration: credit conversion, feature rates,
minimum balance, minimum generation balance, top-up rules where already
supported. Do not allow arbitrary alteration of user balances outside the
existing secure ledger/audit mechanism.

## 29 · AI SUBSCRIPTION ADMIN

Use the existing subscription architecture. Show active subscriptions, status,
entitlement usage, credit usage, exhausted subscriptions, renewal information
where available. Do not create a second subscription table/system.

## 30 · SUBSCRIPTION FEATURE ACCESS

Make clear which features are available under subscription, PAYG, or both. Do
not duplicate entitlement logic — the backend remains authoritative.

## 31 · CREDIT/ENTITLEMENT USAGE

Show Subscription Credits, PAYG Credits, Free Entitlements, Consumed,
Remaining — from the authoritative ledger, never computed from frontend events.

## 32 · AI USAGE DASHBOARD

Generations today/this week/this month, seconds generated, feature usage, Kling
usage, ElevenLabs usage, subscription usage, PAYG usage. Avoid excessive
charts; only show graphs where they help decisions.

## 33 · FEATURE USAGE BREAKDOWN

A percentage breakdown per feature, from actual data. Do not hard-code
percentages.

## 34 · COST MONITORING

For Kling: provider resource usage, estimated provider cost, customer revenue,
margin. For ElevenLabs: existing provider usage/cost data where available. Do
not fabricate cost information where the provider does not expose it.

## 35 · JOB OPERATIONS

Each job shows: job ID, user, feature, provider, pipeline, status, created
time, processing time, cost, failure reason where applicable. For video jobs
the provider must show **Kling**, not Replicate.

## 36 · JOB FILTERS

Filter by feature, status, user, provider, date, failure, funding source. Do
not show every filter at once — use a clean filter sheet/popover.

## 37 · JOB DETAIL

User, Feature, Pipeline, Provider, Status, Created, Started, Completed,
Duration, Billing, Provider Task ID, Failure, Notifications. Provider task IDs
may be visible to admins; secrets never.

## 38 · FAILURE MONITORING

A failure-focused view: recent failed jobs, features with failures, Kling API
errors, callback failures, finalization failures, notification failures.
Separate provider failure from application failure (a Kling API failure is
different from a FrenzSave finalization failure).

## 39 · ERROR GROUPING

Group repeated failures. 100 jobs failing with the same Kling error is ONE
operational problem. Show Error · Occurrences · First seen · Last seen ·
Affected feature.

## 40 · PROVIDER HEALTH HISTORY

Where data is available: successful requests, failed requests, callback
failures, latency. Do not build an unnecessarily complex monitoring platform.

## 41 · NO AUTOMATIC FALLBACK CONTROL

There must be no admin switch such as "Fallback to Replicate" or "Fallback to
fal.ai". These controls must not exist.

## 42 · ELEVENLABS ADMIN

Keep existing direct ElevenLabs functionality separate. `Text-to-Audio →
Provider: ElevenLabs`, `Voice Cloning → Provider: ElevenLabs`. Do not move
these into Kling or rename them as Kling features.

## 43 · ANTHROPIC

Do not remove or alter unrelated Anthropic functionality (summarize, describe,
caption, translate, risk scoring). Part 8 is not an Anthropic migration.

## 44 · ADMIN SECURITY

All admin AI configuration endpoints must verify authenticated session, admin
authorization, CSRF/request protection where applicable, input validation and
audit logging. Do not trust frontend admin state.

## 45 · SECRET MANAGEMENT

Never display full Kling API key, ElevenLabs API key, Supabase service role,
VAPID private key or worker secrets. Use the established server-side settings
mechanism; display only masked values where necessary.

## 46 · KLING CONNECTION TEST

An admin action "Test Kling Connection" that runs server-side, authenticates
securely, performs a safe lightweight verification and returns a clear result.
Do not perform a paid generation to test connectivity.

## 47 · SAVE CONFIGURATION SAFELY

Validate first, show confirmation, save atomically, log the change, show
success/failure. Avoid silent configuration changes.

## 48 · UNSAVED CHANGES

Show "Unsaved changes" with Save / Discard. Do not silently save every
keystroke.

## 49 · ADMIN CONFIRMATIONS

Require confirmation for dangerous actions (disabling a major feature, changing
pricing, changing subscription configuration, changing limits). Do not add
confirmations to harmless actions.

## 50 · AUDIT LOG

Record who changed the setting, what changed, old value, new value, timestamp —
especially for pricing, feature availability, provider configuration and
subscription settings.

## 51 · ADMIN RESPONSIVENESS

Must work on desktop, tablet and mobile. Mobile converts tables → cards /
scrollable tables, side panels → sheets, filters → filter sheets, multi-column
cards → stacked cards. Do not force huge desktop tables onto a phone.

## 52 · ADMIN GLASS DESIGN

Part 6's design system with more restrained effects: glass navigation, glass
metric cards, solid/soft content tables. Do not put every table row inside a
separate glass card.

## 53 · ADMIN TABLES

Prioritize readability: subtle borders, row hover, clear headers, aligned
numeric values, status indicators, compact but readable spacing.

## 54 · ADMIN STATUS COLORS

Restrained semantic states: Success · Warning · Error · Neutral · Processing.
Do not rely on colour alone — include text/icons.

## 55 · EMPTY STATES

Every section has an intentional empty state ("No failed jobs", "No recent
Kling errors", "No subscription activity"). Do not leave blank white areas.

## 56 · LOADING STATES

Skeletons, progressive loading, meaningful placeholders. Avoid full-page
blocking spinners for every small request.

## 57 · NO UNNECESSARY POLLING

Do not continuously poll every admin metric. Use sensible refresh, manual
refresh, server-side aggregation, cached data, existing real-time mechanisms.
Avoid wasting Vercel/Supabase resources.

## 58 · COST/PERFORMANCE AWARENESS

The admin dashboard must not recreate the previous high resource consumption
problem. Do not repeatedly request every job, every event, every provider
metric on a tight interval. Use aggregation and pagination.

## 59 · PAGINATION

Large data sets must be paginated/cursor-based — jobs, usage, ledger,
transactions, errors, audit logs. Never load thousands of records into the
browser unnecessarily.

## 60 · ADMIN SEARCH

Provide contextual search (job ID, user, provider task ID, feature). Do not
make one giant search box responsible for every database table.

## 61 · ADMIN DASHBOARD HIERARCHY

The first screen answers: Is AI healthy? → Is Kling healthy? → Are users
generating? → Are jobs failing? → Is pricing configured? → Is monetization
working? Everything else can be deeper.

## 62 · AI OVERVIEW CARDS

Kling Status, Active Jobs, Today's Generations, Today's AI Revenue, Provider
Cost, Failure Rate. Only include metrics actually available. Do not fabricate
metrics.

## 63 · KLING FEATURE MATRIX

Feature · Provider · Pipeline · Status · Pricing · Limits, from actual backend
capability state.

## 64 · NO PROVIDER AMBIGUITY

Never display "Video Provider: Auto", "Best available" or "Fallback". It should
clearly say **Video Provider: Kling**.

## 65 · BILLING INTEGRITY

Admin pricing changes must not bypass quote generation, HMAC, balance ledger,
subscription entitlement or job accounting. Admin configuration feeds the
existing authoritative backend calculation. No frontend-only pricing.

## 66 · PROVIDER COST VS CUSTOMER PRICE

The distinction between Kling Cost and FrenzSave Customer Price must be
obvious.

## 67 · PRICING CHANGE PREVIEW

Before saving a major pricing change show Current → New, an example generation,
current cost, new cost and the difference.

## 68 · FEATURE LIMITS

Allow configuring safe limits where supported: maximum duration, file size,
references, generation length, daily limits, subscription limits. Validate
against backend capability definitions — admins must not configure values Kling
cannot support.

## 69 · ADMIN DOCUMENTATION

A concise internal documentation page explaining Kling architecture,
independent pipelines, the pricing model, PAYG, subscription, ElevenLabs
separation, provider isolation and health monitoring.

## 70 · REPOSITORY-WIDE FINAL AUDIT

Search for: Replicate, fal, `REPLICATE_`, `FAL_`, Kling, ElevenLabs, AI
pricing, AI provider, AI subscription, PAYG. Classify every active reference.
Final production architecture: **Video AI → Kling · Audio TTS → ElevenLabs ·
Voice Cloning → ElevenLabs · unrelated Anthropic features → unchanged.**

## 71 · NO LEGACY PROVIDER RESURRECTION

Do not leave admin controls that can accidentally reactivate Replicate video,
fal video, old provider routing or old Kling-through-Replicate routes. If
compatibility code must remain, make it unreachable from production
configuration.

## 72 · ADMIN API SECURITY TEST

Attempt to access admin configuration APIs as anonymous, normal user,
authenticated non-admin and admin. Only authorized admins may mutate
configuration.

## 73 · PRICING SECURITY TEST

Attempt to modify customer pricing through frontend manipulation, direct API
request, invalid numeric input, negative value, extreme value and unauthorized
request. All must be rejected appropriately.

## 74 · FEATURE DISABLE TEST

Disable a feature → backend rejects new generation → frontend shows
unavailable. Re-enable → generation becomes available again.

## 75 · KLING FAILURE TEST

Simulate a Kling failure where safely possible. Verify: job fails correctly,
user receives correct state, **no Replicate fallback, no fal fallback, no
double charge**, admin sees the failure.

## 76 · PRICING TEST

Admin changes rate → server quote changes → frontend displays new quote →
actual billing uses the new authoritative quote. Do not test pricing changes
directly against production user balances without safeguards.

## 77 · SUBSCRIPTION TEST

Subscription user → eligible feature → correct entitlement → correct usage →
correct remaining balance. Subscription exhausted → correct restriction → PAYG
if allowed → otherwise a clear upgrade/top-up state.

## 78 · PAYG TEST

PAYG balance → generation → correct deduction → ledger entry → job
association. No duplicate deduction. No client-side-only deduction.

## 79 · FINAL ADMIN EXPERIENCE

Opening AI Admin should immediately convey: AI Health → Kling Health → Feature
Status → Pricing → Usage → Revenue/Cost → Jobs → Failures, without searching
through unrelated settings.

## 80 · REQUIRED VALIDATION

Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`. Also run
admin authorization tests, pricing tests, provider isolation tests, feature
enable/disable tests, PAYG tests, subscription tests, job operation tests and
Kling health tests.

## 81 · FINAL REPORT

Provide a detailed completion report covering: **A** admin architecture; **B**
Kling (connection, health, capabilities, feature pipelines, limits); **C**
pricing (provider cost, customer price, billing dimensions, admin controls);
**D** PAYG (balance, pricing, ledger, usage); **E** subscription (integration,
entitlements, usage); **F** usage metrics; **G** jobs (monitoring, filtering,
failures, detail); **H** security (authorization and secret protection); **I**
provider isolation — explicitly confirm Video → Kling only, Replicate → no
production video execution, fal.ai → no production video execution; **J**
ElevenLabs (Text-to-Audio and Voice Cloning remain direct ElevenLabs); **K**
tests; **L** remaining risks requiring manual production verification.

## 82 · ABSOLUTE NON-NEGOTIABLES

1. Kling is the only production video provider.
2. No Replicate video controls.
3. No fal.ai video controls.
4. No Kie video controls.
5. No automatic video-provider fallback.
6. Every video feature remains independently controlled.
7. Every video feature maps to its own Kling pipeline.
8. Text-to-Audio remains direct ElevenLabs.
9. Voice Cloning remains direct ElevenLabs.
10. Anthropic-related unrelated features remain untouched.
11. Provider secrets remain server-side.
12. Admin APIs must be authorized.
13. Pricing must be server-authoritative.
14. Provider cost and customer price must remain separate.
15. PAYG uses the existing ledger.
16. Subscriptions use the existing subscription architecture.
17. No duplicate billing.
18. No frontend-only feature disabling.
19. No frontend-only pricing.
20. No unnecessary polling.
21. No loading thousands of jobs at once.
22. No excessive admin dashboard clutter.
23. No giant decorative admin UI.
24. Admin must remain responsive.
25. Configuration changes must be validated.
26. Important changes must be auditable.
27. Do not expose secrets.
28. Do not modify unrelated FrenzSave systems.
29. Preserve existing notification architecture.
30. Preserve existing worker architecture.
31. Preserve existing job architecture.
32. Preserve existing billing architecture.
33. Do not resurrect legacy providers.
34. Run all required tests.
35. Do not declare completion until the production architecture is verified.

---

# LEDGER — what is actually done

Updated 2026-10-05. **Honest state: the audit is partial; no admin UI work has
started.** Do not infer progress from this file existing.

| § | Area | State | Evidence / note |
|---|---|---|---|
| 1 | Full admin audit | 🟡 **partial** | Providers, Lip Sync, Text to Audio, the save API and the test route audited 2026-10-05 (below). Pricing/subscription/PAYG/job surfaces not yet inspected in depth. |
| 3, 41, 64, 71 | Remove Replicate/fal video controls | ✅ **done (2026-10-05)** | **Server, not just UI:** the admin save schema for `frenzAiProviders` now accepts ONLY `adminJobsAreTests` (`.strict()` refuses provider / fal scopes / per-vendor models / un-pause with a 400); Replicate and fal.ai are forced paused at normalization whatever is stored; the "Test provider" route accepts ElevenLabs only (a test there is a REAL paid run — it accepted Replicate and fal). **UI:** the 444-line switchboard (`ai-providers-settings.tsx`), the dead circuit-breaker panel and `lib/ai/providers/admin.ts` are deleted; the Lip Sync provider switch and the Text-to-Audio route switch are gone. Guards in `lib/ai/providers/providers.test.ts`, teeth proven. |
| 4, 14, 15, 63 | Kling as THE video provider; per-feature pipelines | ✅ **done** | Providers tab is read-only (`features/admin/ai-providers-overview.tsx`, a server component): Video → Kling, Audio → ElevenLabs, one row per tool with its own pipeline, derived from `KLING_RUNNABLE_FEATURES` + `AI_FEATURES`. |
| 9 | Kling API health | 🟡 **partial** | Healthy / Degraded / Unavailable / Unknown per tool from REAL jobs (`ai_jobs`, 7 days, ≤500 rows) — never green on no data, failures grouped by code (§39). The old panel read `ai_provider_runs`, which holds 8 rows (all Replicate/fal, last 2026-09-22): Kling and ElevenLabs never wrote there. Not yet: latency, callback status. |
| 8, 46 | Kling connection card / test | 🟡 **partial** | Credential presence shown (never the value). A safe, unpaid Kling connection test is NOT built yet. |
| 42 | ElevenLabs stays separate | ✅ **enforced** | Was "holds today" by configuration only: a stored `route: "replicate"` would have sent real Text-to-Audio jobs through Replicate. Now normalized to ElevenLabs always and refused by the save API. Live data checked: every recent TTA job ran `provider_plan.id = "elevenlabs"`. The ElevenLabs MODEL selector is untouched (the live row's model is the owner's call). |
| 65, 19–21 | Billing integrity — Lip Sync price source | ✅ **fixed (owner decision)** | Members were charged `models[config.provider]` = the old **Replicate** card (20¢/s) while every job ran on Kling and the Kling card (25¢/s) was shown and never read — and could not even be edited (the save schema only accepted replicate/fal cards). Asked with the numbers; the owner chose the Kling card. A 5 s lip sync goes $1.06 → $1.31. Quote now reads `models.kling` always; schema accepts only the Kling card. |
| 57, 58 | No unnecessary polling | ✅ **already satisfied** | `features/admin/live/scheduler.ts` (11 cost-safety tests). **Do not rebuild.** |
| 58 | Admin over-fetching | 🟡 **partial** | `FrenzAISection`: three loaders (provider-run ledger, breaker rows, CR audit trail) replaced by one bounded read — 12 → 10. Per-tab loading still open (tab is client state). |
| 2, 5–7, 10–13, 16–18, 22–40, 43–56, 59–62, 66–81 | Everything else | 🔴 **not started** | — |

## Audit findings so far (section 1)

**Admin AI surfaces:** `features/admin/` — `ai-providers-settings.tsx`,
`ai-plans-settings.tsx`, `ai-credits-monitor.tsx`, `ai-balance-adjust.tsx`,
`character-replace-pricing.tsx`, `character-replace-processing.tsx`,
`character-replace-jobs.tsx`, `character-replace-free-access.tsx`,
`lip-sync-settings.tsx`, `text-to-audio-settings.tsx`, `frenz-ai-health.tsx`,
plus `frenz-ai-settings-lazy.tsx` (the lazy barrel).

**Admin AI routes:** `app/api/admin/ai/{character-replace,credit,plans,providers}`.

**Replicate/fal references in admin UI:** `ai-providers-settings.tsx`,
`character-replace-jobs.tsx`, `character-replace-pricing.tsx`,
`frenz-ai-settings-lazy.tsx`, `lip-sync-settings.tsx`,
`text-to-audio-settings.tsx`.

**Where the AI section loads its data:** `app/admin/page.tsx` →
`FrenzAISection()` (~line 908).

⚠️ A sibling session is concurrently running Part 7 and has committed to
`features/ai/design/**`. Coordinate before touching shared admin/design files.
