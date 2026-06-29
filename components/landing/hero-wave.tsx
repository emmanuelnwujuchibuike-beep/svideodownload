/** Decorative flowing blue wave ribbon — sits behind the hero phone on the
 * right, echoing the marketing mockup. Pure SVG, GPU-friendly drift animation. */
export function HeroWave() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-[-6%] top-1/2 -z-0 hidden h-[120%] w-[60%] -translate-y-1/2 motion-safe:animate-drift-slow lg:block"
    >
      <svg viewBox="0 0 600 600" fill="none" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="wave1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#3b82f6" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="wave2" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <path
          d="M -40 360 C 140 300 200 480 360 420 C 480 372 520 220 640 250 L 660 360 C 540 340 470 470 350 510 C 210 560 120 430 -40 470 Z"
          fill="url(#wave1)"
        />
        <path
          d="M -40 250 C 120 190 220 340 360 280 C 470 232 520 120 650 150 L 660 230 C 540 210 470 320 360 360 C 230 408 120 300 -40 340 Z"
          fill="url(#wave2)"
        />
      </svg>
    </div>
  );
}
