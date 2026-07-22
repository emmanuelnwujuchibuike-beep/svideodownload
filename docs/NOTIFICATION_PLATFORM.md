# Enterprise Notification Platform

One unified communication layer — relevant, timely, respectful, reliable — across
every Frenzsave surface and channel. This document is the human-readable companion
to the machine-readable registry in
[`lib/platform/notification-platform.ts`](../lib/platform/notification-platform.ts),
kept honest by
[`notification-platform.test.ts`](../lib/platform/notification-platform.test.ts).

## Position: the substrate already exists

The brief's Notification Gateway, Delivery Engine, Push/Email/Realtime/Digest/
Preference services and Notification Registry™ **already exist** — the app shipped
a mature notification system over Parts 6–9. So the deliverable here is the honest
*map* over it, plus the two levels of registry made explicit:

- **Notification Type Registry** (`lib/platform/notifications-registry.ts`) — every
  notification *type*, its category, grouping and badge rule. Already the single
  source; the union/maps derive from it.
- **Notification Platform Registry** (`lib/platform/notification-platform.ts`, this
  document) — the *platform* map: services, channels, sources, delivery,
  preferences and the AI layer.

## What runs today

| Layer | Reality | Anchor |
|---|---|---|
| Type registry | Every type, category, grouping, badge rule (derived union/maps) | `lib/platform/notifications-registry.ts` |
| Gateway | Create / hydrate / list / group, triggers realtime | `lib/social/notifications.ts` |
| Push | VAPID Web Push, dead-subscription pruning | `lib/push/web-push.ts` |
| Smart delivery | Per-event push that applies preferences + quiet hours | `lib/push/social-push.ts` |
| PWA push | Service-worker handler with action buttons + deep links | `public/sw/push.js` |
| Preferences | Master/push/in-app, per-category, quiet hours, priority, digest opt-out | `lib/social/notification-settings.ts` |
| Sound / vibration | Foreground interaction sound + haptics, per-device | `lib/social/notification-sound-prefs.ts` |
| Email | Resend alert + digest email, once-per-key dedupe | `lib/notify.ts` |
| Digest | Smart Daily Digest + the daily cron | `lib/social/digest.ts`, `app/api/cron/daily-digest` |
| Announcements | Admin broadcasts → `admin_broadcast` notifications | `lib/social/broadcasts.ts` |
| Analytics / monitoring | Delivery success/failure from `push_delivery_log` | `lib/social/push-delivery-stats.ts` |

## Notification philosophy

Relevant · timely · respectful · actionable · reliable · accessible. Two rules
make this concrete and are already enforced in code:

- **Respectful by default.** `computeShouldPush` gates every push on the
  recipient's master/push/category toggles and quiet-hours window — with a
  **security bypass** so a suspicious-login alert is never silenced. The bell's
  count excludes messages (they have their own inbox badge), and a burst collapses
  into one grouped card instead of ten.
- **Reliable, not chatty.** Web Push delivers when the site is closed; dead
  devices are pruned on send; every attempt is logged for the delivery dashboard;
  and volume is kept sane by grouping + the daily digest rather than by hammering.

## Channels

In-app, Web Push and Email are **live**. **SMS**, **native iOS/Android push
(APNs/FCM)** and **Live Activities** are `planned` — Frenz is a PWA, so today
iOS/Android devices receive Web Push through the installed app; native transports
need native apps that don't exist yet.

## Honestly planned

Named by the brief, not built — marked `planned` in the registry:

- **Channels**: SMS, native APNs/FCM, Live Activities.
- **Template Service**: content builders exist (`lib/notify.ts`), but a *versioned*
  template registry with preview + approval workflow is deferred.
- **Sources**: marketplace/orders, AI Studio completions, cloud sync, orgs — all
  concept-stage products.
- **Smart delivery**: a dedicated per-user rate-limiter (grouping + digest +
  quiet-hours reduce volume today), and true per-user local-time targeting
  (windows are UTC hours now).
- **Delivery Intelligence (AI)**: summarisation, ML priority, personalized timing,
  language adaptation, delivery optimization, content quality — none built; smart
  delivery today is rule-based, which is honest and effective.

## Governance

The registry is subject to the constitution's truth rule (`docs/CONSTITUTION.md`,
Article I.3): a `live`/`partial` row must point at a file that exists, a `planned`
row must name none, and every live source must raise under a category that really
exists in the Type Registry. The test fails the build otherwise. The operator view
is the admin **Notifications** section; live delivery health is under **Health**
(Push Delivery monitor) and announcements under **Trending** (Broadcast composer).
