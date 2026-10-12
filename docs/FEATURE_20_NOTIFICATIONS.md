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


---

# Parts 3 and 4 — Universal Inbox, Interactive Notifications (owner briefs 2026-10-12)

## Design, mapped onto what exists

| Brief | Here | Why this shape |
|---|---|---|
| Unread / Read / Pinned / Archived / Dismissed / Scheduled / Muted | All, Unread, Pinned, Archived (Parts 1–2), delete with Undo, Held, category switches | already one inbox; no second store |
| Hidden / Recovered | Archive *is* hide-and-recover: out of the inbox, still searchable, one tap back | one concept is easier to understand than two |
| Bookmarks | Pin | a second "save" that behaves like pin would be the same list twice |
| Notification Search / AI Search Assistant | `lib/notifications/search.ts`: "messages from chris", "security last week", "unread downloads", "payments this month", own labels by name. The reading shows as chips. Instant over the loaded list; **Search all history** runs the same parse on the server, archive included | a rule parser is explainable by construction; nothing is guessed in secret |
| Advanced filters | the parser's vocabulary + tabs + the label row | filters are words, not a form |
| Smart / Custom categories, Labels | the registry's categories (automatic) + **private labels** (0234): up to five per notification, filter row, searchable | custom categories and labels are the same thing to a member |
| Multi-select | Select: Read, Unread, Pin, Archive / Restore, Label, Delete | the only bulk actions with a real endpoint |
| Undo | Archive → Undo (unarchive). Delete → the card leaves at once and the DELETE waits six seconds; Undo cancels it; leaving the page sends it (keepalive) | a delete the member meant is never lost, one they didn't is never final |
| Timeline / Cards / Compact | three layouts, remembered on the device; the timeline groups by day | a calendar view is planned |
| Universal history | each card's **Details & why**: received, pushed / held / kept in-app (and why), read at (0234 trigger), pinned at, archived at | from the row itself, no event log to keep in step |
| Smart Cleanup | two plain suggestions (read and over 30 days, passive and over 7 days), shown at 10 or more, each **archives** (never deletes), pinned untouched | "AI suggests" would overclaim two rules |
| Export | `/api/notifications/export` now carries labels, pinned, archived, delivery and read time | portable history |
| Sync engine | every state lives on the row, so every device reads the same thing | nothing to sync separately |
| Smart Action Engine | `lib/notifications/actions.ts`: Reply (chats, not secret chats), Accept / Decline / View profile, Follow back, Block / Ignore | every action is an endpoint that already exists |
| Inline replies | Reply on the card → `POST /api/messages` with an idempotency key | a retry never sends twice |
| Rich identity (owner, same day) | `lib/push/identity.ts`: name as the title, photo as the icon, the action as the text — chats, post engagement, wallpapers, follows, friend requests, shares, story replies, new subscribers. System notifications wear the Frenz logo in the card, the bell and the toast | iOS web push always shows the app icon (a platform rule); Android and desktop show the photo |
| Social pushes and the Attention Engine | likes, comments, follows, saves, reposts used to go straight to the device past DND, focus modes, quiet hours and the category switches; they now go through `sendSmartPush` | the owner's rule is that DND is absolute |

## Honestly planned (Parts 3–4)

- **Live Activities, Dynamic Island, lock-screen widgets, rich media pushes, watch and voice actions, secure Face ID actions** — native-only; Frenz is a PWA plus a TWA.
- **Push-button inline reply** (typing a reply on the lock screen) — Web Push text actions aren't reliable across browsers; the in-app Reply is real.
- **Animated avatars and 3-second profile videos in a push** — no push platform shows video in the icon.
- **Universal Preview** (a mini story or listing without opening) — planned.
- **Multi-step notification workflows** (approve → sign → complete) — there's no contract or approval product yet.
- **Calendar view, AI digest history (weekly or monthly overviews), search history sync** — planned; the daily digest and the held summary are the real summaries.
- **Action history as its own log** — the row's own timestamps cover read, pinned and archived; a full per-action log is planned.

