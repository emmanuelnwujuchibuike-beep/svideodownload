import {
  ArrowRight,
  BadgeDollarSign,
  Compass,
  Lock,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { HeroEffects } from "@/components/landing/hero-effects";
import { BitmojiAvatar } from "@/components/landing/bitmoji-avatar";
import { PhoneMockup } from "@/components/landing/phone-mockup";
import { SupportedPlatforms } from "@/components/landing/supported-platforms";
import { WallpaperCta } from "@/components/wallpapers/wallpaper-cta";
import { DownloadDisclaimer } from "@/components/legal/download-disclaimer";
import { Downloader } from "@/features/downloader/downloader";
import { HeroCtaForm } from "@/features/downloader/hero-cta-form";
import { HeroLinkDownloader } from "@/features/downloader/hero-link-downloader";
import { SharedLinkDownloader } from "@/features/downloader/shared-link-downloader";
import { cn } from "@/lib/utils";
import { getLandingSettings } from "@/lib/landing/settings";
/* The platform list and its badge markup now live in
   `components/landing/supported-platforms.tsx` — one definition, two surfaces. */

/**
 * The trust row beneath the CTAs (public/upgraded landing page.jpg) — four
 * columns, each an icon disc, a claim and a two-line explanation.
 *
 * Every one is a checkable product FACT, not a scale claim: it is free, it needs
 * no account, it is fast, and the files go to the device rather than an account.
 * None of them asserts a user count or a rating — the Reality Ledger fails the
 * build on those, and there is no system behind either to make them true.
 */
/*
  One tone, not four. The reference (`public/landing hero section.jpg`) draws
  all four icons as the same violet outline; the previous alternating blue/violet
  made the row read as two pairs rather than one set. `tone` is gone rather than
  set to the same value four times.
*/
const TRUST = [
  { label: "Always Free", detail: "No hidden fees", Icon: BadgeDollarSign },
  { label: "Secure & Safe", detail: "Your data protected", Icon: ShieldCheck },
  { label: "Private", detail: "We value privacy", Icon: Lock },
  { label: "Cross Platform", detail: "Works everywhere", Icon: MonitorSmartphone },
] as const;

/**
 * The four claims inside the paste card (`public/landing hero section.jpg`).
 *
 * Every one is a checkable product FACT, like the trust row below it: there is
 * no watermark, the source's full quality is offered, it costs nothing, and it
 * streams rather than queueing. None of them is a scale claim — the Reality
 * Ledger fails the build on those, and there is no system behind a user count
 * or a rating to make one true.
 */
const HERO_PROOF = [
  { label: "No Watermark", Icon: ShieldCheck },
  { label: "Full HD", Icon: Sparkles },
  { label: "100% Free", Icon: BadgeDollarSign },
  { label: "Fast", Icon: Zap },
] as const;

/**
 * The avatar stack's illustrated faces — cartoon avatars only, never a real
 * person's photo (this is public marketing). Deliberately NOT captioned with a
 * user count or a star rating: both would be unsourceable scale claims the ledger
 * fails the build on, and neither has a system behind it to make true.
 */
const FACES = [
  { name: "Amara", female: true, from: "from-rose-500 to-pink-500" },
  { name: "Kwame", female: false, from: "from-blue-500 to-indigo-500" },
  { name: "Lena", female: true, from: "from-violet-500 to-purple-500" },
  { name: "Diego", female: false, from: "from-emerald-500 to-teal-500" },
] as const;

export async function Hero() {
  /*
    The admin-uploaded background for the gallery tile (Landing page panel).

    A plain DB read with no request-scoped input, so `/` stays statically
    prerendered and simply picks the change up on its next revalidation — the
    same shape as the marketing layout's reels warm-up read. Never pass
    request data in here or the front door loses its CDN caching.
  */
  const landing = await getLandingSettings();
  return (
    /*
     * Theme-aware, not pinned. `public/main landing page.jpg` is the DARK design;
     * light mode gets the same composition on a light ground — near-white with a
     * soft violet wash instead of near-black with neon.
     *
     * The effects layer carries its own light/dark pair (see hero-effects.tsx),
     * because neon trails that read as "light travelling" on #050816 read as dirt
     * on white. Same geometry, different palette and much lower intensity.
     */
    /*
      ── Native-app rhythm (owner, 2026-08-09) ────────────────────────────────
      "the h1 text and title description should be arranged upwards in a more
      moderate and smaller text so the landing page looks like a native iOS app."

      The top padding was `safe-top + 7rem`, which pushed the headline most of a
      screen down and made the page read as a marketing poster. iOS starts its
      content directly under the navigation bar; `+4.5rem` clears the fixed
      header and nothing more, so the first thing on screen is the product.
    */
    <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 to-indigo-50/60 pb-5 pt-[calc(var(--frenz-safe-top)+4.5rem)] text-foreground dark:from-[#050816] dark:to-[#050816] dark:text-white sm:pb-7 sm:pt-[calc(var(--frenz-safe-top)+5.5rem)]">
      <HeroEffects />

      {/* `items-start`, not `items-center`: centring the two columns against
          each other pushed the text column down by half the phone mockup's
          overflow on tall screens. `gap-6` on mobile keeps the mockup close
          without the 40px trough. */}
      <div className="container relative z-10 grid items-start gap-6 lg:grid-cols-2 lg:items-center lg:gap-8" id="hero">
        {/* Left — copy + CTAs */}
        {/*
          Left-aligned at every width (owner, 2026-08-04: "the landing page hero
          section currently is center while in the image, the hero section is
          not").

          The reference (public/upgraded landing page.jpg) is a PHONE
          screenshot, and every element in it — eyebrow, headline, paragraph,
          CTA rows — starts at the same left margin. This column was
          `text-center lg:text-left`, so the one viewport the reference
          actually shows was the one viewport that did not match it.

          Left is also the better reading setup: a three-line headline and a
          four-line paragraph centred on a narrow screen give the eye a new
          starting point on every line, which is measurably slower to read.
        */}
        {/*
          🔴 `min-w-0` is load-bearing (owner, 2026-08-09: "the hero section
          spread to large screen when the top placeholder fetches a file, it
          breaks the mobile view").

          A grid item defaults to `min-width: auto`, which means it refuses to
          shrink below its content. The moment the CTA's result panel appeared in
          this column, the widest thing inside it — a format row, a long title —
          set the width of the whole grid TRACK, and the page grew past the
          viewport on a phone. Nothing was wrong with the panel; the column was
          simply never told it could be narrower than its contents.
        */}
        <div className="min-w-0 text-left">
          {/*
            ── The eyebrow, restored and rebuilt (owner, 2026-08-10) ──────────
            "readd the top all-in-one downloader and social hub … but this time
            make it more responsive on all screens and premium, it shouldn't
            occupy much space."

            It was removed earlier the same day and is back because the
            reference (public/landingnew.jpg) opens with it. What is different
            is the three things that made it worth removing:

            • SPACE. It was `py-1.5`, 11px type, `leading-relaxed` and `mb-4` —
              about 46px of column. This is `py-1`, fluid type and `mb-3`:
              roughly 26px. Nearly half, for the same words.

            • RESPONSIVENESS. Thirty-four characters at a fixed 11px with
              0.14em tracking need ~285px of text width, which a 320px phone
              does not have once the pill's padding and icon are removed — so
              it wrapped to two lines and became the tallest thing above the
              headline. The type is now `clamp(9px, 2.7vw, 11px)` and the
              tracking relaxes only at `sm`, so it is ONE line at every width
              from 320px up. `whitespace-nowrap` makes that a guarantee rather
              than an expectation.

            • PREMIUM. Flat violet text on a flat violet chip became the brand
              gradient clipped to the glyphs — the same blue→violet mix the
              headline's "Connect." uses, so the two read as one system.

            `flex` + `w-fit` + `relative z-10` are kept from the previous
            version deliberately. A block-level flex row cannot be overlapped by
            an inline sibling the way an `inline-flex` box can, and that shape
            was the response to an overlap report that was never reproducible
            from source. The symptom has not recurred; the defence costs
            nothing, so it stays.
          */}
          <span className="relative z-10 mb-3 flex w-fit max-w-full items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/[0.07] px-2.5 py-1 backdrop-blur-sm dark:border-violet-400/25 dark:bg-violet-400/10 sm:px-3">
            <Sparkles className="h-3 w-3 shrink-0 text-violet-500 dark:text-violet-300 sm:h-3.5 sm:w-3.5" />
            <span className="whitespace-nowrap bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-[clamp(9px,2.7vw,11px)] font-bold uppercase leading-none tracking-[0.09em] text-transparent dark:from-blue-300 dark:to-violet-300 sm:tracking-[0.14em]">
              All-in-One Downloader &amp; Social Hub
            </span>
          </span>

          {/* "Download. Connect. Explore." — the reference H1, middle word in the
              brand gradient (public/newlandingfull.jpg). */}
          {/*
            Scaled to iOS's Large Title, not to a web hero.

            The type was `text-5xl → 6xl → 4.25rem` (48–68px). Apple's Large
            Title is 34pt and its Title 1 is 28pt; a native app never opens with
            68px type. `text-[2rem] → 4xl → 5xl` (32–48px) keeps the three-line
            stack and the brand gradient while reading as an app screen rather
            than a landing page.

            `leading-[1.05]` over `1.02`: at this size the tighter figure was
            clipping the descender on "Download." and "Explore.".
          */}
          <h1 className="text-[2rem] font-extrabold leading-[1.05] tracking-[-0.035em] text-slate-900 dark:text-white sm:text-4xl lg:text-5xl">
            Download.
            <br />
            <span className="bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-violet-400 dark:to-fuchsia-400">
              Connect.
            </span>
            <br />
            Explore.
          </h1>

          {/*
            iOS body copy is 17pt and stays 17pt — it does not grow with the
            viewport the way web hero text does. `text-[15px] → 16px` sits in
            that range, and dropping the `sm:text-lg` step is most of what stops
            the paragraph competing with the headline.
          */}
          {/*
            ── Shortened so the buttons sit higher (owner, 2026-08-09) ────────
            "make the landing hero feel like an app so the buttons can go
            upwards."

            This was four lines on a phone, and it was the single biggest block
            between the headline and the CTA. Cutting it is not a compression
            trick — "no watermark, full HD, completely free" is now stated
            VERBATIM by the proof strip inside the paste card a few rows down,
            so the paragraph was repeating the three claims the reader is about
            to meet again. What is left is the one thing nothing else says: what
            Frenz is.

            Two lines on a phone instead of four lifts the CTA by roughly 48px,
            which on a 600px viewport is the difference between the paste box
            being below the fold and above it.
          */}
          <p className="mt-3 max-w-md text-pretty text-[15px] leading-relaxed text-slate-600 dark:text-white/70 sm:text-base">
            Download from the platforms you already use, then share, connect and explore — all in{" "}
            <span className="font-medium text-blue-600 dark:text-blue-300">one super app.</span>
          </p>

          {/* CTAs */}
          {/*
            CTA stack — the owner's reference (public/upgraded landing page.jpg).

            Three full-width rows, each an icon tile + title + one-line
            explanation + a trailing arrow, rather than three inline pills. The
            reference's own hierarchy: one loud primary, two calm secondaries.

            Every row is a plain server-rendered <Link>. The landing sits at its
            cold-entry ceiling with no headroom, so this section adds markup and
            CSS but not a single byte of client JavaScript — the arrows and the
            sheen are CSS, and nothing here hydrates.
          */}
          {/* Tighter stack — iOS groups related controls at ~16-20px, not 32. */}
          <div className="mt-5 flex flex-col gap-2.5">
            {/* Primary — goes straight to the paste-link tool (owner, 2026-07-18):
                the downloader needs no account, so a signup wall in front of the
                one thing the page asks for was the wrong door. */}
            {/*
              The CTA — a button that becomes a paste field. The transform is
              still pure CSS (see `.frenz-cta*` in globals.css); the island only
              exists to intercept the submit so the result appears in place
              instead of navigating. Full reasoning in hero-cta-form.tsx.
            */}
            {/*
              Supported platforms, ABOVE the download button (owner,
              2026-08-09: "the platform supported is supposed to be at the top
              of the download button not below").

              It reads better here for a reason worth keeping: the marks answer
              "does this handle my link?", and that question comes BEFORE the
              decision to tap, not after it. Below the button it also split the
              CTA stack in half — three tall rows with a two-line badge grid
              wedged between the first and second, which is most of why the
              stack looked scattered.

              It is deliberately NOT removed from the "Download anything" card
              further down: that placement comes from the owner's own reference
              (`public/newlanding.jpg`), so both are intended. One shared
              component — see `supported-platforms.tsx`.
            */}
            <SupportedPlatforms className="mb-1" />

            {/*
              ── The paste card (public/landing hero section.jpg) ──────────────
              The reference wraps the CTA and a four-item trust strip in ONE
              light card with a gradient hairline ring — not a solid gradient
              block. The ring is a `p-px` gradient wrapper around an inner
              surface: one element, no pseudo-element, and it clips correctly at
              the radius because the inner card carries its own background.

              The trust strip sits INSIDE the card but OUTSIDE the form, so the
              form's `absolute inset-0` face (the button-becomes-a-field
              transform) covers only the input row — never the strip.
            */}
            <div className="rounded-[1.35rem] bg-gradient-to-r from-blue-500 via-violet-500 to-fuchsia-500 p-px shadow-lg shadow-violet-500/15">
              <div className="rounded-[1.3rem] bg-white p-2 dark:bg-[#0b1020]">
                <HeroCtaForm />
                <ul className="mt-2 flex flex-wrap items-center justify-between gap-y-2 px-1 pb-1 pt-1.5">
                  {HERO_PROOF.map((p, i) => (
                    <li
                      key={p.label}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-1 text-[11px] font-semibold text-slate-600 dark:text-white/70",
                        // Hairline dividers between columns, as in the reference.
                        i > 0 && "border-l border-slate-200/80 dark:border-white/10",
                      )}
                    >
                      <p.Icon className="h-3.5 w-3.5 shrink-0 text-violet-500 dark:text-violet-300" />
                      {p.label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/*
              🔴 The trademark disclaimer, directly under the CTA (owner,
              2026-08-10: "put the logo disclaimer below the top hero
              placeholder button").

              MOVED, not added. It was rendered further down inside the purple
              "Download anything" card, which is several screens away from the
              logo strip it disclaims — and a disclaimer that appears long after
              the marks it qualifies is doing its job in the wrong order. It now
              sits immediately below the CTA, one row under the "Works with"
              logos.

              The copy is unchanged and still comes from one component, so there
              is exactly one version of this sentence on the site. Left-aligned
              via the `align` prop rather than a className — see the note in
              that component for why passing `text-left` would silently lose.
            */}
            <DownloadDisclaimer
              align="left"
              className="mx-0 mt-1 max-w-none px-1 text-[10px] leading-snug"
            />

            {/*
              ── Two cards, side by side (the reference) ──────────────────────
              These were two full-width stacked rows. The reference pairs them:
              a light "Explore Features" tile beside the purple Wallpaper
              Gallery tile, both tall, each with a circular arrow bottom-right.

              Side by side is also the better shape here — they are alternatives
              to each other, and stacking two full-width rows under a CTA reads
              as a queue of three equal actions rather than one primary and two
              choices.
            */}
            <div className="grid grid-cols-2 gap-3">
              {/*
                ── Explore Features, to the reference (public/landingnew.jpg) ─
                Owner, 2026-08-10: "the premium colour mix in the explore
                button".

                Three changes, all from the image:

                • The icon is a CIRCLE, not a rounded square, and the gradient
                  is a three-stop blue → indigo → violet rather than a two-stop
                  blue → violet. A two-stop ramp between those hues passes
                  through a muddy mid-tone; the indigo stop is what makes it
                  read as a deliberate mix instead of a fade. A soft coloured
                  glow underneath lifts the disc off the white card.

                • The reference has a large translucent glass shape drifting
                  off the card's right edge. That is two blurred, rotated
                  rounded squares here — no image, no bytes, and it survives
                  dark mode because it is tinted rather than white.

                • Subtitle wording matches the image.
              */}
              <Link
                href="/features"
                className="group relative flex min-h-[11rem] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 text-left text-slate-900 shadow-soft transition duration-200 hover:-translate-y-0.5 hover:shadow-card active:scale-[0.995] dark:border-white/15 dark:bg-white/5 dark:text-white dark:backdrop-blur"
              >
                {/*
                  🔴 Decoration first in the markup, and every content node
                  below carries `relative z-[1]`.

                  Positioned elements paint above static siblings, so an
                  absolutely-positioned decoration will cover its own card's
                  text — the exact regression that shipped on the Wallpaper
                  tile when its gradient was briefly moved into an
                  `inset-0` child.
                */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-8 top-6 h-32 w-32 rotate-[18deg] rounded-[2rem] bg-gradient-to-br from-violet-400/25 via-indigo-400/15 to-transparent blur-[1px] transition-transform duration-500 group-hover:rotate-[22deg] motion-reduce:transition-none dark:from-violet-400/20 dark:via-indigo-400/10"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-2 top-20 h-20 w-20 -rotate-12 rounded-3xl bg-gradient-to-br from-blue-400/20 to-transparent blur-[2px] dark:from-blue-400/15"
                />

                <span className="relative z-[1] flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
                  <Compass className="h-6 w-6" />
                </span>
                <span className="relative z-[1] mt-auto flex items-end justify-between gap-3 pt-4">
                  <span className="min-w-0">
                    <span className="block text-base font-bold leading-tight">Explore Features</span>
                    <span className="mt-1 block text-xs leading-snug text-slate-500 dark:text-white/60">
                      See everything Frenz can do.
                    </span>
                  </span>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70 transition group-hover:bg-slate-200 dark:bg-white/10 dark:ring-white/15">
                    <ArrowRight className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 dark:text-white" />
                  </span>
                </span>
              </Link>

              {/* Same component as the downloads dashboard — icon, dwell
                  flourish, sheen and VIEW cue all preserved (owner: "don't
                  remove the existing wallpaper button icon and design
                  animation"), in the reference's card shape. */}
              {/*
                🔴 Preload the wallpaper CTA's backdrop.

                It is a CSS `background-image`, which the browser's preload
                scanner cannot see: a background is only discovered once the
                stylesheet has been parsed AND the element has been laid out, so
                the request starts several hundred milliseconds after everything
                the scanner found in the HTML. For a 147 KB image sitting at the
                fold, that late start lands squarely inside the LCP window.

                A `<link rel="preload">` in the markup puts it back in front of
                the scanner. `fetchPriority="low"` because it is a decorative
                backdrop, not the largest element — it should start early
                without competing with the hero poster above it, which is the
                one carrying `priority`.

                It cannot go through `next/image`: that renders an <img>, and
                this is a background the text sits on top of.
              */}
              {landing.wallpaperCtaImageUrl ? (
                <link
                  rel="preload"
                  as="image"
                  href={landing.wallpaperCtaImageUrl}
                  fetchPriority="low"
                />
              ) : null}
              <WallpaperCta variant="card" backgroundUrl={landing.wallpaperCtaImageUrl || null} />
            </div>

            {/*
              ── Notes that still apply to the Wallpaper card above ───────────

              It is a plain server-rendered Link, NOT a client island. The first
              version was a client component warming the route on idle; it added
              a client boundary to the landing and pushed the page straight
              through the cold-entry budget (budget.test caught it at 303 kB). A
              Link with `prefetch` costs ZERO client JavaScript and still opens
              instantly — `loading.tsx` on /wallpapers does the rest.

              The 2-second dwell cue (owner, 2026-08-09: "when a user stays at
              the button section for 2 secs, the wallpaper icon should animate
              premium attractive, writing a small text that says view with a
              microscope") is entirely CSS with a 2s `animation-delay` — see
              `.frenz-wp-*` in globals.css. No timer, no state, no client
              component, which is the only way to have it on a page with no
              bytes to spare.
            */}

            {/*
              The hero CTA's own result — under the Wallpaper Gallery button,
              exactly where the tap happened (owner). Renders nothing at all
              without a `?paste=` link, so it costs the other 99% of visitors no
              markup and no layout. The Suspense boundary is what keeps `/`
              statically generated; its fallback is `null`, which is also the
              no-link state, so the static HTML and the hydrated page agree.
            */}
            <Suspense fallback={null}>
              <HeroLinkDownloader />
            </Suspense>
          </div>

          {/*
            Trust row — the reference's four columns, each an icon disc, a claim
            and a two-line explanation, divided by hairlines.

            Every one is a checkable product FACT, not a scale claim: free,
            no account, fast, and "your data stays yours". Nothing here asserts a
            user count or a rating, which the Reality Ledger would fail the build
            on and which there is no system behind to make true.
          */}
          {/* The reference wraps this row in its own light CARD rather than
              letting it sit bare on the page background. */}
          <ul className="mt-6 grid grid-cols-4 gap-x-1 divide-x divide-slate-200/80 rounded-3xl border border-slate-200 bg-white/80 px-1 py-4 shadow-soft backdrop-blur dark:divide-white/10 dark:border-white/10 dark:bg-white/5">
            {TRUST.map(({ label, detail, Icon }) => (
              <li key={label} className="flex flex-col items-center px-1 text-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="mt-2 text-[13px] font-bold leading-tight text-slate-900 dark:text-white">{label}</span>
                <span className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-white/60">{detail}</span>
              </li>
            ))}
          </ul>

          {/* Social proof — the reference's avatar stack, but WITHOUT a fabricated
              "50,000+ Happy Users" count or an invented star rating (there is no
              review system to source one). Illustrative cartoon avatars, never real
              faces, and an honest number-free line. See the Reality Ledger. */}
          <div className="mt-8 flex items-center justify-start gap-3">
            <div className="flex -space-x-2.5">
              {FACES.map((f) => (
                <span
                  key={f.name}
                  className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br ${f.from} ring-2 ring-background`}
                >
                  <BitmojiAvatar seed={f.name} female={f.female} className="h-full w-full" />
                </span>
              ))}
            </div>
            <p className="text-sm font-medium text-slate-600 dark:text-white/70">
              Built for creators &amp; everyday downloaders
            </p>
          </div>
        </div>

        {/* Right — phone mockup.
            pb reserves room for the download callout, which hangs ~56px BELOW the
            frame. Without it the chip collided with the "Paste a link to download"
            label under the hero — the callout is absolutely positioned, so it
            contributes no height of its own and nothing downstream knows it's there. */}
        <div className="relative pb-16 sm:pb-14">
          <PhoneMockup />
        </div>
      </div>

      {/* "Download anything" card — the purple paste-and-download panel from
          public/newlanding.jpg, sitting between the hero phone and the download
          mockup below.
          Uses its own (narrower) side padding instead of `container`'s 24px —
          the default made the card read as "tightly pressed" on phones; a
          smaller margin lets it spread closer to both edges, SnapTik-style,
          while keeping the same max-w-3xl cap everything else on the page uses. */}
      <div id="download" className="relative z-10 mx-auto mt-12 max-w-3xl scroll-mt-24 px-3 sm:mt-14 sm:px-6">
        <div className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-blue-600 via-violet-600 to-fuchsia-600 p-5 shadow-elevated sm:p-7">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
          <div className="relative text-center text-white">
            <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">Download anything</h2>
            <p className="mt-1.5 text-sm text-white/80">Paste a link from any platform and download instantly.</p>
          </div>
          {/* The tool is prerendered into the static HTML by the fallback, then
              swapped for the identical tool pre-filled from a Share Target
              hand-off. Same markup either way, so nothing shifts — and the
              boundary is what lets `/` prerender at all (useSearchParams()
              suspends). See features/downloader/shared-link-downloader.tsx. */}
          <div className="relative mt-5">
            <Suspense fallback={<Downloader hideDisclaimer />}>
              <SharedLinkDownloader />
            </Suspense>
          </div>
          {/* Supported platforms, per the reference card. Same component as the
              hero's row, on the gradient surface. */}
          <SupportedPlatforms surface="onGradient" className="relative mt-4" />
          {/*
            The disclaimer that used to live here has MOVED to directly under
            the hero CTA (owner, 2026-08-10). It is not repeated here on
            purpose: one page needs one copy of a legal sentence, and a second
            one three screens down is the kind of accumulation the same
            instruction ("less cluster") asked to stop. The `Downloader` in this
            card still runs with `hideDisclaimer`, so nothing re-adds it.
          */}
        </div>
      </div>
    </section>
  );
}
