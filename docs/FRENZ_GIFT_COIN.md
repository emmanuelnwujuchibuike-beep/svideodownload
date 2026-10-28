# Frenz Gift Coin (FGC)

Frenz Gift Coin is the currency members spend on gifts. It is a separate wallet product beside Frenz Coin (FC) and is made only by converting FC. This document covers what is built, part by part.

| Part | State |
|---|---|
| 1 · Audit | Done (it set the ground rules: reuse `ai_product_balances` / `ai_product_ledger`, the FC guards, versioned rules, append-only records). |
| **2 · Accounting and conversion engine** | **Built 2026-10-27, local, not pushed. Migration `0290_frenz_gift_coin_conversion.sql` still has to be run, after 0284.** |
| **3 · Admin configuration and sticker catalogue** | **Built 2026-10-27, local, not pushed. Migration `0291_frenz_gift_settings_stickers.sql` still has to be run, after 0290.** |
| **4 · Sticker gifts in chat, earnings hold and release** | **Built 2026-10-27, local, not pushed. Migration `0293_frenz_gift_sends.sql` still has to be run, after 0292.** |

## Part 2 — accounting and the conversion engine (0290)

### Units and storage

| | Product | Currency | Unit |
|---|---|---|---|
| FC | `frenz_coin` | `USD` | integer US cents. 1 FC = $1 = 100 cents. Unchanged. |
| FGC | `frenz_gift` | `FGC` | integer FGC minor units. 1 FGC = 100 minor units. |

There is still one balance table and one ledger, with one row per member per product. The columns are still called `*_cents` (a historical name). Constraints keep each FGC row in `FGC`, with no withdrawable or deposited part. An FGC row may carry `pending_cents` / `held_cents` the same way FC does, and `available = balance − pending`.

FGC ledger rows may only use the kinds `conversion_in`, `conversion_out`, `conversion_fee` and `adjustment`. So FGC has no recharge, reward, deposit or withdrawal of its own. AI Credits can never carry a conversion row.

### A conversion (`convert_fgc`)

`convert_fgc(user, direction, amount, idempotency_key, rules, expected_version)` runs as one transaction, with service-role access only.

Each direction has its own leg in the rules: `rateNum`, `rateDen`, `feeBp`, `feeFlat`, `minIn`, `maxIn` and `dailyMaxIn`. Amounts are in input units, and the fee is in output units.

```
gross     = floor(input × rateNum / rateDen)        output units, rounded DOWN
remainder = input × rateNum − gross × rateDen        what the floor dropped, 0 ≤ r < rateDen
fee       = ceil(gross × feeBp / 10 000) + feeFlat    output units, the percent part rounded UP
net       = gross − fee                               must be ≥ 1, otherwise "below_fee"
```

Every rounding step favours the platform. The `fgc_conversions` table checks this on every row: the floor (`input·num = gross·den + remainder`) and the fee ceiling are both table constraints.

The function runs in this order:

1. **Validate the request.**
2. **Check for a replay.** A key that was already used returns the original result, even if the rules have changed or been removed since. The same key with a different amount or direction returns `idempotency_conflict`.
3. **Check the rules** with `fgc_conversion_rules_check`. Missing rules return `config_missing`. Malformed rules return `config_invalid` (the detail names the field). Rules that allow arbitrage return `config_invalid` with the detail `config_arbitrage`.
4. **Check the version.** If `expected_version` (the version the member was shown) is not the current one, the call returns `rules_changed`.
5. **Check the amount** against min/max, and against the fee (`below_fee`).
6. **Lock both wallets** in a fixed order: product (`frenz_coin` before `frenz_gift`), then user id. This matches FC's existing user-id order, so conversions and transfers never deadlock. The real-concurrency test covers this.
7. **Re-check under the lock:** the replay, the account standing (`coin_wallet_block_reason`: suspended, restricted, or an FC shortfall owed), the rolling 24-hour input total for this direction, and the **available** input balance.
8. **Write it:**
   - Input product: `conversion_out −input`.
   - Output product: `conversion_in +gross`, and `conversion_fee −fee` when the fee is greater than 0. The balance moves by the net amount.
   - Fee income goes to `platform_fee_ledger` once (`fc_to_fgc_conversion_fee`, unit FGC, or `fgc_to_fc_conversion_fee`, unit USD).
   - Then the `fgc_conversions` record and a `financial_audit_log` entry.

