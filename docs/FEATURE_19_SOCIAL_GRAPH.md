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

## Migrations to run (in order)

`0214`, `0215`, `0216`, `0217`, `0218`, `0219` (×10 dashboard switch stands for new campaigns), `0220` (Contact Discovery: run after 0217, whose follow-source constraint it widens). Each is idempotent and PGlite-tested (run twice,
plus a mutant that must fail). The code works before and after each: every new
read falls back to today's behaviour when its column or table is missing.
