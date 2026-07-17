/**
 * Boot splash — the real Frenz "F" mark, large and centered, baked into the
 * initial HTML so a genuine cold start or the post-login redirect never
 * flashes an empty page before content paints.
 *
 * CURRENT RULE (owner, 2026-07-16 — supersedes the 07-12 and earlier 07-16
 * rules): the F loader shows on EVERY login and EVERY cold start. Never on a
 * refresh, an iOS back-gesture, or an SPA navigation — those fall through to
 * each page's own colorless Suspense skeleton (the "Skeleton loading standard").
 *
 * The full decision, and why it's read from the Navigation Timing API rather
 * than a storage marker, is documented on `JS` below. Short version: a marker
 * can only express "the first boot ever", which is the rule this replaced.
 *
 * Also owner (2026-07-12): remove the purple/violet glow entirely — no
 * shadow or ambient color behind the mark, just the clean logo — and make it
 * noticeably bigger on the two moments it's allowed to show at all. The
 * previous glow's blur was reading as "the logo itself looks blurry."
 *
 * Uses the actual logo asset (`/brand/frenz-logo.png`, 512x512 source,
 * preloaded in app/layout.tsx's <head> so it's never the slow part).
 */
const CSS = `
#frenz-boot{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:#ffffff;transition:opacity .4s ease}
html.dark #frenz-boot{background:#050816}
html.frenz-boot-out #frenz-boot{opacity:0;pointer-events:none}
html.frenz-boot-off #frenz-boot{display:none}
.frenz-boot__mark{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:22%;width:152px;height:152px;animation:frenz-boot-breathe 1.6s ease-in-out infinite}
.frenz-boot__mark img{display:block;width:100%;height:100%}
.frenz-boot__shine{position:absolute;inset:0;background:linear-gradient(115deg,transparent 40%,rgba(255,255,255,.65) 50%,transparent 60%);transform:translateX(-130%);animation:frenz-boot-shimmer 1.4s ease-in-out infinite}
@keyframes frenz-boot-breathe{0%,100%{opacity:.95}50%{opacity:.65}}
@keyframes frenz-boot-shimmer{0%{transform:translateX(-130%)}100%{transform:translateX(130%)}}
@media (prefers-reduced-motion:reduce){.frenz-boot__mark,.frenz-boot__shine{animation:none}}
`;

