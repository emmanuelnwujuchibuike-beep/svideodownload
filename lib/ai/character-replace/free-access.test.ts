import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CHARACTER_REPLACE_DEFAULTS, normalizeCharacterReplaceConfig } from "./config";
import { freeAccessLimitsView, freeRequestQualifies, qualityRank } from "./free-access-rules";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 11 — complimentary creations, paid per video after, the device rule
 * ═══════════════════════════════════════════════════════════════════════════
 */

describe("the operator's bounds for a complimentary creation (§5, §21)", () => {
  const config = CHARACTER_REPLACE_DEFAULTS;
  const base = { voiceMode: "original" as const, voiceSource: null, lipSyncMode: null };
  it("defaults: 2 lifetime creations, 10 s, the lowest quality, all four scopes, no premium voice", () => {
    expect(config.freeAccess).toEqual({ enabled: true, creationsPerAccount: 2, entitlement: "lifetime", maxDurationSeconds: 10, maxQualityRank: 0, allowedModes: ["face_only", "skin_face", "upper_body", "full_character"], allowTts: false, allowUploadedVoice: false, allowLipSync: false, maxUploadBytes: 50 * 1024 * 1024 });
    expect(config.antiAbuse).toEqual({ maxFreeAccountsPerDevice: 2, deviceDetection: true, maxFreeAccountsPerNetwork: 4, networkWindowHours: 24, signupRateLimit: true, verificationAfterLimit: false, paidUsersExempt: true, adminExempt: true });
  });
  it("a short standard-quality video of any scope qualifies; longer, higher or premium does not, and says why", () => {
    expect(freeRequestQualifies(config, { ...base, mode: "face_only", quality: "standard", durationMs: 8000 })).toEqual({ ok: true });
    expect(freeRequestQualifies(config, { ...base, mode: "full_character", quality: "480p", durationMs: 10_000 })).toEqual({ ok: true });
    expect(freeRequestQualifies(config, { ...base, mode: "full_character", quality: "480p", durationMs: 10_001 })).toMatchObject({ ok: false, reason: "duration" });
    expect(freeRequestQualifies(config, { ...base, mode: "full_character", quality: "720p", durationMs: 5000 })).toMatchObject({ ok: false, reason: "quality", message: "Complimentary creations use 480p quality at most." });
    expect(freeRequestQualifies(config, { ...base, mode: "upper_body", quality: "high", durationMs: 5000 })).toMatchObject({ ok: false, reason: "quality" });
    expect(freeRequestQualifies(config, { mode: "face_only", quality: "standard", durationMs: 5000, voiceMode: "new_voice", voiceSource: "tts", lipSyncMode: null })).toMatchObject({ ok: false, reason: "tts" });
    expect(freeRequestQualifies(config, { mode: "face_only", quality: "standard", durationMs: 5000, voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: null })).toMatchObject({ ok: false, reason: "upload" });
    const premiumOn = normalizeCharacterReplaceConfig({ freeAccess: { allowUploadedVoice: true } });
    expect(freeRequestQualifies(premiumOn, { mode: "face_only", quality: "standard", durationMs: 5000, voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: "studio" })).toMatchObject({ ok: false, reason: "lipsync" });
    const noUpper = normalizeCharacterReplaceConfig({ freeAccess: { allowedModes: ["face_only"] } });
    expect(freeRequestQualifies(noUpper, { ...base, mode: "upper_body", quality: "standard", durationMs: 5000 })).toMatchObject({ ok: false, reason: "mode" });
    expect(qualityRank(config, "full_character", "720p")).toBe(1);
    expect(qualityRank(config, "face_only", "standard")).toBe(0);
    expect(freeAccessLimitsView(config).maxDurationSeconds).toBe(10);
  });
  it("the normaliser clamps and filters: an unknown scope is dropped, the count is bounded, garbage keeps the defaults", () => {
    const c = normalizeCharacterReplaceConfig({ freeAccess: { creationsPerAccount: 999, maxQualityRank: 7, allowedModes: ["face_only", "nope"], maxDurationSeconds: 0 }, antiAbuse: { maxFreeAccountsPerDevice: -1, networkWindowHours: 0 } });
    expect(c.freeAccess.creationsPerAccount).toBe(100);
    expect(c.freeAccess.maxQualityRank).toBe(2);
    expect(c.freeAccess.allowedModes).toEqual(["face_only"]);
    expect(c.freeAccess.maxDurationSeconds).toBe(1);
    expect(c.antiAbuse.maxFreeAccountsPerDevice).toBe(0);
    expect(c.antiAbuse.networkWindowHours).toBe(1);
  });
});

