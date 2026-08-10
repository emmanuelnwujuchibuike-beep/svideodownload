/**
 * /wallpapers instant shell.
 *
 * This is what makes the landing's Wallpaper Gallery button feel instant. The
 * page itself is `force-dynamic` (it reads the library and the session), so
 * without a loading boundary a cold navigation would sit on the landing page
 * until the server responded. With one, Next paints this the moment the link is
 * tapped and streams the real grid in behind it — and it is the STATIC part of
 * the route, so `<Link prefetch>` on the landing warms it cheaply, with no
 * dynamic render per landing visit.
 *
 * The skeleton mirrors the real page's structure exactly — bar, headline, deck,
 * pill row, filter card, section heading, three-across grid — so the swap is a
 * fill, not a re-layout: nothing moves when the artwork arrives (CLS stays
 * flat). It has to be kept in step with wallpaper-explore.tsx; a skeleton that
 * lies about the layout is worse than no skeleton, because it guarantees a jump.
 */
export default function WallpapersLoading() {
  return (
    <main className="min-h-dvh pb-24">
      <header className="relative" style={{ paddingTop: "calc(var(--frenz-safe-top, 0px) + 0.75rem)" }}>
        <div className="mx-auto w-full max-w-3xl px-4">
          <div className="flex items-start justify-between">
            <div className="h-11 w-11 rounded-2xl bg-card shadow-soft ring-1 ring-inset ring-border/50" />
            <div className="h-11 w-11 rounded-2xl bg-card shadow-soft ring-1 ring-inset ring-border/50" />
          </div>

          <div className="relative mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 pb-2">
              {/* Real text, not a bar — the headline and the promise are correct
                  before any data loads, so there is no reason to make someone
                  wait to read them.

                  A <p> styled as the headline rather than an <h1>, and that is
                  not a detail. A streamed dynamic route emits this fallback AND
                  the real page into the SAME document, so an <h1> here left the
                  served HTML carrying two `<h1>Wallpapers</h1>` — verified by
                  fetching it. Identical classes, so nothing moves; the page's
                  own heading is the only one a crawler finds. */}
              {/* Type scale kept identical to the real headline — see the
                  collision note in wallpaper-explore.tsx. A skeleton that sizes
                  its text differently guarantees the jump it exists to
                  prevent. */}
              <p className="text-[clamp(1.75rem,8.6vw,2.75rem)] font-extrabold leading-[0.95] tracking-[-0.045em] sm:text-6xl">
                Wallpapers
              </p>
              <p className="mt-3 text-[15px] leading-snug text-muted-foreground sm:text-base">
                Stunning HD wallpapers
                <br />
                for your screen.
                <br />
                <span className="font-semibold text-primary">Free</span> to download.
              </p>
            </div>
            <div className="relative aspect-[150/168] w-[38%] max-w-[190px] shrink-0">
              <span className="absolute inset-y-2 left-1/2 block w-[62%] -translate-x-[92%] -rotate-[11deg] rounded-2xl bg-foreground/10" />
              <span className="absolute inset-y-2 left-1/2 block w-[62%] -translate-x-[8%] rotate-[11deg] rounded-2xl bg-foreground/10" />
              <span className="absolute inset-y-2 left-1/2 block w-[62%] -translate-x-1/2 animate-pulse rounded-2xl bg-foreground/15" />
            </div>
          </div>
        </div>
      </header>

      <div className="mt-4 overflow-hidden">
        <div className="mx-auto flex w-max max-w-none gap-2.5 px-4 sm:w-full sm:max-w-3xl">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[46px] w-28 shrink-0 animate-pulse rounded-2xl bg-foreground/10" />
          ))}
        </div>
      </div>

      <div className="mx-auto mt-3 w-full max-w-3xl px-4">
        <div className="h-[66px] rounded-3xl bg-card shadow-soft ring-1 ring-inset ring-border/50" />
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 pt-5">
        <div className="mb-3 h-6 w-28 animate-pulse rounded-full bg-foreground/10" />
        <div className="grid grid-cols-3 gap-2.5">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[7/10] animate-pulse rounded-2xl bg-foreground/10 ring-1 ring-border/50" />
          ))}
        </div>
      </div>
    </main>
  );
}
