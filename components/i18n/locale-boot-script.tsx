/**
 * Applies the visitor's chosen language to `<html lang>` and `<html dir>` before
 * the first paint.
 *
 * ── Why this is a <head> script and NOT a client component ───────────────────
 *
 * Two hard constraints meet here and only this shape satisfies both.
 *
 * 1. The landing page is STATICALLY PRERENDERED, so the server cannot know the
 *    locale — reading the cookie in `app/layout.tsx` would un-static `/` and
 *    cost it CDN caching, which is the exact defect that once gave `/` a
 *    799–4752 ms TTFB. So the locale has to be applied on the client.
 *
 * 2. "NEVER add global runtime that touches navigation" — root-layout client
 *    components and `MutationObserver` on `<html>` have silently broken App
 *    Router prefetch on this project before, invisibly to tsc, lint and build.
 *
 * A bare inline script in `<head>` is neither. It is not a React component, it
 * mounts nothing, it observes nothing, and it has finished executing before the
 * router exists. It is the same pattern `ThemeBootScript` already uses for the
 * theme flash, for the same reason, and it is proven on this codebase.
 *
 * ── Why `dir` matters more than the strings ──────────────────────────────────
 *
 * Arabic is the one declared RTL locale. Rendering Arabic text inside an LTR
 * document is WORSE than leaving it in English: punctuation lands on the wrong
 * side of the line, and any line mixing Arabic with a Latin brand name or a
 * number renders in an order nobody can read. `app/layout.tsx` sets `dir` from
 * `DEFAULT_LOCALE`, which is a constant — so before this existed, translating
 * `ar` would have shipped exactly that broken page.
 *
 * Running in `<head>` means the direction is correct on the FIRST paint rather
 * than snapping after hydration, which would otherwise be a full-page reflow.
 */

/*
  Kept in sync with `LOCALES` in lib/i18n/locales.ts and with `CODES` in
  lib/i18n/use-locale.ts. All three are asserted equal by
  lib/i18n/language-status.test.ts — this file cannot import the registry
  because it is serialised into a string, and a copy nothing checks is a copy
  that drifts.
*/
const BOOT_JS = `(function(){try{
var m=document.cookie.match(/(?:^|;\\s*)frenz_lang=([^;]+)/);
var raw=(m&&m[1])||localStorage.getItem('frenz_lang')||'';
raw=raw.trim().toLowerCase().split('-')[0];
if(!raw)return;
var rtl={ar:1,he:1,fa:1,ur:1,ps:1,sd:1,ug:1,yi:1,dv:1,ku:1};
var d=document.documentElement;
/* lang is set for ANY code, including ones we have no strings for: the page
   really is being read by a speaker of that language, and a correct lang helps
   a screen reader and the browser's own translate offer regardless.
   (No backticks in this comment — it lives inside a template literal.)

   Direction is keyed off the SCRIPT, not off whether we translated it: an RTL
   language rendered left-to-right is unreadable whether the strings came from
   us or from the visitor's own translate button. */
d.setAttribute('lang',raw);
d.setAttribute('dir',rtl[raw]?'rtl':'ltr');
}catch(e){}})();`;

export function LocaleBootScript() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT_JS }} />;
}
