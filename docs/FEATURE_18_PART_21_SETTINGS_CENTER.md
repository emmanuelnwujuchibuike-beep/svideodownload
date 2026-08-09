# Feature 18 · Part 21 — Settings Center™

The design, and the reasoning, before the code.

---

## 0. What is already here

The brief reads as though Frenz has no settings. It has a great many. Before
designing anything I catalogued what exists, because this codebase has a
recorded history of rebuilding services that were already there (the Academy
pass found ~27 of 43 "new" services already implemented).

**22 settings routes already exist** under `app/(app)/account/`: identity,
verification, appearance, notifications, health, profile-type, modules,
layout-studio, business, professional, privacy, relationships, discovery, ghost,
security, password, analytics, plan, developer, appeals, identity/[field].

**Preferences already persist across 6+ domain-owned tables**: `privacy_settings`
(0006), `user_home_preferences` (0040), `notification_settings` (0046),
`account_security_settings` (0055), `chat_appearance_preferences` (0077), plus
profile appearance (0109) and discovery (0113).

**Scores already exist and are real**: `getProfileHealth`, `securityScore`,
`GHOST_SIGNALS`/`ghostedCount`, `getVerificationState`, storage usage via
`features/history/usage.ts`.

So Part 21 is **not** "build settings". It is: *make the settings that exist
findable, explicable, and extensible* — and add the cross-cutting layer none of
them can provide individually.

### The actual defect

`app/(app)/account/page.tsx` declares its 19 rows as a **hand-written array
inside JSX**. That single fact causes everything the brief complains about:

- Nothing can search it — the labels only exist at render time.
- Nothing can summarise it — no other surface can enumerate settings.
- A new setting is invisible unless someone remembers to add a row.
- The same category is described differently in the profile menu and here.

---

## 1. Architecture — a registry, not a runtime

**Decision: the Settings Center is a catalogue that every surface derives from,
not a coordinating service every surface calls through.**

This is the same call `lib/profile/os.ts` made in Part 20, for the same reasons,
and it is worth restating because the brief asks for "reusable preference
services, event-driven synchronization, cloud-native storage":

- A coordinating runtime is a **single point of failure** between a page and its
  data, on a product whose hardest constraint is a 1.6-second cold load.
- Preferences are already correctly sharded: each domain owns its table with its
  own RLS. Collapsing them into one `preferences` blob would **weaken security**
  (one row, one policy, every domain) and create write contention on a hot row.
- A catalogue costs **zero at runtime**, is checked by tests, and answers the
  questions people actually have: what is this, where does it live, who owns it.

```
lib/settings/
  registry.ts     every setting DECLARED — id, category, label, keywords, route
  search.ts       pure ranked search over the registry
  categories.ts   the 24 categories, with their status
```

Each entry names the module that owns the value. The registry **never stores or
writes a preference** — it points at the surface that does. That keeps one
source of truth per preference and makes the registry safe to import anywhere,
including a client component.

### Why entries carry a `status`

`live` · `backend-only` · `planned` · `declined`.

The brief lists categories Frenz does not have (Music, Live Streaming,
Marketplace, Communities, AI Studio, Developer Options). Two honest options:
omit them, or list them as planned. **Listing them as `planned` is better** —
`lib/download-hub` already proved the pattern: declare everything, derive
availability, fail closed. A planned setting appears in search with "not built
yet" rather than returning nothing, which is the difference between a product
that has not shipped a feature and one that appears broken.

`declined` entries carry a **reason**, never "out of scope". This codebase has a
rule against fabricated capability and it applies to settings too.

---

## 2. Smart Settings Search

**Decision: client-side, ranked, synonym-aware, over the registry. No network,
no embeddings.**

The brief says "semantic search … using everyday language". A vector index would
mean a request per keystroke, an embedding model, and a cache — for a corpus of
roughly 200 short strings that fits in a few kilobytes.

