import { BadgeCheck, BellOff, Check, CheckCheck, Download, Flame, Heart, MessageCircle, Play, Search, Sparkles, Smile, Trophy, UserPlus, Users, Wifi } from "lucide-react";

import {
  FrenzFriendsOutline,
  FrenzHomeSolid,
  FrenzInboxOutline,
  FrenzPersonSolid,
} from "@/components/icons/frenz-icons";
import { BitmojiAvatar } from "@/components/landing/bitmoji-avatar";
import { PhoneReels, type MockReel } from "@/components/landing/phone-reels";
import { showcaseStats } from "@/components/landing/showcase-stats";
import { getFeed } from "@/lib/social/feed";

// Illustrated cartoon avatars, never a real person's photo or handle — the landing
// page is public marketing and must not put real users' faces in it. See
// components/landing/bitmoji-avatar.tsx.
const PEOPLE = [
  { name: "Sarah", female: true, from: "from-rose-500 to-pink-500" },
  { name: "James", female: false, from: "from-blue-500 to-indigo-500" },
  { name: "Stephanie", female: true, from: "from-violet-500 to-purple-500" },
  { name: "Daniel", female: false, from: "from-emerald-500 to-teal-500" },
] as const;

// Inbox preview rows — mirror the real upgraded inbox styling (verified tick,
// read receipt, timestamp, unread/mute). Illustrative, never real users.
const MOCK_CHATS = [
  { name: "Peace", female: false, from: "from-blue-500 to-violet-600", preview: "Afa", time: "9:41", unread: "3", online: true, verified: false, group: false, ring: true },
  { name: "Julie Ngozi", female: true, from: "from-amber-500 to-orange-600", preview: "See you tonight!", time: "9:20", unread: "", online: true, verified: true, group: false, ring: false },
  { name: "Marketing Team", female: false, from: "from-violet-500 to-fuchsia-600", preview: "Let's meet at 10am", time: "Yst", unread: "5", online: false, verified: false, group: true, ring: false },
] as const;

/** Fisher-Yates. Runs at ISR regeneration only — see PhoneMockup. */
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Decorative in-app preview shown in the hero — an iPhone 17 Pro Max.
 *
 * GEOMETRY IS REAL, not eyeballed. The device body is 77.6 x 163.0 mm, so the
 * frame is locked to `aspect-[776/1630]` (0.476) rather than being sized by its
 * own content. The previous mockup measured 320x540 = 0.593 — noticeably too
 * wide and too short to read as an iPhone. Because the aspect ratio now drives
 * the height, the screen is a fixed box and the UI inside it flexes to fit;
 * don't add content here expecting the phone to grow, it won't.
 *
 * Depth is done with layered gradients + inset rings (chamfer highlights, glass
 * sheen, screen falloff) and a small perspective tilt. All of it is paint and
 * `transform` — no `filter`/`backdrop-filter` animation, nothing that
 * re-rasterizes on scroll. This sits beside the hero's <h1>, which is the LCP
 * element, so it must never compete for the main thread (docs/FEATURE_21_HERO.md §1).
 */
