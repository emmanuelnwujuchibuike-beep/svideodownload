import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { type AgeStatus, checkBirthDate, evaluateBirthDate, parseIsoDate, todayUtc } from "./age";

/**
 * Age checks (0261). Only the outcome is stored — 'adult', or 'minor' with the day they turn 18
 * (eligible_on) — never the date of birth. Read with the service role; a browser can only ever
 * read its own row, and no browser can write one.
 *
 * Fails CLOSED: a read that errors, a missing table (before 0261 runs) or a signed-out viewer is
 * "none", and "none" never opens a Mature post.
 */

type Row = Record<string, unknown>;

export interface AgeState {
  status: AgeStatus;
  /** a minor only: the day the check can be answered again */
  eligibleOn: string | null;
}

const NONE: AgeState = { status: "none", eligibleOn: null };

export async function readAgeState(userId: string | null): Promise<AgeState> {
  if (!userId) return NONE;
  const { data, error } = await createAdminClient().from("age_checks").select("result, eligible_on").eq("user_id", userId).maybeSingle();
  const row = data as Row | null;
  if (error || !row) return NONE;
  if (row.result === "adult") return { status: "adult", eligibleOn: null };
  if (row.result !== "minor") return NONE;
  const eligibleOn = typeof row.eligible_on === "string" ? row.eligible_on : null;
  // from the day they turn 18 the old answer no longer holds: they may answer again
  const until = parseIsoDate(eligibleOn);
  if (until && until <= todayUtc()) return NONE;
  return { status: "minor", eligibleOn };
}

/** Whether this viewer may see Mature (18+) content right now. */
export async function isAdult(userId: string | null): Promise<boolean> {
  return (await readAgeState(userId)).status === "adult";
}

export type RecordFail = { ok: false; error: string; status: number };

/**
 * Records the answer to the check. An adult answer is final. A minor answer stands until the day
 * they turn 18 — another date before then changes nothing (the existing answer is returned).
 */
export async function recordAgeCheck(userId: string, birthDate: unknown, confirmed: unknown): Promise<({ ok: true } & AgeState) | RecordFail> {
  const current = await readAgeState(userId);
  if (current.status !== "none") return { ok: true, ...current };
  const today = todayUtc();
  const checked = checkBirthDate(birthDate, today);
  if (!checked.ok) return { ok: false, error: "Enter a real date of birth.", status: 400 };
  const outcome = evaluateBirthDate(checked.dob, today);
  // the confirmation is the second half of the check: an adult date without it is not an answer
  if (outcome.result === "adult" && confirmed !== true) return { ok: false, error: "Confirm that you're 18 or older.", status: 400 };
  const row = { user_id: userId, result: outcome.result, method: "self_declared_dob", eligible_on: outcome.result === "minor" ? outcome.eligibleOn : null, checked_at: new Date().toISOString() };
  const { error } = await createAdminClient().from("age_checks").upsert(row, { onConflict: "user_id" });
  if (error) return /schema cache|does not exist/i.test(error.message) ? { ok: false, error: "Age checks arrive with the next update.", status: 503 } : { ok: false, error: "Couldn't save that. Try again.", status: 500 };
  return { ok: true, status: outcome.result, eligibleOn: outcome.result === "minor" ? outcome.eligibleOn : null };
}

/** Every listed member's answer in one read (the admin accounts list). Missing = no answer; a failed read = an empty map. */
export async function readAgeStates(userIds: string[]): Promise<Map<string, AgeState>> {
  const out = new Map<string, AgeState>();
  if (!userIds.length) return out;
  const { data, error } = await createAdminClient().from("age_checks").select("user_id, result, eligible_on").in("user_id", userIds);
  if (error) return out;
  const today = todayUtc();
  for (const r of (data ?? []) as Row[]) {
    if (r.result === "adult") out.set(r.user_id as string, { status: "adult", eligibleOn: null });
    else if (r.result === "minor") {
      const eligibleOn = typeof r.eligible_on === "string" ? r.eligible_on : null;
      const until = parseIsoDate(eligibleOn);
      if (!until || until > today) out.set(r.user_id as string, { status: "minor", eligibleOn });
    }
  }
  return out;
}

/**
 * An admin clears a member's answer (owner, 2026-10-18) — e.g. a real adult who typed the wrong
 * year. The member answers again the next time a Mature post asks. Returns what was cleared, for
 * the audit trail; null when there was nothing to clear.
 */
export async function resetAgeCheck(userId: string): Promise<{ ok: true; cleared: AgeState | null } | RecordFail> {
  const before = await readAgeState(userId);
  const { error } = await createAdminClient().from("age_checks").delete().eq("user_id", userId);
  if (error) return /schema cache|does not exist/i.test(error.message) ? { ok: false, error: "Age checks arrive with the next update.", status: 503 } : { ok: false, error: "Couldn't reset that.", status: 500 };
  return { ok: true, cleared: before.status === "none" ? null : before };
}
