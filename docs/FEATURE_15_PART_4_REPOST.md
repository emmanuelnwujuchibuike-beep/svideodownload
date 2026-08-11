# Feature 15 · Part 4 — The Recommendation Engine (Repost, Distribution & Ripple)

**Owner brief:** "the world's most intelligent repost system… A repost should
feel like a recommendation from someone you trust — not simply another share
button."

Written before the code, as requirement #1–#8 of the brief ask. It covers the
whole system; §11 states plainly which tranche each piece lands in and which
pieces have no data behind them yet.

---

## 0. What already existed — and why that changes the shape of this part

Frenzsave has had reposts since 2026-07-05. Building Part 4 as if it were a
blank page would have meant rewriting a mature, shipped feature:

| Capability | Where | State |
|---|---|---|
| Repost as a POINTER (never copies media) | `0025_reposts.sql` | working |
| Recommendation caption, 15-min edit, pin | `0030_repost_captions.sql`, `repost-composer.tsx` | working |
| Undo toast, optimistic cross-surface store | `lib/social/repost-store.ts` | working |
| Followed-reposter badge + "who reposted" | `lib/social/reposts.ts`, `reposters-sheet.tsx` | working |
| Friend reposts surfaced into For You | `surfaceFollowedReposts()` in `home-feed.ts` | working |
| Repost-engagement notifications ("Sarah liked the post you reposted") | `0036_…sql` | working |
| Send in chat / share / copy link | `share-sheet.tsx` | working |
| Save for later (Collections) | `collection-picker.tsx` | working |
| Reshare to Story | `reshare-sheet.tsx`, `reshare-rules.ts` | working |
| Social Pulse™ / Friend Energy™ ("your friends engaged") | Part 3 tranche 1 | working |

So Part 4 is **not** "build reposting". It is the four things the shipped system
genuinely does not have:

1. **Audience.** Every repost today is public. The brief's Private Repost,
   Repost to Friends, Family, Groups have no representation in the data.
2. **Provenance.** A repost points at a post, so there is no record of *where
   the reposter found it*. Without that edge there is no Social Ripple™, no
   Discovery Bridge™, and no honest "your repost reached N people".
3. **Distribution intelligence.** Reposts are surfaced newest-first, capped at
   2. There is no ranking, no diversity rule, no reason string.
4. **Consequence.** No attribution ledger, so no repost analytics, no creator
   analytics, no Recommendation Circle™ reputation.

---

## 1. Architecture

```
                    ┌──────────────────────────────────────┐
   WRITE PATH       │  POST /api/posts/:id/repost          │
                    │   audience · quote · sourceRepostId  │
                    └──────────────┬───────────────────────┘
                                   │  antispam.ts  (pure: burst, repetition, ratio)
                                   ▼
                    reposts ── audience ── source_repost_id ── quote_media
                       │                        │
                       │                        └── the PROVENANCE EDGE
                       ▼
   READ PATH   repost/audience.ts   who is even eligible to see this row
                       │
                       ▼
               repost/ranking.ts    score, then cap  (never "show everything")
                       │
                       ▼
               repost/reason.ts     "💙 Chris reposted this."  ← from the SAME
                       │                                        branch that ranked it
                       ▼
                  FeedItem.repostBadge + .repostReason

   CONSEQUENCE   repost_attributions (impression|open|like|comment|save|repost|follow_creator)
                       │
          ┌────────────┼─────────────────┬────────────────────┐
          ▼            ▼                 ▼                    ▼
     insights.ts   ripple.ts      reputation.ts        Discovery Bridge
     (reposter +   (Social        (Recommendation      (follow_creator
      creator)      Ripple™)       Circle™)             attribution)
```

Five pure modules (no React, no Supabase, no I/O — the house pattern from
`fit.ts`, `strength.ts`, `reshare-rules.ts`) carry every decision, and every one
of them is unit-tested. The data layer only fetches rows and hands them to a
pure function. That is what makes "explain every recommendation" possible: the
reason string is produced by the code that made the pick, never re-derived by a
component guessing at why something is on screen.

---

## 2. 🔴 The rule this part lives under

