import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CHARACTER_REPLACE_DEFAULTS, modeConfig, normalizeCharacterReplaceConfig, publicCharacterReplaceConfig } from "./config";
import { KNOWN_REPLACEMENT_MODELS, REPLACEMENT_MODE_COPY, REPLACEMENT_MODES, REPLACEMENT_SCOPE, UPPER_BODY_TIER_MAP, knownModelsFor, modelServesMode, replacementPhotoGuidance } from "./modes";
import { quoteCharacterReplace, validateQuoteInput } from "./pricing";
import { adaptersForMode, replacementProviderFor, replacementRouteOk, replacementRoutes } from "./providers/router";
import { validatePhotoFraming } from "./validate";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const money = { currency: "USD", symbol: "$", now: new Date("2026-09-20T12:00:00Z") };

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FOUR REPLACEMENT SCOPES (2026-09-20) — Face Only · Face + Head · Upper Body · Full Character
 * ═══════════════════════════════════════════════════════════════════════════
 */

describe("the customer vocabulary is the brief's, the stored ids are stable", () => {
  it("four scopes in the customer's order, with the brief's names and sentences", () => {
    expect(REPLACEMENT_MODES).toEqual(["face_only", "skin_face", "upper_body", "full_character"]);
    expect(REPLACEMENT_MODES.map((m) => REPLACEMENT_MODE_COPY[m].label)).toEqual(["Face Only", "Face + Head", "Upper Body", "Full Character"]);
    expect(REPLACEMENT_MODE_COPY.face_only.tagline).toBe("Replace the face while keeping the original body and clothing.");
    expect(REPLACEMENT_MODE_COPY.skin_face.tagline).toBe("Replace the face and head appearance while keeping the original body.");
    expect(REPLACEMENT_MODE_COPY.upper_body.tagline).toBe("Replace your face, head, torso and upper-body appearance.");
    expect(REPLACEMENT_MODE_COPY.full_character.tagline).toBe("Replace the entire character while preserving the video's movement, expressions and scene.");
    expect(REPLACEMENT_SCOPE).toEqual({ face_only: "FACE_ONLY", skin_face: "FACE_HEAD", upper_body: "UPPER_BODY", full_character: "FULL_CHARACTER" });
  });
  it("the photo guidance is per scope: a portrait for Face Only, never a full body", () => {
    expect(replacementPhotoGuidance("face_only")).toMatchObject({ best: "Best results: clear front-facing portrait with good lighting.", framing: "portrait" });
    expect(replacementPhotoGuidance("skin_face")).toMatchObject({ best: "Best results: head and shoulders visible, clear face and hair.", framing: "head_shoulders" });
    expect(replacementPhotoGuidance("upper_body")).toMatchObject({ best: "Best results: chest/waist-up photo with your clothing clearly visible.", framing: "half_body" });
    expect(replacementPhotoGuidance("full_character")).toMatchObject({ best: "Best results: full-body photo with one person clearly visible.", framing: "full_body" });
  });
  it("no customer-facing copy names a model", () => {
    const text = JSON.stringify(REPLACEMENT_MODE_COPY) + src("features/ai/frenz-ai-explore.tsx") + src("features/ai/frenz-ai-tools-grid.tsx") + src("features/ai/character-replace/input-direction.tsx") + src("features/ai/character-replace/tutorial-example.tsx");
    expect(text).not.toMatch(/xrunda|prunaai|wan-video|Wan 2\.2|Roop/);
  });
});

