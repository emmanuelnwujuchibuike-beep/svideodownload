/**
 * Pure profile mood/accent constants — split out of `lib/social/profile.ts`
 * (2026-08-18) because that file unconditionally imports `@/lib/cache`
 * (Redis) and `@/lib/supabase/admin` (the service-role client) at module
 * top, and neither had a `server-only` guard. Two CLIENT components
 * (`identity-field-editor.tsx`, `private-journal-card.tsx`) only needed
 * these small label/hex lists, but importing them from `profile.ts` pulled
 * the entire Redis client surface into the browser bundle — ~17kB gzipped,
 * on every profile page load, for constants with zero real dependencies.
 */

/** The moods a member may set (Feature 18 · Part 9). Stored as the label itself,
 *  so the profile can render it with no lookup. No emoji — labels only, per the
 *  brand's no-emoji design rule. */
export const PROFILE_MOODS = [
  "Inspired",
  "Focused",
  "Relaxed",
  "Excited",
  "Creative",
  "Celebrating",
  "Motivated",
  "Peaceful",
] as const;
export type ProfileMood = (typeof PROFILE_MOODS)[number];

/** The profile accent palette (migration 0096). Stored as the key; mapped to a
 *  brand-safe hex via `accentHex` in profile.ts. Drives a subtle accent line
 *  on the Identity Card. */
export const PROFILE_ACCENTS = [
  { key: "blue", label: "Electric Blue", hex: "#0A84FF" },
  { key: "violet", label: "Royal Purple", hex: "#6C4DFF" },
  { key: "emerald", label: "Emerald", hex: "#10b981" },
  { key: "rose", label: "Rose", hex: "#f43f5e" },
  { key: "amber", label: "Amber", hex: "#f59e0b" },
  { key: "cyan", label: "Cyan", hex: "#06b6d4" },
] as const;
export const PROFILE_ACCENT_KEYS = ["blue", "violet", "emerald", "rose", "amber", "cyan"] as const;
