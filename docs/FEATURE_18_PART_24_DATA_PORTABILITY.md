# Feature 18 · Part 24 — Data Portability™ / Digital Ownership Center

Design first, per the standing instruction. What existed, what changed, and what
is deliberately not built.

---

## 1. The audit

| Piece | Where | State |
|---|---|---|
| Data export | `/api/account/export` | Worked. **Nine tables.** |
| Account deletion | `/api/account/delete` | Real: scheduled, 30-day grace, cancellable |
| UI | `features/account/data-controls.tsx` | Download + delete |
| Table catalogue | `lib/platform/data-domains.ts` | **Every** table, grouped into 21 domains |
| Catalogue guard | `data-domains.test.ts` | Fails the build on an uncatalogued table |
| Privacy primitives | `lib/privacy/{ghost,visibility}.ts` | Real |

## 2. The defect

The export hand-listed nine tables: `profiles`, `posts`, `post_comments`,
`follows`, `blocks`, `muted_creators`, `privacy_settings`, `security_audit_log`.

**The personal domains hold ninety-four.**

So the export was never *wrong* — it was **silently incomplete, and getting
worse on its own**. Every table added since was absent, and nothing failed: not
a type, not a test, not a lint rule. Somebody exercising their right to a copy
of their data received a file that looked whole, and neither they nor we had any
way to know what was missing.

That is a compliance problem before it is an engineering one. GDPR Article 20
concerns *all* the personal data relating to the subject, and "we forgot the
table" is not a defence.

## 3. What Part 24 adds

### The registry hangs off the existing catalogue

`lib/portability/registry.ts` declares portability **per domain**, not per
table, against `data-domains.ts`. A new table in a catalogued domain inherits
its domain's decision with no edit anywhere; a new *domain* cannot ship without
one, because `undeclaredDomains()` must be empty.

A second list of tables here would have been the "second registry" this codebase
has removed three times — and would have drifted exactly as the hardcoded export
did.

Three classes:

- **personal** — the member's. Exported.
- **operational** — real data about nobody (locales, flags, published content).
- **restricted** — personal, and deliberately not handed over in bulk.

**Every restriction requires a written justification**, enforced by a test with a
minimum length. "We withheld it" is a claim that needs a reason per domain, not
a category:

- *Messaging* — a conversation belongs to everyone in it. A bulk export hands
  over other people's messages, which they never consented to and cannot object
  to, because they would not know.
- *Moderation* — a bulk export reveals who reported whom. Reporting only works
  while it is not a way to find out who reported you.
- *Verification* — reviewer notes would show anyone how to pass the check. The
  decision and its date are exportable; the working notes are not.

### Owner columns, read out of the migrations

`lib/portability/tables.ts` maps each table to the column holding its owner —
`publisher_id`, `author_id`, `owner_id`, `muter_id`, `id`. Every entry was read
from a real `references auth.users` foreign key, not guessed. Guessing does not
fail loudly here: it returns nothing, or it returns somebody else's rows.

**73 tables exported, 21 excluded with reasons, 0 undecided.**

### 🔴 Secrets never leave the server

The most important list in the feature. An export is a plain file that lands in
a Downloads folder, syncs to a cloud drive, and is often forwarded to whoever
asked for it. Recovery codes, PIN material and private encryption keys inside it
turn data portability into **credential disclosure** — a legitimate request with
a compromised account at the end.

Excluded: `mfa_recovery_codes`, `security_pin`, `user_encryption_keys`,
`webauthn_credentials`, `webauthn_challenges`. A test names each one, so removal
is a deliberate act with a red build rather than a quiet edit.

*"It is their own data"* is true and is not the test. The test is whether handing
it over **in this form** leaves them safer or less safe.

### The file reports its own completeness

`coverage` lists what was included, what was withheld and why, and anything that
failed to read. Seventy-plus queries settle independently, so a missing table on
an unapplied migration is *reported* rather than rejecting the whole export.

A gap somebody can read is a different thing from a gap they cannot: it turns
"is this everything?" from an act of faith into something checkable.

### Data Transparency Dashboard — `/account/data`

Renders from the registry with **no query**: what Frenz stores is a property of
the schema, not of one account, so the page is static and equally correct for
somebody deciding whether to sign up. Four sections: yours and downloadable;
yours but not in bulk (with the reason); never leaves our servers; not about you.

### A staleness bug found on the way

`account.delete` was registered as `status: "planned"` — *"no self-serve deletion
flow yet"* — while the 30-day cancellable flow had been shipped for some time. A
**live feature marked planned** is the mirror of the failure the registry's test
guards (a live setting pointing at a dead route), and nothing catches it. It made
deletion unfindable in Settings search, which for a deletion flow is close to not
having one.

## 4. Not built, and why

- **Backup schedules, snapshots, version history, restore, account migration.**
  All need a job runner and a versioned archive store. There is neither. A
  "backup" that is a button producing today's export is the export with a
  different label.
- **PDF / HTML / Markdown / ZIP exports.** JSON is the format that is lossless
  and machine-readable. The others are presentations of it, and none is useful
  until the data underneath is complete — which is what this part fixed.
- **Selective export by date, person, tag.** The registry makes this reachable
  (the plan is data), but a filter UI over 73 tables needs its own design pass.
- **Smart Data Organizer, AI Data Explainer.** No LLM integration exists.
- **Account archive (pause/hide/resume).** Distinct from Ghost Mode, which is
  real. Needs a lifecycle state the schema does not have.
- **Enterprise exports.** Requires an organisation model this part does not
  introduce.

## 5. Integration

- `lib/settings/registry.ts` — `account.export` and `privacy.transparency`
  added, `account.delete` corrected to live, all pointing at `/account/data`.
- `lib/analytics/pages.ts` — no change; `/^\/account\/.+$/` already owns it
  (checked, not assumed).
- No migration. Part 24 reads what already exists.