describe("the photo's shape against the scope (brief §3, §14) — deterministic, before any upload or provider call", () => {
  it("a portrait passes Face Only and fails Full Character; a landscape photo fails every body scope", () => {
    expect(validatePhotoFraming({ width: 800, height: 1000 }, "face_only")).toEqual({ ok: true });
    expect(validatePhotoFraming({ width: 800, height: 1000 }, "upper_body")).toEqual({ ok: true });
    expect(validatePhotoFraming({ width: 800, height: 1000 }, "full_character")).toEqual({ ok: true });
    expect(validatePhotoFraming({ width: 1600, height: 900 }, "full_character")).toEqual({ ok: false, code: "image-wrong-framing" });
    expect(validatePhotoFraming({ width: 1600, height: 900 }, "upper_body")).toEqual({ ok: false, code: "image-wrong-framing" });
    // Face Only tolerates a wide crop up to 2.2:1 (a selfie in landscape is still a face)
    expect(validatePhotoFraming({ width: 1600, height: 900 }, "face_only")).toEqual({ ok: true });
    expect(validatePhotoFraming({ width: 2400, height: 900 }, "face_only")).toEqual({ ok: false, code: "image-wrong-framing" });
    expect(validatePhotoFraming({ width: 300, height: 500 }, "full_character")).toEqual({ ok: false, code: "image-too-small" });
    expect(validatePhotoFraming(null, "face_only")).toEqual({ ok: false, code: "invalid-image" });
  });
  it("is applied at the picker (with the example one tap away), at create and on the worker from the decoded file; a mode change drops a photo that no longer fits", () => {
    const hook = code("features/ai/character-replace/use-character-replace-workspace.ts");
    expect(hook).toContain("const framing = validatePhotoFraming(size, state.project.mode);");
    expect(code("features/ai/character-replace/step-photo.tsx")).toContain("guidance={{ best: copy.photo.best, example:");
    expect(code("features/ai/character-replace/media-picker.tsx")).toContain('error === "image-wrong-framing" || error === "image-too-small"');
    expect(code("lib/ai/character-replace/open-job.ts")).toContain("const framingVerdict = validatePhotoFraming({ width: image.width, height: image.height }, mode);");
    const worker = code("server/services/ai-character-replace-prepare-service.ts");
    expect(worker).toContain("const framing = validatePhotoFraming({ width: probe.width, height: probe.height }, mode.mode);");
    expect(worker.indexOf("validatePhotoFraming(")).toBeLessThan(worker.indexOf("const cut = await runPrepare(args);"));
    expect(code("lib/ai/character-replace/workspace.ts")).toContain("!validatePhotoFraming({ width: state.project.character.width, height: state.project.character.height }, action.mode).ok ? null : state.project.character");
  });
});

describe("provider routing is configuration, never a request (brief §4, §12)", () => {
  it("the pure catalogue and the adapters agree on which models serve which scopes", () => {
    for (const mode of REPLACEMENT_MODES) {
      const fromAdapters = adaptersForMode(mode).map((a) => a.model).sort();
      const fromCatalogue = knownModelsFor(mode).map((m) => m.model).sort();
      expect(fromAdapters, mode).toEqual(fromCatalogue);
    }
    expect(KNOWN_REPLACEMENT_MODELS.map((m) => m.model)).toEqual(["xrunda/hello", "prunaai/p-video-replace", "wan-video/wan-2.2-animate-replace"]);
    expect(modelServesMode("xrunda/hello", "upper_body")).toBe(false);
    expect(modelServesMode("wan-video/wan-2.2-animate-replace", "upper_body")).toBe(true);
  });
  it("the defaults route every scope; Upper Body on Wan uses the upper-body adapter's tiers, not Full Character's resolutions", () => {
    const config = CHARACTER_REPLACE_DEFAULTS;
    expect(replacementRoutes(config).map((r) => [r.mode, r.model, r.routed])).toEqual([
      ["face_only", "xrunda/hello", true],
      ["skin_face", "prunaai/p-video-replace", true],
      ["upper_body", "wan-video/wan-2.2-animate-replace", true],
      ["full_character", "wan-video/wan-2.2-animate-replace", true],
    ]);
    const upper = replacementProviderFor("upper_body", config);
    expect(upper.mode).toBe("upper_body");
    expect(upper.settingsFor("standard")).toEqual({ resolution: "480" });
    expect(upper.settingsFor("high")).toEqual({ resolution: "720" });
    expect(upper.settingsFor("ultra")).toBeNull();
    expect(upper.settingsFor("1080p")).toBeNull();
    expect(replacementProviderFor("full_character", config).mode).toBe("full_character");
    expect(UPPER_BODY_TIER_MAP.ultra.support).toBe("unsupported");
  });
  it("a configured model no adapter serves leaves the scope unroutable — and the submit path refuses, never guesses", () => {
    const config = normalizeCharacterReplaceConfig({ modes: { upper_body: { provider: { model: "xrunda/hello" } } } });
    expect(modeConfig(config, "upper_body").providerModel).toBe("xrunda/hello");
    expect(replacementRouteOk("upper_body", config)).toBe(false);
    // the fallback adapter is the code default, and submit checks supportsMode first
    expect(replacementProviderFor("upper_body", config).supportsMode("upper_body")).toBe(true);
    const submit = code("lib/ai/character-replace/submit.ts");
    expect(submit).toContain("const provider = replacementProviderFor(meta.mode, config);");
    expect(submit).toContain("if (!provider.supportsMode(meta.mode)) throw new AiJobError(");
  });
  it("every adapter declares its capabilities and a linear cost estimate; the customer never sees them", () => {
    for (const mode of REPLACEMENT_MODES) {
      const p = replacementProviderFor(mode, CHARACTER_REPLACE_DEFAULTS);
      expect(p.capabilities.modes).toContain(mode);
      expect(p.capabilities.maxReferenceImages).toBeGreaterThanOrEqual(1);
      expect(p.estimateProcessingCostUsdCents(3000, 10)).toBe(30);
      expect(p.estimateProcessingCostUsdCents(3000, 0)).toBeNull();
    }
    const pub = JSON.stringify(publicCharacterReplaceConfig(CHARACTER_REPLACE_DEFAULTS, { code: "USD", symbol: "$" }, true));
    expect(pub).not.toMatch(/capabilities|providerModel|xrunda|prunaai|wan-video|perSecondCents|basePriceCents/);
  });
});

