# Feature 15 · Part 5 — Premium Comments, Conversations & Social Interaction System

**Owner brief:** "design the world's most premium comment experience… comments
become meaningful discussions rather than a simple list of replies." Explicitly:
do not copy TikTok/Instagram/YouTube/Facebook/Snapchat comments.

Written before the code, per the brief's own requirement #1 ("design the
complete comment architecture… before writing any code"). §0 is the audit that
shaped everything after it; §7 states plainly what the brief asks for that
isn't being built here, and why; §8 records exactly what shipped in tranche 1
versus what tranches 2–4 still owe.

🔴 **Superseded by Part 6:** `comment-sheet-shell.tsx` / `CommentSheetShell`
referenced below was relocated to `features/ui/glass-sheet-shell.tsx` and
renamed `GlassSheetShell` when Part 6's Share sheet reused it as-is rather
than forking a second copy — see `FEATURE_15_PART_6_SHARING.md` §7. Nothing
about the component's behavior changed; only its name and home.

---

## 0. What already existed — and why that changes the shape of this part

Comments have been iterated on since 2026-07-09 (Feature 17 Part 9's slice,
then two follow-up rounds the same day). Building Part 5 as if comments were a
blank page would have meant re-shipping a mature system:

| Capability | Where | State |
|---|---|---|
| Smart / Top / Newest / Friends sort | `comments.tsx` `SORTS` | working |
| Stickers, images, voice notes, legacy video playback | `comment-media.tsx`, `voice-recorder.tsx` | working |
| 8-emoji reactions + reaction insights sheet | `comment-meta.ts`, `ReactionInsights` | working |
| Mood pills (Question/Opinion/Tip/…) | `comment-meta.ts` | working |
| Pinned + Best Answer | `0023_comment_reactions_mood.sql` | working (pin was an unlabelled, uncapped boolean — see below) |
| One-level threading, collapsible replies | `engagement.ts`, `CommentItem` | working, **structurally capped at depth 1** |
| @mention autocomplete + notifications | `0037_comment_notifications.sql` | working |
| Reply / comment_reaction notifications | `meta.tsx`, `0037` | working |
| Local draft persistence | `comments.tsx` `Composer` | working |
| Report → auto-hide on report threshold | `/api/report`, `0049` trigger | working |
| Lightweight spam heuristics | `commentSpamReason()` | working |
| Anthropic LLM integration (general assistant + AI moderation risk-scoring) | `app/api/assistant/route.ts`, `lib/moderation/risk-score.ts` | working, **not comment-composer-facing** |
| Typing-indicator infrastructure | `use-typing.ts` (messaging) | working, **not wired to comments** |

So Part 5 is not "build comments." A full research pass (17-point audit, this
session) found the real gaps were: **one glass sheet instead of three forked
ones, gesture-controlled height, haptics, a genuine friend accent, comment
editing, labelled multi-pin, true nested threading, live comments, comment
search, an AI writing assist, a creator dashboard, and comment analytics** —
plus several things the brief asks for that this codebase has already made an
explicit, dated decision about (§7).

---

## 1. Architecture

```
                    Comments (shared logic — one component, five mount points)
                            │
        ┌───────────────────┼────────────────────────┐
        ▼                                             ▼
  CommentSheetShell                              <Comments variant="page">
  (glass, ONE shell now,                          persistent sidebar / post page,
   gesture height + dismiss,                      no sheet chrome at all
   replaces 3 forked wrappers)
        │
        ▼
  reel-viewer · image-viewer · feed CommentsSheet
  (each supplies title/headerExtra/onOpen only —
   zero owns its own blur/height/drag code anymore)
```

`Comments` (`features/social/comments.tsx`) is the one place that owns state,
sort, reactions, moderation and the composer. It was already reused across
five mount points before this part (image viewer, reel viewer, feed card via
`CommentsSheet`, `/p/[id]`, `post-viewer.tsx`) — the real problem was that the
*chrome around it* (blur amount, fixed height, z-index, drag) had been
independently written three times with three different values. Tranche 1
collapses that into `comment-sheet-shell.tsx`; the underlying `<Comments>`
logic component is untouched in shape, only extended with new fields.

---

## 2. 🔴 The rule this part lives under

Same Reality Ledger rule as Part 4: **nothing in this UI claims a number,
category, or capability the data doesn't back.** Concretely here:

