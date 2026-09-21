import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CHARACTER_REPLACE_DEFAULTS, CHARACTER_REPLACE_LAUNCH_MODES, normalizeCharacterReplaceConfig, publicCharacterReplaceConfig } from "./config";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 10 — the production QA pass, pinned where a regression would be silent
 * ═══════════════════════════════════════════════════════════════════════════
 */

describe("a never-started draft is not a stalled job (found 2026-09-20)", () => {
  /*
    The 10-minute sweep (`listRecoverableJobs` includes `queued`) measured a
    Character Replace draft from `created_at` against the 30-minute `queued`
    deadline and ended it as `failed / PROVIDER_TIMEOUT` with a push saying
    the video "couldn't finish" — for a project that was still uploading, or
    that the member had simply closed. Drafts belong to the abandoned sweep
    in lib/ai/retention.ts (a day, no push), so the stall path leaves them.
  */
  it("failStalledJob returns before the deadline table for a Character Replace `queued` row", () => {
    const stall = code("lib/ai/stall-server.ts");
    const guard = stall.indexOf('if (job.feature === "ai_character_replace" && job.status === "queued") return false;');
    const deadline = stall.indexOf("const over = stalledForMs(job, now);");
    expect(guard).toBeGreaterThan(-1);
    expect(deadline).toBeGreaterThan(guard);
  });
  it("the abandoned sweep and the create route expire drafts the same way — folder AND source object, guarded on queued + never started", () => {
    const retention = code("lib/ai/retention.ts");
    const helper = retention.slice(retention.indexOf("async function expireDrafts("), retention.indexOf("export async function supersedeOwnDrafts("));
    expect(helper).toContain("removeJobFolder(admin, row.source_path)");
    expect(helper).toContain("removeObjects(admin, [{ bucket: AI_SOURCE_BUCKET, path: row.source_path }])");
    expect(helper).toContain('.eq("status", "queued")');
    expect(helper).toContain('.is("started_at", null)');
    expect(helper).toContain('status: "expired"');
    // both callers go through it
    expect(retention).toContain("const abandoned = await expireDrafts(admin, (idleRows ?? [])");
    expect(retention.slice(retention.indexOf("export async function supersedeOwnDrafts("))).toContain("await expireDrafts(admin, rows, now)");
  });
  it("create supersedes the member's other drafts BEFORE the active count, and only after the same-request idempotency answer", () => {
    const create = code("app/api/ai/character-replace/jobs/route.ts");
    const existing = create.indexOf("const existing = await findJobByRequestId(subject, clientRequestId);");
    const supersede = create.indexOf("await supersedeOwnDrafts(ownerId, feature.id);");
    const count = create.indexOf("const active = await countActiveJobs(subject, feature.id);");
    expect(existing).toBeGreaterThan(-1);
    expect(supersede).toBeGreaterThan(existing);
    expect(count).toBeGreaterThan(supersede);
    // scoped to the member and the feature, never a wider sweep
    const fn = code("lib/ai/retention.ts");
    const body = fn.slice(fn.indexOf("export async function supersedeOwnDrafts("));
    expect(body).toContain('.eq("user_id", userId)');
    expect(body).toContain('.eq("feature", feature)');
  });
});

describe("a refused preflight retires the draft at once (owner, 2026-09-20: it read as queued and opened as completing)", () => {
  it("the preflight route expires the draft on a negative verdict and records preflight.refused; a pass and a pass-through never do", () => {
    const route = code("app/api/ai/character-replace/jobs/[id]/preflight/route.ts");
    const refuse = route.indexOf("if (!record.result.valid) {");
    expect(refuse).toBeGreaterThan(-1);
    expect(route.slice(refuse)).toContain("await retireRefusedDraft({ id: job.id, source_path: job.source_path });");
    expect(route.slice(refuse)).toContain('await recordJobEvent(job.id, "preflight.refused",');
    // after the token decision, so a refusal is never mistaken for a pass
    expect(refuse).toBeGreaterThan(route.indexOf("const token = record.result.valid && bound ? signPreflightToken(claims) : null;"));
    // the pass-through branch (the checker could not run) keeps the draft — it may pass next time
    expect(route.slice(0, refuse)).not.toContain("retireRefusedDraft(");
    const retention = code("lib/ai/retention.ts");
    expect(retention).toContain("export async function retireRefusedDraft(row: Pick<AiJobRow, \"id\" | \"source_path\">, now: Date = new Date()): Promise<boolean> {");
    expect(retention).toContain("const done = await expireDrafts(createAdminClient(), [row], now);");
    expect(code("lib/ai/job-events.ts")).toContain('| "preflight.refused"');
  });
  it("a draft that expired before it was ever started is not history — a started job that expired still is", () => {
    const store = code("lib/ai/job-store.ts");
    expect(store).toContain('query = query.or("status.neq.expired,started_at.not.is.null");');
    expect(store.indexOf('query = query.or("status.neq.expired,started_at.not.is.null");')).toBeGreaterThan(store.indexOf('else query = query.neq("status", "deleted");'));
  });
});

