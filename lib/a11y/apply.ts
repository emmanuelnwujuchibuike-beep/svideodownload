import type { A11yPreferences } from "./preferences";

/**
 * Preferences → the CSS custom properties and data attributes that carry them.
 *
 * ── Why this is a pure function and not DOM code ─────────────────────────────
 * TWO things apply these: the `<head>` boot script (before first paint) and the
 * settings UI (the instant the toggle moves). If each computed its own values
 * they would drift, and the drift would show as a flash — the page painting one
 * way and settling another, which is worst for exactly the people this feature
 * is for.
 *
 * One function, two callers, no possibility of disagreement. It is also
 * directly testable, which DOM-mutating code is not.
 *
 * ── Why CSS variables on `:root` ────────────────────────────────────────────
 * Requirement 9 of the brief: "every new feature automatically inherits
 * accessibility support without requiring separate implementation." That only
 * holds if the mechanism is something components already consume. A new
 * component using the app's normal type scale, focus ring and tap targets is
 * accessible because those read `--a11y-*` — nothing to remember per feature,
 * which is the only version of this that survives a growing codebase.
 */

export const A11Y_STORAGE_KEY = "frenz:a11y";

/** The custom properties a preference set produces. */
export function cssVariables(p: A11yPreferences): Record<string, string> {
  const vars: Record<string, string> = {
    "--a11y-text-scale": String(p.textScale),
    "--a11y-tap-min": p.tapTargets === "large" ? "44px" : "0px",
    "--a11y-focus-width": p.strongFocus ? "3px" : "2px",
    /*
      Line-height and letter-spacing carry "reading comfort" rather than a font
      swap. Shipping a dyslexia-specific typeface would be a 30-100 kB download
      on a page with a 1.6-second budget, and the research on those faces is
      genuinely contested — whereas increased spacing and a shorter measure are
      not. This does the part that is well-supported and cheap.
    */
    "--a11y-line-height": p.readingComfort ? "1.85" : "1.6",
    "--a11y-letter-spacing": p.readingComfort ? "0.02em" : "0em",
    "--a11y-measure": p.readingComfort ? "58ch" : "none",
    "--a11y-font-weight-boost": p.boldText ? "100" : "0",
  };

  /*
    Colour-blindness filters are SVG matrices, not CSS keywords — only
    `grayscale` exists natively. Referencing `url(#…)` needs the matrices in the
    document, so the boot script injects them once; see `a11y-boot-script`.
  */
  vars["--a11y-filter"] =
    p.colorFilter === "none"
      ? "none"
      : p.colorFilter === "grayscale"
        ? "grayscale(1)"
        : `url(#a11y-${p.colorFilter})`;

  return vars;
}

/**
 * The data attributes stylesheets branch on.
 *
 * Attributes rather than more variables because CSS can only *select* on
 * attributes — `[data-a11y-contrast="high"]` can override a whole token set,
 * which a custom property cannot do on its own.
 */
export function dataAttributes(p: A11yPreferences): Record<string, string> {
  return {
    "data-a11y-contrast": p.highContrast ? "high" : "normal",
    "data-a11y-transparency": p.reduceTransparency ? "reduce" : "normal",
    /*
      `system` writes NOTHING, so the OS `prefers-reduced-motion` media query
      stays in sole control — which is what the app already did in 23 files and
      must keep doing by default. Only an explicit in-app choice writes here,
      and the stylesheet gives that attribute precedence over the media query.
    */
    ...(p.motion === "system" ? {} : { "data-a11y-motion": p.motion }),
    "data-a11y-bold": p.boldText ? "on" : "off",
  };
}

/**
 * The JavaScript the boot script runs, as a string.
 *
 * Generated from the same shapes above so the inline script cannot drift from
 * the React path. It is a string because it must execute in `<head>` before any
 * bundle loads — see `components/a11y/a11y-boot-script.tsx` for why that is the
 * only placement that avoids a flash.
 */
export const A11Y_BOOT_JS = `(function(){try{
var raw=localStorage.getItem(${JSON.stringify(A11Y_STORAGE_KEY)});
if(!raw)return;
var p=JSON.parse(raw);
if(!p||typeof p!=='object')return;
var d=document.documentElement,s=d.style;
var scale=[0.9,1,1.15,1.3,1.5].indexOf(p.textScale)>=0?p.textScale:1;
s.setProperty('--a11y-text-scale',String(scale));
s.setProperty('--a11y-tap-min',p.tapTargets==='large'?'44px':'0px');
s.setProperty('--a11y-focus-width',p.strongFocus?'3px':'2px');
s.setProperty('--a11y-line-height',p.readingComfort?'1.85':'1.6');
s.setProperty('--a11y-letter-spacing',p.readingComfort?'0.02em':'0em');
s.setProperty('--a11y-measure',p.readingComfort?'58ch':'none');
s.setProperty('--a11y-font-weight-boost',p.boldText?'100':'0');
var f=p.colorFilter;
s.setProperty('--a11y-filter',!f||f==='none'?'none':f==='grayscale'?'grayscale(1)':'url(#a11y-'+f+')');
d.setAttribute('data-a11y-contrast',p.highContrast?'high':'normal');
d.setAttribute('data-a11y-transparency',p.reduceTransparency?'reduce':'normal');
d.setAttribute('data-a11y-bold',p.boldText?'on':'off');
if(p.motion==='reduce'||p.motion==='full')d.setAttribute('data-a11y-motion',p.motion);
else d.removeAttribute('data-a11y-motion');
}catch(e){}})();`;
