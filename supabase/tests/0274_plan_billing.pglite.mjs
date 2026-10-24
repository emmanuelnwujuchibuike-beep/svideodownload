// PGlite harness for 0274 (Flutterwave recurring billing, Part 3.3). Run from %TEMP%\pgt:
//   node t0274.mjs <repo>/supabase/migrations [--mutant=no-unique|no-identity|no-recheck]
// Applies 0274 TWICE over stubs of 0004 / 0167 / 0273 and checks the renewal ledger and the expiry function.
// One connection: this proves the LOGIC (once per transaction, identity, contract, cancel flag, expiry re-check).
// Two-connection races are proven by plan_billing_concurrency.pg.mjs on a real local PostgreSQL.
// A --mutant removes one protection; the run must FAIL.
import { PGlite } from "@electric-sql/pglite";

import { STUB, migration, split } from "./0274_plan_billing.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").slice("--mutant=".length);

const isMain = import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("0274_plan_billing.pglite.mjs") || process.argv[1]?.endsWith("t0274.mjs");
if (isMain) {
  const run = async (db, sql) => { for (const s of split(sql)) { try { await db.exec(s); } catch (e) { console.log("SQL ERROR:", e.message, "\n", s.slice(0, 300)); process.exit(2); } } };
  const db = new PGlite();
  await run(db, STUB);
  const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await db.exec(`insert into auth.users (id) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 12) g`);
  await db.exec(`insert into public.profiles (id, role) select id, 'user' from auth.users`);
  // a Paystack row from before 0274 — must stay valid and untouched
  await db.exec(`insert into public.subscriptions (user_id, plan, status, provider, subscription_ref, current_period_end) values ('${U(9)}', 'pro', 'active', 'paystack', 'SUB_old', now() + interval '20 days')`);

  const sql = migration(dir, MUTANT);
  await run(db, sql);
  await run(db, sql); // idempotent

  const q = async (s, p) => (await db.query(s, p)).rows;
  let failures = 0;
  const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
  const apply = async (o) => (await q(`select apply_plan_renewal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r`, [o.provider ?? "flutterwave", o.tx, o.target ?? "site_subscription", o.user, o.ref, o.plan ?? null, o.amount ?? 900, o.currency ?? "USD", o.source ?? "webhook", o.admin ?? null]))[0].r;
  const site = async (u) => (await q(`select status::text, current_period_end, cancel_at_period_end, last_reference from subscriptions where user_id = $1`, [u]))[0];
  const ai = async (u) => (await q(`select status, current_period_end, cancel_at_period_end, last_reference from ai_subscriptions where user_id = $1`, [u]))[0];
  const role = async (u) => (await q(`select role::text from profiles where id = $1`, [u]))[0].role;
  const days = (a, b) => Math.round((new Date(a) - new Date(b)) / 86_400_000);
  const fwSite = (u, ref, endSql, extra = "") => db.exec(`insert into subscriptions (user_id, plan, status, provider, subscription_ref, plan_code, contract_amount_minor, contract_currency, contract_interval, current_period_end${extra ? "," + extra.split("=")[0] : ""}) values ('${u}', 'pro', 'active', 'flutterwave', '${ref}', '501', 900, 'USD', 'monthly', ${endSql}${extra ? "," + extra.split("=")[1] : ""})`);

  // ── the renewal ledger ──
  await fwSite(U(1), "7001", "now() + interval '2 days'");
  const before = (await site(U(1))).current_period_end;
  const r1 = await apply({ tx: "900001", user: U(1), ref: "7001", plan: "501" });
  ok(r1.result === "applied", "a verified renewal for the stored subscription, at the contract, is applied");
  const after1 = (await site(U(1))).current_period_end;
  ok(days(after1, before) >= 28 && days(after1, before) <= 31, "…extending the period by ONE month from the paid-through time");
  ok((await role(U(1))) === "pro", "…and the member is Pro");
  ok((await site(U(1))).last_reference === "flw_tx_900001", "…last_reference names the transaction");

  const r2 = await apply({ tx: "900001", user: U(1), ref: "7001", plan: "501" });
  ok(r2.result === "duplicate", "the SAME transaction again → duplicate");
  ok(String((await site(U(1))).current_period_end) === String(after1), "…and no time is added");
  const r2b = await apply({ tx: "900001", user: U(1), ref: "7001", plan: "501", source: "reconcile" });
  ok(r2b.result === "duplicate", "the cron finding it after the webhook → duplicate");

  const r3 = await apply({ tx: "900002", user: U(1), ref: "7001", plan: "501" });
  ok(r3.result === "applied", "a DIFFERENT verified transaction (next month) is applied too");
  ok(days((await site(U(1))).current_period_end, after1) >= 28, "…from the new paid-through time (neither is lost)");
  const afterTwo = (await site(U(1))).current_period_end;
  const r3b = await apply({ tx: "900001", user: U(1), ref: "7001", plan: "501" });
  ok(r3b.result === "duplicate" && String((await site(U(1))).current_period_end) === String(afterTwo), "replaying the OLD transaction after a newer one adds nothing");

  // identity and contract
  ok((await apply({ tx: "900010", user: U(1), ref: "9999", plan: "501" })).result === "identity_mismatch", "another subscription id → identity_mismatch");
  ok((await apply({ tx: "900011", user: U(1), ref: "7001", plan: "502" })).result === "plan_mismatch", "another plan → plan_mismatch");
  ok((await apply({ tx: "900012", user: U(1), ref: "7001", plan: "501", amount: 899 })).result === "contract_mismatch", "an underpaid renewal → contract_mismatch");
  ok((await apply({ tx: "900013", user: U(1), ref: "7001", plan: "501", amount: 1900 })).result === "contract_mismatch", "a renewal at a NEW admin price (not the contract) → contract_mismatch");
  ok((await apply({ tx: "900014", user: U(1), ref: "7001", plan: "501", currency: "NGN" })).result === "contract_mismatch", "another currency → contract_mismatch");
  ok((await apply({ tx: "900015", user: U(9), ref: "SUB_old" })).result === "identity_mismatch", "a Paystack row is never extended here");
  ok((await apply({ tx: "x1", user: U(1), ref: "7001" })).result === "invalid", "a non-numeric transaction id → invalid");
  ok((await apply({ tx: "900016", user: U(10), ref: "7001" })).result === "no_subscription", "a member with no subscription row → no_subscription");
  ok((await q(`select count(*)::int n from plan_renewals`))[0].n === 2, "only the two applied transactions are in the ledger");

  // no contract stored (a row from before 0274)
  await db.exec(`insert into subscriptions (user_id, plan, status, provider, subscription_ref, current_period_end) values ('${U(2)}', 'pro', 'active', 'flutterwave', '7002', now() + interval '1 day')`);
  ok((await apply({ tx: "900020", user: U(2), ref: "7002" })).result === "no_contract", "a Flutterwave row without a stored contract → no_contract (never guessed)");

  // the member's cancel survives a renewal that was already in flight
  await fwSite(U(3), "7003", "now() + interval '1 day'", "cancel_at_period_end=true");
  ok((await apply({ tx: "900030", user: U(3), ref: "7003", plan: "501" })).result === "applied", "a renewal after the member cancelled is applied (it was paid)…");
  ok((await site(U(3))).cancel_at_period_end === true, "…and the cancel flag is KEPT");

  // a late renewal (after the period ended) extends from now, not from the past
  await fwSite(U(4), "7004", "now() - interval '2 days'");
  await db.exec(`update subscriptions set status = 'past_due' where user_id = '${U(4)}'`);
  ok((await apply({ tx: "900040", user: U(4), ref: "7004", plan: "501" })).result === "applied", "a late renewal reactivates…");
  const s4 = await site(U(4));
  ok(s4.status === "active" && days(s4.current_period_end, new Date()) >= 27, "…for one period from now");

  // an admin is never demoted or changed
  await db.exec(`update profiles set role = 'admin' where id = '${U(5)}'`);
  await fwSite(U(5), "7005", "now() + interval '1 day'");
  await apply({ tx: "900050", user: U(5), ref: "7005", plan: "501" });
  ok((await role(U(5))) === "admin", "an admin's role is not touched by a renewal");

  // AI plans
  await db.exec(`insert into ai_subscriptions (user_id, plan, status, provider, plan_code, subscription_ref, contract_amount_minor, contract_currency, contract_interval, current_period_end, cancel_at_period_end) values ('${U(6)}', 'ai_pro', 'active', 'flutterwave', '123', '8006', 1000, 'USD', 'yearly', now() + interval '3 days', true)`);
  ok((await apply({ tx: "900060", target: "ai_subscription", user: U(6), ref: "8006", plan: "123", amount: 1000 })).result === "applied", "an AI plan renewal is applied the same way");
  const a6 = await ai(U(6));
  ok(days(a6.current_period_end, new Date()) >= 360, "…by its CONTRACTED interval (yearly)");
  ok(a6.cancel_at_period_end === true, "…keeping the AI member's cancel flag too");
  ok((await apply({ tx: "900060", target: "ai_subscription", user: U(6), ref: "8006", plan: "123", amount: 1000 })).result === "duplicate", "…once");

  // the admin review path closes its review in the same transaction
  await db.exec(`insert into plan_billing_reviews (dedupe_key, kind, reason, transaction_id) values ('renewal:flutterwave:900070', 'renewal', 'identity not provable', '900070')`);
  await fwSite(U(7), "7007", "now() + interval '1 day'");
  ok((await apply({ tx: "900070", user: U(7), ref: "7007", plan: "501", source: "admin", admin: U(8) })).result === "applied", "an admin applies a reviewed renewal…");
  const rv = (await q(`select status, resolved_by from plan_billing_reviews where dedupe_key = 'renewal:flutterwave:900070'`))[0];
  ok(rv.status === "applied" && rv.resolved_by === U(8), "…and its review is closed atomically");

  // 0275 (Part 3.3.2, L3): a transaction ALREADY applied (by the webhook) closes its still-open review on "duplicate"
  await db.exec(`insert into plan_billing_reviews (dedupe_key, kind, reason, transaction_id) values ('renewal:flutterwave:900001', 'renewal', 'queued before the webhook applied it', '900001')`);
  const endBeforeDup = (await site(U(1))).current_period_end;
  ok((await apply({ tx: "900001", user: U(1), ref: "7001", plan: "501", source: "admin", admin: U(8) })).result === "duplicate", "an admin applying an already-applied transaction gets 'duplicate'…");
  const dup = (await q(`select status, resolution_note, resolved_by from plan_billing_reviews where dedupe_key = 'renewal:flutterwave:900001'`))[0];
  ok(dup.status === "applied" && dup.resolution_note === "already applied" && dup.resolved_by === U(8), "…its open review is CLOSED as already applied (0275)");
  ok(String((await site(U(1))).current_period_end) === String(endBeforeDup), "…and no second period is added");
  ok((await apply({ tx: "900001", user: U(1), ref: "7001", plan: "501", source: "admin", admin: U(9) })).result === "duplicate" && (await q(`select resolved_by from plan_billing_reviews where dedupe_key = 'renewal:flutterwave:900001'`))[0].resolved_by === U(8), "a repeat changes nothing more (the first resolver is kept)");
  const priv2 = (await q(`select has_function_privilege('authenticated', 'public.plan_renewal_duplicate(text, text, uuid)', 'execute') a, has_function_privilege('anon', 'public.plan_renewal_duplicate(text, text, uuid)', 'execute') b`))[0];
  ok(!priv2.a && !priv2.b, "no browser role can call plan_renewal_duplicate");

  // ── expiry ──
  await fwSite(U(11), "7011", "now() - interval '2 days'");
  ok((await q(`select expire_flutterwave_site_plan($1) r`, [U(11)]))[0].r === "not_expired", "inside the 3-day renewal grace → not expired");
  await db.exec(`update subscriptions set current_period_end = now() - interval '4 days' where user_id = '${U(11)}'`);
  await db.exec(`update profiles set role = 'pro' where id = '${U(11)}'`);
  ok((await q(`select expire_flutterwave_site_plan($1) r`, [U(11)]))[0].r === "expired", "past the grace with no renewal → expired");
  ok((await site(U(11))).status === "past_due" && (await role(U(11))) === "user", "…past_due, role back to user");

  await fwSite(U(12), "7012", "now() - interval '1 hour'", "cancel_at_period_end=true");
  await db.exec(`update profiles set role = 'pro' where id = '${U(12)}'`);
  ok((await q(`select expire_flutterwave_site_plan($1) r`, [U(12)]))[0].r === "expired", "a CANCELLED plan ends at its paid-through time (no renewal grace)…");
  ok((await site(U(12))).status === "canceled", "…as canceled, not past_due");

  // the race, replayed in order: the sweep READ U(1) as expired, then a renewal landed, then the sweep writes
  await db.exec(`update subscriptions set current_period_end = now() - interval '5 days' where user_id = '${U(1)}'`);
  const staleRead = (await q(`select user_id from subscriptions where provider = 'flutterwave' and current_period_end < now() - interval '3 days' and user_id = $1`, [U(1)])).length === 1;
  await apply({ tx: "900003", user: U(1), ref: "7001", plan: "501" });
  ok(staleRead && (await q(`select expire_flutterwave_site_plan($1) r`, [U(1)]))[0].r === "not_expired", "expiry after a renewal that landed AFTER the sweep's read → not expired");
  ok((await site(U(1))).status === "active" && (await role(U(1))) === "pro", "…the renewed member stays active and Pro");
  ok((await q(`select expire_flutterwave_site_plan($1) r`, [U(9)]))[0].r === "no_subscription", "a Paystack row is never expired by this sweep");

  // ── constraints and privileges ──
  const fails = async (s) => { try { await db.exec(s); return false; } catch { return true; } };
  ok(await fails(`insert into plan_renewals (provider, transaction_id, target, user_id, subscription_ref, amount_minor, currency, period_end_after, source) values ('flutterwave', '900001', 'site_subscription', '${U(1)}', '7001', 900, 'USD', now(), 'webhook')`), "the ledger refuses the same (provider, transaction) twice — even written directly");
  ok(await fails(`insert into plan_renewals (provider, transaction_id, target, user_id, subscription_ref, amount_minor, currency, period_end_after, source) values ('paystack', '1', 'site_subscription', '${U(1)}', 'x', 900, 'USD', now(), 'webhook')`), "…and any provider but flutterwave");
  ok(await fails(`insert into plan_billing_reviews (dedupe_key, kind, reason) values ('renewal:flutterwave:900070', 'renewal', 'again')`), "a review is queued once per dedupe key");
  ok(await fails(`update subscriptions set contract_amount_minor = 0 where user_id = '${U(1)}'`), "a contract amount must be positive");
  ok(await fails(`insert into subscriptions (user_id, provider, subscription_ref) values ('${U(10)}', 'flutterwave', '7001')`), "one Flutterwave subscription id belongs to one member row");
  ok((await q(`select count(*)::int n from subscriptions where provider = 'paystack' and subscription_ref = 'SUB_old'`))[0].n === 1, "the Paystack row from before 0274 is untouched");
  const priv = (await q(`select has_table_privilege('authenticated', 'public.plan_renewals', 'select') a, has_table_privilege('anon', 'public.plan_billing_reviews', 'select') b, has_function_privilege('authenticated', 'public.apply_plan_renewal(text, text, text, uuid, text, text, bigint, text, text, uuid)', 'execute') c, has_function_privilege('anon', 'public.expire_flutterwave_site_plan(uuid, interval)', 'execute') d`))[0];
  ok(!priv.a && !priv.b && !priv.c && !priv.d, "no browser role can read the ledger or the reviews, or call either function");

  console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT}: expected)` : ""}` : `\nALL OK${MUTANT ? ` — but mutant ${MUTANT} should have failed!` : ""}`);
  process.exit(failures ? 1 : 0);
}
