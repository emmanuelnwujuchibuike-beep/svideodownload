/**
 * Boot splash — the real Frenz "F" mark, large and centered, baked into the
 * initial HTML so a genuine cold start or the post-login redirect never
 * flashes an empty page before content paints.
 *
 * Owner (2026-07-12): the colored logo must ONLY appear on a true cold start
 * (first hard load of a browser/PWA session) or immediately after signing in
 * — never on a plain refresh, never on SPA navigation. A refresh or nav
 * should fall through to each page's own colorless Suspense skeleton (see
 * the "Skeleton loading standard" convention) instead. Distinguishing
 * "cold start" from "refresh" needs a `sessionStorage` marker (both are
 * identical hard-document-loads at the HTTP level) — set the moment this
 * script first runs in a tab session, checked before ever painting. Login is
 * force-shown regardless of that marker via a short-lived `frenz_just_signed_in`
 * cookie set by the auth callback routes right before their redirect.
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
#frenz-boot.frenz-boot--hide{opacity:0;pointer-events:none}
.frenz-boot__mark{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:22%;width:152px;height:152px;animation:frenz-boot-breathe 1.6s ease-in-out infinite}
.frenz-boot__mark img{display:block;width:100%;height:100%}
.frenz-boot__shine{position:absolute;inset:0;background:linear-gradient(115deg,transparent 40%,rgba(255,255,255,.65) 50%,transparent 60%);transform:translateX(-130%);animation:frenz-boot-shimmer 1.4s ease-in-out infinite}
@keyframes frenz-boot-breathe{0%,100%{opacity:.95}50%{opacity:.65}}
@keyframes frenz-boot-shimmer{0%{transform:translateX(-130%)}100%{transform:translateX(130%)}}
@media (prefers-reduced-motion:reduce){.frenz-boot__mark,.frenz-boot__shine{animation:none}}
`;

// Suppression checks run FIRST, synchronously, before this element ever gets
// a chance to paint:
//  1. A `frenz_just_signed_in` cookie (set by the auth callback routes)
//     always wins — force-show, clear the cookie, mark this session booted.
//  2. Otherwise, if this tab session already booted once (sessionStorage),
//     this is a refresh or a non-Link hard navigation, not a cold start —
//     hide immediately and let the page's own skeleton carry the loading
//     state instead.
//  3. Landing on /home with no `frenz_welcomed` cookie means the colorful
//     BrandSplash is about to take over immediately — this skeleton removes
//     itself instead of flashing first (unchanged from before).
const JS = `(function(){var el=document.getElementById('frenz-boot');if(!el)return;try{var justSignedIn=document.cookie.indexOf('frenz_just_signed_in=1')!==-1;if(justSignedIn){document.cookie='frenz_just_signed_in=; Max-Age=0; path=/'}var alreadyBooted=false;try{alreadyBooted=sessionStorage.getItem('frenz-booted')==='1'}catch(e){}if(!justSignedIn&&alreadyBooted){el.style.display='none';return}try{sessionStorage.setItem('frenz-booted','1')}catch(e){}if(location.pathname==='/home'&&document.cookie.indexOf('frenz_welcomed=')===-1){el.style.display='none';return}}catch(e){}var start=Date.now();function hide(){var w=Math.max(0,300-(Date.now()-start));setTimeout(function(){el.classList.add('frenz-boot--hide');setTimeout(function(){if(el&&el.parentNode)el.parentNode.removeChild(el)},440)},w)}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',hide)}else{hide()}setTimeout(hide,6000)})();`;

// Must run BEFORE the <style> below is evaluated, AND before next-themes'
// own injected script (rendered later, wherever <ThemeProvider> sits) so the
// splash paints in the theme the user actually chose — not just the
// device's raw OS preference.
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
const THEME_JS = `(function(){var CACHE='frenz-resolved-theme';var MODE='frenz-theme-mode';var mq=window.matchMedia('(prefers-color-scheme: dark)');function mode(){try{return localStorage.getItem(MODE)||'system'}catch(e){return 'system'}}function cached(){try{return localStorage.getItem(CACHE)}catch(e){return null}}function remember(v){try{localStorage.setItem(CACHE,v)}catch(e){}}function syncNextThemes(v){try{localStorage.setItem('theme',v)}catch(e){}}function set(dark){document.documentElement.classList.toggle('dark',dark)}function resolveSystem(){var c=cached();if(c)return c;return mq.matches?'dark':'light'}function boot(){var m=mode();var resolved=(m==='light'||m==='dark')?m:resolveSystem();set(resolved==='dark');remember(resolved);syncNextThemes(resolved)}boot();function onSystemChange(){if(mode()!=='system')return;var resolved=mq.matches?'dark':'light';set(resolved==='dark');remember(resolved);syncNextThemes(resolved)}try{if(mq.addEventListener)mq.addEventListener('change',onSystemChange);else if(mq.addListener)mq.addListener(onSystemChange)}catch(e){}window.addEventListener('pageshow',boot)})();`;

export function BootSplash() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_JS }} />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div id="frenz-boot" aria-hidden="true">
        <span className="frenz-boot__mark">
          {/* eslint-disable-next-line @next/next/no-img-element -- must render
              before the JS bundle (next/image) is available */}
          <img src="/brand/frenz-logo.png" width={152} height={152} alt="" />
          <span className="frenz-boot__shine" />
        </span>
      </div>
      <script dangerouslySetInnerHTML={{ __html: JS }} />
    </>
  );
}
