# Feature 20 — Notifications, Activity Center and Intelligent Delivery

Owner briefs, 2026-10-11: Part 1 (Universal Notification Platform, Activity
Center, Real-Time Event Engine) and Part 2 (Intelligent Delivery, Attention
Engine, Smart Delivery Windows). Instruction: **"Don't duplicate what already
exists, modify and upgrade it."** No push until Part 6.

This is the design (what each brief section maps to, and why), then the build
ledger. Companion registry: `lib/platform/notification-platform.ts`.

## 1. What already existed (audit, 2026-10-11)

| Brief asks for | Already here | File |
|---|---|---|
| One notification platform | One `notifications` table (5,145 rows), one type registry, one publish path | `lib/platform/notifications-registry.ts`, `lib/notifications/publish.ts` |
| Activity Center | `/notifications`: grouped cards, tabs per category, Unread, search, mark read, delete, clear all, export, live insert, pull to refresh | `features/notifications/notification-center.tsx` |
| Smart Grouping / Stacks | Per post, per conversation, "together" rules: "Ana, Tobi and 23 others liked…" | `listGroupedNotifications` |
| Real-time events | Supabase Realtime insert stream → live toast + list refresh | `features/notifications/notif-stream.ts` |
| Priority | Static table critical / high / medium / low by type | `lib/notifications/priority.ts` |
| Smart Delivery | Critical bypasses everything; Do Not Disturb and holding focus modes (Sleep, Meeting, Driving, Personal, Vacation — chosen or scheduled, per time zone) hold every other push; quiet hours; per-category push switches; 30/hour burst cap; hide previews | `lib/notifications/smart-delivery.ts`, `lib/social/presence/*` |
| Actionable notifications | Push buttons (accept / decline friend, mark read, mute chat) handled by the service worker; inline Accept / Decline / Follow back / Block on cards | `public/sw/push.js`, `notification-card.tsx` |
| Digest | Daily digest of real counts | `lib/social/digest.ts` |
| Preferences | Master, push, in-app, per category, quiet hours, digest, hide preview | `lib/social/notification-settings.ts`, `/account/notifications` |
| Delivery health | Every push attempt logged | `push_delivery_log` |

So Parts 1–2 are an **upgrade of this system**, not a second one.

## 2. The gaps this round closes

1. **Pinned and Archived** don't exist. Nothing can be kept or put away without deleting it.
2. **Priority view** — priority existed only inside the push path; the Activity Center couldn't show it.
3. **Delivery was a black box.** A push held by Sleep focus left no trace. The brief's "AI Explanation" ("Delivered later because Focus Mode was active") had nothing to read.
4. **Held pushes were simply dropped.** "Deliver later / After Focus Mode" did not exist: a DM during Sleep was in-app only, forever.
5. **Quiet hours were UTC hours** — 22:00–08:00 meant 23:00–09:00 in Lagos and 15:00–01:00 in California.
6. **Relationship priority** — no way to let favourites through quiet hours.
7. **Search** looked only at names and post titles, not at a notification's own text.
8. On a phone, a card's **⋯ menu was invisible** (hover-only), so mark read / delete were unreachable by touch.

## 3. Design

### 3.1 The Attention Engine — rules, explained, not a model

`lib/notifications/attention.ts` — one **pure** function:

```
decideDelivery({ priority, category, settings, hold, localHour, favorite, overCap })
  → { decision: "push" | "held" | "in_app", reasons: ReasonCode[] }
```

It is the existing `sendSmartPush` branch logic lifted out unchanged (critical
bypass, DND/focus absolute for everything else, high ignores quiet hours,
medium/low obey quiet hours and the burst cap), plus two additions:

- quiet hours read in the member's **own time zone** (`quiet_hours_tz`; null keeps the old UTC reading, so nobody's window moves until they save);
- **favourites through quiet hours** (`favorites_bypass_quiet`, default **off**). Never through DND or a focus mode — the owner's rule (2026-07-16) is that DND is absolute.

Every decision carries **reason codes** (`critical`, `focus:sleep`, `dnd`, `quiet_hours`, `favorite`, `category_off`, `push_off`, `burst_cap`, …) that `explainDelivery()` turns into the private sentence the brief asks for: *"Held because Sleep focus was on."*

**Why not "AI":** nothing in this app trains on behaviour, and the owner's truth rule forbids implying it. A rule engine whose every decision is explainable is what the brief's own principle ("Everything explainable") actually needs. The "Attention score" is the priority tier plus these rules. It is never shown publicly; only the member sees the reason, on their own card.

### 3.2 Recording the decision

The in-app row is still written **before** any suppression (the 2026-08-26 rule). It now also carries:

- `delivery` — `pushed` | `held` | `in_app` (null = written by a database trigger, which never pushes);
- `delivery_reason` — the first reason code (`focus:sleep`, `quiet_hours`, `burst_cap`, …). A column, not JSON, so a trigger-written row can be stamped with one plain update.

`publishNotification` used to insert its own row and then call `sendSmartPush(…, "already-recorded")`. It now hands its record to `sendSmartPush`, so there is **one insert path** and every pushed row carries its decision. Rows a database trigger writes first (direct messages, new subscribers and members) are passed as `{ recorded: … }`: when their push is held or kept in-app, the decision is stamped on that row, so a held DM is summarised and explained too.

