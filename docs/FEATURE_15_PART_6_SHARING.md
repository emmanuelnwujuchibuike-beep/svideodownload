# Feature 15 · Part 6 — Premium Sharing, Cross-Platform Distribution & Viral Discovery

**Owner brief:** "build a premium sharing platform where every share feels
intentional, beautiful, and meaningful... sharing should strengthen
friendships, communities, creator discovery, and social interactions instead
of becoming spam."

Written before the code, per the brief's requirement #1. §0 is the audit that
shaped it; §8 states plainly what the brief asks for that isn't being built
here, and why.

---

## 0. What already existed — and why that changes the shape of this part

Frenzsave already has a mature **repost** system (this feature's own Part 4:
audience, provenance, ranking, reason strings, antispam, ripple), a real
**reshare** system (message/story → post/reel/story/chat, owner-controlled
`allow_reshare`), and a **plain share** system that turned out to be far
thinner than either:

| Capability | Where | State |
|---|---|---|
| Multi-recipient DM share (up to 10) | `share-sheet.tsx`, `/api/posts/[id]/share` | working |
| Rich unfurl preview when a post is shared in chat | `message-post-embed.tsx` | working |
| Reshare to Story/chat, owner opt-out | `reshare.ts`, `reshare-rules.ts`, `0081` | working |
| Relationship-strength scoring | `lib/social/graph/strength.ts` | working, **not used for share ranking** |
| QR code rendering | `lib/qr/encode.ts`, `profile-qr.tsx` | working, **not wired to sharing** |
| `"share"` notification (icon, verb, priority) | `notifications-registry.ts`, `meta.tsx` | registered, **never emitted** |

So Part 6 is not "build sharing." A 17-point audit (this session) found the
real gaps: **the rich sheet is bypassed by most of the app's Share taps,
groups can't be addressed by it at all, sharing has no rate limit of its own,
the dead notification, and destination ranking that's just recency.**

🔴 **"Share" and "repost" are different systems with no table in common** —
a repost is a durable `reposts` row; a plain share is either an ordinary
`messages` row or a bare counter bump. That distinction decides most of this
document: a "share" has no audience, no attribution ledger, and no per-share
provenance today, and this tranche does not invent one (§8).

---

## 1. Architecture

```
                    <ShareSheet>  (GlassSheetShell chrome — shared with Part 5's comment sheet)
                            │
        ┌───────────────────┼─────────────────────────┬──────────────┐
        ▼                                              ▼              ▼
  people-picker.tsx                              ShareQrSheet   Repost composer
  loadPeople() — friends ranked by            (lib/qr, local,   (Part 4, unchanged —
  Smart Share Circle™ (strength.ts),           no 3rd party)    "Repost" row when
  loadGroups() — NEW, group conversations                        onRepost is passed)
        │
        ▼
  POST /api/posts/:id/share
  { to: userId[], toGroups: conversationId[], note }
        │              │
        ▼              ▼
  getOrCreateConversation +   sendMessage() directly
  sendMessage() per person    (membership self-enforced)
        │
        ▼
  bump_post_counter(shares) + publishNotification({type:"share"})
```

`<ShareSheet>` was already reused at 2 of the app's ~9 Share entry points
before this tranche (§4); the other 7 independently forked a bare
`navigator.share()`/clipboard-copy with no destination picker, no note, no
group support, and — the concrete regression this tranche had to avoid
creating — **no share-counter bump at all inside the rich sheet itself**, only
in the forks. Unifying everything onto one sheet without also moving that
counter bump would have silently zeroed out share counting app-wide instead
of fixing it (§4).

---

## 2. 🔴 The rule this part lives under

Same Reality Ledger rule as Parts 4 and 5: **nothing here claims a
destination, a delivery state, or a scale this codebase cannot actually back.**

- Smart Share Circle™ ranks **only what `relationshipStrength` already
  computes from the viewer's own signals** — no "who does this person talk to
  most" field exists or is added (same refusal `strength.ts`'s own header
  documents).
- "1 billion users / billions of shares / millions of concurrent deliveries" —
  not a testable claim in this environment and not a design this tranche's
  reads/writes are shaped around scaling to. Honest version: every share read
  here is paginated or capped (10 recipients), every write is O(recipients)
  rows — nothing here has been load-tested at that scale, and nothing here
  needs to be to be correct at this app's actual size.
- "Opened" / per-recipient read receipts for a shared post are **not built** —
  see §6, this needs a `message_receipts`-shaped table that doesn't exist.

---

## 3. Smart Share Circle™

`lib/social/share-circle.ts` (`shareCircleScores`) reuses `friendsOverview()`
+ `relationshipStrength()` exactly the way Part 4's repost ranking already
reuses the latter — the SAME privacy-reviewed scorer, not a re-derived one.
`friendsOverview` already returns favourite/since/lastChatAt for every friend
in one batched call (see `graph/overview.ts`'s own header on why this is 4
queries total, not one per friend); this is a second consumer of that same
cheap composition.

