import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import type { CharacterReplaceVoice } from "@/lib/ai/character-replace/config";
import { ElevenLabsError, elevenLabsConfigured, elevenLabsListVoices } from "@/lib/ai/voice/elevenlabs";
import { voiceAgeFromLabel, voiceGenderFromLabel } from "@/lib/ai/voice/elevenlabs-models";
import { getLandingSettings, setLandingSettings } from "@/lib/landing/settings";
import { recordConfigChange } from "@/lib/platform/config-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  IMPORT THE ELEVENLABS VOICE LIBRARY INTO THE CATALOGUE (2026-09-20)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reads what the ACCOUNT can actually use — the premade library plus any
 * voice the operator added — and writes it as the catalogue's DIRECT-API
 * rows (`provider: "elevenlabs_api"`, voice IDs; what the voice changer and
 * a direct-API text-to-speech model use), each with the provider's own
 * gender and age label. The Replicate rows (`elevenlabs`, voice NAMES) and
 * the MiniMax rows are left exactly as they are — on 2026-09-20 this route
 * replaced the Replicate names with ids and text-to-speech would have failed
 * at submit; the two are different vocabularies (config.ts VoiceProvider).
 * Members never see a provider id: the public config strips it.
 *
 * POST only, admin only, no body. Answers with the counts; the provider's
 * own sentence never leaves the server.
 */
export async function POST() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!elevenLabsConfigured()) return NextResponse.json({ error: "ELEVENLABS_API_KEY is not set on this deployment." }, { status: 503 });

  let rows;
  try {
    rows = await elevenLabsListVoices();
  } catch (e) {
    const kind = e instanceof ElevenLabsError ? e.kind : "provider";
    console.error("[admin/cr/voices/import] list failed", { admin: admin.id, kind, detail: String(e).slice(0, 300) });
    return NextResponse.json({ error: kind === "auth" ? "ElevenLabs refused the key. Check ELEVENLABS_API_KEY." : "ElevenLabs didn't answer. Try again in a moment." }, { status: 502 });
  }

  const settings = await getLandingSettings();
  const current = settings.frenzAiCharacterReplace.voices;
  const kept = current.filter((v) => v.provider !== "elevenlabs_api");
  const seen = new Set<string>();
  const imported: CharacterReplaceVoice[] = [];
  for (const r of rows) {
    // a stable, catalogue-shaped id from the provider's name; the provider id itself is what is sent
    const base = `ela-${r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`.slice(0, 40) || `ela-${r.voiceId.slice(0, 8).toLowerCase()}`;
    let id = base;
    for (let n = 2; seen.has(id); n++) id = `${base.slice(0, 36)}-${n}`;
    seen.add(id);
    const accent = r.labels.accent ? r.labels.accent : "";
    const useCase = r.labels.use_case ?? r.labels.usecase ?? "";
    const blurb = [r.labels.description ?? r.labels.descriptive ?? "", accent, useCase].filter(Boolean).join(" · ").slice(0, 80) || r.description.slice(0, 80);
    imported.push({
      id,
      label: r.name.slice(0, 40),
      blurb,
      languages: [],
      providerVoiceId: r.voiceId,
      provider: "elevenlabs_api",
      gender: voiceGenderFromLabel(r.labels.gender),
      age: voiceAgeFromLabel(r.labels.age),
    });
  }
  if (imported.length === 0) return NextResponse.json({ error: "The account has no voices to import." }, { status: 422 });

  const voices = [...kept, ...imported].slice(0, 80);
  try {
    await setLandingSettings({ frenzAiCharacterReplace: { voices } }, { changedBy: admin.id, reason: null });
  } catch (e) {
    console.error("[admin/cr/voices/import] save failed", { admin: admin.id, detail: String(e).slice(0, 300) });
    return NextResponse.json({ error: "Couldn't save the catalogue." }, { status: 500 });
  }
  recordConfigChange({
    actorId: admin.id,
    surface: "character_replace",
    targetId: "voices",
    action: "voices.import",
    before: { elevenlabs_api: current.length - kept.length, total: current.length },
    after: { elevenlabs_api: imported.length, total: voices.length },
  });
  console.info("[admin/cr/voices/import] imported", { admin: admin.id, imported: imported.length, kept: kept.length, dropped: Math.max(0, kept.length + imported.length - voices.length) });
  return NextResponse.json({ ok: true, imported: imported.length, kept: kept.length, total: voices.length });
}
