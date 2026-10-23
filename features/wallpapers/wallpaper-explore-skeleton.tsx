/**
 * /wallpapers before its data — the cold-entry skeleton (owner, 2026-10-22: "Wallpaper cold entry
 * still shows the old Wallpaper UI for the skeleton loader").
 *
 * It mirrors wallpaper-explore.tsx (design/Wallpapers.dc.html) piece for piece — the 470 px dark
 * featured hero with its glass back / search-upload buttons, the badge, the headline and the two
 * actions, the glass chip row, then the white sheet rising over it with its handle, the heading row
 * and the three-across grid of 1:2 tiles — so the real page arriving is a fill, not a re-layout.
 * Used by BOTH app/wallpapers/loading.tsx (a tap from another page) and the page's own Suspense
 * fallback (a cold document load); the old layout lived on in both. Keep it in step with
 * wallpaper-explore.tsx: a skeleton that lies about the layout guarantees the jump it exists to
 * prevent.
 *
 * A server component: no state, no effect, nothing to hydrate.
 */

const GLASS = "border border-white/25 bg-white/[0.14]";

export function WallpaperExploreSkeleton() {
  return (
    <main className="frenz-ui min-h-dvh bg-frenz-page pb-24 text-frenz-ink" aria-busy="true">
      <section className="relative h-[470px] overflow-hidden bg-frenz-ink" aria-hidden>
        <span className="absolute inset-0 animate-pulse bg-white/[0.04] motion-reduce:animate-none" />
        <div className="absolute inset-x-4 flex items-center justify-between" style={{ top: "calc(var(--frenz-safe-top, 0px) + 14px)" }}>
          <span className={`${GLASS} h-11 w-11 rounded-full`} />
          <span className={`${GLASS} h-11 w-[88px] rounded-full`} />
        </div>
        <div className="absolute inset-x-5 top-[214px] flex flex-col gap-2.5">
          <span className={`${GLASS} h-[22px] w-24 rounded-full`} />
          {/* real text, a <p>: the streamed page carries the one <h1> (two in one document was measured once) */}
          <p className="m-0 font-heading text-[40px] font-extrabold leading-none tracking-[-1.5px] text-white">Wallpapers</p>
          <span className="h-[19px] w-44 rounded-full bg-white/20" />
          <div className="mt-1 flex items-center gap-2.5">
            <span className="h-11 w-[138px] rounded-full bg-white/25" />
            <span className={`${GLASS} h-11 w-[110px] rounded-full`} />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-10 flex gap-2 overflow-hidden px-4">
          <span className={`${GLASS} h-11 w-11 shrink-0 rounded-full`} />
          {[56, 84, 72, 90, 64].map((w, i) => (
            <span key={i} className={`${GLASS} h-11 shrink-0 rounded-full`} style={{ width: w }} />
          ))}
        </div>
      </section>

      <section className="relative -mt-[26px] rounded-t-[28px] bg-frenz-page px-4 pt-2" aria-label="Loading wallpapers">
        <div aria-hidden className="mx-auto mb-3.5 h-[5px] w-9 rounded-full bg-frenz-line" />
        <div aria-hidden className="flex items-center justify-between gap-3 px-1 pb-3.5">
          <span className="h-6 w-24 animate-pulse rounded-full bg-frenz-fill motion-reduce:animate-none" />
          <span className="h-9 w-[92px] rounded-full bg-frenz-fill" />
        </div>
        <div aria-hidden className="grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} className="aspect-[1/2] animate-pulse rounded-[22px] bg-frenz-fill motion-reduce:animate-none" />
          ))}
        </div>
      </section>
    </main>
  );
}