// WHEN THE F LOADER SHOWS — owner rule, REVISED 2026-07-16:
// "i want every login to show the F loader and every cold start."
//
// This REPLACES the previous, narrower rule ("only on a first-ever visit /
// cleared site data"), which was implemented with a `frenz-booted` localStorage
// marker — once set, the loader never showed again on that browser. That marker
// is gone; it can't express "every cold start", only "the first one ever".
//
// Cold start is now read from the Navigation Timing API, which distinguishes the
// three cases at the source instead of inferring them from storage:
//
//     nav.type === 'navigate'      -> a fresh entry into the app: PWA launch,
//                                     new tab, external link, or a login's own
//                                     window.location.assign().  SHOW.
//     nav.type === 'reload'        -> the user hit refresh.       instant.
//     nav.type === 'back_forward'  -> iOS back-gesture / history.  instant.
//
// Reload and back-gesture stay instant deliberately: they are NOT cold starts,
// and "the loader shows for seconds on back-gesture" was the owner's own earlier
// complaint. The revised rule widens the trigger set to every cold start; it
// doesn't ask for those two back.
//
// Why this also covers "every login" with no extra work: every sign-in path ends
// in `window.location.assign(next)` — a full document navigation, which reports
// as 'navigate'. That matters because only OAuth and magic-link actually redirect
// through /auth/callback (which sets the `frenz_just_signed_in` cookie); the
// password and email-code paths verify client-side and never touch that route,
// so a cookie-only check would have missed the most common logins entirely.
// The cookie check is kept as belt-and-braces for any login that lands without a
// document navigation, and still force-shows regardless of nav type.
//
// One suppression remains: landing on /home with no `frenz_welcomed` cookie means
// the colorful BrandSplash is about to take over immediately — dismiss instantly
// rather than flash the F first.
//
// WHY AN iOS PWA BACK-SWIPE CAN LEGITIMATELY SHOW IT (owner, 2026-07-17: "why
// does some accounts show the F loader for few seconds in the webapp not in
// browser when i swiped back ... does it mean the swiped back in the ios pwa is
// like a cold start?"). Yes — exactly that. iOS kills a backgrounded standalone
// PWA's whole process under memory pressure (the same fact that forced the old
// boot marker from sessionStorage to localStorage, and register-sw.tsx's reload
// guard before it). When the process is gone, "back" doesn't restore a live
// page: the OS RELAUNCHES the app, which is a brand-new document reporting
// 'navigate'. So it is a genuine cold start and this rule shows the loader. In a
// browser the tab is still alive, so back is a bfcache restore / 'back_forward'
// and stays instant. Nothing to do with re-login — the session is untouched.
//
// DISMISSAL TIMING is what made that feel bad, and it's fixed here rather than
// by narrowing the rule. The cold path used to fade on DOMContentLoaded, which
// on a STREAMED force-dynamic page (/messages) only fires once the SERVER has
// finished rendering — seconds on a data-heavy account, which is exactly why
// "some accounts" saw it longer than others. But the app shell + each page's own
// skeleton arrive in the FIRST chunk, long before that. So the splash now hands
// off as soon as the app's own markup exists (a <main> element), with the 300ms
// minimum kept so it never strobes. The branded moment stays; the dead wait on
// the server doesn't. DOMContentLoaded remains as a fallback and the 6s failsafe
// still bounds the worst case.
//
// Dismissal is node-INDEPENDENT — the permanent fix for the long-recurring
// "stuck on the F loader" reports. Instead of hiding or removing the
// specific `#frenz-boot` node this script sees at run time, it toggles a
// class on `<html>` (`frenz-boot-out` to fade, then `frenz-boot-off` to
// hard-hide), and the CSS above hides ANY `#frenz-boot` node while that
// class is present. This is what finally closes the bug: /messages triggers
// a React hydration mismatch near this node's position in the root layout
// tree, so React discards and regenerates a BRAND-NEW `#frenz-boot` node
// client-side. Every prior approach operated on ONE node — a captured `el`
// (fixed 2026-07-14), then a re-query-by-id inside `hide()` (2026-07-15) —
// but BOTH still left the FAST already-booted reload path (`display='none';
// return`) never scheduling any hide at all, so the regenerated node stayed
// visible forever with no failsafe. A class on `<html>` can't be dodged:
// React never clears the documentElement class (next-themes only
// adds/removes the `light`/`dark` tokens), the CSS rule matches whichever
// node is live no matter how many times it's regenerated, and the hard 6s
// failsafe + the `pageshow` restore-guard both just re-add the class — so
// recovery is now guaranteed on every path, cold load / reload / back-
// gesture alike.
const JS = `(function(){var d=document.documentElement;function dismiss(instant){if(instant){d.classList.add('frenz-boot-off');return}d.classList.add('frenz-boot-out');setTimeout(function(){d.classList.add('frenz-boot-off')},440)}var instant=false;try{var justSignedIn=document.cookie.indexOf('frenz_just_signed_in=1')!==-1;if(justSignedIn){document.cookie='frenz_just_signed_in=; Max-Age=0; path=/'}var navType='navigate';try{var nav=performance.getEntriesByType('navigation')[0];if(nav&&nav.type){navType=nav.type}else if(performance.navigation){var t=performance.navigation.type;navType=t===1?'reload':(t===2?'back_forward':'navigate')}}catch(e){}var coldStart=navType==='navigate';if(!justSignedIn&&!coldStart){instant=true}else if(location.pathname==='/home'&&document.cookie.indexOf('frenz_welcomed=')===-1){instant=true}}catch(e){}if(instant){dismiss(true)}else{var start=Date.now();var faded=false;var fade=function(){if(faded)return;faded=true;var w=Math.max(0,300-(Date.now()-start));setTimeout(function(){dismiss(false)},w)};var shellReady=function(){return !!document.querySelector('main')};if(shellReady()){fade()}else{try{var mo=new MutationObserver(function(){if(shellReady()){mo.disconnect();fade()}});mo.observe(document.documentElement,{childList:true,subtree:true})}catch(e){}document.addEventListener('DOMContentLoaded',fade)}}setTimeout(function(){dismiss(true)},6000);window.addEventListener('pageshow',function(e){if(e.persisted)dismiss(true)})})();`;