Instead the registry carries explicit `keywords` per entry, which is where the
"everyday language" lives: someone types **"dark mode"**, the entry is
*Appearance → Theme*; **"blocked users"** → *Privacy → Relationships*; **"2fa"**
→ *Security → Two-factor*. Synonyms are data, reviewable in a diff, and correct
by construction rather than by whatever an embedding happened to learn.

Ranking, highest first:
1. exact label match
2. label prefix
3. keyword exact
4. label substring
5. keyword substring
6. description substring

Ties break by category order, then alphabetically — never by array position, so
the result list cannot reshuffle between renders.

**Cost:** the registry is ~8 kB of strings. It must NOT ride the landing bundle
(274/275 kB). It is imported only by `/account`, which is a signed-in
`force-dynamic` route with its own budget.

---

## 3. Dashboard

**Decision: surface the scores that already exist. Compute nothing new.**

Profile Health, Security Score, Privacy (ghosted-signal count), Storage, Plan and
Verification are all already computed and already correct. The dashboard is a
*view*, and every tile links to the surface that owns it.

Deliberately **not** invented: a "Settings Score". There is no defensible
definition of a well-configured account, and a number with no meaning is exactly
the kind of confident-wrong metric the analytics audit spent a day removing.

---

## 4. Quick Settings (pinning)

**Decision: device-local first (`localStorage`), synced later.**

A pinned set is a UI preference about *this* screen. Making it a server round-trip
means the settings page cannot render its most-used controls until a fetch
returns — on the one page people open when something is already annoying them.
The storage key is namespaced so a future sync can adopt it without a migration.

---

## 5. Automation Rules™ — designed, NOT built

Trigger (time / sunset / focus / device) → condition → action (a registry entry
plus a value).

**Why it is not in this pass, stated plainly rather than quietly dropped:**

1. It needs a scheduler. "Dark mode at sunset" and "pause notifications while
   sleeping" require either a background job per user or a client that is open at
   the moment the rule fires. Frenz is a PWA — it is not running at 10pm.
2. Server-side evaluation means a cron over every user with a rule, which is a
   new operational surface and a real cost.
3. It writes to six different domain tables, so it needs the registry to exist
   **first** — which is precisely what this part builds.

The honest sequencing is: registry now, automation on top of it. Building a
half-scheduler that silently misses rules would be worse than not shipping it,
because a rule that fires unpredictably is indistinguishable from a bug.

---

## 6. Backup / Restore / History — designed, NOT built

Part 20 already solved this exact shape for the profile
(`0114_profile_versions.sql`): **whole snapshots, not a diff chain** — one
corrupt entry in a chain poisons everything after it; a snapshot is a few hundred
bytes and independently valid. Settings history should reuse that design
verbatim.

It is not built here because it needs a migration, and **0107 → 0115 are all
still unapplied**. Adding a tenth pending migration to a stack nobody has run
makes the stack less likely to be run, not more.

---

## 7. AI Settings Assistant — designed, NOT built

The registry is deliberately shaped to make this cheap later: every entry has a
label, a description, keywords, an owner and a route, which is exactly the
context an assistant needs to answer "where do I turn off X" without any new
data model.

Two rules it must follow when built:
- **Explains and navigates; never writes.** A settings change made on a user's
  behalf by a model is the one thing that is not reversible by reading the
  screen.
- **Optional and off by default**, per the brief.

---

## 8. What this pass delivers

| Item | Status |
|---|---|
| Settings registry (24 categories, every setting declared) | **Built** |
| Smart Settings Search + ranking | **Built, tested** |
| Settings Center UI derived from the registry | **Built** |
| Dashboard over existing scores | **Built** |
| Quick Settings / pinning | **Built** (device-local) |
| Automation Rules | Designed · needs a scheduler |
| Backup / Restore / History | Designed · needs a migration (0107–0115 pending) |
| AI Assistant | Designed · registry shaped for it |
| Universal Preference Sync | Partial — domain tables already sync; pins are local |

Everything not built says so on this page and in the registry, rather than
appearing as an empty screen.