- A "Trending" sort option is **not built** — there is no trend computation
  anywhere in the comment stack (matches Part 4's identical honesty note about
  reposts). Smart/Top/Newest/Friends only.
- "AI Highlights" sort is **not built** for the same reason — highlighting
  implies a judgment call an LLM would have to make per-comment on every page
  load, which is a real cost and a real hallucination surface neither
  justified by this tranche's scope nor requested with urgency.
- Friend Highlights™ is a **visual accent on data that already exists**
  (`CommentAuthor.isFriend`, already computed for Friends sort) — not a new
  signal, so it can't be wrong in a way the sort wasn't already trusted for.

---

## 3. The premium comment sheet

`features/social/comment-sheet-shell.tsx` — the ONE glass shell, replacing:

| Old wrapper | Was |
|---|---|
| `comments-sheet.tsx` (feed card) | solid `bg-card`, `h-[85vh]`/`h-[80vh]`, framer spring |
| `reel-viewer.tsx` inline sheet | `bg-card/95 backdrop-blur-2xl`, fixed `h-[68vh]` |
| `image-viewer.tsx` inline sheet | `bg-card/95 backdrop-blur-2xl`, fixed `h-[68vh]`, lower z-index than the reel version |

All three now render `<CommentSheetShell>` and supply only what's actually
different between them (title string, an optional header control — the reel
sheet's video Play/Pause toggle — and an `onOpen` callback for lazy loading).

**Gesture-controlled height**, for real this time — the grabber pill existed
in all three old versions but was decorative (no pointer handler anywhere,
confirmed by grep before writing a line of the new component). The shell
tracks the handle drag into one of three detents (42vh / the caller's default,
usually 68vh / 92vh), snapping to the nearest on release. Dragging down past
the floor detent converts the excess into a damped dismiss translate — the
exact recipe already proven twice elsewhere in this codebase (wallpaper reels'
drag-to-close, the image viewer's swipe-to-dismiss): `dy × 0.6` capped at
260px, ~110px commit threshold, `haptic("light")` on commit, no CSS transition
while the finger is down so it tracks exactly, one on release so it springs
back or snaps. This is intentionally **not** extracted into a fourth shared
hook alongside those two — gesture code in this app has bitten a
previously-shipped feature once already (pinch-zoom, `touchcancel` not
`pointerup`) by being novel; reusing the exact known-good constants inline is
the lower-risk choice a third time.

The drag zone is the handle+header strip only, never the comment list below
it — this sheet doesn't need the "armed only at scroll-top" arbitration the
media viewers do, because the list and the resize handle simply aren't the
same element.

---

## 4. Haptics + reaction bursts — wired, not invented

`lib/motion/haptics.ts` (`haptic()`) is used in 21 other `features/social/*`
files and `features/ui/reaction-float.tsx`'s `floatReaction()` already calls
it — but zero comment file called either before this tranche (confirmed by
grep). Both are now wired into the comment surface:

- Picking a reaction fires `floatReaction(x, y, emoji)` at the tap point — the
  same floating-burst animation the post-level Wow reaction already uses,
  which also fires the haptic, so this is reuse, not a new animation system.
- Pin / Best-answer moderation actions and a successful comment send fire
  `haptic("selection")`.
- The sheet's own drag-to-dismiss commit fires `haptic("light")` (§3).

---

## 5. Editing, labelled multi-pin, Friend Highlights™

**Editing** — genuinely missing before (`app/api/comments/[id]/route.ts` only
had `DELETE`). Migration `0119` adds `edited_at`; `PATCH` is author-only,
enforced at the query level (`.eq("author_id", user.id)`, not just row
existence) — a post owner can delete someone's comment to moderate their own
post, but must never be able to rewrite someone else's words. `canEdit` on
`CommentNode` is deliberately narrower than `canDelete`, which admins and post
owners also get. 🔴 The table's RLS "owner update" policy (`0008`) is broader
than this — it permits a post owner to update any column including `body` via
a direct client call, because it was written for pin/best moderation flags,
not for edit ownership, and Part 5 doesn't touch it. Every write in this
tranche goes through the API's own narrower check, same posture Part 4 already
established for reposts ("RLS is defence against a hand-rolled anon-key query,
not the primary gate") — flagged honestly rather than silently left implicit.

**Labelled, capped multi-pin** — the shipped pin endpoint was a bare boolean
with no cap and no category; sorting had no secondary order among multiple
pinned comments (all fell back to `created_at`, which isn't pin recency). The
brief's own categories (Important/Announcement/FAQ/Update/Contest
Winner/Guideline) imply multiple simultaneous pins are the intended design,
not an oversight to convert into single-pin — so `0119` adds `pin_label` (a
6-value check constraint) and `pinned_at` (orders multiple pins by recency),
and the API caps at `MAX_PINNED = 5` per post, returning a clear 409 the UI
surfaces via a toast rather than silently failing.

**Friend Highlights™** — before this tranche, `CommentAuthor.isFriend` was
read in exactly one place (the Friends-sort tiebreak); nothing in the render
used it. Now a friend's comment bubble gets a faint blue tint/border and a
small `Users` glyph by the name — deliberately subtle (the brief: "without
overwhelming the interface"), not a text badge, not a sort change beyond what
already existed.

---

## 6. Delivery scope for THIS tranche vs. what's still open

This is a Part-2/3/4-scale brief — every prior Part in this feature has taken
multiple tranches across sessions, and this one covers more ground than any of
them (27 numbered sections). Tranche 1 (delivered, §8) is the shell + haptics +
editing + labelled pins + friend accent — the pieces that are self-contained,
don't require a new subsystem, and make every existing mount point feel the
brief's "premium" ask immediately. Nested arbitrary-depth threading, live
comments/typing, comment search, the AI writing assistant, Creator Lounge™,
and comment analytics are real, scoped, **not yet built** — tranches 2–4,
detailed in §8.

---

## 7. 🔴 In the brief, not buildable here — say it, don't fake it

| Asked | Why not (or not yet) |
|---|---|
| Video Reply **recording** | 🔴 **Explicitly removed by the owner on 2026-07-11** ("Live video recording was removed from comments"). Confirmed with the owner before starting this part rather than silently reversing a dated decision: **leave it removed.** Legacy video comments still play back fine (`VideoComment` in `comment-media.tsx`); there is simply no UI to record a new one. |
| GIF Reply | No Tenor/Giphy integration anywhere in the repo (grepped — zero hits). Confirmed with the owner: **skip**, no new third-party network dependency added to the composer. |
| Voice transcription / translation / noise reduction | No speech-to-text provider exists in this codebase — only text-LLM calls, which cannot process audio. Confirmed with the owner: **skip.** Voice comments ship as-is (record/playback/speed-cycle), which was already solid. |
| "Billions of comments / millions of live threads / global synchronization" | Not a testable claim in this environment, and not a schema/index change this tranche makes. Honest version: every comment read here is paginated (400-row cap) and every write is one row — nothing here scales with total historical volume, and nothing here has been load-tested at that scale either. |
| "AI Highlights" sort / "Trending" | No trend computation exists (§2) — the same rule Part 4 applied to reposts. |
| Location comment type | No location-sharing primitive exists in the post/comment stack to attach (messaging has one; comments don't) — a real gap, not attempted this tranche, candidate for tranche 4 alongside Quote Reply and Poll Reply. |
| Business Badge | No "business account" tier exists anywhere in the billing/plan model (`BillingPlan` is `free`/paid tiers only) — a badge with nothing behind it is exactly the failure mode Part 4 already named ("a labelled control with no destination"). |

---

## 8. Delivery — what shipped in tranche 1, and what tranches 2–4 owe

**Tranche 1 — shipped this session:**

| Piece | Where |
|---|---|
| Migration 0119 — `edited_at`, `pin_label` (+ check constraint), `pinned_at` | `supabase/migrations/0119_comment_edit_and_pin_label.sql` |
| One glass `CommentSheetShell` — replaces 3 forked wrappers, gesture height (3 detents) + damped dismiss | `features/social/comment-sheet-shell.tsx`, wired into `comments-sheet.tsx`, `reel-viewer.tsx`, `image-viewer.tsx` |
| Haptics + reaction-burst wiring (react, pin, best, send, dismiss) | `comments.tsx` |
| Comment editing (author-only) | `PATCH /api/comments/[id]`, `comments.tsx` inline edit UI |
| Labelled, capped (5) multi-pin | `POST /api/comments/[id]/pin`, `lib/social/comment-meta.ts` `PIN_LABELS` |
| Friend Highlights™ (subtle visual accent, not a new signal) | `comments.tsx` `CommentItemImpl` |
| `CommentNode` gained `editedAt`, `pinLabel`, `pinnedAt`, `canEdit`; pin sort now orders multiple pins by recency | `lib/social/engagement.ts` |

Verified: `tsc --noEmit` clean project-wide; full `vitest run` — 2002/2005
passing (the 3 failures are `lib/perf/budget.test.ts` reading a stale/missing
`.next` build manifest, pre-existing and unrelated to this tranche — not a
regression it introduced). 🔴 **Not verified in a real browser** — same
standing limitation as every prior Part in this feature; nobody has dragged
the new sheet, pinned a labelled comment, or edited one through the UI yet.

**Tranche 2 — Nested Conversations & Live — shipped this session:**

| Piece | Where |
|---|---|
| Real arbitrary-depth threading — write path no longer flattens to depth 1 | `app/api/posts/[id]/comments/route.ts` |
| Tree assembly already handled any depth once the write-side stopped flattening it — only needed to stop silently dropping a reply whose parent was hidden/deleted (now surfaces at top level instead of vanishing) | `lib/social/engagement.ts` `listComments()` |
| Collapsible threads at EVERY depth (was top-level only), visual indent capped past depth 4 (keeps nesting logically, stops compounding padding), "Jump to parent" (scrolls + a brief highlight ring) | `comments.tsx` `CommentItemImpl` |
| Conversation Flow™ — consecutive same-author replies in a thread visually chain (shared avatar spacer, name/badges suppressed on the follow-up) instead of a fabricated "AI-clustered" grouping | `comments.tsx` (`chained` prop) |
| Live comments — new/edited/deleted rows append/update/disappear without a manual refresh, via `postgres_changes` (already RLS-protected on delivery, so no new authorization policy needed for this half) | `supabase/migrations/0120_comment_realtime.sql`, `comments.tsx` |
| Typing-indicator infrastructure — the existing, hardened `use-typing.ts` (messaging) generalized from a conversation-only hook into a shared `useTypingChannel` core, with a new `useCommentTypingIndicator(postId, …)` thin wrapper and its own Realtime Authorization policy (topic `typing:comments:<postId>`, gated on the post being published — deliberately coarser than `canComment()`'s full predicate, see the migration's own comment) | `use-typing.ts`, `0120_comment_realtime.sql` |

🔴 **Typing indicators are NOT wired into the UI yet** — the hook and its
authorization exist and are ready, but rendering "X is typing…" needs the
viewer's own id + display name available at the `<Comments>` call site, and
today none of its five mount points pass that down (they only resolve
`loggedIn`/`canComment` server-side, never the raw identity, and comments
sit deep in the feed's client component tree where that isn't already
threaded for other reasons). Wiring it is prop-plumbing across
`app/p/[id]/page.tsx`, `post-viewer.tsx`, `reel-viewer.tsx`,
`image-viewer.tsx`, and `comments-sheet.tsx` — real work, correctly scoped
to tranche 3 rather than stretching tranche 2 to cover it. Live comment
*appending* (the higher-value half) needed no such plumbing and is fully
wired.

Verified: `tsc --noEmit` clean; full `vitest run` unaffected (no tests cover
threading/realtime specifically — a gap worth closing before this ships, not
closed this pass). 🔴 **Not verified in a real browser** — same standing
limitation as tranche 1; migrations `0119` and `0120` both still need to be
applied in Supabase before any of this is live.

**Tranche 3 — AI & Search — shipped this session:**

| Piece | Where |
|---|---|
| Typing indicators wired into the UI — the "plumbing gap" tranche 2 flagged turned out to need ZERO new props: `useEntitlements()` already fetches + memoizes `/api/me` process-wide, so `handle`/`displayName` were already available at zero extra cost. Presence key uses `handle`, not a raw user id. | `comments.tsx` (`Comments`, `Composer`) |
| In-thread comment search — keyword/@mention/#hashtag/username, client-side over the already-loaded (≤400-row) tree; self-contained result cards (author/snippet/timestamp) since a match inside a collapsed nested reply can't always be scrolled to | `comments.tsx` (`flattenNodes`, `SearchResultRow`) |
| AI writing assist — Polish (grammar/tone) + Translate (8 language chips), reusing the exact direct-Anthropic-fetch pattern already proven twice (`/api/assistant`, `risk-score.ts`), gated behind `ANTHROPIC_API_KEY`, user-triggered only, always shows a preview with an explicit "Use this" — never silently rewrites a draft | `app/api/comments/assist/route.ts`, `features/social/comment-ai-assist.tsx` (code-split, same reasoning as `ReportSheet`/`PinLabelPicker`) |

Verified: `tsc --noEmit` clean; full `vitest run` — 2002/2005 (same 3
pre-existing budget-artifact failures). 🔴 **Not verified in a real
browser**, and specifically: nobody has watched a real typing indicator fire
between two live browser tabs, or confirmed the AI assist actually returns a
sane result for a real `ANTHROPIC_API_KEY` — the endpoint mirrors a proven
pattern but has not itself been exercised against the live API.

**Tranche 4 — Moderation, remaining types, Creator Lounge™, analytics,
accessibility — shipped this session, closing out Part 5:**

| Piece | Where |
|---|---|
| Keyword filter (account-wide, rejects at post-time) + management UI | migration `0122`, `commentKeywordBlocked()`, `privacy-editor.tsx` |
| Mute-this-commenter-on-my-posts (narrower than a block) + reversible management list | migration `0122`, `POST/DELETE /api/comments/[id]/mute-author`, `GET/DELETE /api/privacy/muted-commenters` |
| Quote Reply — quotes ANY comment on the post, not just the structural parent | migration `0123`, `QuotedCommentSnapshot` resolved from already-fetched rows (no extra query) |
| Location comment type — same Geolocation + free Nominatim reverse-geocode `conversation-room.tsx` already uses for messages | migration `0123`, `Composer`'s `shareLocation()` |
| AI thread summary — third mode on the same assist endpoint | `/api/comments/assist` (`mode: "summarize"`), `comment-thread-summary.tsx` |
| Creator Lounge™ — unanswered questions, active discussions (48h), top-reacted comments, reply rate, most active supporters. Every number is a real count of real rows — no "trending" assertion, no sentiment score (see the module's own header on why that line isn't crossed) | `lib/social/creator-lounge.ts`, `/account/creator-lounge` |
| Accessibility fixes to the shared `GlassSheetShell` | Escape-to-close, body-scroll-lock, initial focus into the dialog — see below |

🔴 **Real gaps found and fixed during this tranche's own cross-check, not by
a separate audit:**
- `GlassSheetShell` had **no Escape-to-close, no scroll-lock, no initial
  focus** — a real regression versus what several of the three forked
  wrappers it replaced already had individually. Fixed; still **not a full
  focus trap** (Tab can still leave the dialog into the page behind it) —
  a real, larger addition, left honestly undone rather than shipped
  half-right.
- A quoted comment's **body text leaked even when the quoted author was
  blocked** — only the identity was being stripped (`author: null`), not
  the text, which defeats the point of the block. Fixed: a quote of a
  blocked author's comment now returns null entirely.
- Creator Lounge read comments **without excluding the creator's own
  blocked users** — a comment posted before a block still exists in the
  table, and `listComments()` already hides it from the creator's view of
  the actual thread; Creator Lounge was re-surfacing it anyway. Fixed.

Verified: `tsc --noEmit` clean; full `vitest run` — 2010/2013 (same 3
pre-existing budget-artifact failures). 🔴 **Not verified in a real
browser or against a live Supabase instance** — migrations `0119`–`0123`
all still need to be applied before any of Part 5 is live.

**Genuinely left undone, flagged rather than faked:**
- **Poll comment type.** Attaching a real poll to a comment needs its own
  table + voting UI (the `post_polls`/`poll_options`/`poll_votes` shape,
  reapplied at comment scope) — a bigger, distinct lift from Quote/Location,
  which both reused existing patterns almost verbatim. Not attempted.
- **A pre-publish approval queue.** Every moderation lever in this app
  (pin/best/delete/report/mute/keyword-filter) is either instant or
  reactive; nothing holds a comment for review before it's visible. A queue
  is a real, different moderation model, not a variant of what exists.
- **Full keyboard focus trap** and a keyboard equivalent for the sheet's
  drag-to-resize gesture (both noted above) — the sheet remains fully
  usable by keyboard (Escape closes, content scrolls, every action is a
  real `<button>`), it just can't be resized or Tab-contained yet.

**Part 5 is now feature-complete against the brief's realistically-buildable
scope** — every section of the original 27-part spec has either shipped
across tranches 1–4, or has an explicit, reasoned entry in §7's "not
buildable" table or the list directly above. Nothing was silently dropped.