// Must run BEFORE the <style> below is evaluated, AND before next-themes'
// own injected script (rendered later, wherever <ThemeProvider> sits) so the
// splash paints in the theme the user actually chose — not just the
// device's raw OS preference.
//
// Rendered in <head> (app/layout.tsx's ThemeBootScript), NOT in <body> with
// the splash markup — the last remaining theme-flash window (owner,
// 2026-07-16: "the theme still flashes but more little than before"). With
// this script in <body>, a STREAMED response (any force-dynamic page, e.g.
// /messages) can have its first network chunk end after </head> but before
// this script's bytes arrive — the parser yields waiting on the network,
// and the browser may paint that empty body with the DEFAULT (light)
// background before `html.dark` is ever set: a brief opposite-theme flash
// for dark users on exactly the slow loads where chunk boundaries land
// there. In <head>, the script provably executes before ANY first paint
// (there is nothing paintable yet while the head is parsing), closing the
// window for good. It only touches documentElement + localStorage, so it
// has no dependency on <body> existing.
//
// 2026-07-13 rewrite (owner: the flash "still persists", asked for a
// different pattern): the PREVIOUS version of this fix read a CACHED
// last-resolved value from `localStorage['frenz-resolved-theme']` for
// SYSTEM mode instead of live-querying `prefers-color-scheme` — but that
// alone turned out not to be enough. next-themes' OWN injected no-flash
// script (unconditional, no prop to disable it) runs immediately after this
// one and does: `var r = localStorage.getItem('theme') || 'system'; if
// (r === 'system') liveQuery()` — so whenever this app's next-themes
// storage key is empty/"system" (the default, and the common case for
// every user who's never touched the toggle), next-themes' script ALWAYS
// re-decides via a fresh live `matchMedia` call and overwrites whatever
// this script just set, before the first paint — silently undoing this fix
// for exactly the population it was meant to help.
//
// Real fix: this app's actual theme INTENT (light/dark/system) now lives in
// its OWN key, `frenz-theme-mode` (see lib/theme/theme-mode-client.ts;
// ThemeToggle reads/writes it, not next-themes' `theme`). Whenever that
// intent resolves to a concrete light/dark value — including "system",
// resolved from the cache below — this script ALSO writes that concrete
// value into next-themes' own `theme` key, so next-themes' script sees
// "dark"/"light" (never the literal string "system") and takes its
// no-live-query branch, applying the exact same class this script already
// set. A live OS change while the app is open is still applied immediately
// (matching the owner's ask), via this script's own matchMedia listener —
// checked against `frenz-theme-mode`, not next-themes' key.
//
// Self-heal addendum (owner: "the previously saved theme in local storage
// doesnt clear so it can automatically switch to the current system theme
// when opening the webapp"): a pure cache-first read can never notice the
// OS theme changed while the app was fully CLOSED (not just backgrounded) —
// there's no 'change' event to fire for a transition nothing was listening
// for. So in system mode, after painting the cache instantly, the COLD boot
// also re-checks the live `matchMedia` answer a beat later (a short
// setTimeout, not blocking the first paint) and corrects + re-saves if it
// disagrees.
//
// CRITICAL: that live re-check runs ONLY on a genuine cold boot — NEVER on
// `pageshow`/resume. This is the permanent fix for the recurring "webapp
// switches to the OPPOSITE theme every time I leave and come back" report.
// The whole reason this file is cache-first is that WKWebView reports a
// STALE (often inverted) `prefers-color-scheme` for a moment right after a
// resume. On the resume path, the frozen cache is already correct and no
// live read is needed — but the old code ran the re-check on `pageshow`
// too, so that transient stale read overwrote the correct cached value with
// its opposite AND re-saved it (poisoning the cache for next time). Because
// WebKit "self-corrects" a value it merely READ stale without firing a
// 'change' event, nothing ever undid it — so it flipped and STAYED flipped,
// every single reentry. `pageshow` now re-applies the cache with the
// re-check suppressed; a real OS change while the app is open/backgrounded
// still arrives through the `matchMedia` 'change' listener below, which
// fires only on an ACTUAL transition, never on a stale read. (The re-check
// only ever mattered for "OS changed while the app was fully CLOSED", which
// is a cold start, not a resume — so nothing is lost.)
const THEME_JS = `(function(){var CACHE='frenz-resolved-theme';var MODE='frenz-theme-mode';var mq=window.matchMedia('(prefers-color-scheme: dark)');function mode(){try{return localStorage.getItem(MODE)||'light'}catch(e){return 'light'}}function cached(){try{return localStorage.getItem(CACHE)}catch(e){return null}}function remember(v){try{localStorage.setItem(CACHE,v)}catch(e){}}function syncNextThemes(v){try{localStorage.setItem('theme',v)}catch(e){}}function set(dark){document.documentElement.classList.toggle('dark',dark)}function resolveSystem(){var c=cached();if(c)return c;return mq.matches?'dark':'light'}function apply(v){set(v==='dark');remember(v);syncNextThemes(v)}function boot(recheck){var m=mode();if(m==='light'||m==='dark'){apply(m);return}var resolved=resolveSystem();apply(resolved);if(recheck){setTimeout(function(){if(mode()!=='system')return;var live=mq.matches?'dark':'light';if(live!==resolved)apply(live)},60)}}boot(true);function onSystemChange(){if(mode()!=='system')return;apply(mq.matches?'dark':'light')}try{if(mq.addEventListener)mq.addEventListener('change',onSystemChange);else if(mq.addListener)mq.addListener(onSystemChange)}catch(e){}window.addEventListener('pageshow',function(){boot(false)})})();`;

