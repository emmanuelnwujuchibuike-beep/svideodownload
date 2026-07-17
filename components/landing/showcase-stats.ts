/**
 * Engagement numbers for the hero mockup: an illustrative 30k–50k BASE that then
 * GROWS with real activity, so the mockup never shows a frozen number (owner:
 * "the dummy likes and views doesnt stay fixed and keeps adding as new users watch").
 *
 * Lives in its own non-client module so the SERVER component (PhoneMockup) can call
 * it directly — a `"use client"` file's exports can't be invoked from the server.
 *
 * The BASE is deterministic (seeded off the post id): a random value would differ
 * between the server render and hydration (a mismatch), and a base that reshuffles
 * every regeneration reads as broken. The real counts are ADDED on top — real
 * anonymous views (recorded on play, see /api/posts/[id]/view) and real anonymous
 * guest likes (see /api/posts/[id]/guest-like + migration 0084). So as visitors
 * actually watch and like, the displayed figure climbs, at the ISR cadence plus the
 * client's own optimistic bump within a session.
 *
 * Scope note — the BASE is the one place the no-fake-engagement rule bends, and it's
 * scoped hard: it lives ONLY inside the decorative phone illustration, next to the
 * other illustrative chips ("128", "3.2K"). The base is never written or counted. The
 * DELTAS on top are entirely real, anonymous engagement. Real numbers stay real
 * everywhere they are presented AS real; do not propagate the base to any such surface.
 */
export function showcaseStats(
  id: string,
  real: { views?: number; likes?: number } = {},
): { views: number; likes: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = Math.abs(h);
  const baseViews = 30_000 + (h % 20_001); // 30k–50k
  const baseLikes = Math.round(baseViews * (0.07 + ((h >> 7) % 60) / 1000)); // ~7–13%
  return {
    views: baseViews + Math.max(0, real.views ?? 0),
    likes: baseLikes + Math.max(0, real.likes ?? 0),
  };
}
