import { BadgeCheck, Bell, MoreHorizontal, Play, Plus, Search, Users, Wifi } from "lucide-react";
import Image from "next/image";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import {
  FrenzFriendsOutline,
  FrenzHomeSolid,
  FrenzInboxOutline,
  FrenzPersonSolid,
} from "@/components/icons/frenz-icons";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { getLandingSettings } from "@/lib/landing/settings";
import { getFeed } from "@/lib/social/feed";

/**
 * Floating platform bubbles orbiting the phone — the "download from anywhere"
 * message told in logos, matching `public/newlandingfull.jpg`. Brand marks come
 * from the shared registry (lib/platform-icons); Snapchat gets its yellow ground
 * because its mark is white-on-colour and would vanish on a white bubble.
 */
const ORBIT: {
  id: keyof typeof BRAND_ICONS;
  className: string;
  color: string;
  bubble?: string;
  float?: boolean;
}[] = [
  { id: "tiktok", className: "-left-4 top-[14%]", color: "text-black", float: true },
  { id: "instagram", className: "-right-5 top-[9%]", color: "text-[#e1306c]" },
  { id: "snapchat", className: "-left-7 top-[38%]", color: "text-black", bubble: "bg-[#fffc00]", float: true },
  { id: "twitter", className: "-right-7 top-[42%]", color: "text-black" },
  { id: "youtube", className: "-left-5 top-[64%]", color: "text-[#ff0000]", float: true },
  { id: "facebook", className: "-right-4 top-[62%]", color: "text-[#0866ff]" },
];

/**
 * The hero phone — an angled iPhone 17 Pro Max showing the Frenz social feed,
 * recomposed to match `public/newlandingfull.jpg` / `public/newlanding.jpg`.
 *
 * ── What changed in the redesign (owner, 2026-07-26) ──────────────────────────
 *
 *  • POSITION: the device is now ANGLED (a static 3D tilt), not held flat-on — the
 *    product-shot look of the reference. The tilt is pure `transform`, painted once
 *    and GPU-composited; it never animates, so it can't compete with the hero <h1>
 *    (the LCP element) for the main thread. The floating bubbles and the callout
 *    sit OUTSIDE the tilted subtree so they stay flat, in front of the glass.
 *
 *  • THE FEED PROFILE is Frenz — the brand's own verified account, with the Frenz
 *    logo as its avatar — not a stand-in person ("Chris" in the reference).
 *
 *  • THE REELS TILE IS NOW JUST A PICTURE (owner, 2026-08-10). It shows one
 *    admin-chosen still (settings.landing.reelsPosterUrl) and nothing else — no
 *    link, no play button, no REELS tag, no mute glyph, no caption. It went from
 *    an embedded player, to a still that linked to /reels, to this.
 *
 *    The reason is that it is a MOCKUP: its job is to show what the app looks
 *    like, and a still does that. The interactive chrome was a second, weaker
 *    entrance to Reels layered on top of the largest image in the hero — while
 *    the bottom nav already has a Reels button that works. Removing it takes six
 *    overlay layers and two icon components off the LCP element.
 *
 * ── Why still a server component / still async ────────────────────────────────
 *
 * It reads the admin poster (and, only when none is set, one OWN-HOSTED reel
 * thumbnail as a nice default) at build/ISR through the service-role client — no
 * cookies — so `/` stays statically generated (app/(marketing)/page.tsx). A raw
 * <img> is used deliberately: some thumbnails live on a source CDN that answers
 * next/image's SERVER-side fetch with 403 (verified on this page), and the admin
 * poster is a Supabase public URL. Empty ⇒ a branded gradient, so the hero can
 * never render a broken image.
 */
