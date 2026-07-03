/**
 * Boot splash — a branded Frenz "F" loader baked into the initial HTML so cold
 * entries (sign-in redirect, a hard refresh, a first visit after clearing the
 * cache) never flash an empty page before content paints. It's plain markup with
 * inline critical CSS (works before the CSS bundle loads) and an inline script
 * that fades it out the moment the document is ready. It renders once per hard
 * load; in-app (SPA) navigation keeps the persistent layout, so it never re-shows.
 */
const CSS = `
#frenz-boot{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;background:#ffffff;transition:opacity .45s ease}
@media (prefers-color-scheme:dark){#frenz-boot{background:#080b14}}
#frenz-boot.frenz-boot--hide{opacity:0;pointer-events:none}
.frenz-boot__wrap{position:relative;width:92px;height:92px;display:flex;align-items:center;justify-content:center}
.frenz-boot__ring{position:absolute;inset:0;border-radius:9999px;border:3px solid rgba(124,58,237,.15);border-top-color:#7c3aed;animation:frenz-boot-spin .8s linear infinite}
.frenz-boot__ring2{position:absolute;inset:8px;border-radius:9999px;border:2px solid rgba(59,130,246,.10);border-bottom-color:#3b82f6;animation:frenz-boot-spin 1.2s linear infinite reverse}
.frenz-boot__mark{animation:frenz-boot-pulse 1.4s ease-in-out infinite;filter:drop-shadow(0 2px 12px rgba(124,58,237,.4))}
.frenz-boot__label{font:700 14px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;background:linear-gradient(90deg,#3b82f6,#8b5cf6,#d946ef);-webkit-background-clip:text;background-clip:text;color:transparent;letter-spacing:-.01em}
@keyframes frenz-boot-spin{to{transform:rotate(360deg)}}
@keyframes frenz-boot-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.92);opacity:.85}}
@media (prefers-reduced-motion:reduce){.frenz-boot__ring,.frenz-boot__ring2,.frenz-boot__mark{animation:none}}
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
          <span className="frenz-boot__ring" />
          <span className="frenz-boot__ring2" />
          <span className="frenz-boot__mark">
            <svg width="44" height="44" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Frenz">
              <defs>
                <linearGradient id="frenz-boot-f" x1="10" y1="6" x2="40" y2="44" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#d946ef" />
                  <stop offset="0.5" stopColor="#8b5cf6" />
                  <stop offset="1" stopColor="#3b82f6" />
                </linearGradient>
                <linearGradient id="frenz-boot-play" x1="24" y1="28" x2="38" y2="42" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#22d3ee" />
                  <stop offset="1" stopColor="#3b82f6" />
                </linearGradient>
              </defs>
              <rect x="13" y="8" width="9" height="32" rx="4.5" fill="url(#frenz-boot-f)" />
              <rect x="13" y="8" width="25" height="9" rx="4.5" fill="url(#frenz-boot-f)" />
              <rect x="13" y="20" width="18" height="8.5" rx="4.25" fill="url(#frenz-boot-f)" />
              <path d="M26 29.5 L38 36 L26 42.5 Z" fill="url(#frenz-boot-play)" stroke="url(#frenz-boot-play)" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        <span className="frenz-boot__label">Frenz</span>
      </div>
      <script dangerouslySetInnerHTML={{ __html: JS }} />
    </>
  );
}