Pending FC (deposits on hold) and held FC (open withdrawals) are never converted. Pending FGC (Part 5's gift earnings on hold) will not be converted either, because only `available` converts. Released earnings and FGC the member bought with their own FC convert back freely. There is no rule against converting purchased FGC back to FC.

### The record (`fgc_conversions`)

Each row stores:

- the id, member and direction
- the input currency and amount, and the output currency
- `rate_num` / `rate_den`, the gross output and `rounding_remainder`
- `fee_bp`, the percent and flat parts, the fee amount and fee currency
- the net output
- `config_version` and the full `rules_snapshot`, including the quote
- the idempotency key and the status (`completed`)
- `created_at`
- `debit_ledger_id`, `credit_ledger_id` and `fee_ledger_id`

The table is append-only (`financial_append_only_guard`), has no foreign key to `auth.users` (history outlives an account, per 0278), and is service role only. There is no pending status, because both sides post in one transaction and a failure writes nothing.

### Arbitrage check

Leg A is `fcToFgc` (rate a/b, percent fee p1 = bp1/10 000, flat fee f1). Leg B is `fgcToFc` (c/d, p2, f2).

A floor is never more than the exact value, and a ceiling fee is never less than the exact percentage. So one leg returns at most `in × rate × (1 − p) − flat`. The bound is linear for each leg, so any round trip returns at most this, however the conversions are split or merged:

```
X × K − L,   K = a·c·(10 000 − bp1)·(10 000 − bp2) / (b·d·10⁸),   L > 0 whenever a flat fee is > 0
```

**A rule set is valid only when K < 1, or K = 1 with a flat fee above 0.**

- **K = 1 with no flat fee:** a round trip breaks even on exact multiples of the amount (x = b·d·10⁸·t).
- **K > 1:** a round trip gains on any amount large enough that the bounded rounding loss (less than 2 units per leg, plus the flat fees) is smaller than x·(K − 1).

The check deliberately ignores the min/max limits, because limits change and conversions can be split. K and the condition on L are symmetric, so one check covers both directions of round trip. Everything is computed exactly, in `numeric` in SQL and `BigInt` in TypeScript. A refused rule set is never adjusted: the admin is told the effective percentage it keeps (`arbitrageReason`).

These cases are tested at the boundary:

| Rule set | K | Result |
|---|---|---|
| 1:1 both ways, no fee | 1 | refused |
| 100:1 then 1:100, no fee | 1 | refused |
| 10000/9000 with 10%, then 1:1 | exactly 1 | refused |
| the same with a 1-unit flat fee | 1, L > 0 | valid |
| 10001/10000, then 1:1 | > 1 | refused |
| the same with 1 bp | 0.99999999 | valid |

Two exhaustive searches back this up. On 120 random rule sets (in PGlite) and 300 (in TypeScript), no valid rule set has any round trip of up to 3,000 / 2,000 units that returns at least what went in. Every refused rule set has K ≥ 1.

### Configuration

The engine takes its rules from the server, never from the member. `lib/gift/conversion.ts → loadConversionRules()` reads `frenzGift.conversion` from the `landing` settings row and checks it with `checkConversionRules`, which is strict: it never clamps or fills in defaults. The database checks the rules again.

No production rates, fees or limits exist anywhere in the code. Until valid rules are saved there, every conversion returns `config_missing` (HTTP 503, "isn't configured yet") and nothing moves. This is a missing configuration, not an off switch. The route also respects the existing `frenzCoin.enabled` switch.

**Part 3 must:**

- write `frenzGift.conversion` with the shape `{ version, fcToFgc: {…}, fgcToFc: {…} }`
- go through `setLandingSettings`, so changes are versioned (bump `version` whenever anything that prices or limits a conversion changes) and audited like `frenzCoin`
- validate with `checkConversionRules` before saving, and show `message` to the admin

`setLandingSettings` currently rebuilds the row from known keys only. Part 3 has to add `frenzGift` to `LandingSettings`, or an unrelated admin save will drop it (which falls back to `config_missing`, so it fails safe).

### Corrections and account deletion

- `adjust_gift_balance` is the FGC twin of `adjust_coin_balance`. It is signed, carries an admin and a reason, applies once per reference, never goes below the available balance, and is recorded in `financial_audit_log`. There is no admin route for it yet.
- `account_financial_blockers`, restated word for word from 0280, now also returns `gift_balance`, so FGC blocks an account purge.

### Security

- **Grants.** Every new function is revoked from `public`, `anon` and `authenticated`, and only the service role may execute it. `fgc_conversions` is revoked from the API roles. This was tested with Supabase's default grants applied first.
- **RLS.** The existing `select_own` policies on balances and ledger mean a member sees only their own FGC rows and can write nothing.
- **The guard.** `gift_wallet_guard` (flag `frenz.gift_writer`) refuses any FGC balance or ledger write outside the 0290 functions. The FC guard (`frenz.coin_writer`) is unchanged. The FC flag cannot write FGC, and the FGC flag cannot write FC.
- **The route.** `POST /api/gift/convert` requires a session and is rate limited per member. The body is `{ direction, amount, idempotencyKey, expectedVersion? }` and is strict, so it cannot carry a rate, fee or output.

### Tests (Part 2)

| Suite | What it covers | Result (2026-10-27) |
|---|---|---|
| `supabase/tests/0290_fgc_conversion.pglite.mjs` | Real migrations 0278–0284 + 0290, each applied twice, with Supabase default grants. All 15 required areas. | 142/142. All 7 mutants fail it. |
| `supabase/tests/fgc_conversion_concurrency.pg.mjs` | Real PostgreSQL 17, separate connections, forced overlaps, bursts. Overspend, a double-clicked retry, a conversion racing a transfer in both orders, both directions at once, the daily limit, and a 16-connection mixed burst (deadlock check). | 23/23. The `no-lock` mutant fails 11 checks. |
| `lib/gift/conversion-rules.test.ts` | TS quotes, strict validation, arbitrage, exhaustive search. | pass |
| `lib/gift/conversion-sql.server.test.ts` | TS ≡ SQL on 600 quotes and 400 rule verdicts (skips without PGlite). | pass |
| FC regression | The 0278–0284 suites as they are, and 0280 / 0283 / 0284 plus the FC concurrency harness again with 0290 stacked on top. | all pass |

To run them, follow `docs/HANDOFF.md` §2: PGlite lives in `%TEMP%\node_modules`, and the `.pg.mjs` harnesses need `embedded-postgres` and `pg` in a scratch folder.

### Open owner decisions

- **PIN.** A conversion stays inside the member's own wallets, so no transaction PIN is asked for. Sending a gift (Part 4) moves value to someone else and should use the PIN, like FC transfers.
- **Fee side.** The fee is taken from the output (in the output currency), as the brief describes ("calculate the gross output, apply the fee"). If the owner wants the fee taken from the input instead, that is a change to `fgc_conversion_quote` plus a new rules version.

## Part 3 — admin configuration and the sticker catalogue (0291)

### Settings persistence

The conversion rules live in the `landing` settings row as `frenzGift`: `{ conversion: { version, fcToFgc, fgcToFc } | null, updatedAt, updatedBy }`. `conversion: null` means not configured, and nothing is ever filled in.

- **Read:** `getLandingSettings().frenzGift` (`lib/gift/settings.ts`, `normalizeGiftSettings`). A stored value that fails `checkConversionRules` is reported as `problem` and treated as not configured. It is never repaired.
- **No other save can lose it.** `setLandingSettings` now writes through `save_landing_settings`, which stores `stored || (value − frenzGift)` in one statement. Every key a save sends replaces its stored value, while `frenzGift` and any key the build doesn't know are kept, even when two admins save at once. `frenzGift` is not in `LandingSettingsPatch`, and the landing route strips unknown keys. Before 0291 runs, a fallback reads the row and writes it back merged the same way.
- **Its only writer** is `save_frenz_gift_conversion` (`lib/gift/settings-server.ts` → `POST /api/admin/gift/settings`).

### Validation and versioning

- **One validator.** `checkConversionRules` (TS) and `fgc_conversion_rules_check` (SQL) are the same check; `lib/gift/conversion-sql.server.test.ts` compares them on 400 rule sets. 0291 adds one rule to both: the smallest allowed conversion of each leg must leave at least 1 unit after fees (`<leg>.minNet`).
- **Checked twice.** The route checks with the version that would be stamped, then the database checks again under a row lock.
- **Versioning.** The admin sends the version being edited (0 when unconfigured).
  - A different stored version is refused as stale (409).
  - Identical legs are answered as unchanged: no version bump and nothing written.
  - Any change to a rate, fee, minimum, maximum or daily limit is stored as `version + 1`.
  - Only the seven fields of each leg are stored, and the client can't choose the version.
- **Conversions.** `convert_fgc`'s `expectedVersion` still refuses a quote shown under an older version (`rules_changed`). Each conversion keeps its own snapshot.
- **The round-trip figure** is `roundTripPercent` (from `roundTripFactor`: rates and percentage fees, the most a round trip can keep), shown next to `roundTripExample` (one real ≈$100 round trip with the engine's integer rounding and flat fees).

### Admin UI

Admin → Frenz Coin gains two tabs, **Gift Coin** and **Stickers** (`features/admin/frenz-gift/`). They load on demand, use the console's own components, and share its password prompt.

The **Gift Coin** tab shows:

- for each direction: the rate as an exact fraction (with a decimal preview), the percentage fee and flat fee (each labelled with the currency it is taken from, which is what the conversion produces), and the per-conversion and daily limits in the input currency
- a status badge (Configured · version / Not configured)
- live validation with the server's own message, the round-trip percentage and an example
- Discard, a browser warning when leaving with unsaved edits, and a success message only after the server's read-back

All text is parsed exactly; more decimals than the unit allows is an error, never rounded.

### Sticker catalogue

**Tables.**

- `gift_stickers`: slug (fixed once created), name, description, rarity (common/rare/epic/legendary), `price_fgc` (FGC minor units), `image_url` (static), `animation_url` (optional), category, featured, published, sort order, `archived_at` and revision.
- `gift_sticker_revisions`: every state each sticker has had, append-only.

The fields follow `design/sticker-gifts.html`: rarity tags, category chips, the featured banner, and a static frame in the grid.

**How writes work.**

- `admin_save_gift_sticker` is the only writer, enforced by a trigger and a writer flag. It validates every field (the price above all), refuses a stale revision and requires artwork to publish. Archiving unpublishes the sticker and keeps it; it can be restored. Each change writes a revision plus `financial_audit_log` and `config_audit_log` rows in the same transaction.
- Stickers are never deleted (trigger, plus the revision foreign key).
- Part 4 must sell only through `gift_sticker_offer(id)` (published and not archived) and record the sticker id **and revision** on each gift, so a later edit, re-price, unpublish or archive never rewrites what a gift was.

**Artwork.** `POST /api/admin/gift/stickers/artwork` accepts PNG, WebP, GIF or JPEG up to 8 MB. `sharp` re-encodes it to a 512 px WebP with transparency, plus an animated WebP when the input is animated. Files go to the existing public `ai-showcase` bucket under `gift-stickers/`, so there is no new bucket or package. Objects are never deleted, so old revisions keep their artwork.

### Audit

| Event | Where | What it records |
|---|---|---|
| Rules saved | `financial_audit_log` `gift_conversion_config_updated`, plus `config_audit_log` surface `frenz_gift` | admin, before, after, version, validation outcome (app and database checks, round-trip percentage), time |
| Rules refused (stale, invalid, arbitrage) | `gift_conversion_config_rejected` | the reason (the app's own refusals are recorded by the route) |
| Sticker created or changed | `gift_sticker_created` / `gift_sticker_updated` | before, after, what changed, revision |
| Step-up refusals | `admin_step_up_required` | as before |

No secrets are logged.

### Authorization

Reading needs an administrator (`getAdminUser`). Saving rules or stickers needs an administrator with a fresh password (`requireFinancialAdmin`). Every 0291 function and table is service role only, which was tested with Supabase's default grants applied.

### Tests (Part 3)

| Suite | Result (2026-10-27) |
|---|---|
| `supabase/tests/0291_gift_settings_stickers.pglite.mjs` (real migrations 0278–0291, each applied twice) | 86/86. All 6 mutants fail it. |
| `lib/landing/financial-settings.server.test.ts` (landing, Frenz Coin, reward and AI saves keep `frenzGift` and unknown keys, including the pre-0291 fallback) | pass |
| `features/admin/frenz-gift/gift-admin.test.ts`, `app/api/admin/gift/gift-admin-routes.test.ts`, `lib/gift/*` | pass |
| Regression: 0290 suite, and 0283 FC closeout with 0290 + 0291 stacked | 142/142, 79/79 |

### Notes

- **Rules that are now invalid.** Under 0291, a rule set whose smallest conversion yields nothing after fees is invalid. For example, `minIn: 1` with a 2% fee: gross 1, fee rounded up to 1, net 0. Part 2's test-only rules include such sets; its suite runs 0290 alone, so it still passes.
- **Direct writes to `settings`:** closed by 0292 (below).

## Part 3 security follow-up — financial configuration can only change through its audited writers (0292)

### The bypass

0001 gave `settings` the policy `"settings admin all"`, written as `for all using (is_admin())`. Supabase grants every public table to `anon` and `authenticated` by default. Together, that let any administrator use their own browser session to insert, update or delete the `landing` row through the REST API (`/rest/v1/settings`).

From there they could rewrite `frenzGift.conversion`:

- with no validation (arbitrage-prone rules included)
- with no version check or stale-edit protection
- with no audit row

The same path also exposed `frenzCoin` and `frenzRewards`. The PGlite suite reproduces this on the pre-0292 schema.

Separately, nothing in the database stopped a service-role write, such as a stale read-merge-write, from replacing `frenzGift`; only application code did.

### What was audited

- **Policies:** only `"settings admin all"` (0001).
- **Grants:** Supabase's defaults (all privileges, including TRUNCATE) for `anon` and `authenticated`.
- **Triggers:** `reward_config_sync_trg` (0189), which only reads.
- **SQL writers:**
  - 0159 and 0255: one-off migration blocks that merge, so other keys are kept.
  - 0291: `save_landing_settings` and `save_frenz_gift_conversion`, both service role only.
- **App writers:** every `settings` write in the app uses the service-role client. None uses an admin session, and nothing in the browser writes it.
- **Landing route:** strips unknown keys, so it can't send `frenzGift`.

### What closes it (0292)

1. **No API role writes `settings`.** The policy becomes `"settings admin read"` (select only, still `is_admin()`), and insert, update, delete and truncate are revoked from `anon` and `authenticated`. Administrators read exactly as before, and every legitimate writer is the service role, which RLS does not apply to.
2. **`settings_gift_guard`** is a row trigger (before insert, update, delete). It lets the landing row's `frenzGift` change only when the transaction-local flag `frenz.gift_settings_writer` is on **and** the current role is not `anon`, `authenticated` or `service_role`. That combination exists only inside the security-definer `save_frenz_gift_conversion`. Setting the flag from an API or service-role session doesn't open it.

   Refused, whoever asks: changing or removing `frenzGift`, deleting the row that holds it, renaming its key, replacing the value with a non-object, and an upsert that replaces it. Other keys and other rows are untouched.
3. **`settings_truncate_guard`** refuses TRUNCATE (row triggers don't fire on it), even for the service role.
4. **`save_frenz_gift_conversion`** is restated word for word, with the flag set only around its one update. It still locks the row, refuses a stale version, validates, bumps the version only for a change, and writes `financial_audit_log` and `config_audit_log` in the same transaction.

A stale read-merge-write that carries an old `frenzGift` (the pre-0291 fallback racing a gift save) is now **refused**, never applied silently.

### Tests

| Suite | Result (2026-10-27) |
|---|---|
| `supabase/tests/0292_protect_financial_settings.pglite.mjs`: production's policy, `is_admin()`, default grants and a BYPASSRLS service role | 44/44. Before 0292, an admin session rewrites `frenzGift` with no audit (bypass proven). After 0292: admin, member and anon writes and truncates are refused while admins still read; service-role code can write every other key and row but none of the `frenzGift` changes listed above, even after setting the flag itself; the legitimate writers still work. All 4 mutants fail it (`admin-write`, `no-guard`, `trust-service`, `no-truncate-guard`). |
| `supabase/tests/gift_settings_concurrency.pg.mjs`: real PostgreSQL 17, separate connections, forced overlaps confirmed in `pg_stat_activity` | 14/14 (detailed below). The `no-lock` mutant fails (12 of 12 "won", duplicate audit rows). |
| Regression: 0290 suite; 0291 suite; 0283 FC closeout with 0290 + 0291 + 0292; vitest (settings, gift, registries) | 142/142; 86/86; 79/79; 413/413 |

The concurrency harness covers:

- a gift save against a landing save, in both orders: both changes survive
- two gift saves over the same version: one wins, the other is stale
- a stale read-merge-write, both after a gift save and in forced overlap: refused
- a burst of 12 landing saves plus 12 gift saves: exactly 1 gift save wins, 11 are stale, all 12 landing keys survive, and there is one audit row
- an authenticated write: permission denied

### Limits

- A database superuser (the owner who runs migrations) can still do anything, including disabling triggers. That is outside the API's threat model.
- `frenzCoin` and `frenzRewards` are now protected from direct API writes too (point 1). Within service-role code they are still guarded by the app's audit-first `setLandingSettings` rather than by a database trigger.

## Part 4 — sticker gifts in chat (0293)

### Rules (`landing.frenzGift.gifting`)

The rules object is `{ version, recipientShareBp, commissionBp, holdHours, senderCooldownHours, dailyMaxFgc }`.

- **Validation.** `checkGiftingRules` (TS) and `gift_rules_check` (SQL) are the same check; `lib/gift/gifting-rules.test.ts` compares them on 300 rule sets. Share plus commission must equal exactly 10 000 bp, the share must be at least 1 bp, the hold must be 1–2160 h (earnings are never spendable at once), and the cooldown 0–2160 h.
- **Single writer.** `save_frenz_gift_gifting` is the only writer. It checks the version, validates, bumps the version only when something changes, writes `financial_audit_log` and `config_audit_log` in the same transaction, and runs under the 0292 settings guard. The admin route is `POST /api/admin/gift/gifting` (fresh password).
- **Off until saved.** There are no defaults in code; gifting is off (`gifting_not_configured`) until an admin saves rules. The proposed first values are 90 % / 10 %, a 72 h hold, no flat commission, plus an admin-chosen cooldown and daily limit.

### Arithmetic

- Recipient share = `floor(price × recipientShareBp / 10000)`; commission = price − share.
- Example: 50.00 FGC at 90 % gives the recipient 45.00 and a 5.00 commission. 10.01 FGC gives 9.00 and 1.01.
- If the share rounds to 0, the gift is refused (`below_minimum`).

### The transaction (`send_gift_with_pin` → `send_gift`)

Everything below happens in one transaction:

1. **PIN.** `coin_pin_check` runs with purpose `gift`, and the attempt is consumed here. A proof begun for a transfer can't authorize a gift.
2. **Replay.** A replay returns the original gift; a different body under the same key is `idempotency_conflict`.
3. **Rules** are checked.
4. **Conversation.**
   - Secret chats are refused.
   - The sender must be an active member, and allowed to send if the group is admins-only.
   - Direct chat: the recipient is the other member.
   - Group chat: the recipient must be chosen and must be a member.
   - No block in either direction, the recipient must not be suspended, and the sender can't gift themselves.
5. **Sticker.** It must be published and not archived, **at the revision and price the member was shown** (otherwise `sticker_changed`, returning the current values). The sticker row is read `for share`, so an admin edit and a gift serialize.
6. **Locks.** Both FGC wallets are locked in user-id order.
7. **Under the lock:** replay re-checked, sender standing (`gift_send_block_reason`), the sender's due earnings released, the daily limit, then **available** FGC.
8. **Ledger:**

   | Who | Kind | Amount | Status |
   |---|---|---|---|
   | Sender | `gift_sent` | −share | settled |
   | Sender | `gift_fee` | −commission | settled → `platform_fee_ledger` `gift_commission`, once |
   | Recipient | `gift_earning` | +share | **reserved** (pending until `hold_until`) |

`gift_sends` stores the sticker id and revision (a foreign key into `gift_sticker_revisions`), price, share, commission, basis points, hold and `hold_until`, the rules version and snapshot, a sticker snapshot, the conversation, the message client id (`gift-<id>`), the key, the status and the ledger ids.

- **Constraints** check the arithmetic, the split, the hold and the state machine.
- **Immutability:** a guard allows only status changes, pending → released or reversed.
- **Access:** sender and recipient can read via RLS; nobody writes through the API. `send_gift` itself is callable by no API role, not even the service role; only the PIN wrapper reaches it.

### The chat message

- After the commit, the server posts the message through the ordinary `sendMessage`. The client id is `gift-<id>`, the metadata kind is `gift`, and the snapshot fields are included.
- The gift record is the idempotency anchor: a retry returns the same gift and re-posts with the same client id, which `sendMessage` answers with the message it already made.
- `messages_gift_guard` refuses any `gift` message that doesn't match a real gift from that sender in that chat with its own client id, and refuses edits to one. This closes direct inserts under the 0052 `messages sender insert` policy as well.

### Earnings: hold, release, conversion, withdrawal

- Earnings are pending (`pending_cents`), so they can't be spent, gifted or converted until released.
- **Release** (`release_gift_earnings`), with no cron. Under the recipient's wallet lock, each due gift moves from reserved to settled exactly once (the lock plus a conditional status change). It runs lazily:
  - inside `send_gift` (the sender's own earnings)
  - in `gift_wallet_summary` (the gallery's wallet read)
  - before every FGC→FC conversion (`lib/gift/conversion.ts`)
- **Payout path:** available FGC → `convert_fgc` (`fgc_to_fc`, the configured rate and fee) → FC → the existing FC withdrawal. **There is no FGC bank withdrawal, no separate gift payout, and no minimum, account-age or approval gate on gift earnings.**

### Chargebacks and provenance

- **Provenance isn't reliable.** FC is fungible (deposits, transfers, rewards, corrections, conversions), and `fgc_conversions` records no source deposit, so a gift can't be traced to a deposit. Nothing claims otherwise.
- **Conservative guard on senders** (`gift_send_block_reason`): no gifting while the FC wallet is suspended, restricted or owes a recovery (0281), while a deposit dispute is open, while any deposit is still held or disputed, or within `senderCooldownHours` of a deposit settling.
- **Freeze, not reversal:** a recipient's pending earnings from a sender who is under review (`gift_sender_frozen`) are not released.
- **Admin reversal** (`reverse_gift`): an audited admin decision, for a PENDING gift only, applied once. It takes back the recipient's pending share, refunds the sender the full price in FGC (where the existing recovery and `adjust_gift_balance` can reach it), and reverses the commission (`gift_commission_reversal`). The Admin → Frenz Coin → Gift Coin tab lists pending gifts, with past-hold ones flagged as under review.
- **Released earnings are never clawed back automatically.** An unrecoverable loss stays visible as the existing coin deposit shortfall (0280) and in `financial_audit_log`.

### UI

- **Chat:** the attachment sheet (`MediaComposerSheet`) gains a "Gift" entry beside "Credits". It is absent in secret chats and in admins-only groups for members.
- **Gift sheet:** `features/gift/gift-sheet.tsx` loads on demand. It shows the FGC balance and pending earnings, category chips, a featured banner, a 3-column grid with rarity tags and still frames, then confirmation (recipient picker in groups, price, available balance, PIN) and the send.
- **Gift bubble:** `features/gift/gift-bubble.tsx` replays its bounce on tap and falls back to "Sent a gift".
- **States:** loading, empty, error/retry, not configured, insufficient balance (with how to convert), sticker changed (the new price must be confirmed), unavailable, PIN failure, blocked, and network error.
- **Admin:** Gift Coin → Sticker gifting (share %, hold, cooldown, daily limit, with expected-version save and an unsaved-change warning) and Pending gift earnings (reverse with a reason).

### Tests (Part 4)

| Suite | Result (2026-10-27) |
|---|---|
| `supabase/tests/0293_gift_sends.pglite.mjs` (real migrations 0278–0293, each applied twice) | 104/104. All 8 mutants fail it: `no-pin`, `spend-pending`, `no-revision`, `no-block`, `early-release`, `double-release`, `forge-message`, `frozen-release`. |
| `supabase/tests/gift_sends_concurrency.pg.mjs` (real PostgreSQL 17, forced overlaps) | 19/19 (corrected in Part 5; first reported as 20/20). The `no-lock` mutant fails (double charge, duplicate key, deadlock). |
| vitest: `lib/gift/gifting-rules.test.ts` (with the SQL cross-check), `features/gift/gift-format.test.ts`, `app/api/gift/gift-routes.test.ts` | pass |
| Regressions: 0290, 0291 and 0292 suites; 0283 FC closeout with 0290–0293 stacked | 142, 86, 44, 79, all pass |

### Limits

- **No push notification for gifts.** The gift message goes through `sendMessage` (chat realtime and badges) but not the `/api/messages` route's push fan-out, so a recipient who isn't in the chat sees it on their next visit.
- **No full-screen reveal or Gift Box yet.** The recipient reveal, the Gift Box history screen and the top-up shortcut from your design brief are UI work still waiting for your OK on that brief's plan.
- **Static grid frames.** Animated stickers play in the confirmation and the bubble.

## Part 4.1 — gift notifications by push and email (0294)

### Switches

**Settings → Notifications → "Sticker gifts"** (`/account/notifications`, `features/account/gift-notification-settings.tsx`) has two switches:

- **Gift push notifications**: `notification_settings.gift_push`
- **Gift emails**: `notification_settings.gift_email`

How they behave:

- **Both default to on**, the same policy as every other per-event switch here (category defaults, 0262 `message_email`, 0253 `optional_email`).
- **Independent:** each is saved on its own through `PATCH /api/notification-settings` (`giftPush` / `giftEmail`), only for the signed-in member's row. Changing one never writes the other.
- **The global controls still apply on top.**
  - Push: the master and push switches, the premium category, quiet hours, delivery rules, lock-screen privacy and device permissions (`sendSmartPush`).
  - Email: the global optional-email switch, because a gift email is optional email (`gift_received`).
- **The gift itself is unaffected.** The chat message and wallet earnings are there whatever the switches say.

### Dispatch

1. **Outbox.** A trigger on `gift_sends` writes two `gift_notifications` rows (push, email) in the **same transaction** as the gift. A refused or rolled-back gift has none, and a replayed request adds none. `send_gift` (0293) is unchanged.
2. **After the response.** `POST /api/gift/send` calls `after(() => dispatchGiftNotifications(giftId))`, so no provider is ever called inside a financial transaction.
3. **Per channel** (`lib/gift/gift-notify.ts`):
   - `claim_gift_notification`: one caller wins. Due means pending, failed with attempts left, or a claim older than 15 minutes. A reversed gift is recorded `skipped (reversed)` and never announced.
   - Check the member's switch (off → `skipped (preference_off)`).
   - Send:
     - Push: `sendSmartPush` (`already-recorded`, since the chat message is the in-app record), deep-linking to `/messages/<conversation>`. The body names the sender by public name and the sticker; the lock-screen text is "You received a sticker gift."
     - Email: `emailMember(kind gift_received)`. Subject "You received a sticker gift on Frenzsave", the sender's photo, name and handle, an "Open the chat" button, and a "Manage notification settings" footer link. Every dynamic string is escaped, it goes to the account's own address, and it carries a one-click unsubscribe.
   - `finish_gift_notification`:
     - **sent** only when a push service or Resend **accepted** it. `sendPushToUser` / `sendSmartPush` now return `{ devices, accepted }`.
     - **skipped** when a switch or global rule said no, there's no device, or there's no address.
     - **failed** when refused.
4. **Retries.** The existing 10-minute `ai-reconcile` cron runs `sweepGiftNotifications`. It picks up rows the after-response step never reached (pending for more than 2 minutes), failures with attempts left (at most **3 tries**, then they stay `failed` and visible), and stale claims. There is no new cron or worker.
5. **Privacy.** Logs carry the gift id and a reason code only, never a name, an address or a token. Dead push endpoints (404/410) are pruned by the existing sender, exactly as before.

### Tests (Part 4.1)

| Suite | Result (2026-10-27) |
|---|---|
| `supabase/tests/0294_gift_notifications.pglite.mjs` | 34/34. All 3 mutants fail it: `no-claim-guard`, `announce-reversed`, `no-enqueue`. |
| `lib/gift/gift-notify.server.test.ts` | 17/17. Covers both switches on / push only / email only / both off, quiet hours, no devices, not eligible, replay, simultaneous dispatch, reversed gift, provider failure and retry, the 3-try cap, content, and email escaping plus the settings link. |
| `app/api/notification-settings/gift-prefs.test.ts` | 7/7. Unauthenticated refused, defaults on, each switch independent, own row only, bad values refused, other settings untouched. |
| `lib/push/web-push-result.test.ts` | 5/5. Accepted counts, 410 pruning, retry, and a failure that isn't pruned. |

### Limits

- **Quiet hours drop the gift push.** A push held by quiet hours, do-not-disturb or a delivery rule is recorded `skipped`, not queued for later, because gifts aren't held for the end-of-quiet-hours summary push. The chat message is there when the member looks.
- **No sticker artwork in the email.** The email shell has no image slot besides the sender's photo, so the sticker is named.
- **"Sent" means accepted.** It means the push service or Resend accepted the message, not that the device or inbox showed it.

## Part 5 — wallet and gift history integration, and the full-suite timeouts (2026-10-27)

There is no new migration in this part.

### The two full-suite timeouts (SUB journeys)

Both tests drive the real SQL through `lib/testing/pglite-bridge.ts`. Two causes, each measured:

1. **The bridge rewrote every row of every table around every RPC**, one statement at a time, then re-read everything. Each step's cost grew with the journey's whole history: bundles step 4 took 3,968 ms of its 5,000 ms budget even when run alone.
2. **The failing steps were the first to import the Paystack webhook route** inside the timed test. That cold import alone takes about 2.5–2.7 s, and under full-suite contention it can approach the limit.

Fixes:

- The bridge now rewrites only tables whose fake rows changed since the last sync; pull still reads every table. `lib/testing/pglite-bridge.test.ts` pins that sync still works both ways and that unchanged tables are skipped.
- Both journey suites load the route modules in their existing setup block (60 s budget). The steps, assertions and timeouts are unchanged.

Results:

| Step | Before | After |
|---|---|---|
| bundles step 4 | 3,968 ms | 443 ms |
| journey step 9 | 1,810 ms | 541 ms |
| journey step 1 | 2,002 ms | 121 ms |

The journey's real mutant (`no-amount-check`) still fails as it should. Full suite: 0 failures in two consecutive runs.

### The Gift Box (`/wallet/gifts`, design screen 7)

It's reached from the wallet overview (a prefetched button with the tap spinner) and from the gift sheet.

- **History.** Received/Sent tabs and day-grouped rows, read from each gift's **stored snapshot** (`lib/gift/history.ts` via `GET /api/gift/history`). Received rows show the share earned and its hold status; sent rows show the price.
- **Balance.** The Gift Coin balance comes from `gift_wallet_summary`, which releases due earnings as it reads.
- **Convert card.** Converts with the Part 2 engine. The preview uses `GET /api/gift/convert` with `expectedVersion`, and the database prices the conversion again. FGC→FC points to the ordinary FC withdrawal; there is no FGC payout.
- **Deviation from the design.** The summary card shows the real gift count and the real available/on-hold balance instead of the design's "N coins in gifts" total, which no stored figure provides.

### Fixed

- **Group bubble wording.** In a group, members other than the chosen recipient read "{sender} sent {recipient} a gift" (`giftLine`). Before, everyone who wasn't the sender read "…sent you a gift".

### Tests (Part 5)

| Suite | Result |
|---|---|
| `supabase/tests/gift_wallet_integration.pglite.mjs` | 27/27 |
| `app/api/gift/gift-box.test.ts` | 11/11 |
| `lib/testing/pglite-bridge.test.ts` | 5/5 |
| All FC and gift PGlite suites (0278–0294) | pass |
| Real-PostgreSQL harnesses: FGC conversion, gift settings, gift sends | 23, 14 and 19 checks, all pass |

The integration suite covers release one second before, exactly at and one second after the deadline; that only available FGC converts; conversion replay and the stale-version refusal; the FC withdrawal handoff; that no FGC payout function exists; snapshots surviving a sticker edit or archive; a group gift crediting only the chosen member; full reconciliation; and members being unable to make direct writes.

A correction: the Part 4 report said `gift_sends_concurrency` had 20 checks. It has 19.

## Part 6 — several gifts in one send, a note, the reveal, the top-up route, no PIN (0296, 2026-10-27)

### Owner decisions
- **Quantity:** several copies of one sticker in a single action, **each recorded as its own gift**.
- **Note:** optional, at most 200 characters.
- **No PIN:** gifts are sent "like a normal sticker". The first send asks *"Send this gift?"* with **"Don't ask me again for a week"** (a per-device convenience, `features/gift/gift-prefs.ts`). It is not a security control; the database still checks every gift in full.
- **Reveal:** the existing reveal behaviour is kept. There is no new "seen" flag and no reveal state in the database.
- **Top-up:** existing FC deposit, then the existing FC → FGC conversion. No coin packs, no new checkout.

### The batch (`send_gift_batch`, 0296)
`send_gift` (0293) makes one gift per call and is unchanged. The batch is one database function that calls it once per copy inside a single savepoint:
- Each copy passes every rule. Each copy sees the ones before it, so the **daily limit and AVAILABLE FGC are checked against the whole batch**.
- On any refusal the savepoint is rolled back and nothing of the batch remains: no gift, ledger, fee, notification or batch audit row. The refusal names the copy it stopped at (`failed_at`) and is audited as `gift_refused`.

The rest of the batch rules:
- **Quantity:** 1 to 10 (`GIFT_BATCH_MAX`, `lib/gift/batch.ts`). It's a chat gesture, and the cap bounds how long both wallets stay locked. The value cap is still the admin's daily limit.
- **Idempotency:** copy *i* uses key `<key>-<i>`, so the batch key is 8 to 76 characters.
  - A replay answers the committed batch.
  - The same key with a different sticker, chat, recipient, quantity or note is `idempotency_conflict`.
  - Two identical requests at once: the second waits on the wallet locks, then answers the first batch.
- **Records:** each copy is a full `gift_sends` row with its own id, snapshot, price, share, commission, hold, ledger rows, two outbox rows and `gift_sent` audit row. The batch labels its rows (`batch_id`, `batch_index`, `batch_size`) through a one-time write that `gift_sends_guard` allows only under `frenz.gift_batch_writer`, only on a new pending row.
- **Chat:** one bubble per batch, on the first gift's client id, stating the quantity and the note. `messages_gift_guard` refuses a bubble whose quantity or note isn't its batch's own.
- **Notifications:** `claim_gift_notification` now returns `batch_index` / `batch_size`. The dispatcher sends one push and one email for the batch ("You received 3 sticker gifts from …") and closes every other copy's rows as `skipped / batched`. Each row is still claimed and finished exactly once, and the sweep closes a later copy the same way.
- **Access:** service role only. A member can't call it.

### The note
- Trimmed at both ends. Blank or whitespace-only means no note. At most 200 characters, counted as code points like Postgres counts them. No control characters: refused, nothing charged.
- Checked in the sheet, in the route and again in the database.
- Stored **once, on the batch's first gift** (`gift_sends.note`, `batch_index = 1`). The other copies point to it through `batch_id`.
- Shown as plain text in the bubble, the reveal and the Gift Box (React escapes it).
- **Never** in a push, an email, a ledger row, an audit row, a notification claim or a log. It is also not in the message body that inbox and push previews read.

### Screens
1. **Composer** (`gift-composer-button.tsx`): a gift button beside the emoji picker. The design swaps them, but the picker is a working feature, so it stays. The button shows only where a gift can be sent. A one-time "Send a sticker gift" coach mark is dismissed for good on ×, or on the first gift sent (device storage, no server write).
3. **Detail** (`gift-sheet.tsx`): stage with a pop-in, rarity, name, To, quantity stepper, note with a counter, the price × quantity, Available, Total, Balance after, then the confirmation and Send. On a price change the new price is shown and must be confirmed again.
5. **Reveal** (`gift-reveal.tsx`): the recipient's tap on a gift bubble shows the sender, sticker, worth and note, with Say thanks (focuses the composer), Send one back (opens the sheet on that sticker) and Saved to your Gift Box. It writes nothing and can be reopened freely. Escape closes it.
6. **Top-up** (inside the sheet when the total exceeds AVAILABLE FGC): a progress bar, then "Convert Frenz Coins" (`/wallet/gifts?convert=fc_to_fgc&back=<chat>`) and "Add Frenz Coins" (`/wallet/deposit`). The buttons only open those screens. The Gift Box opens the converter on FC → FGC, shows available FC and pending or held deposits as not yet available, and offers "Back to the chat" after converting.
   - **Limit:** after a deposit, the payment provider returns to the existing wallet route; that flow is unchanged. The chat to return to is remembered for the visit, and the Gift Box offers it.

**Motion and haptics:** Tailwind `motion-safe:` animations with `motion-reduce:` fades, and the existing `haptic()` (selection on pick, light on stepper and errors, medium on success). Nothing depends on either.

### Tests (Part 6)
| Suite | Result |
|---|---|
| `supabase/tests/0296_gift_batches.pglite.mjs` | all pass. Mutants `batch-no-rollback` and `batch-forge-note` fail it as they must |
| `app/api/gift/gift-batch.test.ts` (route: no PIN, validation, bubble, announce, no note in logs) | pass |
| `lib/gift/gift-batch-notify.server.test.ts` (one announcement per batch, no note) | pass |
| `features/gift/gift-part6.test.ts` (rules, wording, week skip, coach mark, return path, reveal writes nothing, top-up never charges, Reduce Motion) | pass |
| `app/api/gift/gift-box.test.ts` (note and batch place in history) | pass |

### Security trade-off (owner decision)
With no PIN, an unlocked phone or a stolen session can spend Gift Coins up to the daily limit. Everything else still applies, unchanged, in the database:
- the session and rate limits
- account restrictions, recovery, held or disputed deposits and the post-deposit cooldown
- blocks and chat rules
- AVAILABLE FGC only

The PIN path (`send_gift_with_pin`) remains for any client still sending the old body.
