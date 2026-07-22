/**
 * Component Registry — the Enterprise Design System's catalogue of every shared,
 * reusable UI building block.
 *
 * The brief's "Component Registry™": one place documenting each component, the
 * file it lives in, its category, its accessibility requirement and its motion
 * behaviour. It is a CATALOGUE over the real components in `components/*` and
 * `features/ui/*` — not a new abstraction — kept honest by
 * `component-registry.test.ts`: a `live` entry must point at a file that exists,
 * a `planned` one must not pretend to, and every id is unique.
 *
 * ── Three honest statuses ─────────────────────────────────────────────────────
 * Not every archetype the brief lists (Button, Input, Card) is a wrapper
 * component here: this app composes those from Tailwind utilities on the design
 * tokens rather than shipping a `<Button>`. Calling those `convention` (a
 * documented utility pattern, no component file) instead of `live` keeps the
 * catalogue truthful — it never claims a component that isn't there, and it never
 * hides a pattern that every screen actually uses.
 *
 *   live       — a real shared component file (source exists).
 *   convention — a utility-class pattern on the tokens; no wrapper component.
 *   planned    — named by the brief, not built. Honest placeholder.
 */

export type ComponentCategory =
  | "brand"
  | "icon"
  | "input"
  | "surface"
  | "overlay"
  | "navigation"
  | "feedback"
  | "media"
  | "motion"
  | "skeleton";

export type ComponentStatus = "live" | "convention" | "planned";

export interface ComponentDef {
  id: string;
  name: string;
  category: ComponentCategory;
  /** Repo-relative source. Required for `live`; optional for `convention`; empty for `planned`. */
  source: string;
  status: ComponentStatus;
  /** What the component must do to be accessible (the a11y contract). */
  a11y: string;
  /** Its motion behaviour, and how it honours reduced-motion. */
  motion: string;
  note?: string;
}

