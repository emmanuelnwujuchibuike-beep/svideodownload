import { Check, Flame, Heart, MessageCircle, Play, Search, Sparkles, Smile, Trophy, UserPlus, Users, Wifi } from "lucide-react";

import {
  FrenzFriendsOutline,
  FrenzHomeSolid,
  FrenzInboxOutline,
  FrenzPersonSolid,
} from "@/components/icons/frenz-icons";

// Initials-in-gradient-circle, matching the fallback-avatar convention used by
// meet-people.tsx and notification-card — never emoji (see the no-emoji rule).
const PEOPLE = [
  { name: "Sarah", from: "from-rose-500 to-pink-500" },
  { name: "James", from: "from-blue-500 to-indigo-500" },
  { name: "Maria", from: "from-violet-500 to-purple-500" },
  { name: "Daniel", from: "from-emerald-500 to-teal-500" },
] as const;

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
export function PhoneMockup() {
  return (
    <div className="relative mx-auto w-full max-w-[292px] [perspective:1800px]">
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

      {/* Soft glow behind phone */}
      <div aria-hidden className="absolute inset-0 -z-10 scale-110 rounded-[3.5rem] bg-gradient-to-br from-blue-500/25 via-violet-500/18 to-purple-600/25 blur-3xl" />

      {/* Contact shadow — grounds the device instead of letting it float flat. */}
      <div
        aria-hidden
        className="absolute inset-x-6 bottom-1 -z-10 h-10 rounded-[50%] bg-black/35 blur-2xl dark:bg-black/60"
      />

      {/* Titanium frame — iPhone 17 Pro Max. Horizontal gradient = light raking
          across a rounded metal band: bright at both chamfers, dark in the middle. */}
      <div
        data-phone-frame
        className="relative z-10 aspect-[776/1630] rounded-[2.6rem] bg-[linear-gradient(100deg,#f4f4f5_0%,#a1a1aa_6%,#52525b_22%,#3f3f46_50%,#52525b_78%,#a1a1aa_94%,#e4e4e7_100%)] p-[2.5px] shadow-[0_2px_6px_rgba(0,0,0,0.28),0_18px_40px_-8px_rgba(0,0,0,0.45),0_40px_80px_-20px_rgba(0,0,0,0.5)] [transform:rotateY(-7deg)_rotateX(2deg)] [transform-style:preserve-3d]"
      >
        {/* Top/bottom chamfer highlight — the band catching light along its length. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[2.6rem] bg-[linear-gradient(to_bottom,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0)_7%,rgba(255,255,255,0)_93%,rgba(255,255,255,0.35)_100%)]"
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
              <div className="flex gap-2">
                <div className="relative h-28 flex-1 overflow-hidden rounded-xl bg-gradient-to-br from-rose-500 via-fuchsia-500 to-indigo-500">
                  <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-0.5 text-[9px] font-medium backdrop-blur">
                    <Play className="h-2.5 w-2.5" /> 12.5K
                  </span>
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/25 backdrop-blur">
                      <Play className="h-4 w-4 fill-white" />
                    </span>
                  </span>
                </div>
                <div className="relative h-28 w-12 overflow-hidden rounded-xl bg-gradient-to-br from-blue-600 to-violet-700" />
              </div>
            </div>

            {/* Community chat */}
            <div className="rounded-xl bg-white/[0.06] p-2">
              {/* "Group Chat", not "Community Chat" — group conversations are real;
                  a Communities product is not. Don't depict what doesn't ship. */}
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-white/70">
                <MessageCircle className="h-2.5 w-2.5" aria-hidden /> Group Chat
              </span>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-[9px] font-bold">G</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-semibold">General Chat</span>
                  <span className="block truncate text-[9px] text-white/45">Hey everyone! What&apos;s trending today?</span>
                </span>
                <span className="rounded-full bg-blue-500 px-1.5 py-0.5 text-[8px] font-bold">126</span>
              </div>
            </div>

            {/* People you may know */}
            <div>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-white/70">
                <Users className="h-2.5 w-2.5" aria-hidden /> People You May Know
              </span>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                {PEOPLE.map((p) => (
                  <div key={p.name} className="flex flex-col items-center gap-1 rounded-lg bg-white/[0.05] p-1.5">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br ${p.from} text-[10px] font-bold text-white`}>
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-[8px] font-semibold leading-none">{p.name}</span>
                    <span className="inline-flex w-full items-center justify-center gap-0.5 rounded-md bg-blue-500 py-0.5 text-[8px] font-semibold">
                      <UserPlus className="h-2 w-2" /> Add
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Download complete */}
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/15 p-2 ring-1 ring-emerald-500/30">
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
            <div className="relative">
              <div className="flex items-end justify-around rounded-full border border-white/10 bg-white/[0.07] px-2 pb-1 pt-1.5">
                <TabIcon icon={FrenzHomeSolid} label="Home" active />
                <TabIcon icon={FrenzFriendsOutline} label="Friends" />

                {/* Create — raised gradient circle, same as the real nav */}
                <span className="-mt-4 self-center">
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
