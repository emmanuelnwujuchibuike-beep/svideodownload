import { NextResponse } from "next/server";

import { publicCharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { LAUNCH_INTERNAL_MESSAGE, launchAllows } from "@/lib/ai/character-replace/launch-server";
import { voiceCapabilities } from "@/lib/ai/voice/capabilities";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { hasProviderFor } from "@/lib/ai/providers";
import { hasWorker } from "@/lib/worker";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/character-replace/config — what the workspace may offer.
 *
 * Owner, 2026-09-13 (Part 1, §7): "The actual availability of these options
 * should eventually come from backend/admin configuration. Do NOT hard-code
 * business rules into the frontend." This is the one place the browser learns
 * which qualities, lip-sync tiers, languages and voices exist, the ceilings a
 * file is checked against before an upload, the currency, and whether the
 * tool is on for this member.
 *
 * ── 🔴 THE RATES DO NOT LEAVE THE SERVER ─────────────────────────────────────
 *
 * `publicCharacterReplaceConfig` strips every price field. A browser that held
 * the per-second rate could compute a price, and §10 forbids the interface
 * from producing one: the only price a member ever sees is the server's quote
 * (POST /api/ai/character-replace/quote, Part 3). `pricingAvailable` says the
 * engine is there; the interface asks it for every change of inputs.
 *
 * Signed in only, like every AI endpoint — `resolveAiSubject` refuses an
 * anonymous request regardless of what the page did.
 */
export async function GET(request: Request) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
  }

  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject) {
    return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  }

  const burst = await aiJobReadLimiter.limit(`ai-cr-config:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  try {
    const [settings, entitlement] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature)]);
    const cr = settings.frenzAiCharacterReplace;
    // Part 10 §25: in `internal` launch mode only administrators may make a new video; everyone else reads "not yet".
    const launched = await launchAllows(cr, subject);
    const config = publicCharacterReplaceConfig(
      settings.frenzAiCharacterReplace,
      { code: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) },
      // Part 3: the engine exists (lib/ai/character-replace/pricing.ts) and
      // POST /api/ai/character-replace/quote answers with the server's price.
      true,
      // 2026-09-20: a voice feature whose provider key is missing here is not offered (it would be refused at Start)
      voiceCapabilities(cr),
    );
    return NextResponse.json({
      config,
      /*
       * The operator's switch AND the plan policy, folded into one boolean the
       * entry card and the workspace both read. A tool that is on but not
       * offered to this audience is "unavailable" to them, with the entitlement
       * carrying the why.
       */
      available: config.enabled && entitlement.allowed && launched,
      /** Part 10 §25: the sentence the workspace shows when the launch mode, not a switch, is why. Null otherwise. */
      unavailableReason: config.enabled && entitlement.allowed && !launched ? LAUNCH_INTERNAL_MESSAGE : null,
      audience: entitlement.audience,
      /*
        Part 4: whether a job can actually be RUN on this deployment — the
        provider token is present and the worker that trims is reachable. The
        workspace enables Start on this, never on a constant.
      */
      processingAvailable: hasProviderFor(feature) && hasWorker && cr.ops.processingEnabled && !cr.ops.maintenanceMode,
      /*
        Part 8 §2, §30: why Start is off, in the operator's words when it is
        maintenance. The workspace shows this instead of a generic "not
        available"; nothing else about the switches reaches a browser.
      */
      maintenance: cr.ops.maintenanceMode ? { active: true, message: cr.ops.maintenanceMessage } : { active: false, message: null },
      processingPaused: !cr.ops.processingEnabled && !cr.ops.maintenanceMode,
    });
  } catch (e) {
    console.error("[ai/character-replace/config] read failed", { subject: subject.key, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
