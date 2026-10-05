/**
 * Which Frenz AI paths middleware guards.
 *
 * Owner, 2026-10-05, replacing the 2026-09-09 "signed in or nothing" rule:
 * "anonymous users should only see the welcome page and description, when
 * they click the explore it show a pop up modal that says sign in or login to
 * use frenz ai features."
 *
 * So EXACTLY `/ai` — the welcome page — is open, and nothing else under it.
 * An exact match, not a prefix: `/ai/text-to-video`, `/ai/history` and every
 * other tool must still bounce a guest to /login, and a prefix test is how
 * `/ai/anything` would quietly become public too.
 *
 * `/studio/ai` stays guarded: it is the Studio shell's door for members, and
 * the public welcome lives at `/ai`.
 *
 * ⚠️ This is the PAGE gate. Every AI endpoint refuses a guest on its own
 * (`resolveAiSubject`), because a direct fetch never passes through a page.
 */
export const AI_PUBLIC_PATHS: ReadonlySet<string> = new Set(["/ai"]);

/** True for an `/ai…` path that requires a session. */
export function isGuardedAiPath(path: string): boolean {
  return path.startsWith("/ai") && !AI_PUBLIC_PATHS.has(path);
}
