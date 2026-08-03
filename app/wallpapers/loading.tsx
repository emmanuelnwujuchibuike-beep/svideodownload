/**
 * /wallpapers instant shell.
 *
 * This is what makes the landing's Wallpapers button feel instant. The page
 * itself is `force-dynamic` (it reads the library and the session), so without a
 * loading boundary a cold navigation would sit on the landing page until the
 * server responded. With one, Next paints this the moment the link is tapped and
 * streams the real grid in behind it — and it is the STATIC part of the route,
 * so `<Link prefetch>` on the landing warms it cheaply, with no dynamic render
 * per landing visit.
 *
 * The skeleton mirrors the real header and grid exactly, so the swap is a fill,
 * not a re-layout: nothing moves when the artwork arrives (CLS stays flat).
 */
export default function WallpapersLoading() {
  return (
    <main className="min-h-dvh pb-24">
      <header
        className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-blue-600/15 via-violet-600/10 to-fuchsia-600/15"
        style={{ paddingTop: "calc(var(--frenz-safe-top, 0px) + 1.25rem)" }}
      >
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -left-20 top-10 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="relative mx-auto w-full max-w-3xl px-4 pb-6">
          <div className="h-5 w-16 rounded-full bg-foreground/10" />
          {/* The title is real text, not a bar — it is correct before the data
              loads, so there is no reason to make someone wait to read it. */}
          <h1 className="mt-3 text-3xl font-bold tracking-[-0.02em] sm:text-4xl">Wallpapers</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Tap any design to open it full screen. Free HD downloads — no account needed.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="h-6 w-24 animate-pulse rounded-full bg-foreground/10" />
            <div className="h-7 w-40 animate-pulse rounded-full bg-foreground/10" />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-4 pt-5">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-foreground/10 ring-1 ring-border/50" />
          ))}
        </div>
      </div>
    </main>
  );
}
