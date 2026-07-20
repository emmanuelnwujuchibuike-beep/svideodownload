/**
 * The login page's hero image — one premium visual, not a collage.
 *
 * ── Why this was cut from seven images to one ─────────────────────────────────
 *
 * The login page used to float seven WebP tiles (~720 kB total) that sprang in
 * with framer-motion. That is a lot of weight and a client-side animation
 * library on the one page a returning user hits most, for decoration. The brief
 * was to make it lightweight and singular, keeping only the image that matches
 * what the product actually does.
 *
 * `4.webp` is that image: a person pulling media from the exact platforms this
 * app downloads from — TikTok, Instagram, YouTube, Facebook, Pinterest, X,
 * Snapchat — which is the product in one frame. (The other six were abstract
 * neon art with no connection to it, and one was a music note the old code even
 * mislabelled as this one.)
 *
 * ── No longer a client component ──────────────────────────────────────────────
 *
 * With the entrance springs gone there is no state and no effect, so this is a
 * plain server component. That removes framer-motion from the login route's
 * client bundle entirely. The perpetual drift is CSS, which needs no JS.
 *
 * ── The CLS lesson is preserved ───────────────────────────────────────────────
 *
 * The height is still derived from WIDTH via `aspect-*`, never `h-full`.
 * Measured previously as the app's single largest layout shift: this element
 * sits in a `flex-1` column whose height depends on the auth block below, which
 * grows when the webfont swaps — so a height tied to the container dragged the
 * image ~200 px late in load (CLS 0.1614, POOR). A width-derived height is fixed
 * at first paint. `next/image` with explicit dimensions gives the same
 * guarantee for the intrinsic box.
 */
import Image from "next/image";

export function LoginCollage() {
  return (
    <div className="relative mx-auto aspect-[3/4] max-h-[46vh] w-full max-w-[320px]">
      <div className="relative h-full w-full overflow-hidden rounded-[28px] bg-gradient-to-br from-violet-600 to-fuchsia-700 shadow-2xl ring-1 ring-inset ring-white/15 motion-safe:animate-drift-slow">
        <Image
          src="/login/4.webp"
          alt=""
          aria-hidden
          fill
          /*
            The LCP element on this page, so it is eager and high priority — and
            it renders at full opacity in the server HTML (no JS-gated entrance),
            which is the fix that took this page's LCP from 8-11s down to the
            image's own arrival time. LCP measures visibility, and an element
            hidden until hydration cannot become the LCP until hydration ends.
          */
          priority
          sizes="(max-width: 640px) 80vw, 320px"
          className="object-cover"
        />
        {/* Soft top light + bottom shade for depth. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-white/5"
        />
      </div>
    </div>
  );
}
