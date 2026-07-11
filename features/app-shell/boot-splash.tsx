/**
 * Boot splash — the real Frenz "F" mark, large and centered (X/Twitter and
 * Tango-style boot loader), baked into the initial HTML so cold entries (hard
 * refresh, sign-in redirect, first visit after clearing the cache) never flash
 * an empty page before content paints. Plain markup + inline critical CSS
 * (works before the CSS bundle loads) + an inline script that fades it the
 * moment the document is ready. Renders once per hard load; SPA navigation
 * keeps the persistent layout, so it never re-shows.
 *
 * Uses the actual logo asset (`/brand/frenz-logo.png`, preloaded in
 * app/layout.tsx's <head> so it's never the slow part) rather than a hand-drawn
 * placeholder glyph — kept muted (grayscale + reduced opacity) rather than
 * full color on purpose: the loud, colorful "Frenz" welcome is reserved for
 * the very first uncached /home entry (see BrandSplash) — so a plain refresh
 * shows a quiet, correctly-branded skeleton, never a bold colorful loader.
 *
 * On the ONE landing this skeleton would otherwise show right underneath that
 * colorful welcome (first-ever login, or any visit after site data was cleared —
 * both mean the `frenz_welcomed` cookie is absent) it suppresses itself instead,
 * so there's no grayscale-then-colorful double-flash — just the one premium
 * welcome. Every other cold entry (a plain refresh, a normal sign-in) still gets
 * this quiet skeleton exactly as before.
 */
const CSS = `
#frenz-boot{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:#ffffff;transition:opacity .4s ease}
html.dark #frenz-boot{background:#050816}
#frenz-boot.frenz-boot--hide{opacity:0;pointer-events:none}
.frenz-boot__mark{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:22%;width:104px;height:104px;animation:frenz-boot-breathe 1.6s ease-in-out infinite}
.frenz-boot__mark img{display:block;width:100%;height:100%;filter:grayscale(1);opacity:.4}
.frenz-boot__shine{position:absolute;inset:0;background:linear-gradient(115deg,transparent 40%,rgba(148,163,184,.45) 50%,transparent 60%);transform:translateX(-130%);animation:frenz-boot-shimmer 1.4s ease-in-out infinite}
@keyframes frenz-boot-breathe{0%,100%{opacity:.9}50%{opacity:.55}}
@keyframes frenz-boot-shimmer{0%{transform:translateX(-130%)}100%{transform:translateX(130%)}}
@media (prefers-reduced-motion:reduce){.frenz-boot__mark,.frenz-boot__shine{animation:none}}
`;

// Hide as soon as the document has parsed (content is present), with a small
// minimum so it reads as a loader, and a safety cap so it can never get stuck.
// Suppression check runs FIRST, synchronously, before this element ever gets a
// chance to paint: landing on /home with no `frenz_welcomed` cookie means the
// colorful BrandSplash is about to take over immediately, so this skeleton
// removes itself instead of flashing first.
const JS = `(function(){var el=document.getElementById('frenz-boot');if(!el)return;try{if(location.pathname==='/home'&&document.cookie.indexOf('frenz_welcomed=')===-1){el.style.display='none';return}}catch(e){}var start=Date.now();function hide(){var w=Math.max(0,300-(Date.now()-start));setTimeout(function(){el.classList.add('frenz-boot--hide');setTimeout(function(){if(el&&el.parentNode)el.parentNode.removeChild(el)},440)},w)}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',hide)}else{hide()}setTimeout(hide,6000)})();`;

// Must run BEFORE the <style> below is evaluated: resolves the SAME
// light/dark decision next-themes will make (its own script, injected later
// wherever <ThemeProvider> sits, hasn't run yet at this point) so the splash
// paints in the theme the user actually chose — not just the device's raw OS
// preference. Without this, someone who explicitly picked Light while their
// phone's OS is in dark mode saw a dark flash on every cold entry, which on
// iOS is EVERY time the installed app resumes after being backgrounded a
// while (the OS frequently reloads it rather than truly restoring it).
const THEME_JS = `(function(){try{var t=localStorage.getItem('theme');var dark=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)document.documentElement.classList.add('dark')}catch(e){}})();`;

export function BootSplash() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_JS }} />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div id="frenz-boot" aria-hidden="true">
        <span className="frenz-boot__mark">
          {/* eslint-disable-next-line @next/next/no-img-element -- must render
              before the JS bundle (next/image) is available */}
          <img src="/brand/frenz-logo.png" width={104} height={104} alt="" />
          <span className="frenz-boot__shine" />
        </span>
      </div>
      <script dangerouslySetInnerHTML={{ __html: JS }} />
    </>
  );
}
