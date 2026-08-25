/**
 * Discovery Orbit™ catalogue — pure, client-safe (Feature 15 Part 8). Split
 * out of orbits.ts specifically so `features/explore/orbit-rail.tsx` (a
 * client component) can import the TABS/TYPES without pulling in
 * `getOrbitFeed`'s data layer, which transitively imports server-only code
 * (lib/social/home-feed.ts → posts.ts → lib/supabase/paginate.ts, marked
 * "server-only"). A single-file module isn't tree-shaken out of a client
 * bundle just because a component only imports its types/constants — the
 * whole file's import graph comes along, which broke the production build
 * the first time this shipped as one file. Same reasoning as
 * lib/social/smart-feed.ts staying deliberately import-light.
 */

export type OrbitId =
  | "friend"
  | "creator"
  | "music"
  | "nearby"
  | "trending"
  | "learning"
  | "gaming"
  | "travel"
  | "business"
  | "community";

export interface OrbitDef {
  id: OrbitId;
  label: string;
  description: string;
}

export const ORBITS: OrbitDef[] = [
  { id: "friend", label: "Friends", description: "Posts from people you follow" },
  { id: "creator", label: "Creators", description: "New and emerging creators to follow" },
  { id: "music", label: "Music", description: "Trending sounds" },
  { id: "nearby", label: "Nearby", description: "Fresh content from your area" },
  { id: "trending", label: "Trending", description: "What's popular right now" },
  { id: "learning", label: "Learning", description: "Education & how-to" },
  { id: "gaming", label: "Gaming", description: "Gameplay & gaming culture" },
  { id: "travel", label: "Travel", description: "Places & journeys" },
  { id: "business", label: "Business", description: "Entrepreneurship & work" },
  { id: "community", label: "Communities", description: "Groups you might like" },
];

export interface OrbitCard {
  id: string;
  kind: "post" | "creator" | "sound";
  href: string;
  title: string;
  subtitle?: string;
  imageUrl: string | null;
}

export interface OrbitResult {
  orbit: OrbitId;
  cards: OrbitCard[];
  /** True when this orbit has no real backend yet — the UI must show an
   *  honest explanation, never an empty grid that reads as "broken". */
  deferred?: boolean;
  deferredReason?: string;
}