Three prior sessions established it and it decides more of this design than any
other single constraint: **no fabricated social proof, ever.** The Reality
Ledger fails the build on invented scale claims.

Consequences, concretely:

- "Five friends watched your repost" is **not built**. There is no per-viewer
  view ledger, only `views_count`. Building one records who watched what, which
  is a privacy decision, not a UI task (§10).
- Repost analytics count **attribution rows that exist**. A repost with no
  attributions shows "No reach yet" — the honest state and the common one.
- Social Ripple™ draws the tree that `source_repost_id` actually recorded. A
  repost that nobody re-reposted draws one node. It does not draw a decorative
  fan-out.
- "Trending" is never asserted without a measured signal.
- **`unknown ≠ zero`.** Reposts made before this migration have a null
  provenance edge; they are shown as "direct" and never as "found it themselves".

---

## 3. Audience — the private repost

A repost is a pointer row, not a post. That is what makes an audience shippable
here when `post_audience` is still not live for circles: adding an audience to a
repost does **not** touch `posts.visibility`, does not touch the feed indexes,
and does not rewrite an RLS policy twenty queries depend on.

`reposts.audience`, rules as data in `lib/social/repost/audience.ts`:

| audience | who the repost reaches | brief mapping |
|---|---|---|
| `public` | anyone; profile Reposts tab, badges, surfacing | Instant Repost |
| `followers` | people who follow the reposter | Repost to Followers |
| `friends` | mutual, agreed friendships only | Repost to Friends |
| `close_friends` | `friend_favorites` — the viewer's own pins | Best Friends / Family |
| `private` | nobody but the reposter (a saved recommendation) | Save for Later |

**Both the sheet's rows and the server's filter read this one table**, the same
discipline as `reshare-rules.ts`, so the promise on the button cannot drift from
the code that enforces it. It is pinned by tests including an exhaustive
assertion that a `close_friends` repost can never reach a stranger.

Two enforcement points, deliberately:

- **RLS** narrows public read to `audience = 'public'` (plus your own rows).
  Every app read uses the service role, so this is defence against a
  hand-rolled anon-key query, not the primary gate.
- **Application code** — `visibleReposts()` filters by the viewer's actual
  relation before anything is ranked. This is the primary gate because that is
  where the relation data already lives (`friendIdSet`, `follow`,
  `friend_favorites`).

🔴 **Group and Community reposts are NOT built, and the reason is that there is
no community.** `conversations.type in ('direct','group')` exists — group
*chats* — and "Repost to Group" is therefore delivered as **Send in Chat** with a
group conversation selected, which is what it actually is. There is no
`communities` table anywhere in this schema, so "Repost to Community" and
"Business Teams" would be a button that writes to nothing. Shipping a labelled
control with no destination is the failure mode this project has already caught
three times (`/admin/corpora`, the mute-creator stub, the collections stub). The
sheet omits them rather than faking them; §10 records them as blocked on a
Communities product.

---

## 4. Provenance — one column that unlocks three features

`reposts.source_repost_id → reposts(id)`.

When you repost something you found through Chris's repost, the row records
Chris's repost id. It is nullable (you found it in Explore), and it is set from
the client only when the surface that showed you the post *was* a repost — the
API validates that the referenced repost really points at the same post, so it
cannot be used to fabricate a chain.

That single edge is the entire basis for:

- **Social Ripple™** — the propagation tree, built by a pure BFS over rows.
- **Discovery Bridge™** — "someone followed this creator through your repost"
  needs to know which repost they came through.
- Ranking's **second-degree** signal — "a friend of a friend recommended this".

It is a self-referencing FK with `on delete set null`: deleting Chris's repost
must orphan the branch, never cascade-delete other people's reposts.

---

## 5. Smart distribution — ranking, then capping

`lib/social/repost/ranking.ts`, pure, `rankReposts(candidates, context)`.

Scores are the *ordering*; the caps are what actually stops the feed flooding,
and the caps matter more:

| Signal | Weight | Why this weight |
|---|---|---|
| Relationship strength band (`strength.ts`) | up to 30 | The existing, privacy-reviewed measure. Not re-derived here. |
| Mutual friends (log) | up to 10 | 0→5 mutuals means far more than 40→45. |
| Reposter wrote a caption | +8 | Effort is the cheapest honest quality proxy. |
| Multiple independent reposters | up to 12 (log) | Two friends independently is a stronger signal than one twice. |
| Shared interests (category overlap) | up to 8 | Real: `post.category` vs the viewer's engaged categories. |
| Creator already followed | −6 | You will see it anyway; a repost slot is better spent on discovery. |
| Recency (halves every 18h) | ×0.55–1.0 | A repost is a recommendation with a shelf life. |
| Recommendation reputation | ×0.85–1.15 | Multiplier, never additive — see below. |
| Viewer already engaged | drop | Not a ranking problem; it is not a candidate. |

**Caps (the anti-flood rules):**

- ≤2 reposts per feed page (unchanged from the shipped surfacing).
- ≤1 repost per reposter per page — one person cannot own your feed.
- ≤1 repost per original creator per page.
- Never two adjacent repost items.
- A post you dismissed is suppressed for 30 days.

🔴 **Reputation is a multiplier, not points.** As an additive term a
high-reputation account would outrank a close friend's recommendation, which
inverts the brief's own priority order ("Friends first. Creators second.
Algorithms third."). As a ±15% multiplier it can only reorder things that were
already close.

---

## 6. "Why am I seeing this?"

`lib/social/repost/reason.ts` turns the ranking's *inputs* into one sentence.
The rule that makes it trustworthy: **the reason is emitted by the branch that
made the decision**, carried on the item, never inferred in the component (the
same rule Part 3 tranche 2 established for the comment-preview badge).

| Emitted when | String |
|---|---|
| One followed reposter | 💙 Chris reposted this. |
| 2–4 | 🔥 Chris and 2 others reposted this. |
| ≥5 | 🔥 Five friends reposted this. |
| Second-degree via provenance | 👥 Someone Chris recommended this to reposted it. |
| Category overlap is the top signal | ⭐ Popular with people who watch what you watch. |
| Reposter is a close friend | 💙 From your close friends. |

Every string names a **row that exists**. There is no "trending among people you
follow" string, because there is no trend computation — the type supports the
kind, nothing emits it, exactly as Part 3 left `trending` in Social Pulse.

Emoji in this copy is deliberate and matches the brief's own examples; the
no-emoji design rule covers UI chrome, and notification copy already carries an
owner-approved exception.

---

## 7. The premium repost button

🔴 **The rail does not get a new button.** On 2026-08-11 the owner moved Repost
*inside* Send precisely to stop the tray reading as a wall: "put the reshare
button inside the send button to avoid tray cluster". Adding a distinct glass
Repost control to the rail would undo an instruction from four days ago.

So the premium button is built as a **component** (`RepostButton`) and used
everywhere reposting is the primary action — the destination sheet's hero
control, the quote composer's confirm, the feed card, the repost page — while
the reels rail keeps the owner's Send fork, which now opens this sheet.

What the brief asks for, and how each is actually delivered:

- **Dual-arrow glyph** — a hand-drawn `RepostGlyph`, not `Repeat2`. Two
  arrows that pass each other, with an asymmetric stroke so it does not read as
  Lucide's refresh circle.
- **Electric blue glow + purple accent** — the brand pair from `design-tokens`,
  as a blurred radial under the disc, animated on `opacity` only.
- **Glass, adaptive blur, luxury shadow** — the `glass.primary` recipe already
  shared by the whole rail, so it belongs to the app rather than to this feature.
- **Premium ripple / elegant spring / soft haptic** — the shipped `springs.press`
  vocabulary and `haptic()`, not a second hand-rolled spring (there were seven
  before `springs` existed).
- **120 FPS, honestly** — `transform`/`opacity` only, so frames composite
  without layout or paint. No web API requests a refresh rate; claiming more
  would be marketing.
- **Reduced motion** — the ripple and the bounce stop; the colour and the state
  change survive. Dropping the feedback with the motion leaves people unable to
  tell whether the tap registered.

---

## 8. Anti-spam

`lib/social/repost/antispam.ts`, pure, decided from the reposter's own recent
rows so it is testable without Redis:

| Detector | Rule | Rationale |
|---|---|---|
| Burst | >8 reposts in 5 min | A human recommending things does not do this. |
| Volume | >40 reposts in 24 h | Generous; catches scripted accounts. |
| Repetition | same post reposted >3 times after undo | Undo-and-redo farming a notification each time. |
| Same-creator flooding | >6 of the last 10 from one creator | Coordinated promotion. |
| Uncaptioned velocity | >20/day, none captioned | Volume without a single recommendation. |

The verdict is graded, not binary: `allow` → `throttle` (the repost is written
but excluded from distribution) → `block`. **Throttle is the important state.**
Blocking a false positive costs a real person their feature; throttling costs a
spammer their reach and is invisible to the honest user. Requests carrying a
verdict of `block` return 429 with the reset time, and the Upstash sliding
window (`lib/rate-limit.ts`) provides the cross-instance backstop.

---

## 9. Consequence — attribution, analytics, ripple, reputation

`repost_attributions` records **at most one row per (repost, actor, event)** —
a unique index, so re-liking or scrolling past twice cannot inflate anything.

**What is recorded and what is not.** Impressions and opens are recorded with
the actor id so the unique index can dedupe them, and then **every read
aggregates to a count**. No API returns "who saw your repost" — reach is a
number. The one place an identity appears is `follow_creator`, which surfaces to
the creator as a count too; Discovery Bridge tells you *that* your recommendation
grew someone's audience, never *who* it was.

- **Reposter analytics** — reach, opens, likes, comments, saves, chain reposts,
  follower conversion. Every figure is a count of rows.
- **Creator analytics** — top reposters (public: they reposted publicly),
  friend-network reach, quote reposts, conversation rate. Countries/cities are
  **not built**: there is no geo column on any of these tables and adding one to
  an engagement ledger is a privacy decision.
- **Social Ripple™** — pure BFS over `source_repost_id`, layered
  creator → direct → second degree → beyond, with the honest note that a null
  edge means "unknown", not "direct".
- **Recommendation Circle™** — derived per read from attribution counts, never
  stored, never shown to anyone but its owner (the `strength.ts` precedent).
  Quality = engagement per repost, not volume; a 5-repost account that gets
  opened every time outranks a 500-repost account that gets ignored.

---

## 10. 🔴 In the brief, not buildable here — say it, don't fake it

| Asked | Why not |
|---|---|
| Repost to Community / Business Teams | **No `communities` table in the schema.** A whole product, not a row. |
| Repost to Group | Delivered as Send in Chat → a `type='group'` conversation. That *is* the group. |
| "Five friends watched your repost" | No per-viewer view ledger. Building one is a privacy decision needing opt-in. |
| Countries / cities in creator analytics | No geo data on any engagement table. |
| Voice / Music in the quote composer | No recorder wired outside messaging; no music-licensing product exists. |
| Repost to Story | 🔴 **There is no post→story path at all.** `reshare-rules.ts` defines `ReshareSource` as `message \| story`; resharing was built for chat media and other people's stories, never for feed posts. The resizable preview, stickers and animated backgrounds on top of that are a story *composer* — its own product. The row is in `REPOST_DESTINATIONS` marked `live: false` with this reason, and the sheet does not render it. |
| Real-time analytics | Counts are read per request. Live subscription per repost is a per-view cost that belongs behind a measurement. |
| "1 billion users / billions of reposts" | Not a testable claim. Honest version: every read here is batched per page and every write is one row — nothing scales with total volume. |
| Location in ranking | Deliberately declined. No location data is collected for the feed, and adding it for ranking is not a ranking change. |

---

## 11. Delivery

- **Tranche 1 (this session).** Migration 0116; all five pure engines + tests;
  audience-aware read path; premium button + destination sheet + audience picker;
  quote composer; reason strings wired into feed and reels; anti-spam on the
  write path.
- **Tranche 2 (this session).** Attribution ledger + recording; reposter and
  creator insights; Social Ripple™ visualisation; Recommendation Circle™; the
  repost history page.
- **Tranche 3.** Conversation Reposts™ (a thread linking the original, quotes
  and discussions), notification batching for repost engagement, realtime
  counters.
- **Tranche 4.** Communities (unblocks Community/Business reposts), story
  composer, voice/music in quotes.