describe("safe launch mode (§25)", () => {
  it("two modes, production by default, and anything else normalises to production", () => {
    expect(CHARACTER_REPLACE_LAUNCH_MODES).toEqual(["production", "internal"]);
    expect(CHARACTER_REPLACE_DEFAULTS.ops.launchMode).toBe("production");
    expect(normalizeCharacterReplaceConfig(null).ops.launchMode).toBe("production");
    expect(normalizeCharacterReplaceConfig({ ops: { launchMode: "internal" } }).ops.launchMode).toBe("internal");
    expect(normalizeCharacterReplaceConfig({ ops: { launchMode: "everyone" } }).ops.launchMode).toBe("production");
    expect(normalizeCharacterReplaceConfig({ ops: { launchMode: true } }).ops.launchMode).toBe("production");
  });
  it("the mode never reaches a browser through the public config", () => {
    const pub = publicCharacterReplaceConfig({ ...CHARACTER_REPLACE_DEFAULTS, ops: { ...CHARACTER_REPLACE_DEFAULTS.ops, launchMode: "internal" } }, { code: "USD", symbol: "$" }, true);
    expect(JSON.stringify(pub)).not.toMatch(/launchMode|internal/);
  });
  it("is decided on the server by the admin dashboard's own role check, and production costs no query", () => {
    const launch = code("lib/ai/character-replace/launch-server.ts");
    expect(launch).toContain('import "server-only"');
    expect(launch).toContain('if (config.ops.launchMode !== "internal") return true;');
    expect(launch).toContain('if (!subject || subject.kind !== "user") return false;');
    expect(launch).toContain("const admin = await getAdminUser().catch(() => null);");
    expect(launch).toContain("return !!admin && admin.id === subject.userId;");
  });
  it("gates the three doors — config (available + the reason), create (before a ticket), start (before the reserve)", () => {
    const config = code("app/api/ai/character-replace/config/route.ts");
    expect(config).toContain("available: config.enabled && entitlement.allowed && launched,");
    expect(config).toContain("unavailableReason: config.enabled && entitlement.allowed && !launched ? LAUNCH_INTERNAL_MESSAGE : null,");

    const create = code("app/api/ai/character-replace/jobs/route.ts");
    const createGate = create.indexOf('if (!(await launchAllows(config, subject))) return fail("FEATURE_UNAVAILABLE", { error: LAUNCH_INTERNAL_MESSAGE });');
    expect(createGate).toBeGreaterThan(-1);
    expect(createGate).toBeLessThan(create.indexOf("createSourceUploadTicket("));

    const start = code("app/api/ai/character-replace/jobs/[id]/start/route.ts");
    const startGate = start.indexOf('if (!(await launchAllows(config, subject))) return fail("FEATURE_UNAVAILABLE", { error: LAUNCH_INTERNAL_MESSAGE });');
    expect(startGate).toBeGreaterThan(-1);
    expect(startGate).toBeLessThan(start.indexOf("reserveCharacterReplaceCharge("));
    expect(startGate).toBeLessThan(start.indexOf("claimJobStart("));
  });
  it("the admin form offers exactly the two modes, saves it under ops, and warns on both directions of the switch", () => {
    const form = src("features/admin/character-replace-pricing.tsx");
    expect(form).toContain('<option value="production">');
    expect(form).toContain('<option value="internal">');
    expect(form).toMatch(/ops: \{[\s\S]*?launchMode,[\s\S]*?circuitBreaker: \{/);
    expect(form).toContain('payload.ops.launchMode === "internal" && cr.ops.launchMode !== "internal"');
    expect(form).toContain('payload.ops.launchMode === "production" && cr.ops.launchMode === "internal"');
    const route = code("app/api/admin/landing/route.ts");
    expect(route).toContain('launchMode: z.enum(["production", "internal"]).optional(),');
  });
  it("the workspace shows the launch sentence in the Unavailable card instead of the generic one", () => {
    const hook = code("features/ai/character-replace/use-character-replace-workspace.ts");
    expect(hook).toContain("configError: res.available ? null : (res.unavailableReason ?? null),");
    const client = code("lib/ai/character-replace/client.ts");
    expect(client).toContain("unavailableReason?: string | null;");
  });
});

describe("nothing floats over the workspace's sticky bar (Part 9 rule, third offender found in Part 10)", () => {
  it("the install card, the push nudge and the Messages pill all stay off /studio/ai/character-replace", () => {
    const install = code("features/notifications/ios-install-prompt.tsx");
    expect(install).toContain('const onWorkspace = (pathname ?? "").startsWith("/studio/ai/character-replace")');
    expect(install).toContain('{mode !== "hidden" && !onWorkspace ? (');
    expect(code("features/notifications/push-nudge.tsx")).toContain('if ((pathname ?? "").startsWith("/studio/ai/character-replace")) return;');
    expect(code("features/app-shell/floating-messages.tsx")).toContain('if (pathname.startsWith("/studio/ai/character-replace")) return null;');
  });
});
