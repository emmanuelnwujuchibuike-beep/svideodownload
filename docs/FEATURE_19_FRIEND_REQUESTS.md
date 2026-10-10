# Feature 19 · Part 2 — Friend Requests™ & the Adaptive Trust Workflow

Built 2026-10-10. Part 1 (the social graph) already existed as Feature 18 · Part 17
(`lib/social/graph/*`, migrations 0006/0020/0021/0035/0076/0112) and was not rebuilt.

## Architecture

One request table (`friend_requests`, 0020) is the source of truth; nothing restates it.

| Layer | File | Role |
|---|---|---|
| Rules (pure) | `lib/social/friend-requests/trust.ts` | who may ask, adaptive allowance, note spam, lifecycle constants |
| Reads | `lib/social/friend-requests/server.ts` | sender facts, ignores, expiry, card context, receiver policy |
| Writes | `lib/social/friends.ts` | send / accept (as) / decline / ignore / cancel / unfriend, events |
| API | `app/api/friends/[id]`, `app/api/privacy`, `app/api/block/[id]` | |
| UI | `features/friends/request-card.tsx`, `request-logic.ts`, `friends-hub.tsx`, `features/social/privacy-editor.tsx` | |
| Schema | `supabase/migrations/0216_friend_request_trust.sql` | ignores table, `source`, `friend_requests_policy` |

### Lifecycle

`pending → accepted | declined | cancelled | expired` (0020). **Ignore** is not a
status: it is a row in `friend_request_ignores`, readable only by the receiver,
because the sender can read their own request rows (0020 RLS) and an "ignored"
status would tell them. The sender keeps seeing "pending", which is true.
Unanswered requests expire after 30 days, lazily, when the receiver's list is
read (no cron, no idle cost). A decline blocks a repeat for 30 days. A block now
closes pending requests both ways and ends the friendship (it did not before).

### Adaptive Trust Workflow

Inputs are the sender's own behaviour only: account age, verification, friend
count, requests sent in the last hour/day/week, and how many of last week's were
declined or ignored. Tiers: new (<7 days) 10/day, standard 20, trusted (verified,
or 90+ days with 10+ friends) 40; never more than 10 an hour. With 10+ requests
in a week, ≥60 % refused halves the allowance and ≥85 % pauses sending for a day.
Refusals are explained in plain words; no score is ever shown.

### Request privacy

`privacy_settings.friend_requests_policy`: everyone (default, today's behaviour),
friends of friends, verified, nobody. Privacy page → "Friend requests".

### Note spam

Links, emails, phone numbers and "message me on WhatsApp/Telegram" are refused;
the same note (case/punctuation-insensitive) to 5+ people in a day is refused.

### Card context

Mutual friends are COUNTED, never named, and only over people whose
`show_mutual_connections` allows it (0112). Also: verified, time on Frenz, where
the request came from (`source`: profile, search, suggestion, qr, nearby, link,
messages).

### Events

`friend.requested`, `friend.added` (with the Accept-as label), `friend.closed`
(declined / ignored / cancelled), `friend.removed` — `lib/platform/domain-events.ts`.

## Gap Ledger (honest)

| Brief item | State |
|---|---|
| Send / accept / decline / cancel, note, reminders, block checks | live (0020, earlier) |
| Ignore, expiry, decline cool-down, request privacy, adaptive limits, note spam, Accept As, card context, filters, Follow instead, Block/Report from the card, events | **live (this part)** |
| QR, profile link, search, suggestions with transparent reasons, nearby | live (Feature 18 Parts 17/18) — requests from them can now carry a `source` |
| Admin spam-campaign review | planned — the data is now there (`source`, refusal ratio inputs); no admin view yet |
| Contact sync | planned — needs its own consent design; nothing uploads contacts today |
| NFC | planned (brief marks it future) |
| Community / event / business / team invitations | planned — those products do not exist yet |
| Shared communities, events, creators, languages on the card | planned — no source data; only mutual friends are real today |
| AI icebreakers | planned — only mutual friends exist as a shared fact; anything more would be invented |
| Offline request queue | planned |
