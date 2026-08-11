# Feature 15 · Part 3 — Premium Engagement System

**Status:** Tranche 1 shipped. Tranches 2–4 specified below, not yet built.
**Owner brief:** "the world's most engaging and premium social interaction
system… every interaction should strengthen friendships and encourage meaningful
engagement rather than addictive clicking."

Requirement #1–#9 of the brief. Written before the code, and — with equal weight
— an honest account of which parts have data behind them today and which do not.

---

## 0. What already existed

Part 1 shipped most of the *surface* of this brief. Building Part 3 without
reading it would have meant rewriting a working rail:

| Capability | Where | State |
|---|---|---|
| Glass action rail, adaptive accent, ripple, haptics | `features/reels/viewer/glass-button.tsx` | working |
| Rolling engagement counters | `features/ui/animated-count.tsx` | working |
| Reaction picker (Love/Funny/Wow/Fire/…) | `features/social/reaction-picker.tsx` | working |
| Floating reaction burst on like | `features/ui/reaction-float.tsx` | working |
| Repost burst + followed-reposter badge | `features/social/repost-burst.tsx`, `lib/social/reposts.ts` | working |
| Comments sheet, replies, gating, spam checks | `features/social/comments.tsx`, `lib/social/engagement.ts` | working |
| Collections / save-to-folder | `features/social/collection-picker.tsx` | working |
| Share sheet, reshare, forward | `features/social/share-sheet.tsx` | working |
| Follow with optimistic state | `lib/social/follow-store.ts` | working |
| Social Pulse™ component | `features/reels/viewer/social-pulse.tsx` | **built, fed nothing** |

That last row is the headline. Social Pulse was written in Part 1 with a
deliberate empty event list, because the feed returned no friend-activity data.
**Part 3 tranche 1 gives it real data.**

---

## 1. Engagement architecture

```
  posts ── post_reactions ── reposts ── post_comments      (existing tables)
                    │
                    ▼
        lib/social/pulse-activity.ts        ONE batched query per feed page
           "which people I follow engaged with these posts, and how"
                    │
                    ▼
          FeedItem.friendActivity            attached beside repostBadge
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
   Social Pulse™        Friend Energy™
   (timed, ambient)     (static, in the caption)
```

**One query, per page, batched.** The friend-activity read follows the exact
shape `followedReposters` already uses: `IN (postIds) AND user_id IN
(followingIds)`, one profile lookup for the union of actors, then grouped in
memory. N posts cost two round-trips, not 2N. It runs in the same
`Promise.all` as the repost badge, so a feed page costs no extra wall-clock time.

**Fail-open to nothing.** Every branch is wrapped and returns an empty map on
error. A missing migration, an RLS change or a slow query degrades to "no friend
activity", which is a correct and common state — never to a broken feed.

**The viewer's own actions are excluded.** "You liked this" is not social proof,
and seeing yourself in a Pulse card reads as a bug.

---

## 2. 🔴 The rule this whole feature lives under

Fabricated social proof has been declined three times on this project and the
Reality Ledger fails the build on invented scale claims. So:

- Every Pulse event is a **row that exists**, naming a **person the viewer
  actually follows**.
- No "trending" without a measured signal. The `trending` Pulse kind stays
  unused until there is a real trend computation behind it — the component
  supports it; nothing emits it.
- A post with no friend activity shows **nothing**. Not a placeholder, not a
  generic "people are watching". That is the honest state and it is what most
  reels will show.

This is also why "5 friends watched this" from the brief is **not** built:
there is no per-viewer view ledger that records *who* watched, only a
`views_count`. Inventing the names would be exactly the failure above, and
building the ledger is a privacy decision (§7), not a UI task.

---

## 3. Social Pulse™ vs Friend Energy™ — two shapes, one dataset

Both read `FeedItem.friendActivity`. They differ in *when* they interrupt:

| | Social Pulse™ | Friend Energy™ |
|---|---|---|
| Form | a card that fades in, holds, fades out | one static line in the caption block |
| Timing | while playing, one at a time | always, with the caption |
| Cost | attention | none |
| Off switch | its own preference, defaults on | follows the caption |

Pulse is for the *event* ("David reposted this"). Friend Energy is for the
*aggregate* ("2 friends you follow liked this"). Showing both of the same fact
would be repetition, so Pulse takes the named individuals and Friend Energy
takes the count when there are more actors than Pulse will name.

---

## 4. Interaction and motion

Everything animated is `transform`/`opacity` only, so frames composite without
layout or paint — the same constraint Part 2's player runs under, for the same
reason. `prefers-reduced-motion` keeps the colour and state change and drops
only the movement; removing the feedback with the motion is the common mistake
and leaves people unable to tell whether a tap registered.

Counters roll rather than jump (`AnimatedCount`, already shipped). A count that
snaps from 1.2K to 1.3K reads as a re-render; one that rolls reads as an event.

---

## 5. Real-time synchronisation

Today engagement is optimistic-local plus a refetch on navigation, and the
optimistic stores (`follow-store`, `repost-store`) already keep every mounted
surface in step within a session. Live cross-device updates need a Supabase
realtime channel per visible post, which is a per-view subscription cost — that
belongs in tranche 3 behind a measurement, not before one.

---

## 6. Accessibility

Pulse is `aria-live="polite"`, never takes focus, and accepts no tap — so there
is nothing to miss by ignoring it, which is what makes an ambient card safe at
all. Friend Energy is ordinary text in the caption and is read in document order.
Every rail control has a name and a visible focus ring (Part 1). Counts announce
as their full value, not the abbreviated "1.2K".

---

## 7. 🔴 What the brief asks for that is not built, and why

| Asked | Status |
|---|---|
| "5 friends watched this" | **No data.** There is no per-viewer view ledger, only `views_count`. Building one is a privacy decision — it records who watched what — and needs an explicit opt-in, not a schema migration. |
| Voice / GIF comments, translation | Comments exist; these are three separate products (recorder plumbing exists for messaging, a GIF provider does not, translation needs a service). Tranche 4. |
| Creator analytics: watch time, completion rate, follower conversion, traffic sources | The playback engine now measures completion (Part 2's engagement counter). Surfacing it per-creator needs an aggregation table. Tranche 3. |
| Notification batching | The notification platform exists; batching is a scheduler change. Tranche 3. |
| Creator Appreciation™ badges | A whole product (badge issuance, eligibility, delivery). Not started. |
| Nearby users, QR share | Share sheet exists; nearby needs a proximity service that does not exist. |
| "Billions of likes" | Not a testable claim. The honest version: every read here is batched per page and every write is a single row — nothing in this design scales with total volume. |

---

## 8. Delivery plan

- **Tranche 1 (shipped).** `pulse-activity.ts` — the batched who-of-my-friends
  -engaged query; `FeedItem.friendActivity`; Social Pulse™ fed with real events;
  Friend Energy™ line in the reel caption. 21 tests.
- **Tranche 2.** Smart comment preview on the rail (friend > verified > creator
  reply > newest), story ring on the rail avatar, share-ripple and follow-success
  micro-interactions.
- **Tranche 3.** Realtime engagement sync, creator engagement insights, and
  intelligent notification batching.
- **Tranche 4.** Voice/GIF comments and comment translation.
