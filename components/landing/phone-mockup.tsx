import { Check, Heart, MessageCircle, Play, Search, Smile, UserPlus } from "lucide-react";

const PEOPLE = [
  { name: "Sarah", place: "Lagos", from: "from-rose-500 to-pink-500" },
  { name: "James", place: "London", from: "from-blue-500 to-indigo-500" },
  { name: "Maria", place: "Brazil", from: "from-violet-500 to-purple-500" },
  { name: "Daniel", place: "New York", from: "from-emerald-500 to-teal-500" },
] as const;

/** Decorative in-app preview shown in the hero — pure presentation. */
export function PhoneMockup() {
  return (
    <div className="relative mx-auto w-full max-w-[330px]">
      {/* Floating chips */}
      <div className="absolute -right-3 -top-4 z-20 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400 text-amber-900 shadow-xl shadow-amber-500/30 animate-float">
        <Smile className="h-6 w-6" />
      </div>
      <div className="absolute -right-6 top-28 z-20 inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-bold shadow-xl ring-1 ring-border/60">
        <MessageCircle className="h-3.5 w-3.5 text-rose-500" /> 128
      </div>
      <div className="absolute -right-8 top-44 z-20 inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-bold shadow-xl ring-1 ring-border/60">
        <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500" /> 3.2K
      </div>
      <div className="absolute -left-6 top-32 z-20 h-14 w-14 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 shadow-xl ring-4 ring-background animate-float" />
      <div className="absolute -right-4 bottom-24 z-20 h-16 w-16 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-xl ring-4 ring-background" />

      {/* Soft glow behind phone */}
      <div aria-hidden className="absolute inset-0 -z-10 scale-110 rounded-[3rem] bg-gradient-to-br from-blue-500/30 via-violet-500/20 to-purple-600/30 blur-3xl" />

      {/* Phone frame */}
      <div className="relative z-10 overflow-hidden rounded-[2.5rem] border-[6px] border-neutral-900 bg-neutral-950 shadow-2xl">
        {/* Notch */}
        <div className="absolute left-1/2 top-2 z-30 h-5 w-24 -translate-x-1/2 rounded-full bg-neutral-900" />

        <div className="space-y-3 px-3 pb-4 pt-7 text-white">
          {/* Status / brand bar */}
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-bold">
              Frenz<span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">Save</span>
            </span>
            <span className="flex items-center gap-1 text-[10px] text-white/60">●●●● 5G ▮▮▮</span>
          </div>

          {/* Tabs */}
          <div className="flex items-center justify-between border-b border-white/10 pb-2 text-[11px]">
            <span className="font-semibold text-white">For You</span>
            <span className="text-white/45">Trending</span>
            <span className="text-white/45">Following</span>
            <Search className="h-3.5 w-3.5 text-white/55" />
          </div>

          {/* Trending reels */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold">🔥 Trending Reels</span>
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
            <span className="text-[10px] font-semibold text-white/70">💬 Community Chat</span>
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
            <span className="text-[10px] font-semibold text-white/70">👥 People You May Know</span>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
              {PEOPLE.map((p) => (
                <div key={p.name} className="flex flex-col items-center gap-1 rounded-lg bg-white/[0.05] p-1.5">
                  <span className={`h-7 w-7 rounded-full bg-gradient-to-br ${p.from}`} />
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
        </div>
      </div>
    </div>
  );
}