## Build ledger (Parts 3–4)

| Piece | Where | State |
|---|---|---|
| Schema: labels (≤ 5), read_at | `0234_inbox_labels_history.sql` (+ trigger in `0235`, on its own: DDL after a dollar block is skipped) | built, **owner applies** |
| Search parser, labels | `lib/notifications/search.ts` | built, tested |
| Smart actions | `lib/notifications/actions.ts` | built, tested |
| Whole-history search, labels, read / unread / label actions | `lib/social/notifications.ts`, `/api/notifications` | built |
| Smart Cleanup | `/api/notifications/cleanup` | built |
| Activity Center: chips, Search all history, label row, Select + bulk bar, Undo, layouts, cleanup card | `features/notifications/notification-center.tsx` | built |
| Card: labels, Details & why (history), label editor, inline Reply, Mark unread, selectable | `features/notifications/notification-card.tsx` | built |
| Rich identity pushes; Frenz logo for system in card, bell, toast; social pushes through the Attention Engine | `lib/push/identity.ts`, `lib/push/social-push.ts`, `lib/social/follows.ts`, `lib/social/friends.ts`, `lib/wallpapers-notify.ts`, share and story routes, `features/app-shell/notification-bell.tsx`, `live-toast.tsx` | built |
| Export with history | `/api/notifications/export` | built |


---

# Premium Smart Notification System (owner brief 2026-10-12, after Part 4)

## Audit — most of it already existed after Parts 1–4

Avatars and names, grouping ("Sarah and 4 others liked your post"), Accept / Decline inline, mark read / all read, delete with Undo, realtime, Web Push with deep links, settings with quiet hours and per-category push, the 9+ badge, and **per-person "Notify me when Sarah posts"** (0129, `creator_notification_prefs`: posts / stories / reposts, opt-in, with a bell button and sheet on every profile). The work below closes the gaps the audit found.

## What changed

| Gap found | Fix |
|---|---|
| The new-post fan-out never checked who may SEE the post — a followers-only post went to any subscriber; blocks and mutes were ignored; nothing prevented a second notification for the same post | `lib/social/creator-notify-emit.ts`: published, not scheduled, not private (checked against the row); followers-only → only subscribers who follow; blocked either way or muting → never; already told → skipped. Each signal is one batched query. Reads that fail **fail closed** (nobody is told), including before 0232's `expires_at` exists |
| The fan-out ran as a bare `void` in the publish path — a serverless function can freeze the moment the response is sent, cutting it half way | `after()` in `lib/social/posts.ts` and the stories route |
| Story fan-out could notify on every one of five stories in a row | one "added to their story" per person per hour |
| Pushes said "@sarah posted" | rich identity: the person's name and photo; the text says what it was ("Shared a new reel · …", "Shared a new AI video") |
| The card read "Sarah News you follow" | "Sarah shared a new reel" from the push's own words |
| No picture of what a notification is about | the post's poster or the wallpaper's thumbnail, 48 px, lazy, fixed size (no layout shift), https only; never the full media |
| Comments showed only the post title | the comment's own words ("commented: 'This looks amazing!'"), visible comments only |
| A deleted, taken-down or now-private post linked to a dead page and could show its title | "This post is no longer available", no title, no picture, no link |
| Tabs followed internal categories | Social · Content · Messages · Earnings first (`lib/notifications/smart-category.ts`), then Downloads / Communities / Security / System, then the views |
| The whole first 80 rows loaded at once, no way to see older | a 40-row first page and **Load older** by a created_at cursor (indexed), never an offset |
| A live arrival refreshed the list under someone reading it | near the top it refreshes; further down a "New notifications" pill appears — nothing jumps |
| The badge never reacted | it pops once when the count rises (reduced motion skips it) |
| Admin saw push delivery only | the same monitor adds notifications created in 24 h, the busiest types and the Attention Engine's decisions (pushed / held / kept in-app) — counts only, computed when an admin opens the page |