describe("pricing depends on the scope (brief §6–§8)", () => {
  it("each scope has its own tiers and its own per-video price; the quote carries them by name", () => {
    const config = normalizeCharacterReplaceConfig({ modes: { upper_body: { basePriceCents: 100 } } });
    const upper = quoteCharacterReplace({ selectedDurationMs: 8000, mode: "upper_body", quality: "high", voiceMode: "original", voiceSource: null, ttsCharacters: 0, lipSyncMode: null }, config, money);
    expect(upper.modeBasePriceCents).toBe(100);
    expect(upper.basePriceCents).toBe(100);
    expect(upper.qualityRateCents).toBe(45);
    expect(upper.videoCents).toBe(360);
    expect(upper.totalCents).toBe(Math.max(config.minimumChargeCents, 460));
    expect(upper.lines.find((l) => l.key === "base")?.amountCents).toBe(100);
    expect(upper.lines.find((l) => l.key === "character")?.value).toBe("Upper Body");
    const full = quoteCharacterReplace({ selectedDurationMs: 8000, mode: "full_character", quality: "720p", voiceMode: "original", voiceSource: null, ttsCharacters: 0, lipSyncMode: null }, config, money);
    // Full Character keeps the top-level base price, never the scope's
    expect(full.modeBasePriceCents).toBe(0);
    expect(full.basePriceCents).toBe(config.basePriceCents);
    const face = quoteCharacterReplace({ selectedDurationMs: 8000, mode: "face_only", quality: "standard", voiceMode: "original", voiceSource: null, ttsCharacters: 0, lipSyncMode: null }, config, money);
    expect(face.totalCents).not.toBe(upper.totalCents);
  });
  it("a scope's unsupported quality is refused, never downgraded; a disabled scope is refused", () => {
    const config = normalizeCharacterReplaceConfig({ modes: { skin_face: { enabled: false } } });
    expect(validateQuoteInput({ selectedDurationMs: 3000, mode: "upper_body", quality: "ultra", voiceMode: "original", voiceSource: null, ttsCharacters: 0, lipSyncMode: null }, config).ok).toBe(false);
    expect(validateQuoteInput({ selectedDurationMs: 3000, mode: "upper_body", quality: "1080p", voiceMode: "original", voiceSource: null, ttsCharacters: 0, lipSyncMode: null }, config).ok).toBe(false);
    expect(validateQuoteInput({ selectedDurationMs: 3000, mode: "upper_body", quality: "high", voiceMode: "original", voiceSource: null, ttsCharacters: 0, lipSyncMode: null }, config).ok).toBe(true);
    const off = validateQuoteInput({ selectedDurationMs: 3000, mode: "skin_face", quality: "high", voiceMode: "original", voiceSource: null, ttsCharacters: 0, lipSyncMode: null }, config);
    expect(off).toEqual({ ok: false, reason: "Face + Head isn't available right now." });
  });
  it("the public config carries a server-formatted price line per scope and the photo guidance — no rate", () => {
    const pub = publicCharacterReplaceConfig(CHARACTER_REPLACE_DEFAULTS, { code: "USD", symbol: "$" }, true);
    expect(pub.modes.map((m) => [m.id, m.priceLine])).toEqual([
      ["face_only", "from $0.15/sec"],
      ["skin_face", "from $0.30/sec"],
      ["upper_body", "from $0.30/sec"],
      ["full_character", expect.stringMatching(/^from \$\d+\.\d\d\/sec$/)],
    ]);
    expect(pub.modes.find((m) => m.id === "upper_body")?.photo).toEqual({ best: "Best results: chest/waist-up photo with your clothing clearly visible.", framing: "half_body" });
    const withBase = publicCharacterReplaceConfig(normalizeCharacterReplaceConfig({ modes: { face_only: { basePriceCents: 250 } } }), { code: "USD", symbol: "$" }, true);
    expect(withBase.modes[0]?.priceLine).toBe("from $0.15/sec + $2.50 per video");
  });
  it("the pricing fingerprint moves when a scope's base price or Upper Body's rate changes (a new pricing version)", () => {
    const fp = code("lib/ai/character-replace/config.ts");
    expect(fp).toContain('modes: (["face_only", "skin_face", "upper_body"] as const).map((m) => [m, config.modes[m].enabled, config.modes[m].basePriceCents, config.modes[m].tiers.map((t) => [t.id, t.perSecondCents, t.enabled])]),');
  });
});

