import "server-only";

import { listUsableVoiceClones, type VoiceCloneRow } from "@/lib/ai/voice-clone/clones";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A CLONED VOICE, OFFERED TO THE OTHER TOOLS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A clone is only worth making if it can be spoken with, so Text to Audio and
 * Lip Sync Pro both offer the member's own voices beside the catalogue's. This
 * module is the ONE place that decides how a clone appears in a voice list and
 * how a picked one is read back.
 *
 * ── 🔴 THE PREFIX IS A SECURITY BOUNDARY, NOT A CONVENIENCE ─────────────────
 *
 * A clone is offered as `clone:<our uuid>`. The prefix exists so that a value
 * arriving from a browser is UNAMBIGUOUS about which namespace it is in: a
 * catalogue id is looked up in the operator's catalogue, a `clone:` id is
 * looked up in `ai_voice_clones` SCOPED BY THE MEMBER'S OWN USER ID. Neither
 * lookup can be made to return the other's row, and neither accepts a
 * provider's voice id at all.
 *
 * Before 2026-09-27 this project's rule was that no member-supplied value could
 * ever reach a provider's `voice_id` field (lib/ai/voice/tts-provider.ts §6).
 * That rule was right, and this does not break it: what reaches the provider is
 * still a value the SERVER looked up, from a row the server wrote, owned by the
 * member asking. The browser never names a provider voice.
 *
 * ── 🔴 CLONES ARE A DIRECT-API-ONLY OFFER ───────────────────────────────────
 *
 * The Replicate ElevenLabs wrapper takes a voice NAME from a fixed enum of 26.
 * A clone has no name in that enum and never will, so offering one on that
 * route would be offering a voice that cannot speak. Callers pass
 * `allowed: false` for the Replicate route and the list is simply empty.
 */
export const CLONE_VOICE_PREFIX = "clone:";

/** Whether a voice id from a browser is naming one of the member's own voices. */
export function isCloneVoiceId(voiceId: string | null | undefined): boolean {
  return typeof voiceId === "string" && voiceId.startsWith(CLONE_VOICE_PREFIX);
}

/** The uuid inside a `clone:` id, or null when it is not one (or is malformed). */
export function cloneIdFromVoiceId(voiceId: string): string | null {
  if (!isCloneVoiceId(voiceId)) return null;
  const id = voiceId.slice(CLONE_VOICE_PREFIX.length).trim();
  return /^[0-9a-fA-F-]{36}$/.test(id) ? id : null;
}

export function voiceIdForClone(cloneId: string): string {
  return `${CLONE_VOICE_PREFIX}${cloneId}`;
}

export interface UsableCloneOption {
  id: string;
  label: string;
  blurb: string;
  /** Empty = every language the model speaks. A clone is not limited to one; ElevenLabs speaks it in all of them. */
  languages: readonly string[];
  gender: string;
  /** True, so an interface can group "Your voices" apart from the catalogue. */
  own: true;
}

export function cloneVoiceOption(row: VoiceCloneRow): UsableCloneOption {
  return { id: voiceIdForClone(row.id), label: row.name, blurb: row.description || "Your own cloned voice.", languages: [], gender: "neutral", own: true };
}

/**
 * The member's own voices, as a voice list's rows. Never throws and never
 * refuses the tool: a library that cannot be read means the catalogue's voices
 * are offered alone, because a member whose clones are momentarily unreadable
 * should still be able to make audio.
 */
export async function usableCloneOptions(userId: string, opts: { allowed: boolean }): Promise<UsableCloneOption[]> {
  if (!opts.allowed) return [];
  const rows = await listUsableVoiceClones(userId).catch(() => []);
  return rows.map(cloneVoiceOption);
}
