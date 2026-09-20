import "server-only";

import { getAdminUser } from "@/lib/admin/guard";
import type { CharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import type { AiSubject } from "@/lib/ai/subject";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 10 §25 — SAFE LAUNCH MODE, DECIDED ON THE SERVER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ops.launchMode` is `production` (every member the plan policy allows) or
 * `internal` (administrators only). The check is the admin dashboard's own:
 * `getAdminUser()` re-reads the role from `profiles` on every request, so a
 * cohort is never a cookie, a flag in localStorage or anything a browser can
 * set. Three doors ask it — the config read (so the workspace says "not yet"
 * instead of loading), create and start (so a hand-made request is refused
 * before an upload ticket or a reservation exists). Results, history, the
 * wallet and recharges are untouched by the mode: the switch decides who may
 * make a NEW video, nothing else.
 *
 * Cheap by construction: in `production` this is a boolean and no query.
 */
export const LAUNCH_INTERNAL_MESSAGE = "Character Replace is opening gradually and isn't on your account yet. Your finished videos and balance are untouched — check back soon.";

export async function launchAllows(config: Pick<CharacterReplaceConfig, "ops">, subject: AiSubject | null): Promise<boolean> {
  if (config.ops.launchMode !== "internal") return true;
  if (!subject || subject.kind !== "user") return false;
  const admin = await getAdminUser().catch(() => null);
  return !!admin && admin.id === subject.userId;
}
