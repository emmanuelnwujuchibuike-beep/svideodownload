/**
 * Frosted-glass icon treatment for Home's colored gradient topbar (owner
 * mockup) — the app-wide IconTile/SuggestionsLauncher styles assume a
 * neutral background and would look like a mismatched gray blob on a
 * colorful wash, so this overrides just the background/ring/text via
 * tailwind-merge (cn()) rather than forking a whole new component.
 * IconTile's neutral variant paints `bg-gradient-to-b` (a background-IMAGE
 * utility) — tailwind-merge treats bg-color and bg-image as separate class
 * groups, so `bg-white/[0.12]` alone doesn't remove it, and a background-image
 * always paints over a background-color underneath: the override silently
 * no-ops without `bg-none` here to cancel the gradient first.
 */
export const GLASS_TILE = "bg-none bg-white/[0.12] shadow-none ring-1 ring-inset ring-white/15";
export const GLASS_CIRCLE = "bg-white/[0.12] text-white ring-1 ring-inset ring-white/15 hover:bg-white/20";