export const COMPONENTS: ComponentDef[] = [
  /* ── Brand ── */
  { id: "frenz-wordmark", name: "Frenz logo / wordmark", category: "brand", source: "components/brand/frenz-logo.tsx", status: "live", a11y: "Decorative in-chrome; the surrounding link carries the label. Standalone marks take an aria-label.", motion: "Static; no idle animation (battery rule)." },
  { id: "wow-icon", name: "Wow reaction mark", category: "brand", source: "components/brand/wow-icon.tsx", status: "live", a11y: "aria-hidden; the pressable control owns the label.", motion: "Burst on interaction only." },
  { id: "diamond-crown-badge", name: "Premium badge", category: "brand", source: "components/badges/diamond-crown-badge.tsx", status: "live", a11y: "aria-label describes the tier; not colour-only.", motion: "Static; optional shimmer under motion-safe." },

  /* ── Icon system ── */
  { id: "icon-tile", name: "Topbar icon glyph", category: "icon", source: "components/icons/icon-tile.tsx", status: "live", a11y: "Bare glyph; the wrapping button provides the accessible name.", motion: "Colour transition only." },
  { id: "module-icon-badge", name: "Module icon badge", category: "icon", source: "components/icons/module-icon-badge.tsx", status: "live", a11y: "Decorative; paired with a visible label.", motion: "Static glass tile; no idle motion." },
  { id: "nav-icon-badge", name: "Nav icon badge", category: "icon", source: "components/icons/nav-icon-badge.tsx", status: "live", a11y: "Decorative; the nav item labels it.", motion: "Active-state transition only." },
  { id: "frenz-icons", name: "Brand icon set", category: "icon", source: "components/icons/frenz-icons.tsx", status: "live", a11y: "aria-hidden glyphs; consumers label the control.", motion: "None." },

  /* ── Inputs ── */
  { id: "switch", name: "Switch / toggle", category: "input", source: "components/ui/switch.tsx", status: "live", a11y: "role=switch with aria-checked; keyboard-operable; visible focus ring.", motion: "Thumb slides on the shared duration; instant under reduced-motion." },
  { id: "theme-toggle", name: "Theme toggle", category: "input", source: "components/theme-toggle.tsx", status: "live", a11y: "Labelled button; announces the target theme; keyboard-operable.", motion: "Icon crossfade only." },
  { id: "button", name: "Button", category: "input", source: "", status: "convention", a11y: "Real <button>/<a>; visible focus-visible ring; ≥44px touch target; never colour-only state.", motion: "active:scale press; hover sheen under motion-safe.", note: "Utility-class composition on the tokens (bg-primary / rounded-2xl / shadow), not a wrapper component." },
  { id: "input", name: "Text input", category: "input", source: "", status: "convention", a11y: "Labelled (aria-label or <label>); focus ring; error text tied via aria-describedby.", motion: "Ring transition only.", note: "Utility-class pattern (h-16 rounded-2xl ring-1 focus:ring-2) on the tokens." },

  /* ── Surfaces ── */
  { id: "card", name: "Card", category: "surface", source: "", status: "convention", a11y: "Semantic sectioning; heading hierarchy preserved.", motion: "Optional compositor-only hover lift.", note: "rounded-3xl border bg-card shadow-soft/-card pattern on the tokens." },
  { id: "usage-dashboard", name: "Usage dashboard", category: "surface", source: "features/downloads/usage-dashboard.tsx", status: "live", a11y: "Labelled section; meter values in text, never bar-only.", motion: "Width transitions on the meter; none under reduced-motion." },
  { id: "history-panel", name: "Download history panel", category: "surface", source: "features/history/history-panel.tsx", status: "live", a11y: "Search input labelled; icon buttons carry aria-labels.", motion: "None beyond hover." },

  /* ── Overlays ── */
  { id: "quota-gate", name: "Quota gate dialog", category: "overlay", source: "features/downloads/quota-gate.tsx", status: "live", a11y: "role=dialog, aria-modal, aria-labelledby; Escape closes; body scroll-locked.", motion: "Spring in/out; respects AnimatePresence + reduced-motion." },
  { id: "command-center", name: "Command centre (⌘K)", category: "overlay", source: "features/navigation/command-center.tsx", status: "live", a11y: "Dialog semantics; arrow-key navigation; focus trapped; labelled results.", motion: "Fade/scale in; reduced-motion aware." },
  { id: "floating-progress", name: "Floating download card", category: "overlay", source: "features/downloads/floating-progress.tsx", status: "live", a11y: "role=status, aria-live=polite; dismiss button labelled.", motion: "Spring slide-in from the bottom." },
  { id: "toast", name: "Toast", category: "feedback", source: "features/ui/toast.tsx", status: "live", a11y: "role=status/alert with aria-live; auto-dismiss pauses on focus.", motion: "Slide/fade; reduced-motion shortens to a fade." },
  { id: "sheet", name: "Bottom sheet", category: "overlay", source: "", status: "convention", a11y: "role=dialog, aria-modal; drag handle labelled; Escape + scrim close; scroll-locked.", motion: "Shared spring token; drag-to-dismiss.", note: "A repeated pattern (thread options, composer) on the shared spring token, not one wrapper yet." },

  /* ── Navigation ── */
  { id: "search-trigger", name: "Search trigger", category: "navigation", source: "features/navigation/search-trigger.tsx", status: "live", a11y: "Labelled button; opens the command centre; keyboard shortcut hinted.", motion: "None." },
  { id: "downloads-entry", name: "Downloads entry", category: "navigation", source: "features/downloads/downloads-entry.tsx", status: "live", a11y: "Labelled link (aria-label/title); auth-aware target; prefetched.", motion: "Colour transition only." },
  { id: "pull-to-refresh", name: "Pull to refresh", category: "navigation", source: "features/ui/pull-to-refresh.tsx", status: "live", a11y: "Gesture augments, never replaces, a reachable refresh; announces state.", motion: "Finger-tracked; spring release." },

  /* ── Feedback ── */
  { id: "animated-count", name: "Animated count", category: "feedback", source: "features/ui/animated-count.tsx", status: "live", a11y: "Final value is the accessible text; motion is decorative.", motion: "Tween to value; jumps instantly under reduced-motion." },
  { id: "reaction-float", name: "Reaction float", category: "feedback", source: "features/ui/reaction-float.tsx", status: "live", a11y: "Purely decorative; aria-hidden.", motion: "Float-and-fade burst on interaction only." },

  /* ── Media ── */
  { id: "download-player", name: "In-browser media player", category: "media", source: "features/downloads/download-player.tsx", status: "live", a11y: "Native controls; labelled; keyboard-operable.", motion: "Open/close transition." },
  { id: "fade-image", name: "Fade-in image", category: "media", source: "features/ui/fade-image.tsx", status: "live", a11y: "Requires meaningful alt (empty alt for decorative).", motion: "Opacity fade on load; instant under reduced-motion." },

  /* ── Motion ── */
  { id: "reveal", name: "Scroll reveal", category: "motion", source: "components/ui/reveal.tsx", status: "live", a11y: "Content must remain reachable if the observer never fires.", motion: "Fade-up when scrolled into view; disabled under reduced-motion." },
  { id: "press-icon", name: "Press icon", category: "motion", source: "components/motion/press-icon.tsx", status: "live", a11y: "Wraps a real control; label comes from it.", motion: "Scale on press; motion-safe gated." },
  { id: "lazy-mount", name: "Lazy mount", category: "motion", source: "features/ui/lazy-mount.tsx", status: "live", a11y: "Deferred content still keyboard-reachable once mounted.", motion: "Mounts on idle/visibility; no visual motion of its own." },

  /* ── Skeletons ── */
  { id: "skeleton", name: "Skeleton", category: "skeleton", source: "features/ui/skeleton.tsx", status: "live", a11y: "aria-hidden while loading; the region is aria-busy.", motion: "Shimmer under motion-safe; static otherwise." },
  { id: "page-skeletons", name: "Page skeletons", category: "skeleton", source: "features/ui/page-skeletons.tsx", status: "live", a11y: "Loading placeholders are aria-hidden; real content replaces them.", motion: "Shimmer under motion-safe." },

  /* ── Named by the brief, honestly not built ── */
  { id: "data-table", name: "Data table", category: "surface", source: "", status: "planned", a11y: "Would need column headers, sort announcements, keyboard grid nav.", motion: "—", note: "No enterprise data-grid in this product yet; lists + cards cover current needs." },
  { id: "date-picker", name: "Date / time picker", category: "input", source: "", status: "planned", a11y: "Would need a labelled calendar grid with roving focus.", motion: "—", note: "Not a surface this product exposes yet." },
  { id: "tabs", name: "Tabs primitive", category: "navigation", source: "", status: "planned", a11y: "Would need role=tablist/tab/tabpanel with arrow-key selection.", motion: "Indicator slide.", note: "Tab UIs exist inline (downloads/history); a shared ARIA-complete primitive is deferred." },
];

export function getComponentRegistry(): ComponentDef[] {
  return COMPONENTS;
}

export const COMPONENT_CATEGORIES: { id: ComponentCategory; label: string }[] = [
  { id: "brand", label: "Brand" },
  { id: "icon", label: "Icons" },
  { id: "input", label: "Inputs" },
  { id: "surface", label: "Surfaces" },
  { id: "overlay", label: "Overlays" },
  { id: "navigation", label: "Navigation" },
  { id: "feedback", label: "Feedback" },
  { id: "media", label: "Media" },
  { id: "motion", label: "Motion" },
  { id: "skeleton", label: "Skeletons" },
];

export function componentsInCategory(category: ComponentCategory): ComponentDef[] {
  return COMPONENTS.filter((c) => c.category === category);
}
