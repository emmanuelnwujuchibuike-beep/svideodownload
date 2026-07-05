/**
 * Boot splash — a faint, COLORLESS bold "F" baked into the initial HTML so cold
 * entries (hard refresh, sign-in redirect, first visit after clearing the cache)
 * never flash an empty page before content paints. Plain markup + inline critical
 * CSS (works before the CSS bundle loads) + an inline script that fades it the
 * moment the document is ready. Renders once per hard load; SPA navigation keeps
 * the persistent layout, so it never re-shows.
 *
 * Deliberately quiet: an almost-invisible grayscale F with a skeleton shimmer, NO
 * color and NO spinner. The loud, colorful "Frenz" welcome is reserved for the
 * very first uncached /home entry (see BrandSplash) — so a plain refresh only ever
 * shows this subtle skeleton, never a bold colorful loader.
 */
const CSS = `
#frenz-boot{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:#ffffff;transition:opacity .4s ease}
@media (prefers-color-scheme:dark){#frenz-boot{background:#050816}}
#frenz-boot.frenz-boot--hide{opacity:0;pointer-events:none}
.frenz-boot__mark{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:20px;animation:frenz-boot-breathe 1.6s ease-in-out infinite}
.frenz-boot__shine{position:absolute;inset:0;background:linear-gradient(115deg,transparent 40%,rgba(148,163,184,.45) 50%,transparent 60%);transform:translateX(-130%);animation:frenz-boot-shimmer 1.4s ease-in-out infinite}
@keyframes frenz-boot-breathe{0%,100%{opacity:.26}50%{opacity:.14}}
@keyframes frenz-boot-shimmer{0%{transform:translateX(-130%)}100%{transform:translateX(130%)}}
@media (prefers-reduced-motion:reduce){.frenz-boot__mark,.frenz-boot__shine{animation:none}}
`;

// Hide as soon as the document has parsed (content is present), with a small
// minimum so it reads as a loader, and a safety cap so it can never get stuck.
const JS = `(function(){var el=document.getElementById('frenz-boot');if(!el)return;var start=Date.now();function hide(){var w=Math.max(0,300-(Date.now()-start));setTimeout(function(){el.classList.add('frenz-boot--hide');setTimeout(function(){if(el&&el.parentNode)el.parentNode.removeChild(el)},440)},w)}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',hide)}else{hide()}setTimeout(hide,6000)})();`;

export function BootSplash() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div id="frenz-boot" aria-hidden="true">
        <span className="frenz-boot__mark">
          {/* Single flat neutral color — no gradient, no sparkle. Reads on light
              and dark backgrounds alike. */}
          <svg width="56" height="56" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Frenz">
            <rect x="14.5" y="7" width="8.5" height="34" rx="4.25" fill="#8892a6" />
            <rect x="14.5" y="7" width="25.5" height="8.5" rx="4.25" fill="#8892a6" />
            <rect x="14.5" y="19.5" width="18.5" height="8" rx="4" fill="#8892a6" />
          </svg>
          <span className="frenz-boot__shine" />
        </span>
      </div>
      <script dangerouslySetInnerHTML={{ __html: JS }} />
    </>
  );
}