describe("the immutable snapshot and the job's plan (brief §11, §16)", () => {
  it("/start writes scope, provider, model, original length, the trim and the rates beside the signed quote, and a provider_plan on the job", () => {
    const start = code("lib/ai/character-replace/start-job.ts");
    for (const k of ["replacementMode: snapshot.mode", "scope: REPLACEMENT_SCOPE[snapshot.mode]", "provider: plannedProvider.id", "providerModel: plannedProvider.model", "originalDurationMs: meta.video.durationMs", "selectedStartMs: selected.startMs", "selectedEndMs: selected.endMs", "selectedDurationMs: snapshot.durationMs", "outputQuality: snapshot.quality", "modeBasePriceCents: snapshot.modeBasePriceCents", "modePerSecondRateCents: snapshot.qualityRateCents", "lipSyncRateCents: snapshot.lipSyncRateCents", "voiceRateCents: snapshot.voiceRateCents", "totalPriceCents: snapshot.totalCents"]) {
      expect(start, k).toContain(k);
    }
    expect(start).toContain("reserveCharacterReplaceCharge({ userId: ownerId, jobId: job.id, snapshot: ledgerSnapshot })");
    expect(start).toContain("provider_plan: { id: plannedProvider.id, model: plannedProvider.model, scope: REPLACEMENT_SCOPE[snapshot.mode] },");
    // the plan is read from configuration at Start — never from the body
    expect(start).toContain("const plannedProvider = replacementProviderFor(meta.mode, config);");
  });
});

describe("the admin (brief §12, §13)", () => {
  it("the form offers only known models per scope, refuses a scope on without a serving model or a price, and enforces the cost guard unless overridden", () => {
    const form = src("features/admin/character-replace-pricing.tsx");
    expect(form).toContain("knownModelsFor(id).map((m) => (");
    expect(form).toContain("if (m.enabled && !modelServesMode(m.provider.model, id)) out.push(");
    expect(form).toContain("if (m.enabled && !m.tiers.some((t) => t.enabled)) out.push(");
    expect(form).toContain("if (!payload.pricingGuard.allowBelowMargin) {");
    expect(form).toContain('["upper_body", "Upper Body", upperBody, setUpperBody, UPPER_BODY_TIER_MAP,');
    expect(form).toContain('label="Price per video"');
    const route = code("app/api/admin/landing/route.ts");
    expect(route).toContain("upper_body: modeSchema.optional(),");
    expect(route).toContain("pricingGuard: z");
  });
  it("the normaliser carries Upper Body and the guard with sane defaults and clamps", () => {
    const c = normalizeCharacterReplaceConfig({ modes: { upper_body: { basePriceCents: -5, tiers: [{ id: "ultra", enabled: true }] } }, pricingGuard: { minimumMarginPercent: 5000, allowBelowMargin: true } });
    expect(c.modes.upper_body.basePriceCents).toBe(0);
    // ultra is unsupported on the upper-body map — forced off whatever the row says
    expect(c.modes.upper_body.tiers.find((t) => t.id === "ultra")?.enabled).toBe(false);
    expect(c.pricingGuard).toEqual({ minimumMarginPercent: 1000, minimumCustomerPriceCents: 0, allowBelowMargin: true });
    expect(CHARACTER_REPLACE_DEFAULTS.pricingGuard).toEqual({ minimumMarginPercent: 30, minimumCustomerPriceCents: 0, allowBelowMargin: false });
  });
});

