/**
 * Design System — the principles, motion language, accessibility standards and
 * themes that every Frenz surface inherits.
 *
 * The brief's "Experience OS™" / "Motion Intelligence™" as DATA: the tokens live
 * in `design-tokens.ts`, the components in `component-registry.ts`, and this file
 * is the governing layer over both — the rules a component is measured against.
 * Everything that names a `source` points at real code, enforced by
 * `design-system.test.ts`, so the system can't drift into describing motion or
 * themes that aren't wired.
 */

export interface DesignPrinciple {
  id: string;
  title: string;
  detail: string;
}

/** The ten principles from the brief, each tied to how the system enforces it. */
export const DESIGN_PRINCIPLES: DesignPrinciple[] = [
  { id: "clarity", title: "Clarity", detail: "One primary action per surface; state is shown in text, never colour or a bar alone." },
  { id: "consistency", title: "Consistency", detail: "Every colour, radius and duration comes from a token — no hardcoded hex or magic ms." },
  { id: "hierarchy", title: "Hierarchy", detail: "A single heading scale and spacing rhythm; the eye lands on the CTA first." },
  { id: "readability", title: "Readability", detail: "Inter at a fluid scale; body ≥16px; measure capped for line length." },
  { id: "touch-comfort", title: "Touch comfort", detail: "Interactive targets ≥44px; primary actions within thumb reach on phones." },
  { id: "accessibility", title: "Accessibility", detail: "WCAG AA contrast, visible focus, screen-reader names and reduced-motion — non-negotiable." },
  { id: "performance", title: "Performance", detail: "Motion is compositor-only; the 2-second cold-entry budget outranks decoration." },
  { id: "motion-purpose", title: "Motion purpose", detail: "Every animation explains a change of state; none runs idle (battery)." },
  { id: "responsiveness", title: "Responsiveness", detail: "One tree that changes shape across breakpoints — never content hidden by media query." },
  { id: "discoverability", title: "Discoverability", detail: "Anything reachable is linked; the command centre indexes every destination." },
];

export interface MotionPattern {
  id: string;
  name: string;
  /** What it is for. */
  purpose: string;
  /** The token(s) or spring it uses. */
  token: string;
  /** How it degrades under prefers-reduced-motion. */
  reducedMotion: string;
  /** Repo-relative source; empty only when the pattern is a pure token. */
  source: string;
}

export const MOTION_PATTERNS: MotionPattern[] = [
  { id: "durations", name: "Shared durations & easing", purpose: "One timing language for every transition.", token: "--dur-fast/--dur/--dur-slow, --ease-out/--ease-spring", reducedMotion: "Durations still apply; the app-wide MotionConfig neutralises transform/opacity animation.", source: "lib/platform/design-tokens.ts" },
  { id: "app-reduced-motion", name: "App-wide reduced motion", purpose: "Honour the OS setting everywhere at once.", token: "MotionConfig reducedMotion=\"user\"", reducedMotion: "This IS the enforcement point — Framer Motion animations collapse to instant.", source: "app/layout.tsx" },
  { id: "sheet-spring", name: "Bottom-sheet spring", purpose: "The one spring every sheet/dialog opens on.", token: "SHEET_SPRING (stiffness/damping)", reducedMotion: "AnimatePresence + MotionConfig short-circuit the spring.", source: "lib/motion/springs.ts" },
  { id: "page-transition", name: "Page transition", purpose: "Direction-aware route change in the app shell.", token: "--ease-out, pathname stack", reducedMotion: "Falls back to no slide; content is present immediately.", source: "features/app-shell/page-transition.tsx" },
  { id: "scroll-reveal", name: "Scroll reveal", purpose: "Fade-up sections as they enter the viewport.", token: "--dur, --ease-out", reducedMotion: "Disabled — content renders in place.", source: "components/ui/reveal.tsx" },
  { id: "keyframes", name: "Keyframe utilities", purpose: "Shimmer, fade-up, float, drift for skeletons and accents.", token: "@keyframes + animate-* utilities", reducedMotion: "Gated behind motion-safe in globals.css.", source: "app/globals.css" },
  { id: "haptics", name: "Haptics", purpose: "Tactile confirmation on supported devices.", token: "vibrate() patterns", reducedMotion: "Independent of visual motion; a single tap-scale accompanies it.", source: "lib/motion/haptics.ts" },
];

export function getMotionPatterns(): MotionPattern[] {
  return MOTION_PATTERNS;
}

export interface A11yStandard {
  id: string;
  requirement: string;
  howEnforced: string;
}

/** The accessibility contract every component in the registry is held to. */
export const A11Y_STANDARDS: A11yStandard[] = [
  { id: "contrast", requirement: "Text meets WCAG AA (4.5:1; 3:1 for large).", howEnforced: "Token palette tuned for both themes; state never conveyed by colour alone." },
  { id: "focus", requirement: "Every interactive element has a visible focus indicator.", howEnforced: "focus-visible:ring-2 ring-primary is the shared pattern; never `outline-none` without a replacement." },
  { id: "screen-reader", requirement: "Controls expose an accessible name; live regions announce async change.", howEnforced: "aria-label on icon buttons; role=status/alert + aria-live on toasts and the download card." },
  { id: "keyboard", requirement: "All flows operable without a pointer; dialogs trap and restore focus.", howEnforced: "Escape closes overlays; the command centre is full arrow-key navigable." },
  { id: "reduced-motion", requirement: "Respect prefers-reduced-motion.", howEnforced: "App-wide MotionConfig + motion-safe: gating on CSS animations." },
  { id: "dynamic-text", requirement: "Layouts survive larger text and zoom.", howEnforced: "Relative units, no fixed heights on text containers, truncation only where safe." },
  { id: "rtl", requirement: "Layout mirrors for RTL locales.", howEnforced: "Logical properties where used; deferred until an RTL locale ships (see gap ledger).", },
];

export function getA11yStandards(): A11yStandard[] {
  return A11Y_STANDARDS;
}

export type ThemeStatus = "live" | "planned";

export interface ThemeDef {
  id: string;
  name: string;
  status: ThemeStatus;
  note: string;
}

export const THEMES: ThemeDef[] = [
  { id: "light", name: "Light", status: "live", note: "The default (theme-system-default): explicit light, not 'system'." },
  { id: "dark", name: "Dark", status: "live", note: "Full token override; every surface styles both." },
  { id: "auto", name: "Auto (system)", status: "live", note: "Follows the OS via next-themes; user choice persists." },
  { id: "brand-seasonal", name: "Brand / seasonal themes", status: "planned", note: "The token architecture supports additional palettes; none authored yet — would be a new token set + selector." },
];

export function getThemes(): ThemeDef[] {
  return THEMES;
}