export async function PhoneMockup() {
  // REAL reels, not a gradient placeholder. Same query that already backs
  // TrendingToday on this page: anonymous (`viewerId: null`), and it filters
  // suspended / low-trust / hidden / blocked publishers server-side, so nothing
  // here can surface an account that shouldn't be public. It's a DB read, not a
  // dynamic API, so `/` stays statically generated and just refreshes on ISR
  // (cadence is app/layout.tsx's `revalidate`).
  //
  // ONLY thumbnails we host ourselves are eligible, and that is load-bearing:
  // a lot of `thumbnail_url` values point at the source platform's SIGNED CDN
  // (e.g. p16-common-sign.tiktokcdn-us.com). Those signatures EXPIRE, after
  // which the URL 403s permanently — measured on this very page: 4 of 11 remote
  // images were already broken, all of them tiktokcdn, while every
  // media.frenzsave.com image loaded. The hero is the first thing a visitor
  // sees; it must never gamble on someone else's expiring URL. Own-media also
  // means R2 (zero egress) instead of a third-party hotlink.
  // ALL public reels, not the diversity-capped trending slice. The 64 published
  // reels today come from only a few publishers, so the feed's per-publisher cap
  // collapsed them to ~6 — right for discovery, wrong here where the deck should
  // mirror the full reels page. `diversityCap: 999` lifts that; every other safety
  // filter (suspended / hidden / low-trust / blocked) still applies.
  const ownMedia = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
  const eligible = (
    await getFeed({ sort: "trending", viewerId: null, limit: 60, diversityCap: 999 })
  ).filter(
    (p) =>
      p.mediaKind === "video" &&
      !!p.thumbnailUrl &&
      !!p.mediaUrl &&
      !!ownMedia &&
      p.thumbnailUrl.startsWith(ownMedia),
  );

  // Shuffle so the hero isn't the same clip forever, and so a newly uploaded reel
  // can reach the front page.
  //
  // This runs at ISR REGENERATION, not per request — `/` is one static CDN document
  // (docs/FEATURE_21_LANDING.md §4), so every visitor in a given window shares an
  // order and the page stays cacheable. That also makes it the only correct place:
  // shuffling on the client would swap the hero's tile after hydration, which is
  // the same flash we rejected for the personalized hero. New uploads surface on
  // the next regeneration rather than instantly — the honest trade for a landing
  // page that paints from the edge.
  // ALL eligible reels (owner: "show all the reels in reels page same way, not
  // few"), capped generously so the deck can't become unbounded on a big library.
  // Every reel — including brand-new ones — carries the same illustrative
  // 30k–50k engagement pattern that GROWS with real anonymous activity.
  const reels: MockReel[] = shuffle(eligible)
    .slice(0, 40)
    .map((p) => {
      const s = showcaseStats(p.id, { views: p.viewsCount, likes: p.likesCount });
      return {
        id: p.id,
        thumbnailUrl: p.thumbnailUrl!,
        mediaUrl: p.mediaUrl!,
        viewsCount: s.views,
        likesCount: s.likes,
        commentsCount: Math.round(s.likes / 9),
        title: p.title ?? "",
      };
    });

  return (
    <div className="group/phone relative mx-auto w-full max-w-[292px]">
      {/* Floating chips — line icons only, no emoji */}
      <div className="absolute -right-3 -top-4 z-20 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400 text-white shadow-xl shadow-amber-500/30 animate-float">
        <Smile className="h-6 w-6" aria-hidden />
      </div>
      <div className="absolute -right-6 top-28 z-20 inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-bold shadow-xl ring-1 ring-border/60">
        <MessageCircle className="h-3.5 w-3.5 text-rose-500" /> 128
      </div>
      <div className="absolute -right-8 top-44 z-20 inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-bold shadow-xl ring-1 ring-border/60">
        <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500" /> 3.2K
      </div>
      <div className="absolute -left-6 top-32 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-xl ring-4 ring-background animate-float">
        <Sparkles className="h-6 w-6" aria-hidden />
      </div>
      {/* Left side, clear of the tab bar — at bottom-right it sat on top of the
          Chats tab and hid the nav the mockup is meant to be showing off. */}
      <div className="absolute -left-5 bottom-28 z-20 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-xl ring-4 ring-background">
        <Trophy className="h-7 w-7" aria-hidden />
      </div>

      {/* Download callout — the whole point of the mockup is that a visitor should
          understand HOW downloading works without reading a word.
          The copy names the button as the REAL in-app one, not a landing-page
          control: "Tap + to download" was ambiguous — a visitor could read it as
          the + on this page. In the app, that + opens the action sheet whose first
          row is "Download Video: download from any social platform"
          (features/create/create-action-sheet.tsx), which is what this describes.
          Sits outside the frame so it covers none of the UI it's explaining. */}
      <div className="pointer-events-none absolute -bottom-[56px] left-1/2 z-30 w-max -translate-x-1/2 text-center transition-opacity duration-200 group-has-[[data-deck-open]]/phone:opacity-0">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-foreground px-3 py-1.5 text-[11px] font-bold text-background shadow-xl">
          <Download className="h-3.5 w-3.5" aria-hidden />
          The + button in the app downloads any video
        </span>
      </div>
      {/* Arrow from the callout up to the + button. Electric Blue deliberately:
          it crosses BOTH the near-black phone screen and the light page
          background, so a foreground-coloured arrow disappears over one or the
          other. Brand blue reads on both. */}
      <svg
        aria-hidden
        viewBox="0 0 24 74"
        className="pointer-events-none absolute -bottom-[26px] left-1/2 z-30 h-[74px] w-6 -translate-x-1/2 text-primary transition-opacity duration-200 group-has-[[data-deck-open]]/phone:opacity-0"
        fill="none"
      >
        <path
          d="M12 70 L12 16"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="4 4"
        />
        <path
          d="M12 8 l 6 8 M12 8 l -6 8"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Soft glow behind phone */}
      <div aria-hidden className="absolute inset-0 -z-10 scale-110 rounded-[3.5rem] bg-gradient-to-br from-blue-500/25 via-violet-500/18 to-purple-600/25 blur-3xl" />

      {/* Contact shadow — grounds the device instead of letting it float flat. */}
      <div
        aria-hidden
        className="absolute inset-x-6 bottom-1 -z-10 h-10 rounded-[50%] bg-black/35 blur-2xl dark:bg-black/60"
      />

      {/* Titanium frame — iPhone 17 Pro Max.
          Held FLAT-ON (owner: "it can still be high 3d without being bent"), so all
          the depth has to come from material rather than rotation:
            - the band gradient reads as light raking across a rounded metal edge —
              bright at both chamfers, dark through the middle
            - a polished outer ring separates the device from the page
            - inset rings give the band real thickness
            - four stacked shadows carry it off the background
          All of it is paint. No transform, no filter — nothing that costs a frame. */}
      <div
        data-phone-frame
        className="relative z-10 aspect-[776/1630] rounded-[2.6rem] bg-[linear-gradient(100deg,#fafafa_0%,#d4d4d8_4%,#71717a_13%,#3f3f46_34%,#27272a_50%,#3f3f46_66%,#71717a_87%,#d4d4d8_96%,#fafafa_100%)] p-[3px] shadow-[0_0_0_0.5px_rgba(255,255,255,0.35),inset_0_1px_1px_rgba(255,255,255,0.65),inset_0_-1px_1px_rgba(255,255,255,0.35),0_1px_2px_rgba(0,0,0,0.3),0_10px_20px_-6px_rgba(0,0,0,0.35),0_28px_50px_-12px_rgba(0,0,0,0.5),0_56px_90px_-24px_rgba(0,0,0,0.55)]"
      >
        {/* Chamfer highlight down the length of the band — the polished edge. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[2.6rem] bg-[linear-gradient(to_bottom,rgba(255,255,255,0.6)_0%,rgba(255,255,255,0)_5%,rgba(255,255,255,0)_95%,rgba(255,255,255,0.4)_100%)]"
        />
        {/* Specular hits where a rounded band would catch the light hardest. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-[16%] -left-[0.5px] w-[2px] rounded-full bg-gradient-to-b from-transparent via-white/70 to-transparent"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-[24%] -right-[0.5px] w-[2px] rounded-full bg-gradient-to-b from-transparent via-white/50 to-transparent"
        />

        {/* Titanium side buttons — shaded so they read as raised, not painted on. */}
        <span aria-hidden className="absolute -left-[3.5px] top-[14%] h-7 w-[3.5px] rounded-l-[2px] bg-gradient-to-r from-zinc-400 to-zinc-600 shadow-[-1px_0_2px_rgba(0,0,0,0.35)]" />
        <span aria-hidden className="absolute -left-[3.5px] top-[20%] h-12 w-[3.5px] rounded-l-[2px] bg-gradient-to-r from-zinc-400 to-zinc-600 shadow-[-1px_0_2px_rgba(0,0,0,0.35)]" />
        <span aria-hidden className="absolute -left-[3.5px] top-[29%] h-12 w-[3.5px] rounded-l-[2px] bg-gradient-to-r from-zinc-400 to-zinc-600 shadow-[-1px_0_2px_rgba(0,0,0,0.35)]" />
        {/* Power button */}
        <span aria-hidden className="absolute -right-[3.5px] top-[23%] h-16 w-[3.5px] rounded-r-[2px] bg-gradient-to-l from-zinc-400 to-zinc-600 shadow-[1px_0_2px_rgba(0,0,0,0.35)]" />
        {/* Camera Control button */}
        <span aria-hidden className="absolute -right-[3.5px] top-[35%] h-8 w-[3.5px] rounded-r-[2px] bg-gradient-to-l from-zinc-300 to-zinc-500 shadow-[1px_0_2px_rgba(0,0,0,0.35)]" />

        <div className="relative h-full overflow-hidden rounded-[2.45rem] border-[4px] border-black bg-black">
          {/* Dynamic Island */}
          <div className="absolute left-1/2 top-[0.5rem] z-30 flex h-[1.4rem] w-[4.9rem] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-800 ring-1 ring-zinc-700" />
          </div>

          {/* Glass sheen — a diagonal reflection across the display. Sits above the
              UI, below the Island, and never intercepts pointer events. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 rounded-[2.1rem] bg-[linear-gradient(112deg,rgba(255,255,255,0.13)_0%,rgba(255,255,255,0.05)_18%,rgba(255,255,255,0)_38%,rgba(255,255,255,0)_100%)]"
          />
          {/* Inner bezel falloff — the display recessed under the glass. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 rounded-[2.1rem] shadow-[inset_0_0_2px_1px_rgba(255,255,255,0.10),inset_0_0_18px_rgba(0,0,0,0.55)]"
          />

          {/* The screen is a FIXED box now (the frame's aspect ratio drives it), so
              the UI flexes to fill it rather than defining its height. */}
          <div className="flex h-full flex-col gap-2.5 overflow-hidden rounded-[2.1rem] bg-neutral-950 px-3 pb-4 pt-3 text-white">
            {/* iOS status bar — time · signal · wifi · battery */}
            <div className="flex items-center justify-between px-3 text-white">
              <span className="text-[11px] font-semibold tracking-tight">9:41</span>
              <div className="flex items-center gap-1.5">
                {/* Cellular signal */}
                <span className="flex items-end gap-[1.5px]" aria-label="signal">
                  <span className="h-[3px] w-[2.5px] rounded-[1px] bg-white" />
                  <span className="h-[5px] w-[2.5px] rounded-[1px] bg-white" />
                  <span className="h-[7px] w-[2.5px] rounded-[1px] bg-white" />
                  <span className="h-[9px] w-[2.5px] rounded-[1px] bg-white" />
                </span>
                {/* Wifi */}
                <Wifi className="h-3 w-3" strokeWidth={2.5} />
                {/* Battery */}
                <span className="flex items-center gap-[1px]" aria-label="battery">
                  <span className="relative h-[11px] w-[22px] rounded-[3px] ring-1 ring-white/80">
                    <span className="absolute inset-[1.5px] right-[4px] rounded-[1.5px] bg-white" />
                  </span>
                  <span className="h-[4px] w-[1.5px] rounded-r-sm bg-white/80" />
                </span>
              </div>
            </div>

            {/* App brand bar */}
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-sm font-bold">
                Frenz
              </span>
              <Search className="h-3.5 w-3.5 text-white/55" />
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-4 border-b border-white/10 pb-2 text-[11px]">
              <span className="font-semibold text-white">For You</span>
              <span className="text-white/45">Trending</span>
              <span className="text-white/45">Following</span>
            </div>

            {/* Trending reels */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold">
                  <Flame className="h-3 w-3 text-rose-400" aria-hidden /> Trending Reels
                </span>
                <span className="text-[10px] text-blue-400">View all</span>
              </div>
              {/* REAL trending reels — tapping play opens the real deck inside the
                  phone (snap-scrolling column, muted autoplay, view counted).
                  Raw <img> inside PhoneReels, NOT next/image — deliberate: some
                  thumbnails live on whatever CDN yt-dlp resolved, and next/image
                  fetches SERVER-side, which those CDNs answer with 403 (verified).
                  Falls back to gradient tiles when no reel has an own-host poster,
                  so the hero can never render a broken image. */}
              {reels.length > 0 ? (
                <PhoneReels reels={reels} />
              ) : (
                <div className="flex gap-2">
                  <div className="relative h-28 flex-1 overflow-hidden rounded-xl bg-gradient-to-br from-rose-500 via-fuchsia-500 to-indigo-500">
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/25 backdrop-blur">
                        <Play className="h-4 w-4 fill-white" />
                      </span>
                    </span>
                  </div>
                  <div className="relative h-28 w-12 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-blue-600 to-violet-700" />
                </div>
              )}
            </div>

            {/* Messages preview — mirrors the real upgraded inbox: a search pill,
                then premium chat rows (verified tick, read-receipt ✓✓, timestamp,
                unread pill / mute). This is the "make the chat section look like my
                inbox" ask, scaled into the mockup. */}
            <div className="rounded-2xl bg-white/[0.05] p-2 ring-1 ring-white/5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-white/70">
                  <MessageCircle className="h-2.5 w-2.5" aria-hidden /> Messages
                </span>
                <span className="ml-auto flex items-center gap-1 rounded-full bg-white/[0.07] px-2 py-0.5 text-[8px] text-white/40">
                  <Search className="h-2 w-2" /> Search
                </span>
              </div>
              {MOCK_CHATS.map((c) => (
                <div key={c.name} className="flex items-center gap-2 rounded-xl px-1 py-1">
                  <span className="relative shrink-0">
                    <span className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br ${c.from} ${c.ring ? "ring-2 ring-blue-400/60" : ""}`}>
                      <BitmojiAvatar seed={c.name} female={c.female} className="h-full w-full" />
                    </span>
                    {c.online ? <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-neutral-950" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-0.5">
                      <span className="truncate text-[10px] font-bold">{c.name}</span>
                      {c.verified ? <BadgeCheck className="h-2.5 w-2.5 text-blue-400" /> : null}
                      {c.group ? <span className="rounded-full bg-white/10 px-1 py-px text-[6px] font-semibold text-white/50">GROUP</span> : null}
                    </span>
                    <span className="flex items-center gap-0.5 text-[9px] text-white/45">
                      <CheckCheck className="h-2.5 w-2.5 text-blue-400" /> <span className="truncate">{c.preview}</span>
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-0.5">
                    <span className="text-[7px] text-white/35">{c.time}</span>
                    {c.unread ? (
                      <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-blue-500 px-1 text-[7px] font-bold">{c.unread}</span>
                    ) : (
                      <BellOff className="h-2.5 w-2.5 text-white/30" />
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* People you may know — a premium friends rail: taller cards, story
                ring, verified tick, mutual-friend line, gradient Add. */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-white/70">
                  <Users className="h-2.5 w-2.5" aria-hidden /> People You May Know
                </span>
                <span className="text-[8px] font-semibold text-blue-400">See all</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {PEOPLE.map((p, i) => (
                  <div key={p.name} className="flex flex-col items-center gap-1 rounded-xl bg-white/[0.05] p-1.5 ring-1 ring-white/5">
                    <span className={`rounded-full bg-gradient-to-br ${p.from} p-[1.5px]`}>
                      <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-neutral-900 ring-2 ring-neutral-950">
                        <BitmojiAvatar seed={p.name} female={p.female} className="h-full w-full" />
                      </span>
                    </span>
                    <span className="flex items-center gap-0.5">
                      <span className="text-[8px] font-bold leading-none">{p.name}</span>
                      {i % 2 === 0 ? <BadgeCheck className="h-2 w-2 text-blue-400" /> : null}
                    </span>
                    <span className="text-[6px] leading-none text-white/40">{2 + ((i * 3) % 7)} mutual</span>
                    <span className="mt-0.5 inline-flex w-full items-center justify-center gap-0.5 rounded-md bg-gradient-to-r from-blue-600 to-violet-600 py-[3px] text-[8px] font-semibold">
                      <UserPlus className="h-2 w-2" /> Add
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Download complete */}
            <div className="flex items-center gap-2 rounded-2xl bg-emerald-500/15 p-2 ring-1 ring-emerald-500/30">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-white">
                <Check className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold">Video saved successfully</span>
                <span className="block text-[9px] text-white/50">1080p · No Watermark</span>
              </span>
            </div>

            {/* Spacer — absorbs whatever height is left so the tab bar stays
                pinned to the bottom of the fixed screen box, like a real app. */}
            <div className="flex-1" />

            {/* Bottom tab bar — wired to the REAL app nav: the same tab set and the
                same icon components features/app-shell/mobile-nav.tsx renders
                (Home · Friends · [+] · Chats · Profile), so this can't drift into
                advertising a nav Frenz doesn't have. Mirrors the real bar's
                glass pill + raised brand-gradient Create button. */}
            {/* grid-cols-5, NOT justify-around: with five items of unequal label
                widths ("Friends" vs "You") justify-around does not put the middle
                item at the container's centre — it drifted several px left, which
                is exactly why the download arrow didn't line up with the +. Equal
                columns make the + mathematically centred, so the arrow (also
                centred) hits it dead-on at any width. */}
            <div className="relative">
              <div className="grid grid-cols-5 items-end rounded-full border border-white/10 bg-white/[0.07] px-2 pb-1 pt-1.5">
                <TabIcon icon={FrenzHomeSolid} label="Home" active />
                <TabIcon icon={FrenzFriendsOutline} label="Friends" />

                {/* Create — raised gradient circle, same as the real nav. This is
                    the button the callout below points at: in the real app it opens
                    the action sheet whose FIRST row is "Download Video — download
                    from any social platform" (features/create/create-action-sheet.tsx).
                    A soft pulse ring draws the eye to it without animating anything
                    expensive (transform/opacity only, motion-safe). */}
                <span className="relative -mt-4 flex h-8 items-center justify-self-center self-center">
                  <span
                    aria-hidden
                    className="bg-brand absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping"
                  />
                  <span className="bg-brand relative flex h-8 w-8 items-center justify-center rounded-full text-white shadow-lg shadow-violet-500/30 ring-[2px] ring-neutral-950">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </span>

                <TabIcon icon={FrenzInboxOutline} label="Chats" badge="3" />
                <TabIcon icon={FrenzPersonSolid} label="You" />
              </div>
            </div>

            {/* Home indicator — every modern iPhone has one; without it the
                screen doesn't read as iOS. */}
            <div className="flex justify-center pt-0.5">
              <span className="h-[3px] w-24 rounded-full bg-white/60" />
            </div>
          </div>
        </div>
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
      <Icon className={`h-[15px] w-[15px] ${active ? "text-white" : "text-white/45"}`} />
      <span className={`text-[7px] font-semibold leading-none ${active ? "text-white" : "text-white/40"}`}>
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
