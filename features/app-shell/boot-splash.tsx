/**
 * Boot splash — a branded Frenz "F" baked into the initial HTML so cold entries
 * (sign-in redirect, hard refresh, first visit after clearing the cache) never
 * flash an empty page before content paints. Plain markup + inline critical CSS
 * (works before the CSS bundle loads) + an inline script that fades it the moment
 * the document is ready. Renders once per hard load; SPA navigation keeps the
 * persistent layout, so it never re-shows.
 *
 * Style: a premium shimmering skeleton F (soft brand aura + a light sweep) — NO
 * spinner. Palette matches the design tokens (Electric Blue → Royal Purple).
 */
const CSS = `
#frenz-boot{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:#ffffff;transition:opacity .45s ease}
@media (prefers-color-scheme:dark){#frenz-boot{background:#050816}}
#frenz-boot.frenz-boot--hide{opacity:0;pointer-events:none}
.frenz-boot__wrap{position:relative;width:92px;height:92px;display:flex;align-items:center;justify-content:center}
.frenz-boot__glow{position:absolute;width:130px;height:130px;border-radius:9999px;background:radial-gradient(circle,rgba(10,132,255,.30),rgba(108,77,255,.20) 45%,transparent 72%);filter:blur(4px);animation:frenz-boot-breathe 1.8s ease-in-out infinite}
.frenz-boot__mark{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:22px;animation:frenz-boot-breathe 1.8s ease-in-out infinite;filter:drop-shadow(0 6px 18px rgba(108,77,255,.35))}
.frenz-boot__shine{position:absolute;inset:0;background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.65) 50%,transparent 65%);transform:translateX(-130%);animation:frenz-boot-shimmer 1.5s ease-in-out infinite}
.frenz-boot__label{font:800 15px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;background:linear-gradient(90deg,#0A84FF,#6C4DFF,#D946EF);-webkit-background-clip:text;background-clip:text;color:transparent;letter-spacing:-.02em}
@keyframes frenz-boot-breathe{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.93);opacity:.9}}
@keyframes frenz-boot-shimmer{0%{transform:translateX(-130%)}100%{transform:translateX(130%)}}
@media (prefers-reduced-motion:reduce){.frenz-boot__glow,.frenz-boot__mark,.frenz-boot__shine{animation:none}}
`;

// Hide as soon as the document has parsed (content is present), with a small
// minimum so it reads as a loader, and a safety cap so it can never get stuck.
const JS = `(function(){var el=document.getElementById('frenz-boot');if(!el)return;var start=Date.now();function hide(){var w=Math.max(0,350-(Date.now()-start));setTimeout(function(){el.classList.add('frenz-boot--hide');setTimeout(function(){if(el&&el.parentNode)el.parentNode.removeChild(el)},480)},w)}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',hide)}else{hide()}setTimeout(hide,6000)})();`;

export function BootSplash() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div id="frenz-boot" aria-hidden="true">
        <div className="frenz-boot__wrap">
          <span className="frenz-boot__glow" />
          <span className="frenz-boot__mark">
            <svg width="54" height="54" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Frenz">
              <defs>
                <linearGradient id="frenz-boot-f" x1="10" y1="6" x2="40" y2="44" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#0A84FF" />
                  <stop offset="0.52" stopColor="#6C4DFF" />
                  <stop offset="1" stopColor="#D946EF" />
                </linearGradient>
              </defs>
              <rect x="14.5" y="7" width="8.5" height="34" rx="4.25" fill="url(#frenz-boot-f)" />
              <rect x="14.5" y="7" width="25.5" height="8.5" rx="4.25" fill="url(#frenz-boot-f)" />
              <rect x="14.5" y="19.5" width="18.5" height="8" rx="4" fill="url(#frenz-boot-f)" />
              <path d="M36.4 19.6 l1.15 2.55 2.55 1.15 -2.55 1.15 -1.15 2.55 -1.15 -2.55 -2.55 -1.15 2.55 -1.15 z" fill="#22D3EE" />
            </svg>
            <span className="frenz-boot__shine" />
          </span>
        </div>
        <span className="frenz-boot__label">Frenz</span>
      </div>
      <script dangerouslySetInnerHTML={{ __html: JS }} />
    </>
  );
}
