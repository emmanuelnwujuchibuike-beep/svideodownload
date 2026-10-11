# Feature 19 — Friends, Followers, Social Graph & Connection Platform

The governing doc for Feature 19, Parts 1–4 (built 2026-10-10). Each part was
audited against the code BEFORE anything was built: most of the graph already
existed, and AGENTS.md rule 5 says not to rebuild it. What is live, what is
planned and why, is in each part's Gap Ledger — nothing below is implied done
that is not.

## The one architectural rule

There is ONE social graph, and every relationship has exactly one home:

| Edge | Table | Since |
|---|---|---|
| Follow | `follows` | 0006 |
| Friendship / friend request | `friendships`, `friend_requests` | 0020 |
| Block / mute / restrict | `blocks`, `muted_creators`, `user_restrictions` | 0006 / 0035 / 0076 |
| Favourite friend | `friend_favorites` | 0021 |
| Private label, circle, trusted contact | `relationship_labels`, `social_circles` + `circle_members`, `trusted_contacts` | 0112 |
| Ignored friend request | `friend_request_ignores` | 0216 |
| Follow request, daily follower flow | `follow_requests`, `follower_daily` | 0217 |

`lib/social/graph/edges.ts` catalogues the edges; nothing restates them. A
second store would be a second source of truth, and the first time the two
disagreed the symptom would be someone a member blocked reappearing in their feed.

Every change emits a domain event (`lib/platform/domain-events.ts`):
`follow.created`, `friend.requested`, `friend.added`, `friend.closed`,
`friend.removed`.

---

## Part 1 — Social Graph foundation & Relationship Engine

**Already built** as Feature 18 · Part 17 (`lib/social/graph/*`): the edge
catalogue, private labels (one per person — `labels.ts`), private circles,
trusted contacts, connection strength (`strength.ts` — private bands computed
only from the viewer's own data, never the other person's behaviour), a
relationship timeline derived from existing timestamps (`milestones.ts`, no
second table to drift), People You May Know with non-disclosing reasons
(`suggestions.ts`), mutual-friend counts that honour `show_mutual_connections`.

**Gap Ledger**

| Brief item | State |
|---|---|
| Graph, labels, circles, strength, timeline, suggestions, mutuals | live (Feature 18 Part 17) |
| Graph domain events | **live** (Part 2 added friend.*) |
| Several private tags per person | planned — `relationship_labels` holds one per pair; widening it changes the primary key |
| Shared communities / events / marketplace in the relationship | planned — those products do not exist yet |

---

## Part 2 — Friend Requests™ & the Adaptive Trust Workflow

| Layer | File |
|---|---|
| Rules (pure) | `lib/social/friend-requests/trust.ts` |
| Reads | `lib/social/friend-requests/server.ts` |
| Writes | `lib/social/friends.ts` |
| API | `app/api/friends/[id]`, `app/api/privacy`, `app/api/block/[id]` |
| UI | `features/friends/request-card.tsx`, `request-logic.ts`, `friends-hub.tsx`, Privacy page |
| Schema | `0216_friend_request_trust.sql` |

- **Lifecycle** `pending → accepted | declined | cancelled | expired`. **Ignore**
  is a row in `friend_request_ignores`, readable only by the receiver: the sender
  can read their own request rows, so an "ignored" status would tell them. The
  sender keeps seeing "pending", which is true. Expiry after 30 days is lazy (no
  cron). A decline blocks a repeat for 30 days. A block now closes pending
  requests both ways and ends the friendship (it did not before — found here).
- **Adaptive limits** from the sender's own behaviour only: new (<7 days) 10/day,
  standard 20, trusted (verified, or 90+ days with 10+ friends) 40; at most 10 an
  hour. With 10+ requests in a week, ≥60 % refused halves the allowance and ≥85 %
  pauses sending for a day. Refusals are plain words; no score is ever shown.
- **Who may send requests** — everyone (default), friends of friends, verified, nobody.
- **Note spam** — links, emails, phone numbers, "message me on WhatsApp" refused;
  the same note to 5+ people a day refused.
- **Card** — mutual friends (counted, never named, only over people who allow
  it), verified, time on Frenz, where it came from; Accept As (built-in labels),
  filters, Follow instead, Block and Report.

**Gap Ledger**

| Brief item | State |
|---|---|
| Everything above | **live** |
| QR, profile link, search, suggestions, nearby | live (Feature 18) — requests carry a `source` |
| Admin spam-campaign review | planned — the data exists (`source`, refusal inputs), no admin view |
| Contact sync | planned — needs its own consent design |
| NFC | planned (brief: future) |
| Community / event / team invitations | planned — those products do not exist |
| Shared interests / languages on the card, AI icebreakers | planned — only mutual friends exist as a real shared fact; anything more would be invented |

---

## Part 3 — Followers™, Following & Audiences

| Layer | File |
|---|---|
| Rules (pure) | `lib/social/follow-policy.ts` |
| Decision & requests | `lib/social/follows.ts` |
| Audience Intelligence | `lib/social/follower-insights.ts` |
| API | `app/api/follow/[id]`, `app/api/follow-requests`, `app/api/follow-requests/[id]`, `app/api/privacy` |
| UI | `features/social/follow-button.tsx` (Requested), `lib/social/follow-store.ts`, `features/friends/follow-requests.tsx`, Privacy page, Studio → Audience |
| Schema | `0217_follow_platform_and_circles.sql` |