describe("the server is authoritative (§3, §4, §16, §17)", () => {
  it("/start decides free vs paid itself, consumes atomically after the claim, and never reserves money for a free creation", () => {
    // 0166: THE start sequence lives in lib/ai/character-replace/start-job.ts (the route and the batch route both call it)
    const start = code("lib/ai/character-replace/start-job.ts");
    const elig = start.indexOf("const eligibility = await getCharacterReplaceFreeEligibility({ subject, config, request, isAdmin: shared.isAdmin, plans: settings.frenzAiPlans });");
    const fits = start.indexOf("freeRequestQualifies(config, { mode: snapshot.mode, quality: snapshot.quality, durationMs: snapshot.durationMs,");
    const claim = start.indexOf("claimJobStart({");
    // 2026-09-21: the consume carries the operator's CURRENT count (the pill said "1 remaining" after the admin lowered it)
    const consume = start.indexOf("const use = await consumeFreeUse({ userId: ownerId, jobId: job.id, snapshot: ledgerSnapshot, granted:");
    const reserve = start.indexOf("reserveCharacterReplaceCharge({ userId: ownerId, jobId: job.id, credits: walletCharge.creditsRequired, snapshot: { ...ledgerSnapshot, creditBreakdown: walletCharge.breakdown, creditsConfigVersion: walletCharge.configVersion } })");
    expect(elig).toBeGreaterThan(-1);
    expect(fits).toBeGreaterThan(elig);
    expect(claim).toBeGreaterThan(fits);
    expect(consume).toBeGreaterThan(claim);
    expect(reserve).toBeGreaterThan(consume);
    // the balance check is skipped only for a complimentary creation; the claim carries the funding source and a zero charge
    // 0167: nor for a generation paid with included credits
    // 0184: the wallet holds credits — the comparison is to the engine's credits, never the cents total
    expect(start).toContain("if (!complimentary && !useCredits && balanceBefore < walletCharge.creditsRequired) {");
    expect(start).not.toContain("balanceBefore < snapshot.totalCents");
    expect(start).toContain('funding: complimentary ? "free" : useCredits ? "credits" : "balance",');
    expect(start).toContain("chargedCents: complimentary || useCredits ? 0 : snapshot.totalCents,");
    // a refused free use (the race) reverts the claim and answers its own code
    expect(start).toContain('return refuse("CR_FREE_UNAVAILABLE");');
    // the audit records the NORMAL price beside "charged 0"
    expect(start).toContain('? { type: "FREE_TRIAL", normalPriceCents: snapshot.totalCents, chargedCents: 0, freeEntitlementUsed: 1, currency: snapshot.currency }');
    // nothing in the body decides any of it
    expect(code("lib/ai/character-replace/start-schema.ts")).not.toMatch(/free|complimentary|deviceId|isAdmin/i);
  });
  it("the entitlement is decided by the database under a device lock, from a server-set cookie's hash — never a browser value", () => {
    // 0162 = the tables, 0163 = the functions + their revokes in one transaction, 0164 = the old overload dropped
    const tables = src("supabase/migrations/0162_ai_free_creations.sql");
    const fns = src("supabase/migrations/0163_ai_free_creations_functions.sql");
    expect(tables).toContain("create unique index if not exists ai_free_uses_job_uniq on public.ai_free_uses (job_id);");
    expect(tables).not.toMatch(/^(as|do) \$\$/m); // plain DDL only — no function body, no do-block
    expect(fns).toContain("perform pg_advisory_xact_lock(hashtext('ai_free:' || coalesce(p_device_hash, 'no-device')));");
    expect(fns).toContain("select * into v_row from public.ai_free_entitlements where user_id = p_user_id and product = p_product for update;");
    expect(fns).toContain("where job_id = p_job_id and status = 'consumed'");
    expect(fns).toContain("execute format('revoke all on function %s from public, anon, authenticated', fn);");
    expect(fns.indexOf("execute format('revoke all on function")).toBeGreaterThan(fns.lastIndexOf("create or replace function"));
    expect(src("supabase/migrations/0164_ai_free_creations_grants.sql")).toContain("execute 'drop function if exists public.claim_ai_job_start(uuid, uuid, text, integer, integer, integer, bigint, jsonb)';");
    const free = code("lib/ai/character-replace/free-access.ts");
    expect(free).toContain('import "server-only"');
    expect(free).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(free).toContain('return id ? hmac(id, "device") : null;');
    expect(free).toContain("const isAdmin = opts.isAdmin ?? (config.antiAbuse.adminExempt ? !!(await getAdminUser().catch(() => null)) : false);");
    // a database fault never grants blind — and never tells the member they are ineligible: the line is hidden
    expect(free).toContain('return off("TEMPORARILY_UNAVAILABLE");');
    expect(free).toContain('if (row.eligibility === "pending") return off("TEMPORARILY_UNAVAILABLE");');
    expect(code("app/api/ai/character-replace/balance/route.ts")).toContain('enabled: settings.frenzAiCharacterReplace.freeAccess.enabled && free.reason !== "TEMPORARILY_UNAVAILABLE",');
  });
  it("undo paths restore the entitlement once and never touch the wallet for a free job; completion settles the use", () => {
    const funding = code("lib/ai/funding.ts");
    expect(funding).toContain('if (opts.job.funding_source === "free") {');
    expect(funding.indexOf("await restoreFreeUse(opts.job.id")).toBeLessThan(funding.indexOf("await refundCharacterReplaceCharge(opts.job.user_id, opts.job.id)"));
    const fin = code("server/services/ai-character-replace-finalize-service.ts");
    // 0167: included plan credits settle on their own ledger between the two
    expect(fin).toContain('job.funding_source === "free" ? await settleFreeUse(jobId) : job.funding_source === "credits" ? await settleAiCredits(jobId) : await settleCharacterReplaceCharge(ownerId, jobId)');
    // the claim function is told the funding source; the store passes it and falls back on an ambiguous overload too
    const store = code("lib/ai/job-store.ts");
    expect(store).toContain("p_funding: funding,");
    expect(store).toContain('error.code === "PGRST202" || error.code === "PGRST203"');
  });
  it("the routes answer the entitlement and a display-only billing fact; the client never computes either", () => {
    // 2026-10-07: read in one parallel wave with the other balance-page facts (the route was 0.8–1.4 s of sequential awaits)
    expect(code("app/api/ai/character-replace/balance/route.ts")).toContain("getCharacterReplaceFreeEligibility({ subject, config: settings.frenzAiCharacterReplace, request, plans: settings.frenzAiPlans }),");
    expect(code("app/api/ai/character-replace/config/route.ts")).toContain('if (!readDeviceId(request)) headers.append("set-cookie", deviceCookieHeader(newDeviceId()));');
    const quote = code("app/api/ai/character-replace/quote/route.ts");
    expect(quote).toContain("const complimentary = free.eligible && fit?.ok === true;");
    const ws = code("lib/ai/character-replace/workspace.ts");
    expect(ws).toContain("if (pricing.snapshot.billing?.complimentary) return true;");
    expect(code("features/ai/character-replace/character-replace-workspace.tsx")).toContain('"Create Video · Complimentary"');
  });
  it("the failure push says a restored creation came back only from the audit row", () => {
    expect(code("lib/ai/notify.ts")).toContain('(await freeUseState(opts.jobId)) === "restored"');
    expect(code("lib/ai/notification-copy.ts")).toContain('"Your complimentary creation has been restored."');
  });
  it("the admin form carries every switch the brief lists and the tables are catalogued", () => {
    const form = src("features/admin/character-replace-pricing.tsx");
    for (const id of ["cr-free-count", "cr-free-max-seconds", "cr-free-quality", "cr-free-max-upload", "cr-abuse-device-max", "cr-abuse-network-max"]) expect(form, id).toContain(`id="${id}"`);
    for (const label of ["Free lip sync", "Free generated voice (TTS)", "Free uploaded voice", "Device abuse detection", "Sign-up rate limiting", "Verification after the device limit", "Paid users exempt from the device limit", "Administrator exemption"]) expect(form, label).toContain(`label="${label}"`);
    expect(code("app/api/admin/landing/route.ts")).toContain("freeAccess: z");
    expect(code("app/api/admin/landing/route.ts")).toContain("antiAbuse: z");
    expect(src("lib/platform/data-domains.ts")).toContain('"ai_free_entitlements", "ai_free_uses", "ai_device_associations"');
    expect(src("lib/portability/tables.ts")).toContain('ai_free_uses: "user_id"');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  "NOT AVAILABLE ON THIS ACCOUNT" WAS THE WRONG SENTENCE (owner, 2026-10-04)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A free member whose PLAN grants zero complimentary creations was told
 * "Complimentary creations aren't available on this account" — which reads as
 * something wrong with them, and hides that the offer exists one plan up.
 * Live config when this was written: free 0, pro 3, business 7.
 *
 * 🔴 The two causes had to be split before the copy could be fixed, because
 * only ONE of them is about the plan. `DISABLED_BY_ADMIN` fires when the
 * operator switches the whole offer off — nobody gets them, on any plan — and
 * a plan-shaped sentence there would be an upsell for something that does not
 * exist. This codebase has already shipped upgrade copy implying a gate that
 * was not real; that is the mistake these assertions exist to prevent.
 */
describe("the complimentary-creation refusal says which cause it is", () => {
  const s = src("lib/ai/character-replace/free-access.ts");
  const msg = s.slice(s.indexOf("export function freeEligibilityMessage"));

  it("a plan that grants none is its own reason, separate from the offer being off", () => {
    const logic = code("lib/ai/character-replace/free-access.ts");
    expect(logic).toContain('if (!config.freeAccess.enabled) return off("DISABLED_BY_ADMIN");');
    expect(logic).toContain('opts.plans?.freeCreations.enabled ? "NOT_ON_YOUR_PLAN" : "DISABLED_BY_ADMIN"');
  });

  it("names the plan and says what IS included", () => {
    const line = msg.slice(msg.indexOf('case "NOT_ON_YOUR_PLAN"'), msg.indexOf('case "DISABLED_BY_ADMIN"'));
    expect(line).toContain("Free plan");
    expect(line.toLowerCase()).toContain("text");
    expect(line.toLowerCase()).toContain("video");
  });

  it("🔴 quotes no allowance figure", () => {
    /*
      The monthly free characters and the per-plan creation counts are both
      operator-editable. A number written into this sentence goes stale the
      first time one changes — the standing rule against a stat that is not
      read from the thing it describes.
    */
    const line = msg.slice(msg.indexOf('case "NOT_ON_YOUR_PLAN"'), msg.indexOf('case "DISABLED_BY_ADMIN"'));
    expect(line.replace(/2026-10-04|frenzAiPlans/g, "")).not.toMatch(/\d{2,}/);
  });

  it("the offer being switched off still says nothing about a plan", () => {
    // teeth: the lie this split exists to avoid.
    const line = msg.slice(msg.indexOf('case "DISABLED_BY_ADMIN"'), msg.indexOf('case "TEMPORARILY_UNAVAILABLE"'));
    expect(line).not.toContain("Free plan");
    expect(line).not.toContain("Pro");
  });
});
