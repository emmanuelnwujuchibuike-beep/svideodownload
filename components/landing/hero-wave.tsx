/** Decorative flowing blue wave ribbon behind the hero phone, echoing the
 * marketing mockup. Pure SVG, GPU-friendly drift. Visible on every screen. */
export function HeroWave() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 -z-0 w-[85%] opacity-70 will-change-transform motion-safe:animate-drift-slow sm:w-[70%] lg:w-[58%]"
    >
      <svg
        viewBox="0 0 600 600"
        fill="none"
        className="h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="heroWave1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.5" />
            <stop offset="55%" stopColor="#3b82f6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="heroWave2" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.18" />
          </linearGradient>
          <linearGradient id="heroWave3" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <path d="M -60 380 C 120 300 220 470 380 410 C 500 365 540 210 660 250 L 680 380 C 560 350 480 480 360 520 C 200 575 100 440 -60 480 Z" fill="url(#heroWave1)" />
        <path d="M -60 270 C 110 200 230 350 380 285 C 490 238 540 120 670 150 L 680 250 C 560 225 470 330 360 372 C 220 425 110 320 -60 360 Z" fill="url(#heroWave2)" />
        <path d="M -60 470 C 140 400 240 540 400 480 C 520 435 560 320 680 350 L 690 460 C 560 435 500 540 380 580 C 240 632 120 520 -60 560 Z" fill="url(#heroWave3)" />
      </svg>
    </div>
  );
}