## Relevance — what is deliberately NOT used

Opting in to a person is the only relevance signal for new-content notifications, plus the
privacy rules above. No interaction history, online status, reply speed or viewing behaviour
is read to decide who hears about what — the brief's own warning, kept.

## Scale

A creator's fan-out is bounded at 2,000 opted-in subscribers per post, in batches of 25,
inside `after()`. Past that it needs a queue. That is a real future need, not hidden.
Only explicit opt-ins fan out, so a popular account with no subscribers costs one indexed
lookup.

## Still open — owner's call

- Opening the **bell dropdown** marks everything read (an earlier product choice). The brief
  says not to unless chosen deliberately. Left as is; say the word and it becomes
  "open = seen, tap = read".
- **Wallpaper uploads** don't fan out to subscribers yet (uploads are operator-reviewed
  before they publish). Planned with the review step.

---

# Parts 5–6 — Control Center, delivery rules, devices (2026-10-12)

Built on what Parts 1–4 left, nothing parallel. Migration **0236** (`notification_settings.rules`,
`notification_settings.lock_screen`, `push_subscriptions.label`) must be applied by the owner;
until then every read falls back to the 0233 columns and the new controls say so in words.

| Brief ask | Where it lives |
|---|---|
| Notification Control Center | `/account/notifications`: the existing switches, then `NotificationControlCenter` and `PushDevices` below them |
| Delivery rules ("family → immediate", "likes → summary") | `lib/notifications/rules.ts`, read by the Attention Engine (`attention.ts`, reason codes `rule_*`); first match wins; never security or critical; never through DND or a focus mode |
| Contact priorities | a rule's "from": favourite friends (`friend_favorites`) or close friends (`social_circles` kind `close_friends`) — looked up only when a rule names them |
| Smart filters / "AI suggestions" | `lib/notifications/suggestions.ts`: a counting rule over the member's own week, shown with the number. Not AI, and labelled as such |
| Notification profiles | the focus modes that already exist (`/account/presence`), linked |
| Lock-screen privacy | Show all / No preview / Hide all (`lockScreenPayload`) — replaces the old single switch, same column underneath |
| Export / import / reset | client JSON file; import goes through the same validated PATCH; reset = defaults, every changed category back on, rules cleared |
| Sounds and haptics | per device, already in the inbox sound picker; a web app cannot set the OS push sound (iOS and Android both refuse) |
| Device manager | `app/api/push/devices` + `features/notifications/push-devices.tsx`: name, label, last delivery and 7-day counts from `push_delivery_log`; rename, test one device, remove |
| Multi-device sync | one `sync` broadcast on the existing `notifications:<uid>` channel after a read/archive/clear — never row UPDATE events |
| Retries, dead endpoints, duplicates | already in `lib/push/web-push.ts` (one retry, prune on 404/410, collapse by tag/topic); `sendPushToDevice` reuses the same sender |

Planned, not built: routing to the "active" device only, native APNs/FCM, watch/car surfaces,
email/SMS failover.

# Notifications Part 1 — the incoming banner (2026-10-12)

Audit: the centre, categories, grouping, thumbnails, Accept/Decline, pagination, per-person
"notify me" (the profile bell), block/mute/visibility filtering and the single event pipeline
(`sendSmartPush` → row + push) already existed from Parts 1–4. The real gap was the banner.

`features/notifications/live-toast.tsx` (same mount, upgraded, `bannerFor` in `banner.ts`):
Instagram's arrangement — round sender avatar with a Frenz badge, name on its own line, the
message under it, "now", the post thumbnail — swipe up to dismiss, bursts drawn as a stacked
edge with a count, a replayed insert never re-shows, held rows (DND, focus, quiet hours) never
banner, the open conversation never banners. Reads the newest five rows only; CSS motion only.