`GET /api/share/circle` returns `{ scores: Record<userId, number> }`.
`loadPeople()` merges these into its existing recent-conversations + friends
list: **scored friends sort by strength; unscored recent-chat partners (real,
valid destinations that aren't mutual friends — no signal exists to score
them by yet) keep their existing recency order and simply rank after every
scored friend**, never inventing a cross-category comparison. A slow/failed
score fetch falls back cleanly to the pre-Part-6 flat order.

---

## 4. Unifying the fork

Confirmed by audit: `<ShareSheet>` was rendered at exactly 2 of the app's ~9
"Share" entry points (feed card's Send action, reel viewer's Send action).
Seven forked a bare `navigator.share()`/clipboard-copy with a raw
`bump_post_counter` beacon and nothing else — including **the two highest-
traffic ones**, `image-viewer.tsx` and `post-viewer.tsx` (used from the main
home feed, profile grids, and the dashboard hero).

Unified this tranche: `image-viewer.tsx`, `post-viewer.tsx`, and
`post-engagement.tsx` (the `/p/[id]` permalink page's own like/save/share
bar) now all open the real `<ShareSheet>`. Neither `image-viewer.tsx` nor
`post-viewer.tsx` had any repost mechanism to preserve (confirmed by grep), so
`onRepost` is simply omitted there — not a regression, that capability never
existed on those surfaces.

