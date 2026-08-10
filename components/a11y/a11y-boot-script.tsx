import { A11Y_BOOT_JS } from "@/lib/a11y/apply";

/**
 * Applies the visitor's accessibility preferences BEFORE the first paint.
 *
 * ── Why a <head> script and not a client component ──────────────────────────
 *
 * The brief requires "instant accessibility changes, no restart required" and
 * offline support. Both rule out the obvious alternatives:
 *
 * • A React context cannot change type size before first paint, so every page
 *   would render at the default size and then reflow. For someone who set
 *   150% text because they cannot read the default, that flash is not a polish
 *   issue — it is the app showing them the thing they told it not to.
 * • A server read would make the setting unavailable offline and would
 *   un-static the marketing pages.
 *
 * A bare inline script in `<head>` runs before anything paints, needs no
 * bundle, and works with no network. It is the same shape `ThemeBootScript` and
 * `LocaleBootScript` already use here, for the same reason — and it is
 * explicitly NOT a root-layout client component, which has silently broken App
 * Router prefetch on this project before.
 *
 * ── The SVG matrices ────────────────────────────────────────────────────────
 * Only `grayscale` exists as a native CSS filter. Colour-blindness simulation
 * needs `feColorMatrix`, and `filter: url(#id)` can only reference a filter
 * that is in the document — so the definitions ship inline, hidden, costing a
 * few hundred bytes and no JavaScript.
 *
 * The matrices are the Machado/Oliveira/Fernandes coefficients, the same set
 * browsers and design tools use. They SIMULATE the three common forms of colour
 * blindness rather than correcting for them — which is the honest thing a web
 * app can offer, and is what makes them useful for checking a design as well as
 * for using one.
 */
export function A11yBootScript() {
  return <script dangerouslySetInnerHTML={{ __html: A11Y_BOOT_JS }} />;
}

/**
 * The filter definitions. Rendered once in `<body>`, hidden from everything —
 * `aria-hidden` for screen readers and zero size for layout.
 */
export function A11yColorFilters() {
  return (
    <svg
      aria-hidden
      focusable="false"
      width={0}
      height={0}
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        <filter id="a11y-protanopia">
          <feColorMatrix
            type="matrix"
            values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0"
          />
        </filter>
        <filter id="a11y-deuteranopia">
          <feColorMatrix
            type="matrix"
            values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0"
          />
        </filter>
        <filter id="a11y-tritanopia">
          <feColorMatrix
            type="matrix"
            values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0"
          />
        </filter>
      </defs>
    </svg>
  );
}