export async function PhoneMockup() {
  const landing = await getLandingSettings();

  // Poster source of truth is the admin image. Absent it, fall back to one
  // own-hosted reel thumbnail so the mockup looks real out of the box — the same
  // eligibility rule the page has always used (own R2 media only; a source-CDN
  // signature would 403 once it expires). Still absent ⇒ gradient (below).
  let posterUrl = landing.reelsPosterUrl;
  if (!posterUrl) {
    const ownMedia = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
    if (ownMedia) {
      try {
        const seed = (await getFeed({ sort: "trending", viewerId: null, limit: 24, diversityCap: 999 })).find(
          (p) => p.mediaKind === "video" && !!p.thumbnailUrl && p.thumbnailUrl.startsWith(ownMedia),
        );
        posterUrl = seed?.thumbnailUrl ?? "";
      } catch {
        /* a failed feed read must never break the hero — gradient fallback covers it */
      }
    }
  }

  return (
    <div className="group/phone relative mx-auto w-full max-w-[300px]">
      {/* Soft glow behind the phone */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 scale-110 rounded-[3.5rem] bg-gradient-to-br from-blue-500/25 via-violet-500/18 to-purple-600/25 blur-3xl"
      />
      {/* Contact shadow — grounds the tilted device instead of letting it float flat. */}
      <div
        aria-hidden
        className="absolute inset-x-8 bottom-2 -z-10 h-10 rounded-[50%] bg-black/35 blur-2xl dark:bg-black/60"
      />

      {/* Floating platform bubbles — flat, in front of the glass. */}
      {ORBIT.map(({ id, className, color, bubble, float }) => {
        const Icon = BRAND_ICONS[id];
        if (!Icon) return null;
        return (
          <span
            key={id}
            aria-hidden
            className={`absolute z-30 flex h-11 w-11 items-center justify-center rounded-2xl shadow-xl ring-1 ring-black/5 ${bubble ?? "bg-white"} ${className} ${float ? "animate-float" : ""}`}
          >
            <Icon className={`h-5 w-5 ${color}`} />
          </span>
        );
      })}

      {/* Tilt wrapper — the ONLY 3D-transformed subtree. Static transform, GPU
          composited; `transform-gpu` promotes it so the tilt costs no repaint. */}
      <div className="[transform:perspective(1600px)_rotateX(4deg)_rotateY(-15deg)_rotateZ(2deg)] [transform-style:preserve-3d]">
        {/* Titanium frame — iPhone 17 Pro Max. Geometry locked to the real device
            aspect ratio; all depth is paint (band gradient, chamfer highlights,
            inset rings, stacked shadows) so nothing re-rasterizes. */}
        <div
          data-phone-frame
          className="relative z-10 aspect-[776/1630] rounded-[2.6rem] bg-[linear-gradient(100deg,#fafafa_0%,#d4d4d8_4%,#71717a_13%,#3f3f46_34%,#27272a_50%,#3f3f46_66%,#71717a_87%,#d4d4d8_96%,#fafafa_100%)] p-[3px] shadow-[0_0_0_0.5px_rgba(255,255,255,0.35),inset_0_1px_1px_rgba(255,255,255,0.65),inset_0_-1px_1px_rgba(255,255,255,0.35),0_1px_2px_rgba(0,0,0,0.3),0_18px_30px_-8px_rgba(0,0,0,0.4),0_40px_60px_-16px_rgba(0,0,0,0.5),0_70px_100px_-30px_rgba(0,0,0,0.55)]"
        >
          {/* Chamfer highlight down the length of the band — the polished edge. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[2.6rem] bg-[linear-gradient(to_bottom,rgba(255,255,255,0.6)_0%,rgba(255,255,255,0)_5%,rgba(255,255,255,0)_95%,rgba(255,255,255,0.4)_100%)]"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-[16%] -left-[0.5px] w-[2px] rounded-full bg-gradient-to-b from-transparent via-white/70 to-transparent"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-[24%] -right-[0.5px] w-[2px] rounded-full bg-gradient-to-b from-transparent via-white/50 to-transparent"
          />

          {/* Titanium side buttons */}
          <span aria-hidden className="absolute -left-[3.5px] top-[14%] h-7 w-[3.5px] rounded-l-[2px] bg-gradient-to-r from-zinc-400 to-zinc-600 shadow-[-1px_0_2px_rgba(0,0,0,0.35)]" />
          <span aria-hidden className="absolute -left-[3.5px] top-[20%] h-12 w-[3.5px] rounded-l-[2px] bg-gradient-to-r from-zinc-400 to-zinc-600 shadow-[-1px_0_2px_rgba(0,0,0,0.35)]" />
          <span aria-hidden className="absolute -left-[3.5px] top-[29%] h-12 w-[3.5px] rounded-l-[2px] bg-gradient-to-r from-zinc-400 to-zinc-600 shadow-[-1px_0_2px_rgba(0,0,0,0.35)]" />
          <span aria-hidden className="absolute -right-[3.5px] top-[23%] h-16 w-[3.5px] rounded-r-[2px] bg-gradient-to-l from-zinc-400 to-zinc-600 shadow-[1px_0_2px_rgba(0,0,0,0.35)]" />
          <span aria-hidden className="absolute -right-[3.5px] top-[35%] h-8 w-[3.5px] rounded-r-[2px] bg-gradient-to-l from-zinc-300 to-zinc-500 shadow-[1px_0_2px_rgba(0,0,0,0.35)]" />

          <div className="relative h-full overflow-hidden rounded-[2.45rem] border-[4px] border-black bg-black">
            {/* Dynamic Island */}
            <div className="absolute left-1/2 top-[0.5rem] z-30 flex h-[1.4rem] w-[4.9rem] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-800 ring-1 ring-zinc-700" />
            </div>

            {/* Glass sheen + bezel falloff */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 z-20 rounded-[2.1rem] bg-[linear-gradient(112deg,rgba(255,255,255,0.13)_0%,rgba(255,255,255,0.05)_18%,rgba(255,255,255,0)_38%,rgba(255,255,255,0)_100%)]"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 z-20 rounded-[2.1rem] shadow-[inset_0_0_2px_1px_rgba(255,255,255,0.10),inset_0_0_18px_rgba(0,0,0,0.55)]"
            />

            {/*
              SCREEN — the Frenz feed, on a light app ground like the reference.

              🔴 The whole screen is `aria-hidden` (axe, 2026-08-10).

              Two things drove this. The narrow one: the signal and battery
              glyphs carried `aria-label` on plain `<span>`s, which axe flags as
              `aria-prohibited-attr` (serious) — an element with no role cannot
              take a name, so those labels were not announced anywhere, they
              just failed the audit.

              The broad one is the better reason to hide the subtree rather than
              patch two attributes. This is a PICTURE OF AN APP. Everything in
              it — "9:41", the fake battery, "Frenz · @frenz · 2d", a post that
              does not exist, a tab bar that navigates nowhere — was being read
              out to a screen-reader user as though it were real content sitting
              between the hero CTA and the rest of the page. A sighted visitor
              perceives it in one glance as a product shot; a screen-reader user
              got a dozen meaningless nodes with no way to tell they were
              decoration.

              The device frame keeps its visual role and loses its semantic one,
              which is what a mockup should have been all along.
            */}
            <div aria-hidden className="flex h-full flex-col bg-neutral-50 text-neutral-900">
              {/* iOS status bar */}
              <div className="flex items-center justify-between px-5 pt-2.5 text-neutral-900">
                <span className="text-[11px] font-semibold tracking-tight">9:41</span>
                <div className="flex items-center gap-1.5">
                  <span className="flex items-end gap-[1.5px]">
                    <span className="h-[3px] w-[2.5px] rounded-[1px] bg-neutral-900" />
                    <span className="h-[5px] w-[2.5px] rounded-[1px] bg-neutral-900" />
                    <span className="h-[7px] w-[2.5px] rounded-[1px] bg-neutral-900" />
                    <span className="h-[9px] w-[2.5px] rounded-[1px] bg-neutral-900" />
                  </span>
                  <Wifi className="h-3 w-3" strokeWidth={2.5} />
                  <span className="flex items-center gap-[1px]">
                    <span className="relative h-[11px] w-[22px] rounded-[3px] ring-1 ring-neutral-900/80">
                      <span className="absolute inset-[1.5px] right-[4px] rounded-[1.5px] bg-neutral-900" />
                    </span>
                    <span className="h-[4px] w-[1.5px] rounded-r-sm bg-neutral-900/80" />
                  </span>
                </div>
              </div>

              {/* Top app bar — search · profile · For You · reels · bell */}
              <div className="flex items-center gap-2 px-3 pb-2 pt-2">
                <Search className="h-3.5 w-3.5 text-neutral-500" />
                <Users className="h-3.5 w-3.5 text-neutral-500" />
                <span className="mx-auto inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-bold text-white shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/90" /> For You
                </span>
                <Play className="h-3.5 w-3.5 text-neutral-500" />
                <Bell className="h-3.5 w-3.5 text-neutral-500" />
              </div>

              {/* Continue Watching pill */}
              <div className="px-3">
                <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-neutral-600 shadow-sm">
                  <Plus className="h-3 w-3 text-blue-600" /> Continue Watching
                </span>
              </div>

              {/* Post — from Frenz (the brand's own verified account) */}
              <div className="mt-2.5 px-3">
                <p className="mb-1.5 text-[8px] font-bold uppercase tracking-[0.12em] text-neutral-400">
                  From someone you follow
                </p>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-neutral-200">
                    <FrenzLogo size={28} className="rounded-full" />
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="flex items-center gap-0.5">
                      <span className="truncate text-[11px] font-bold">Frenz</span>
                      <BadgeCheck className="h-3 w-3 text-blue-500" />
                    </span>
                    <span className="block text-[9px] text-neutral-500">@frenz · 2d</span>
                  </span>
                  <MoreHorizontal className="h-4 w-4 text-neutral-400" />
                </div>
                <p className="mt-1.5 text-[10px] leading-snug text-neutral-700">
                  Save any video in seconds — no watermark, full quality.
                </p>
              </div>

              {/*
                🔴 A plain picture, not a reels section (owner, 2026-08-10:
                "remove the reels section on the phone mockup, make a normal
                image uploaded from admin, so load reduces — users will use the
                reels button instead").

                What went with it: the link to /reels, the pulsing REELS tag,
                the mute glyph, the play button, the hover-scale and the
                "Trending on Frenz" caption. Six overlay layers and two icon
                components, all of them advertising a destination the bottom nav
                already offers — so it was a second, weaker entrance to Reels
                sitting on top of the one image in the hero viewport.

                It is a mockup. Its job is to show what the app looks like, and
                a still does that. Everything removed here is markup, icons and
                a compositing layer that the LCP element was rendering behind.
              */}
              <div className="mt-2 flex-1 px-3 pb-2">
                <div
                  aria-hidden
                  className="relative block h-full w-full overflow-hidden rounded-2xl bg-neutral-900 ring-1 ring-black/5"
                >
                  {posterUrl ? (
                    /*
                      🔴 This is the LCP ELEMENT (owner, 2026-08-10: "LCP is
                      still really high"). Two compounding mistakes were on it.

                      It was a raw <img> pointing at the bucket original —
                      measured at 544 KB — for a slot that renders about 270px
                      wide inside a 300px phone frame. The mockup is
                      `mx-auto max-w-[300px]`, so it is visible on MOBILE too,
                      sitting in the hero viewport where Lighthouse looks for
                      the largest element.

                      And it carried `loading="lazy"`. On an above-the-fold
                      image that is actively harmful: the browser will not begin
                      fetching until layout has decided the element is near the
                      viewport, so the request starts late by construction —
                      which is exactly the interval LCP measures. Lazy is right
                      for the grid below; it was never right for this.

                      `next/image` with `sizes` is the fix for the bytes: the
                      optimizer serves ~300px of AVIF instead of a
                      four-megapixel JPEG.

                      🔴 IT IS NOT THE LCP ELEMENT, and `priority` is gone
                      (measured 2026-08-10, correcting a35cc7f).

                      A `largest-contentful-paint` observer on the live page
                      under mobile throttling reports two candidates and this is
                      neither of them — the winner is the Wallpaper Gallery tile
                      in the LEFT column. The reason is structural: this mockup
                      is the second grid item, so on a phone it renders after
                      the whole left-hand stack, roughly a thousand pixels below
                      the fold, where LCP does not look.

                      `priority` therefore did active harm. It emitted a
                      high-priority preload for a below-the-fold decoration that
                      competed for the same throttled connection as the image
                      that IS the LCP element.

                      `loading="eager"` with `fetchPriority="low"` is the right
                      pair: the request still starts immediately rather than
                      waiting on layout — which keeps the mockup filled on
                      DESKTOP, where the two columns sit side by side and this
                      IS above the fold — but the browser schedules it behind
                      the real LCP image instead of alongside it.
                    */
                    /*
                      🔴 Two layers — the whole poster on a blurred copy of
                      itself (owner, 2026-08-10: "the iphone mockup poster is
                      still zooming onesided").

                      Same geometric bind as the Wallpaper tile, same fix. This
                      slot is a tall 9:16-ish window inside the phone frame, and
                      the admin uploads whatever shape they have. `object-cover`
                      filled it by matching the short axis and discarding the
                      rest, so a landscape poster showed a magnified vertical
                      slice of its middle — the one-sided zoom.

                      `contain` in front shows the whole poster undistorted; the
                      blurred, overscanned copy behind fills what is left, so the
                      screen inside the mockup is still edge to edge with no
                      empty bars. Full reasoning in wallpaper-cta.tsx.

                      Both layers are the same optimized src, so the second is a
                      cache hit and costs no extra bytes. Neither carries
                      `priority` — measured, this is below the fold on mobile.
                    */
                    <>
                      <Image
                        src={posterUrl}
                        alt=""
                        fill
                        sizes="300px"
                        aria-hidden
                        loading="eager"
                        fetchPriority="low"
                        className="scale-110 object-cover blur-lg"
                      />
                      <Image
                        src={posterUrl}
                        alt=""
                        fill
                        sizes="300px"
                        loading="eager"
                        fetchPriority="low"
                        className="object-contain"
                      />
                    </>
                  ) : (
                    <span className="absolute inset-0 bg-gradient-to-br from-blue-600 via-violet-600 to-fuchsia-600" />
                  )}
                </div>
              </div>

              {/* Bottom tab bar — the REAL app nav (Home · Friends · [+] · Chats ·
                  Profile), same icon components mobile-nav renders. grid-cols-5 so
                  the raised + is mathematically centred. */}
              <div className="px-3 pb-2">
                <div className="grid grid-cols-5 items-end rounded-2xl border border-neutral-200 bg-white px-2 pb-1.5 pt-2 shadow-sm">
                  <TabIcon icon={FrenzHomeSolid} label="Home" active />
                  <TabIcon icon={FrenzFriendsOutline} label="Friends" />
                  <span className="relative -mt-5 flex h-8 items-center justify-self-center self-center">
                    <span className="bg-brand relative flex h-9 w-9 items-center justify-center rounded-full text-white shadow-lg shadow-violet-500/30 ring-[3px] ring-white">
                      <Plus className="h-4 w-4" strokeWidth={2.6} />
                    </span>
                  </span>
                  <TabIcon icon={FrenzInboxOutline} label="Chats" badge="3" />
                  <TabIcon icon={FrenzPersonSolid} label="Profile" />
                </div>
              </div>

              {/* Home indicator */}
              <div className="flex justify-center pb-1.5">
                <span className="h-[3px] w-24 rounded-full bg-neutral-900/50" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Download hint — sits below the flat wrapper (not the tilted phone), so it
          reads straight. The + it names is the one in the bar above: in the app it
          opens the action sheet whose first row downloads from any platform. */}
      <div className="pointer-events-none mt-5 flex justify-center">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-foreground px-3 py-1.5 text-[11px] font-bold text-background shadow-xl">
          <Plus className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden />
          The + button downloads any video
        </span>
      </div>
    </div>
  );
}

function TabIcon({
  icon: Icon,
  label,
  active = false,
  badge,
}: {
  icon: typeof FrenzHomeSolid;
  label: string;
  active?: boolean;
  badge?: string;
}) {
  return (
    <span className="relative flex flex-col items-center gap-[2px]">
      <Icon className={`h-[15px] w-[15px] ${active ? "text-blue-600" : "text-neutral-400"}`} />
      <span className={`text-[7px] font-semibold leading-none ${active ? "text-blue-600" : "text-neutral-400"}`}>
        {label}
      </span>
      {badge ? (
        <span className="absolute -right-1.5 -top-1 flex h-[11px] min-w-[11px] items-center justify-center rounded-full bg-blue-500 px-[3px] text-[6px] font-bold text-white">
          {badge}
        </span>
      ) : null}
    </span>
  );
}