# Notifications Part 2 — outside the app (2026-10-12)

Audited platforms, honestly:

| Platform | What it is | Sender photo | Notes |
|---|---|---|---|
| Android | the Play Store app is a **TWA** (Chrome Web Push); no Flutter/native source in this repo | yes — the large icon | title = sender, body = action; the status-bar badge is now a white F silhouette (`public/badge-96.png`; SW v28) instead of a white square |
| iPhone / iPad | installed PWA (Web Push, iOS 16.4+) | **no** — iOS always draws the app icon | "<name> from <app>" and the photo-with-app-badge look are iOS rules; the photo needs a native app (Communication Notifications) |
| Desktop browsers | Web Push | yes (icon) | |

Changed: push icons are the sender's 192 px avatar render (`avatarSrc`), never the original
upload; message previews follow the Part 5 lock-screen setting. Not possible without a native
app: MessagingStyle conversations, Android channels, iOS communication notifications.

---

# Part 7 — Security notifications (2026-10-12)

Audit first: most of the brief's "Security Notification Center" already existed on
`/account/security` — security score with recommendations, two-factor, recovery codes,
passkeys, a security PIN, step-up re-authentication for sensitive actions, active sessions,
the Connected Devices hub with trust levels, the append-only `security_audit_log` (0053) and
eight `security_*` notification types (critical: they reach the member through Do Not Disturb).

Built on it:

| Brief ask | Where |
|---|---|
| Suspicious Activity Engine | `lib/security/suspicious.ts` (rules) + `suspicious-run.ts`, run after every sign-in / failed check from `writeAuditLog`: new country (30 d), two countries in 6 h, 5+ failed checks in an hour, PIN lockout. Each alert names the rule and the facts. Not AI. |
| Approximate region | the edge's own country header saved with each audit event — no IP lookup, raw IPs never stored |
| Notification Authenticity | a reference `FZ-XXXXXXXX` on every security notification (stored + in the push); **Verify an alert** on `/account/security` |
| Security Timeline | the existing activity list: device, country, warning marks, search, full history paging |
| Phishing Protection | `lib/security/link-warning.ts` — links that imitate Frenz, use look-alike characters, are bare IPs or hide their address are flagged in messages and captions |

Planned, honestly not built: credential-stuffing / bot detection beyond the existing rate
limits (needs auth-provider logs Frenz does not receive), impossible travel at city level
(needs IP geolocation), cryptographic signatures a member could check offline, family /
organisation / guardian roles and their audit consoles (those account types do not exist),
breach monitoring, OS-level emergency alerts (web push cannot override silent mode at all).

# Part 8 — Social notifications (2026-10-12)

Audit: Relationship Intelligence as words (`lib/social/intelligence/stage.ts`), the Relationship
Timeline / Friendship Health / Insights (`lib/social/friendship/story.ts`), Shared Memories
(`lib/social/memories`), relationship milestones derived from real timestamps
(`lib/social/graph/milestones.ts`), favourites and close friends, the "start chatting"
reconnect reminders, streak / rank / plan celebrations, the per-person new-post bell, the
daily digest (Social Recaps) and Suggested rules (Part 5, the digital-wellbeing nudge) all
existed. Built:

- **Friendship anniversaries** (`lib/social/anniversaries.ts`) — "You became friends N years
  ago today 🎉" to both friends, on the existing daily job; low priority, bounded, de-duplicated.
- **Close to you** — an Activity Center view of favourite friends and close friends only.

Planned, honestly: birthdays (no birthday is stored — an optional, privacy-controlled field is
the owner's decision first), animated avatars / 3-second profile videos on notification cards,
AI "engagement insights" and "strongest friendships" summaries (the brief itself warns against
engagement-maximising; the existing Friendship Insights are the private, explainable form),
live-stream and Time Capsule / Life Journey alerts (those products do not exist yet).