describe("history and results name the scope (brief §17, §18)", () => {
  it("the history label map and the mode filter chips cover four scopes", () => {
    const history = code("lib/ai/history.ts");
    expect(history).toContain('const MODE_LABEL: Record<string, string> = { face_only: "Face Only", skin_face: "Face + Head", upper_body: "Upper Body", full_character: "Full Character" };');
    const page = code("features/ai/frenz-ai-history.tsx");
    expect(page).toContain('aria-label="Filter by replacement type"');
    expect(page).toContain('(["all", ...REPLACEMENT_MODES] as const)');
  });
});

describe("the studio has its own page (owner, 2026-09-20 — Explore AI Studio replaced the scope page the same evening)", () => {
  it("the tool's root route is Explore AI Studio; the workspace lives at /create with the scope in the query; both groups", () => {
    for (const p of ["app/(app)/studio/ai/character-replace/page.tsx", "app/(marketing)/ai/character-replace/page.tsx"]) {
      expect(code(p), p).toContain("<FrenzAIExplore createPath=");
    }
    // 🔴 never static under the Studio shell: its layout calls getUser(), and a prerendered redirect sent every member to Creator Studio
    expect(code("app/(app)/studio/ai/character-replace/page.tsx")).toContain('export const dynamic = "force-dynamic";');
    expect(code("app/(marketing)/ai/character-replace/page.tsx")).toContain('export const dynamic = "force-static";');
    for (const p of ["app/(app)/studio/ai/character-replace/create/page.tsx", "app/(marketing)/ai/character-replace/create/page.tsx"]) {
      const page = code(p);
      expect(page, p).toContain("initialMode={isReplacementMode(mode) ? mode : null}");
      expect(page, p).toMatch(/modeHref="\/(studio\/)?ai\/character-replace"/);
    }
    // the header strip skeleton sits on the create routes
    expect(src("app/(app)/studio/ai/character-replace/create/loading.tsx")).toContain("CharacterReplaceCreateSkeleton");
    expect(src("app/(marketing)/ai/character-replace/create/loading.tsx")).toContain("CharacterReplaceCreateSkeleton");
    // Paystack may send a member back to the create pages
    expect(code("lib/ai/character-replace/topup-server.ts")).toContain('"/studio/ai/character-replace/create"');
    expect(code("lib/ai/character-replace/topup-server.ts")).toContain('"/ai/character-replace/create"');
  });
  it("the Explore page prefetches every create link on landing, paints from a cached config, sends an older ?job= link to the create page, and its scope cards open the workspace on that scope", () => {
    const page = code("features/ai/frenz-ai-explore.tsx");
    expect(page).toContain("router.prefetch(createPath);");
    expect(page).toMatch(/for \(const m of REPLACEMENT_MODES\)\s*router\.prefetch\(`\$\{createPath\}\?mode=\$\{m\}`\);/);
    expect(page).toContain("const cached = readCachedConfig();");
    expect(page).toContain("router.replace(`${createPath}?job=${encodeURIComponent(job)}`);");
    const grid = code("features/ai/frenz-ai-tools-grid.tsx");
    for (const m of ["face_only", "skin_face", "upper_body", "full_character"]) expect(grid).toContain("href: `${create}?mode=" + m + "`,");
    // the workspace's step 1 is a navigation to the scope page, and the photo step's back goes there too
    const ws = code("features/ai/character-replace/character-replace-workspace.tsx");
    expect(ws).toContain('if (next === "mode") {');
    expect(ws).toContain("router.push(modeHref);");
    expect(ws).toContain("<StepHeader title={WORKSPACE_STEPS[index]?.title ?? \"\"} mode={project.mode} modeHref={modeHref} />");
    // the mode-hidden overlays (push nudge, Messages pill, Install card) match the create route by prefix
    expect(code("features/notifications/ios-install-prompt.tsx")).toContain('startsWith("/studio/ai/character-replace")');
  });
});