### 3.3 Deliver later — the held summary (Smart Delivery Windows, Smart Summaries)

When a push is **held** by DND, a focus mode or quiet hours, its row is marked `delivery = 'held'`. Once the hold has ended, the member gets **one** push: *"While Sleep was on: 3 messages, 2 comments."* The rows are then stamped `summarized_at` so it never repeats.

- Only **high and medium** priority held rows count. A morning push about likes would be the engagement-bait the brief rules out.
- Opt-out: `held_summary_enabled` (default on), in Settings → Smart delivery.
- **Clock:** the existing hourly GitHub Actions run of `/api/cron/streak-reminders` also runs the summary, **in the same invocation**. That adds zero function invocations: the owner's hard law is that nothing may cost money while nobody is looking. One indexed read per hour when there is nothing held, bounded batches when there is.
- Reading a held notification in the app first removes it from the summary (read rows are skipped), so nobody is told about something they already saw.

### 3.4 Activity Center

| Brief view | Here |
|---|---|
| Unread / Read | existing All + Unread |
| Priority | new tab: critical + high, from the same priority table |
| Pinned | new: pinned cards sit at the top of All, plus a Pinned tab |
| Archived | new tab, fetched only when opened (archived rows leave the inbox) |
| Scheduled | "Held" tab: held for later, with the reason |
| Dismissed | existing delete |

Each card's menu (now reachable on touch): Mark read · Pin / Unpin · Archive / Unarchive · **Why this?** (the delivery reason, privately) · Delete. Search covers the notification's own title and text too.

Pin and archive are set server-side through `PATCH /api/notifications` with an explicit `action`, scoped to the signed-in member's own rows (`user_id = auth user`). The bell's unread count is unchanged.

### 3.5 Privacy, security, performance

- Reasons are stored on the member's own row and returned only to them; no other member, sitemap or analytics sees them.
- Pin and archive change only the caller's rows. No client value decides delivery.
- **Backward compatible before 0233 runs** (the owner applies migrations by hand): every new column is probed once per server instance, as `data` was in 0094. Without the columns the center behaves exactly as before.
- No new polling, no new realtime channel, no new cron. Archived is fetched on demand.

## 4. Honestly planned (named by the briefs, not built)

Each is `planned` in the registry, never implied as done:

- **Multi-device routing / active-device detection** ("using Desktop → phone stays silent"). A web push reaches every subscribed device. Choosing one needs a reliable live-session signal per device, and the owner's rule is never to gate a working push on a signal not yet seen to be true. Cross-device *read* sync already works: read state lives on the row, and every device reads the same row. What IS real per device today: the service worker skips the lock-screen notification while the app is open and visible on that same device.
- **Interruption protection** for calls, screen recording, gaming, video playback, navigation. A web page cannot observe these. Focus modes (including the Gaming and Driving modes that exist) are the honest equivalent.
- **Battery, network and location-aware delivery.** The browser does not expose these reliably, and location would be a privacy cost for little gain.
- **Learned timing** ("AI learns preferred reading times") and **ML priority**. Not without a model and consent; the rules above are explainable today.
- **Escalation to emergency contacts.** It needs a contacts-and-consent model and SMS; neither exists.
- **Smartwatch, car, glasses, Dynamic Island, Live Activities, native APNs/FCM.** They need native apps; Frenz is a PWA plus a TWA.
- **Lunch / weekend / vacation digests.** One daily digest exists; the held summary is the second real cadence.
- **Calls and video calls** as notification types — the products don't exist.

## 5. Build ledger

| Piece | Where | State |
|---|---|---|
| Design (this file) | `docs/FEATURE_20_NOTIFICATIONS.md` | done |
| Schema: pinned / archived / delivery / summarized; settings tz + two switches | `supabase/migrations/0233_activity_center_delivery.sql` | built, **owner applies** |
| Attention Engine (pure) + explanations | `lib/notifications/attention.ts` | built, tested |
| Presence hold reason | `lib/social/presence/server.ts` `presenceHold` | built |
| One record path with the decision | `lib/notifications/smart-delivery.ts`, `publish.ts` | built |
| Held summary (piggybacks the hourly streak run) | `lib/notifications/held-summary.ts`, `app/api/cron/streak-reminders` | built |
| Activity Center: Priority, Pinned, Held, Archived, Why this?, touch menu, text search | `features/notifications/*`, `lib/social/notifications.ts`, `/api/notifications` | built |
| Settings: Smart delivery (local quiet hours, summary, favourites) | `features/account/notification-settings-editor.tsx` | built |
| Upgraded "new subscriber" / "new member" push and email: the person's name as the title, their photo as the icon (iOS web push always shows the app icon — a platform rule), what happened and what it earned as the body, tap → their profile; the email shows photo, name and @handle | `lib/sub/notify.ts`, `lib/email/resend.ts` | built |
| Fixed on the way: the Daily digest switch never saved (the API schema dropped `digestEnabled`) | `app/api/notification-settings/route.ts` | fixed |
| Fixed on the way: a card's ⋯ menu was hover-only, so unreachable on phones | `features/notifications/notification-card.tsx` | fixed |