- **Who may follow you** (`privacy_settings.follow_policy`): everyone (default,
  today's behaviour), friends of friends, verified, friends only, **only people I
  approve**, nobody. A friend may always follow except under "nobody" — a
  friendship is the stronger tie. Approval plus a followers-only profile
  (`profiles.visibility = 'followers'`, which already existed) is a private account.
- **Enforced in the database, not only the UI.** 0217 rewrites the `follows`
  insert policy: a direct client insert is admitted only when the target's
  policy is "everyone" (`follow_policy_of()`, security definer). Every other
  policy is decided by the server and written with the service role after its
  checks — a client cannot insert around an approval. PGlite-tested with a
  mutant that drops the check.
- **Follow requests** — approve, approve with a label, decline, ignore. Readable
  only by the target; the requester sees "Requested" (an ignored request still
  reads as asked, which is true). The button: Follow → Requested → tap to withdraw.
- **Anti-automation** — at most 60 follows an hour, 200 a day (50 for an account
  under a week old). Plain words when it stops someone.
- **Audience Intelligence** — `follower_daily` (gained / lost per day, kept by a
  trigger) and `follows.source` (profile, search, suggestion, feed, reels, qr,
  request, other). The Audience page shows follower flow for 7 and 30 days and
  where followers come from. Counts only, never who; a source with fewer than 5
  followers is not shown on its own (a count of 1 from "QR code" can point at a
  person). Days before 0217 ran have no row — nothing is backfilled or estimated.

**Gap Ledger**

| Brief item | State |
|---|---|
| Follow, counts, push, milestones, per-creator notification bells, follower list privacy, mute / block / restrict, suggestions, creator audience dashboard (new followers, interests ≥ cohort, trends, loyal fans) | live (earlier) |
| Follow policy, follow requests, Requested state, approve with label, anti-automation, follow sources, follower flow | **live (this part)** |
| Paid creator / business memberships | planned — a payments product (pricing, payouts, refunds, entitlements) on the payments router; not a follow-graph change |
| Follow categories | live through circles (Part 4) — a circle can hold anyone you know |
| Favourites raising feed / story / message priority | planned — the ranker reads a mutual-friend signal; adding a per-person weight needs measurement first (same reason `feed_priority` is not live in `circles.ts`) |
| Follow Quality Score, bot probability, purchased-follower detection | planned — needs labelled data to be anything but a guess; the anti-automation limits are the honest first step |
| Top countries / languages on the creator dashboard | planned — no country or language is stored per follower |
| Business follow dashboard (customers, appointments) | planned — no business CRM exists |
| "Lost followers" by name | not built, on purpose — counts only |

---

## Part 4 — Close Friends™, Inner Circle, VIP & Social Circles

| Layer | File |
|---|---|
| Palette, icons, kinds | `lib/social/graph/circles.ts` |
| Suggestions (pure) | `lib/social/graph/circle-suggestions.ts` |
| API | `app/api/graph/circles` (+ `[id]`, `[id]/members`) |
| UI | `features/friends/circles-manager.tsx`, `circle-icon.tsx` |
| Schema | `0217` (`social_circles.kind`, `icon`, palette CHECK) |

- **Special circles** — Close friends (star, royal), Inner circle (diamond,
  titanium), VIP (crown, amber): one of each per member (unique index), created
  with one tap. They are ordinary circles underneath — the same owner-only
  privacy, members and permissions — given a fixed identity so every surface
  can recognise them.
- **No emoji.** Ten geometric glyphs (circle, diamond, shield, compass, star,
  hexagon, ribbon, layers, crown, briefcase), stored as a key — never markup.
- **Premium palette** — titanium, graphite, ocean, forest, royal, crimson, pearl,
  glass, beside the original eight; still palette keys, never CSS from a request.
- **Smart Circle suggestions** — transparent rules over the member's OWN
  favourites, labels and strength bands ("Add 4 to Close friends — your
  favourites and the friends you talk to most"). Nothing reads the other
  person's behaviour; nothing is applied without a tap.
- **Multi-circle membership** and **owner-only privacy** were already true
  (0112 RLS: only the owner can read a circle or its members).

**Gap Ledger**

| Brief item | State |
|---|---|
| Unlimited private circles (capped at 50 × 500 for performance), members, colours, multi-membership, filter by circle, profile sections per circle | live (Part 17) |
| Close friends / Inner circle / VIP, icons, premium palette, suggestions | **live (this part)** |
| Close-friends-only Stories and Posts | planned — stories resolve their audience from friendship/following at read time and `posts.visibility` is a CHECK the feed index and read policy depend on; both need a migration plus a policy rewrite (see `CIRCLE_PERMISSIONS` in `circles.ts`) |
| Message / call the circle | planned — nothing keeps a group conversation in step with circle membership |
| Favourite / VIP priority in feed, stories, notifications | planned — ranker change that needs measurement first |
| Circle analytics, circle timeline, shared experiences | planned — only member counts are real today |
| Relationship Evolution (promote / archive / merge suggestions) | partly live — Close-friends suggestions; archive and merge planned |
| Inner Circle albums, shared notes, voice rooms, family calendar | planned — those products do not exist |

---

## Part 5 — Contact Sync™, Smart Discovery & the Invitation Platform

| Layer | File |
|---|---|
| Device-side parsing, normalisation, invite links (pure) | `lib/social/contacts/normalize.ts` |
| Browser hashing (Web Crypto SHA-256) | `lib/social/contacts/hash.ts` |
| Server (runs as the member) | `lib/social/contacts/server.ts` |
| API | `app/api/contacts/match`, `matches`, `privacy` |
| UI | `/friends/contacts` (`features/friends/contacts.tsx`), linked from Add friends |
| Schema | `0220` |
| Tests | `lib/social/contacts/contacts.test.ts` + the 0220 PGlite run (25 checks, run twice, 2 mutants that fail) |

**How a contact is matched, and what is never done with it**

1. Contacts are read **on the device**: the Contact Picker (Chrome on Android),
   a `.vcf` or `.csv` export (phone, Google, Apple, Outlook), or pasted
   addresses. Duplicates merge there (one person per address).
2. Each e-mail address is normalised (`trim`, lower case) and hashed with
   SHA-256 **in the browser**. Only those hashes are sent, at most 500 per
   request. The route refuses anything that is not a 64-character hex hash.
3. The database keys each hash again with a secret no client role can read
   (`contact_private_settings`) and looks it up in `contact_match_keys`, one keyed
   hash per member with a **confirmed** address, kept current by a trigger on
   `auth.users`. So a leaked key table cannot be reversed with a dictionary of
   addresses, and an unconfirmed sign-up with someone else's address never
   makes them "found".
4. A hash that matches nobody is never stored. A match is returned only if
   the member allows it (`profile_discovery.findable_by_email`: anyone, friends
   of friends, or nobody) and neither side has blocked the other.
5. Nothing is remembered unless the member switches on "Remember matches",
   and then only the pair (them, the member found), never the address.
   Remembered matches are re-checked against today's privacy settings on
   every read, and "Forget" deletes them all.
6. Enumeration is capped in the database: 500 hashes per call, 2,000 per
   member per UTC day (`contact_match_usage`), plus 10 calls a minute at the edge.

**Invitations** are links the device opens (mail, SMS, WhatsApp, Telegram, or
the native share sheet for Signal and everything else), carrying the member's
one attribution link (`/r/<token>`), so a join is credited by the existing
referral system. Frenz sends nothing to a contact and never sees their address.

**Gap Ledger**

| Brief item | State |
|---|---|
| Phone / e-mail contacts, file import (vCard, CSV: phone, SIM export, Google, Apple, Microsoft), paste | **live** |
| Privacy-first matching (hash on device, keyed server compare, discard unmatched, confirmed addresses only) | **live** |
| Sync permissions: manual sync, remember or not, delete synced data, who may find me | **live** |
| Contact Health: read / on Frenz / to invite / duplicates merged | **live** (counts from this run, on the device) |
| Invite by e-mail, SMS, WhatsApp, Telegram, Signal (share sheet), QR (`/u/<handle>/card`), profile link | **live** |
| Follows made here are attributed (follow source `contacts`, follower insights) | **live** |
| Matching on PHONE numbers | planned — Frenz has no verified phone numbers. Matching unverified ones would let anyone claim someone else's number |
| Automatic / background sync | planned — the web cannot read a phone's address book in the background. The member re-runs it |
| Who may invite me / see my contact info / see mutual contacts | partly — Frenz never stores a contact's address, so there is nothing to show. Invites are sent by the inviter's own device |
| Invitation landing with profile preview and reason | partly — `/r/<token>` already credits the referral. A richer landing page is planned |
| Contact labels (family, work…) and AI Reconnect ("you worked together") | planned — needs organisation and school data Frenz does not hold. Relationship labels (Part 1) apply once connected |
| Contact timeline (invited → joined → became friend) | planned — invites are opened on the device, so "invited" is not observable. Joins are in the referral records |
| Business / organisation / educational directories, corporate import | planned — no directory product exists |
| NFC, Nearby Share | planned (future, as the brief says) |

---

## Part 6 — People You May Know™ & the AI Relationship Engine

| Layer | File |
|---|---|
| Ranking, reasons, filters, confidence (pure) | `lib/social/graph/suggestions.ts` (the Part 17 ranker, extended, not replaced) |
| The ONE engine (gathers the evidence) | `lib/social/people/engine.ts` |
| API | `GET /api/people/suggestions?filter=`, `POST`/`DELETE /api/people/suggestions/feedback` |
| UI | `features/friends/people-you-may-know.tsx` on Add friends |
| Schema | `0221` (`people_suggestion_feedback`) |
| Tests | `lib/social/people/engine.test.ts` (the whole engine over an in-memory graph), `suggestions.test.ts`, 0221 PGlite + an RLS mutant |

**Where candidates come from:** friends of friends, people the member's follows
follow, people who follow the member, the member's remembered contact matches
(Part 5, privacy re-checked by the database), and a popular pool for a cold
start.

**What ranks them:** mutual friends (saturating), the member's own contacts,
"follows you", mutual follows, shared circles, the same public location,
interest overlap (cosine over `user_interest_profile`), verification, and a
small logarithmic popularity prior. New accounts sink. Confidence bands
(very high → experimental) are computed for ordering and tests, and are
**never** returned by an API.

**Every suggestion has a reason, and the reason never leaks:** a mutual friend
or a mutual follow is named or counted only when every person involved has a
public list. Interest overlap moves the ranking but is never the reason (it
comes from private watch history). The other reasons are things the member
already knows ("In your contacts", "Follows you") or things the profile says
about itself ("Business on Frenz").

**Removed before ranking:** you, your friends, pending requests either way,
blocks either way, people you muted or restricted, suspended, hidden, private
or being-deleted profiles, members who turned recommendations off, and anyone
you dismissed (or snoozed, until the snooze runs out).

**Feedback** (private, 0221): Not interested · I already know them (offers a
friend request) · Remind me later (7 days) · Hide · Undo · Reset. A piece of
feedback moves the viewer's cache version, so the next list is fresh.

**Measured on production, read-only (2026-10-10), uncached:** the engine
answered in 0.65–1.2 s from this machine (several round trips to Supabase).
Lists are cached per viewer for 60 s on the server and per filter in the tab,
so a repeat view or a filter switch is instant. Sub-100 ms on a COLD request
is not met and needs a precomputed candidate table (planned).

**Gap Ledger**

| Brief item | State |
|---|---|
| One engine, explainable reasons, privacy-safe mutuals, quality filtering (blocks, mutes, restrictions, suspended, hidden, opt-out) | **live** |
| Mutual friends, mutual followers, contacts, follows-you, circles, location, interests, verification | **live** |
| Internal confidence (very high → experimental), never shown | **live** |
| Filters: people you know, creators, businesses, professionals, verified, near you | **live** (from `profile_type` 0107, verification, profile location) |
| Feedback: not interested, already know, later, hide, undo, reset. Private discovery history | **live** |
| Freshness: recent follows and friendships are read live, 60 s cache, feedback busts it | **live** |
| Shared schools, companies, events, communities, learning paths, marketplace | planned — Frenz holds none of that data yet |
| Language / country / profession / education / industry filters | planned — no such profile fields. Country rides on the free-text location |
| "Recommend more / less like this" weights, learned ranking, AI Discovery Lab (opt-in models) | planned — needs feedback volume first. "Not interested" is already stored separately for it |
| Suggestions on Feed, Search, Profile, Messaging, Notifications | planned — the engine and API are ready. The home rail still uses `getSuggestedCreators` (also the engine's cold-start pool) until its latency is measured on the home render |
| Inactive / bot / compromised-account down-ranking | partly — new accounts sink and suspended ones are removed. There is no last-active signal yet |
| Sub-100 ms cold, offline cache, edge delivery | partly — cached and per-tab instant. Cold is 0.65–1.2 s (see above) |

---

## Part 7 — Friend Profiles™, Relationship Timeline & Shared Memories

| Layer | File |
|---|---|
| Timeline, anniversaries, Friendship Health, insights (pure) | `lib/social/friendship/story.ts` |
| One friendship, read for the viewer | `lib/social/friendship/server.ts` |
| API (friends only, re-checked by RLS) | `app/api/friends/[id]/goals`, `capsules`, `timeline-hidden` |
| UI | `/friends/with/[handle]` (`features/friends/friendship-page.tsx`), from "Our story" in each friend's menu |
| Schema | `0222` (`friend_goals`, `time_capsules.recipient_id`, `friendship_timeline_hidden`, `are_friends()`) |
| Tests | `lib/social/friendship/story.test.ts` + 0222 PGlite (16 checks, run twice, 2 mutants that fail) |

The page exists only for two people who are friends right now (404 for
anyone else). It is `/friends/with/<handle>`, not `/friends/<handle>`, so a
member whose handle is "discover" or "circles" still has one.

**The timeline stores nothing.** Every moment is a timestamp another table
already owns, read when the page opens: the friend request and who sent it,
friends since, follows both ways, the first message and who said hello, the
100th, 500th and 1,000th message, first likes, comments and reposts each way,
bucket-list goals ticked off, and the 1-month, 6-month and yearly
anniversaries (clamped to month ends, UTC). A friend's private SAVE of a post
is never read, and neither is a hidden comment. Verified on production
read-only against three real friendships.

**What is remembered is the member's choice:** "Edit what's remembered"
takes any kind of moment off THEIR view of one friendship (0222, owner-only).
The friendship itself and its anniversaries always stay.

**Shared between the two friends, by design:** the Bucket List (both read,
add, tick off and remove, and it closes if the friendship ends) and Time
Capsules sealed for the friend. The database refuses the recipient's read
until the capsule opens, and the app sends no message before then, not even
to its author.

**Private to the viewer:** Friendship Health (recently active, growing,
long-time, quiet lately, new: chips, never a score), insights (messages,
busiest month, longest streak, mutual friends), the Memory Vault (messages
they starred in that chat), and photos and videos shared in their chat.

**Export:** one tap downloads the timeline, insights, bucket list and
capsules as JSON. A sealed capsule leaves without its message.

**Gap Ledger**

| Brief item | State |
|---|---|
| Friend profile page, timeline, anniversaries, milestones (100/500/1,000 messages, first like, comment, repost) | **live** |
| Friendship Health, insights, mutual friends (privacy-aware), shared chat media, Memory Vault (starred messages) | **live** |
| Shared Bucket List, Time Capsules for a friend, hide moments, export | **live** (0222) |
| Quick actions: message, profile, export | **live**. Call, share story, create album or event: planned (no albums or events product) |
| Shared communities, events, marketplace, collaborations, schools, projects, AI projects, shared downloads | planned — Frenz holds none of that data as something two people share |
| Memory collections (auto albums by theme), Relationship Map, AI interest matching | planned — needs media classification. The interest profile is private watch history and is not shared between two people |
| Anniversary reminders (notifications) | planned — the dates are computed. A daily job to send them is not built yet |
| "Encrypted" vault and capsules | partly — capsules are sealed by database policy, and the platform encrypts data at rest. Not end-to-end encrypted |
| Relationship search, offline viewing | planned. The page is server-rendered in one pass |
| Instant loading | partly — a cold read took 1.8–2.4 s from this machine (about 25 small queries in two batches). The page shows a loading stripe meanwhile |

---

## Part 8 — Relationship Strength™, Social Intelligence & Connection Health

| Layer | File |
|---|---|
| Stages as words, reconnect, evolution, memory surface (pure) | `lib/social/intelligence/stage.ts` |
| The ONE intelligence read (the "Social Intelligence API") | `lib/social/intelligence/server.ts`, `GET /api/social/intelligence` |
| Archive and reconnect controls | `POST /api/social/relationship-prefs` |
| UI | `/friends/insights` (`features/friends/insights-page.tsx`), "Your connections" on Friends, Archive in each friend's menu, the stage and "You talk most" on the friendship page |
| Schema | `0223` (`relationship_prefs`, `relationship_activity()`) |
| Tests | `lib/social/intelligence/stage.test.ts` + 0223 PGlite (6 checks, run twice, 2 mutants that fail) |

**No numbers.** A relationship has a stage, a word and one sentence: New
connection, Growing, Consistent, Established, Long-term, Legacy connection,
Quiet for a while, Archived. A test fails if any stage copy contains a digit
or a percent sign. The 0–100 strength score from Part 17 stays internal.

**What it reads, and what it refuses to read.** Only what the member already
has: how long they have been friends, and the messages in chats they are half
of (counted in the database by `relationship_activity`, one query for every
chat). Never how the other person behaves toward them. The brief's
"Response Patterns" (how fast someone replies) is **refused, not deferred**:
it would turn the app into a way of monitoring a person. "Shared active hours"
is the member's own chat, shown as a time of day in their own zone ("in the
evening"), never as a chart.

**Silence is not decay:** nothing is "Quiet for a while" until half a year
without a word, and a quiet new friendship is still "New connection".

**AI Reconnect** appears only for friends you have talked to, after a few
months of silence, in words ("You haven't spoken in several months"). Every
nudge has "Not now" (30 days) and "Don't suggest". **Relationship Evolution**
suggests only what is certain: you follow each other, so make it a
friendship. Or a friend's profile is a business or creator, so label them.
**AI Memory Surface** lists this week's anniversaries and capsules opening.

**Relationship Archive:** private (the friend is not told), keeps every
memory, takes them off the Friends list, Catch up, stories and activity there,
and out of reconnect nudges. Restore anytime from Your connections.

Measured read-only on production (2026-10-10), before 0223: 3.6 s cold from
this machine, using the fallback. On production, 7 friendships were
classified (3 Consistent, 4 New connection) and one evolution was suggested.

**Gap Ledger**

| Brief item | State |
|---|---|
| Stages in words, private, no numbers; Connection Health; reconnect (dismissible); archive; evolution (follow → friend, friend → business/creator label); memory surface (anniversaries, capsules) | **live** |
| Communication insight: when you talk most | **live** (your own chat, your own time zone) |
| Response patterns | **refused** — it measures the other person |
| Shared communities, events, projects, purchases, collaborations, learning paths, AI sessions | planned — no shared data of that kind exists yet |
| Anniversary and memory reminders as notifications | planned — they are computed. A daily sender is not built |
| Intelligence feeding Feed, Search and Messaging ranking | planned — the API exists. Ranking changes need measurement first |
| Background analysis, offline | partly — counted in the database on demand. No precomputed store yet |

---

## Part 9 — Online Presence™, Focus Modes™ & Presence Automation™

| Layer | File |
|---|---|
| Focus modes, schedules, effective presence, Smart Availability (pure) | `lib/social/presence/engine.ts` |
| The ONE read for other people (privacy transform) | `getDisplayedStatuses` in `lib/social/presence-status.ts`, `GET /api/presence-status` |
| The member's own presence, saving, automations, the push question | `lib/social/presence/server.ts`, `PATCH /api/presence-status`, `/api/presence/schedules` |
| Live online set (Supabase Realtime presence) | `features/friends/use-presence.ts` |
| UI | `/account/presence` (`features/account/presence-settings.tsx`), the chat header (`presence-badge.tsx`), the inbox status picker |
| Schema | `0224` (columns on `user_presence_status`, `presence_schedules`, `presence_history` + trigger) |
| Tests | `lib/social/presence/*.test.ts` (20) + 0224 PGlite (6 checks, run twice, 2 mutants that fail) |

**The architecture: one row, derived at read time.** Presence already had a
home: `user_presence_status` (0043) for the manual status, `last_seen_visibility`
(0060) for who sees you online, and one shared Realtime channel for who is
connected. Part 9 adds to that row instead of building a second store. What is
true *now* is worked out when someone reads it: a custom status that "clears
after an hour" stores the hour and is ignored once it has passed, and an
automation ("Sleep, every night 23:00 to 07:00", in the member's own time zone)
is a stored window that applies while the clock is inside it. **No cron, no
timer, no polling**: presence costs nothing while nobody is looking.

**Two independent questions, two settings.** *Who sees that I'm online and when
I was last active* stays `last_seen_visibility` (Everyone / Friends / Nobody).
*Who sees my status, focus, auto reply and what I'm open to* is the new
`audience` (Everyone / Friends / one of my circles / Nobody). A hidden status
reads as the ordinary default, exactly like someone who never set one. Typing
and read receipts stay in Ghost Mode, linked from the page: one switch per signal.

**A privacy hole closed.** The online channel is public: everyone on it sees
every key on it. Before this part, a member whose last seen was "Friends" or
"Nobody" still joined it, so anyone saw them "Active now". Now only members
whose last seen is "Everyone" join it; the others' friends see "active recently"
from the server, which applies the setting. Their app touches "last active" at
most once every 3 minutes when it comes back to the foreground (never on a
timer). Ghost Mode and the inbox picker now update the live cache too, so going
Invisible or hiding last seen takes effect at once, not after a reload.

**Focus Modes™.** Work, Study, Meeting, Driving, Sleep, Gaming, Personal time,
Vacation. Each says what others see ("In a meeting") and whether pushes wait.
Meeting, Driving, Sleep, Personal time and Vacation hold pushes exactly like Do
Not Disturb, through the same check in `smart-delivery.ts`. In-app delivery and
security alerts are untouched. A focus runs for an hour, until morning, or until
ended, and can bring its suggested auto reply (opt-in).

**Smart Reply Status™ is not a message.** The auto reply shows in the chat header
to people allowed to see your status, and only while a focus or custom status is
on or you are Busy or Do Not Disturb. Sending real automatic messages would put
words in a member's mouth in someone else's inbox, and would notify them.

**Smart Availability™ is rules, not a model.** Late at night it offers Sleep,
and on a weekday afternoon with no working hours it offers them. It reads only the
member's own clock and settings, offers at most two things, and applies nothing
without a tap.

**Presence history** is private, kept 90 days, written by a database trigger on
real changes (status, focus, custom status). Automatic Away is left out, since it
would bury everything else. Searchable on the page.

**Gap Ledger**

| Brief item | State |
|---|---|
| Statuses: Online, Recently active, Away, Busy, Do Not Disturb, Invisible, Offline, Sleeping, Vacation, Custom | **live** (Sleeping and Vacation are focus modes, so they can hold pushes and be scheduled) |
| Independent visibility: last seen / online, status details, typing, read receipts | **live** (typing and read receipts in Ghost Mode) |
| Focus Modes with effects on notifications, visibility, presence, messages | **live** (sounds follow pushes, which wait) |
| Presence Automation (scheduled focus by day and time, own time zone) | **live** |
| Custom status with presets and clear-after | **live** |
| Smart Reply Status (auto reply) | **live**, shown in the chat, never sent as a message |
| Smart Availability suggestions | **live** (rules over the member's own clock) |
| Social availability (open to chat, collaboration, business, friend requests, mentorship) | **live** (set and shown in chat. Showing it on profiles is planned) |
| Status audience: everyone, friends, one circle, nobody | **live** |
| Presence history, searchable | **live** |
| Multi-device presence: where you're online | **live**, for the member only (phone / tablet / computer from the live channel) |
| Domain events `presence.changed`, `focus.enabled` | **live** (declared and emitted on saves from the Presence page) |
| A different status per device | planned — one status everywhere is the honest default. Per-device needs a device id on every presence write |
| Business availability (Open / Closed / Holiday) | planned — opening hours are saved without a time zone, so "open now" cannot be computed truthfully. Needs a time zone on the business profile |
| Creator availability (Live, Recording, Tour mode), live activity (streaming, audio rooms, editing together) | planned — none of those products exist yet. The focus modes and custom status cover the honest part |
| AI suggestions of In Meeting / Driving from sensors or calendar | refused for now — it would mean reading location or calendar. The rules above never leave the member's own settings |
| Vacation from a calendar | planned — no calendar connection exists |
| Sub-100 ms updates at 500M users | the live set is Supabase Realtime presence on one channel. That is right for today's scale. Sharding the channel by friend graph is the exit path, not something running now |

---

## Part 10 — Friend Lists™, Relationship Manager™ & Smart Lists™

| Layer | File |
|---|---|
| Smart lists, rules, nesting, organization suggestions, insights, search, tags, CSV (pure) | `lib/social/lists/engine.ts` |
| The one directory read + every write (bulk, list ops, import) | `lib/social/lists/server.ts` |
| API | `POST /api/graph/bulk`, `POST /api/graph/lists` (list creation stays `app/api/graph/circles`) |
| UI | `/friends/manage` (`features/friends/relationship-manager.tsx`), "Manage people" on Friends |
| Schema | `0225` (`social_circles.parent_id / archived_at / description`, `relationship_tags`, `circle_rules` + two triggers) |
| Tests | `lib/social/lists/engine.test.ts` (18) + 0225 PGlite (16 checks, run twice, 2 mutants that fail) + live probes 2026-10-11 |

**A list IS a circle.** Circles (0112, 0217) were already private lists:
owner-only RLS, many per person, colours, icons, special kinds and a real
permission. A second list table would be a second source of truth, so 0225 adds
only what circles could not hold: nesting (four levels, cycles and cross-owner
parents refused by a trigger), archiving, a description, private many-per-person
tags (the one relationship label per person stays), and rules.

**Smart lists are filters, not rows**: Friends, Followers, Following, Follow
each other, Favourites, New friends, Online now, Verified, Creators, Businesses,
Not in a list, Archived. They are answered from the graph every time, so they
can never go stale.

**One directory, every relationship.** Friends, people you follow and people who
follow you, merged into one row per person, paginated past PostgREST's silent
1,000-row ceiling, a fixed number of queries however big the network (capped at
3,000 people, friends first, and the page says so). Search and filters run in
the browser over that one read, so a keystroke costs no request.

**AI organizes, the member decides.** The organization engine is transparent
rules over the member's own lists: two lists with nearly the same people (merge:
the old list is archived, never deleted), a big list mixing in creators or
businesses (make a sub-list), a list empty for a month (archive), friends in no
list, and people waiting for a list's rules. At most five offers, each applied
only on a tap. List automation works the same way: a rule ("Is a creator", "Has
the tag Investor"…) offers people for a list. Nobody is added silently.

**Bulk management with undo, drawn on the tap.** Select people, then add to or
remove from a list, tag, favourite or unfavourite, archive or restore, export.
The screen changes on the tap (measured 3–16 ms with the server held 3 s);
the server's answer names exactly who changed, anything it refused is put back,
and Undo sends the opposite action. Only people you are connected to (and not
blocked with) can be put in a list or tagged: a private list of strangers would
be a dossier.

**Import and export.** Export the people shown as CSV or JSON (labels, tags,
lists), generated in the browser. CSV cells can never run as spreadsheet
formulas. Import pastes handles or a CSV's first column into a list. Only
connections are added, and the rest are named back.

**List permissions today:** profile sections (Part 17 of Feature 18) and now the
Part 9 status audience. Both are enforced in code on a real membership row.

**Gap Ledger**

| Brief item | State |
|---|---|
| Relationship Manager (friends, followers, following in one place) | **live** |
| Custom lists, multi-list membership | **live** (circles, up to 50 lists of 500) |
| Nested lists | **live** (four levels, enforced in the database) |
| Smart lists | **live** (12, computed) |
| AI Organization Engine (merge, sub-list, archive, unsorted, rules waiting) | **live**, offers only |
| List automation rules (creator, business, verified, favourite, new friend, tag, follow each other) | **live**, applied on a tap |
| Private relationship tags, searchable | **live** |
| List analytics (largest, where you talk most, quiet, growing) | **live**, in words |
| Advanced search and filters (name, handle, label, tag, list, smart list) | **live** |
| Bulk actions with undo | **live** |
| Export CSV and JSON, import handles | **live** |
| Social dashboard (friends, followers, following, creators, businesses, lists) | **live** |
| List permissions for stories, posts, messages, live streams | planned — the same blockers as Part 4 (`CIRCLE_PERMISSIONS`): stories and posts resolve their audience in RLS and feed indexes |
| Rules on events, organizations, location, language, reputation | planned — that data does not exist on profiles yet |
| Shared lists, Social Workspaces, enterprise admin, managed lists | planned — they would end the owner-only privacy every list has today, and there is no organisation product to own them. A design, not a toggle |
| Business CRM import | planned — CSV import of handles is the honest version |
| Drag-and-drop ordering | planned — "Inside" chooses the parent today |
| Offline editing | partly — the page works on what it loaded. Writes need a connection and put themselves back if they fail |

---

## Part 11

Skipped by the owner (2026-10-11).

---

## Part 12 — Professional Network™, Career Timeline™ & Professional Reputation™

| Layer | File |
|---|---|
| Roles and their inverses, open-to, recommendations, opportunities, Career Timeline, trust checklist, Network Assistant, relationship history (pure) | `lib/social/professional/engine.ts` |
| Reads (dashboard, public page, discovery, opportunities, export) and every write | `lib/social/professional/server.ts` |
| API | `POST /api/network` (one route, one op per write), `GET /api/network/export` |
| UI | `/network` (dashboard), `/network/discover`, `/network/opportunities`, `/u/<handle>/network` (public). Entry: Friends hub card, Account menu |
| Schema | `0226` (`profile_details.open_to / industry`, `pro_connections`, `pro_recommendations`, `skill_endorsements`, `pro_opportunities`, three in-app notification types) |
| Tests | `lib/social/professional/engine.test.ts` (12) + 0226 PGlite (19 checks, run twice, 2 mutants that fail) |

**Reused, not rebuilt.** Headline, skills, languages, country, availability and
résumé (`profile_details`, 0107). Experience, education, certifications,
awards, publications and projects (`profile_credentials`, 0107) are the source
of the **Career Timeline**, which stores nothing of its own. The **Business
Card** with its QR already lives at `/u/<handle>/card`. Private words like
"Colleague" or "Mentor" stay in `relationship_labels`.

**What is new: relationships both people confirm.** A private label is one
person's note. "Ada was my manager at Acme" says something about two people,
so it exists only when both agree: you name what they were to you and what you
were to them (22 roles, each with the inverses that make sense, a symmetry test
keeps the table honest), they confirm or say "Not right". One open request or
connection per pair (a database index), thirty new requests a day.

**Recommendations are moderated by the person they are about.** Recommendation,
testimonial, client review, business reference or mentor review: plain text,
20 to 1,500 characters, at most one link. It is shown on their page only after
they approve it, they can keep it private or delete it, and an edit goes back
for approval. Only friends or confirmed connections can write one or endorse a
skill, and only skills the person lists.

**Professional Reputation is a private checklist, never a score.** Verified
identity, a headline and skills, history, three confirmed connections, an
approved recommendation, endorsements from three people, ninety days on Frenz.
Each says how to meet it. Nobody else sees it, and nothing ranks anyone.

**The AI Network Assistant explains every suggestion**, in words, from public
profile facts and confirmed relationships only: "You were both at Acme",
"Worked with Kemi", "Available for work, with Figma", "Open to mentoring".
People who opted out of discovery, are blocked, suspended, hidden, already
connected or asked are never suggested. Rules, not a model: nothing to pay for
per view, and nothing to explain away.

**Respectful by default.** Notifications for a request, a confirmation and a
recommendation are in-app only, never a push. Endorsements notify nobody.
Discovery shows only people who allow it, and nobody is told you searched.
Someone's connection list follows their friend-list privacy setting, and their
career sections follow each section's own audience on their profile.

**Instant on the tap, cached on the way back** (owner, 2026-10-11). Every toggle
and button draws its result at once and puts itself back if the server says no.
Discover and Opportunities are GET forms: they work before hydration and every
search is a URL the router cache keeps. Edits survive a back-swipe through
`features/ui/use-sticky-state.ts`.

**Gap Ledger**

| Brief item | State |
|---|---|
| Business connection types (all 19 + custom), both sides named and confirmed | **live** |
| Network dashboard (connections, colleagues, mentors, clients, recommendations, endorsed skills) | **live** |
| Business Cards with QR, profile link, contact, résumé, website | **live** (Feature 18 Part 18, linked from here) |
| Career Timeline (experience, education, certifications, awards, publications, projects, connections, recommendations), permission-controlled | **live** (public view obeys each profile section's audience) |
| Recommendations, testimonials, client reviews, references, mentor reviews, moderated | **live** (subject approves) |
| Skill endorsements | **live** |
| Collaboration status (work, hiring, freelance, partnerships, investors, mentoring, looking for a mentor, speaking) | **live** |
| Professional discovery and filters (role, skill, open-to, country, language, industry, verified) | **live** |
| AI Network Assistant, explainable | **live** (rules) |
| Professional Reputation, transparent | **live** (private checklist) |
| Hiring: open positions, internships, freelance, volunteer, partnership, research, creator roles | **live** (post, search, message the poster). No applicant tracking |
| Business relationship history per connection | **live** (requested, connected, recommendations) |
| Network export (contacts, recommendations both ways, endorsements, credentials, opportunities) | **live** (JSON) |
| Mentorship requests | **live** as a mentor/mentee connection with a note. Office hours, sessions, progress tracking: planned (no scheduling product exists) |
| Professional, business, creator, developer and research identities managed separately | partly — profile types (personal, creator, business, professional, student) exist. One account holds one type |
| Verified organizations, enterprise departments, teams, directories, roles | planned — there is no organisation entity to verify or administer. A design of its own |
| Project collaboration: repositories, documents, tasks, milestones, meetings, contracts, invoices | planned — none of these products exist |
| Investments, conferences, contracts in the relationship history | planned — no such records exist to read |
| NFC cards | planned (the brief marks it future) |
| Filters by education and certification | planned — credentials are free text without an index |

---

## Migrations to run (in order)

`0214`, `0215`, `0216`, `0217`, `0218`, `0219` (×10 dashboard switch stands for new campaigns), `0220` (Contact Discovery: run after 0217, whose follow-source constraint it widens), `0221` (People You May Know feedback), `0222` (Friend Profiles: bucket list, capsules for friends, hidden moments), `0223` (Relationship Intelligence: archive, reconnect controls, activity counts), `0224` (Presence: status details, focus, automations, private history), `0225` (Friend Lists: nesting, archive, tags, rules). **All of 0214–0225 were applied and probed live on 2026-10-11.** Then `0226` (Professional Network: open-to and industry, confirmed connections, recommendations, endorsements, opportunities, three in-app notification types). Each is idempotent and PGlite-tested (run twice,
plus a mutant that must fail). The code works before and after each: every new
read falls back to today's behaviour when its column or table is missing.