🔴 **Caught before shipping, not after:** the rich sheet's own
`copyLink`/`shareExternal`/`send` never called the counter-bump endpoint —
only the forks did. Unifying onto the sheet without fixing this would have
made share counting silently stop working on 3 newly-unified, high-traffic
surfaces. `bumpShareCounter()` now runs inside `share-sheet.tsx` itself (and
`share-qr-sheet.tsx`'s copy action), once per successful ACTION, so every
entry point counts consistently regardless of which one was tapped.

**Also unified in tranche 2:** the two "…"-overflow-menu "Share" rows
(`feed-post-card.tsx`, `reel-viewer.tsx`'s `ReelMoreSheet`) now open the same
sheet too — every "Share" affordance on a post/reel goes through one
component. **Deliberately still separate:** the profile/business-card share
buttons, which share different content entirely (a profile, not a post) and
are correctly their own components, not a fork of this one.

---

## 5. Groups — a real, narrow gap, not a design choice

`ShareSheet`'s destination list could never address a group conversation: its
`people-picker.tsx` only ever added a DM's `other` participant, which is
`null` for a group, and `add()` silently no-ops on null. Reshare's own
destination picker already solved this (`loadInbox()` covers direct and group
alike) — plain share just never got the same treatment.

Fixed additively, not by retrofitting `PeoplePickerGrid` (also reused by
`CreateGroupSheet` for a person-only picker — changing its contract would
break that): `loadGroups()` (`people-picker.tsx`) sources group conversations
from the same `/api/messages` call `loadPeople()` already makes, `ShareSheet`
renders them as their own row, and `POST /api/posts/:id/share` gained
`toGroups: conversationId[]` alongside the existing `to: userId[]` — sent
directly via `sendMessage()`, which already self-enforces active membership
(`conversation_members`, `left_at is null`), so a group id the sharer isn't
actually part of fails closed there, not silently.

---

## 6. QR code, notifications, security

- **QR code** — `ShareQrSheet` reuses `ProfileQr` (pure math + `TextEncoder`,
  no Node-only APIs, safe inside a client sheet) rather than a second QR
  renderer or a third-party image service. Generated locally; nothing about a
  shared link ever reaches an external QR API.
- **The dead `"share"` notification** — fully registered (icon, verb string,
  priority) since it was built, never actually emitted (confirmed: the only
  `type: "share"` hits anywhere were the unrelated counter-bump payload).
  `/api/posts/[id]/share` now calls `publishNotification({ type: "share" })`
  **once per share action** (not per recipient — a 10-person share would
  otherwise burst 10 notifications at the original author), skipped when
  sharing your own post.
- **Rate limiting** — `/api/posts/[id]/share` borrowed `assistantLimiter` (an
  AI-usage bound, not a sharing one); `/api/reshare` had **no limiter at
  all**. Both now use a dedicated `shareLimiter` (`lib/rate-limit.ts`).
- **Email/SMS share** — `mailto:`/`sms:` links, no new infra, added as two
  more `ShareSheet` actions.
- **Graded antispam** (tranche 2) — `lib/social/share/antispam.ts`, same
  three-verdict shape as repost's, but `throttle` means something different
  here: a share is a DM to someone the sharer explicitly chose, not a public
  distribution, so there's no downstream "exclude from the feed" step to
  throttle INTO. Instead `throttle` still delivers the message (refusing
  would punish the recipient for the sharer's behavior) and only suppresses
  the `shares_count` bump and the author notification, so repeated abuse
  can't inflate its own signals. This needed real per-sharer history to
  evaluate, which didn't exist (§8's `shares`-table gap) — rather than fake
  it or block on tranche 3's full attribution ledger, migration `0121` adds
  the deliberately minimal `share_events` log (rate + creator only, not
  per-recipient delivery or destination breakdown) that tranche 3 extends
  rather than replaces. Registered in both governance registries
  (`lib/platform/data-domains.ts`, `lib/portability/tables.ts`) — a new table
  the test suite catches immediately if either is skipped.

---

## 7. The premium share sheet

`ShareSheet`'s chrome is now `GlassSheetShell` — the exact component Part 5
built for comments, relocated to `features/ui/` and used as-is rather than
forked a second time (nothing about the gesture or glass treatment is
comment-specific). This gives the share sheet, for the first time: real
drag-to-resize (3 detents) and drag-to-dismiss, consistent blur/elevation
with every other premium sheet in the app, and the same haptic-on-dismiss the
comment sheet has. `hapticPattern` on successful send and `haptic("light")`
on each group-avatar toggle were already present or newly added to match
`reshare-sheet.tsx`'s existing haptic density.

---

## 8. 🔴 In the brief, not buildable here — say it, don't fake it

| Asked | Why not (or not yet) |
|---|---|
| Community sharing (Announcements, Discussion Prompt, Moderator Approval, Community Analytics) | **No `communities` table in the schema** — confirmed still true (Part 4's own conclusion, re-verified). A whole product, not a row. `join-communities.tsx`'s hardcoded fake member counts are a **pre-existing, unrelated** decorative stub the audit surfaced in passing — flagged, not fixed here (out of this feature's scope unless asked). |
| Business/Creator inbox, Business Teams sharing | **No business/creator account tier exists.** `BillingPlan`'s `"business"` value is a download-quota tier for the URL-downloader product (10,000/day), not a social account type — there is no admin flag, no team concept, nothing to route a "Business inbox" share to. |
| Story stickers / polls / questions / countdown / music / mentions | `stories` has exactly 6 columns after 3 migrations (id, media, caption, expiry, thumbnail, reshare-permission) — this is a **whole-Stories-feature gap**, true for a normally-created story and a reshared one alike, not specific to reshare. Out of Part 6's scope unless the owner wants a Stories authoring overhaul. |
| Signed/expiring share links, disable-download-on-share, per-share audience/privacy | **No signing infrastructure exists anywhere in this app** for share/download links (only upload presigning, an unrelated concern) and a plain share has no audience concept at all today — unlike `reposts.audience` (Part 4), which the pointer-row model made cheap to add. Doing the same for a link-in-a-DM is a real, larger design (what does "expire" even mean for a link already copy-pasted elsewhere?) — not attempted this tranche. |
| Live share status (delivered/viewed/opened/expired/failed+retry) | Generic 1:1 message delivery ticks exist (sent→delivered→read); there is no per-member receipt table for a group send, and nothing distinguishes "read the DM" from "opened the linked post." Building the latter is a per-viewer tracking decision, same privacy-scoping question Part 4 declined for "who watched your repost." |
| Share analytics breakdown (story/chat/external split, conversion rate, follower growth from shares, top countries) | No `shares` table to attribute against — today's `totals.shares` is one lumped counter. Real attribution needs the ledger Part 4 built for reposts (`repost_attributions`); building an equivalent for plain shares is a real, sizeable tranche-3/4 item. |
| Share Journey™ (animated propagation visualization) | Needs the attribution ledger above to draw anything real — Part 4's Social Ripple™ only exists because `source_repost_id` records real provenance edges. A plain share has none; a "journey" drawn without one would be decorative, not data. |
| FrenzBridge™ (seamless return-to-origin navigation) | A real, cross-cutting feature (preserving Story/Community/Chat navigation context across a reel open/close) — genuinely buildable, but it is a navigation-history architecture decision touching every viewer entry point, not a sharing-feature slice. Scoped out of Part 6 tranche 1; candidate for its own pass. |
| Nearby/proximity sharing (Bluetooth/WebRTC) | No such transport exists anywhere in this codebase; `nearby-discovery.tsx` is location-text-based, unrelated. A from-scratch peer transport is a much bigger scope call than this tranche. |
| "1 billion users / billions of shares" | Not a testable claim (§2). |

---

## 9. Delivery — what shipped this tranche, and what's still open

**Tranche 1 — shipped this session:**

| Piece | Where |
|---|---|
| Shared premium shell relocated + reused (comments AND share) | `features/ui/glass-sheet-shell.tsx` |
| Smart Share Circle™ — friend ranking by relationship strength | `lib/social/share-circle.ts`, `GET /api/share/circle`, `people-picker.tsx` |
| Group destinations — real gap fixed, `toGroups` on the share API | `people-picker.tsx` (`loadGroups`), `app/api/posts/[id]/share/route.ts` |
| Unified the fork — image-viewer, post-viewer, post-engagement now open the real sheet | those 3 files |
| Share-counter bump moved into the sheet itself (fixes a would-be regression from unifying) | `share-sheet.tsx`, `share-qr-sheet.tsx` |
| QR code destination, reusing the existing local QR primitive | `features/social/share-qr-sheet.tsx` |
| The dead `"share"` notification, now actually emitted once per action | `app/api/posts/[id]/share/route.ts` |
| Dedicated `shareLimiter`; `/api/reshare` gained rate limiting (had none) | `lib/rate-limit.ts`, both share routes |

Verified: `tsc --noEmit` clean project-wide. 🔴 **Not verified in a real
browser** — same standing limitation as every prior Part; nobody has dragged
the new share sheet, sent to a group, or scanned a generated QR code through
the UI yet.

**Tranche 2 — shipped this session:**

| Piece | Where |
|---|---|
| Unified the last two "Share" entry points (the "…"-menu rows) | `feed-post-card.tsx`, `reel-viewer.tsx` |
| Email/SMS share | `share-sheet.tsx` |
| Graded antispam (allow/throttle/block) + its minimal history log | `lib/social/share/antispam.ts` (8 unit tests), `supabase/migrations/0121_share_events.sql` |
| New table registered in both governance registries | `lib/platform/data-domains.ts`, `lib/portability/tables.ts` |

Verified: `tsc --noEmit` clean; full `vitest run` — 2010/2013 (8 new antispam
tests added; same 3 pre-existing `budget.test.ts` failures, unrelated to
sharing — confirmed the new `data-domains`/`portability` registry tests catch
a missed table registration immediately, which is exactly what they're for).

**Tranche 3 — Share Journey™ + destination breakdown — shipped this session:**

| Piece | Where |
|---|---|
| `share_events` gained a `kind` (dm/group/copy_link/os_share/email/sms/qr) and `recipient_ids` (only where a recipient is actually knowable) | migration `0124_share_events_kind.sql` |
| Every share action now ledgers its kind — the DM/group path already wrote its own row with real recipient ids; `/api/posts/[id]/event` now also logs the 5 external kinds for signed-in callers (anonymous taps still bump the public counter, just aren't ledgered — the table's `sharer_id` is `not null`) | `app/api/posts/[id]/share/route.ts`, `app/api/posts/[id]/event/route.ts` |
| **Share Journey™** — a real funnel (total shares → destination breakdown → how many DM/group recipients later viewed the post), cross-referencing `recipient_ids` against the existing `post_views` table. Deliberately NOT a propagation tree — that needs the provenance edges Part 4's `source_repost_id` has and a plain share doesn't (§0/§2); building a fake one would be the exact "decorative, not data" mistake this doc already refused for reposts | `lib/social/share/insights.ts`, surfaced on `/account/analytics` |

🔴 **Per-share audience/privacy controls — reconsidered, not built, and not
just deferred.** A repost's `audience` (Part 4) gates a real, dedicated READ
path (the profile's Reposts tab, feed surfacing) — that's what makes it
enforceable. A plain share has no equivalent surface at all: it's either a
private DM (already as private as it can be) or an external link (whoever
has the link can open it, same as any URL). An "audience" selector on a
share action would have nothing to actually gate — exactly the "labelled
control with no destination" failure Part 4 already named and refused to
ship for Community/Business reposts. Correctly not built, not merely
postponed.

Verified: `tsc --noEmit` clean; full `vitest run` — 2010/2013 (same 3
pre-existing budget-artifact failures). 🔴 **Not verified in a real
browser** — same standing limitation as every prior tranche; the Share
Journey numbers have never been checked against a real send-then-view
sequence end to end.

**Tranche 4 — reassessed:** FrenzBridge™ (its own navigation-architecture
project, touching every viewer's open/close path in a codebase with an
already-hard-won, bug-prone page-transition system — a real, larger
undertaking correctly left out of a sharing-feature pass rather than rushed
into it) and Community/Business sharing (still blocked on products that
don't exist — no `communities` table, no business account tier; inventing
either from scratch here would be a far bigger, unrequested expansion, not
"finishing sharing") remain explicitly not built, for the reasons already
recorded in §8.

**Part 6 is now feature-complete against the brief's realistically-buildable
scope.** Every section of the original spec either shipped across tranches
1–3, or has an explicit, reasoned entry in §8's "not buildable" table or
directly above — nothing was silently dropped.