/** Renders THEME_JS — must live in <head> (see the comment on THEME_JS above
 *  for why <body> placement left a paint-before-script flash window on
 *  streamed responses). Rendered by app/layout.tsx inside its explicit
 *  <head>, before anything else. */
export function ThemeBootScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_JS }} />;
}

/**
 * The splash STYLE + the dismissal DECISION script — now rendered in <head>
 * (app/layout.tsx), NOT in <body> alongside the splash markup.
 *
 * Why (owner report 2026-07-16: "/messages sits on the F loader for seconds
 * on reload / iOS back-swipe"): the `JS` script hides the splash, and it used
 * to sit in <body> immediately AFTER the `#frenz-boot` <div>. On a STREAMED
 * response — which every `force-dynamic` page is, `/messages` included — the
 * first network chunk can end right between that <div> and this <script>. The
 * browser then PAINTS the F splash and yields waiting on the network, and the
 * script that would hide it doesn't run until a later chunk arrives — which,
 * on a slow personalized page, can be seconds later (after the server's own
 * data work). That's the exact "stuck on the F loader for seconds" symptom,
 * and it's the SAME streaming-chunk-boundary bug already fixed for THEME_JS by
 * moving it to <head>.
 *
 * In <head>, the decision runs before ANY first paint (nothing is paintable
 * while the head parses). For a reload/back-gesture it adds `frenz-boot-off` to
 * <html> synchronously, so when the body's `#frenz-boot` <div> is parsed later
 * the CSS (also here in <head>) has it display:none from the very first frame —
 * the splash never becomes visible at all. The script only touches
 * `document.documentElement` + cookies, so it has no dependency on <body>
 * existing. A cold start or a login shows the splash and fades it on
 * DOMContentLoaded.
 */
export function BootHead() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <script dangerouslySetInnerHTML={{ __html: JS }} />
    </>
  );
}

export function BootSplash() {
  return (
    <div id="frenz-boot" aria-hidden="true">
      <span className="frenz-boot__mark">
        {/* eslint-disable-next-line @next/next/no-img-element -- must render
            before the JS bundle (next/image) is available */}
        <img src="/brand/frenz-logo.png" width={152} height={152} alt="" />
        <span className="frenz-boot__shine" />
      </span>
    </div>
  );
}
