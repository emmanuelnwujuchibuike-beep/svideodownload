import { Clapperboard, Music, Scissors, Sparkles, Type, Wand2 } from "lucide-react";

/**
 * Editor / Studio section — same pattern as Marketplace and Rewards (owner:
 * "follow same pattern and make the editor studio section"). Left: pill, headline,
 * copy and feature rows. Right: a video-editor app mockup.
 *
 * The Studio is a planned creator surface; this section is aspirational marketing,
 * built at the owner's request. Copy avoids stating it exists today.
 */

const FEATURES = [
  { icon: Scissors, title: "Trim & Cut", desc: "Cut clips to length with a precise, frame-accurate trimmer." },
  { icon: Music, title: "Add Music", desc: "Drop in trending sounds and sync them to your video." },
  { icon: Type, title: "Captions & Text", desc: "Auto-captions and styled text overlays in a tap." },
  { icon: Wand2, title: "Filters & Effects", desc: "Polish every clip with filters, effects and transitions." },
];

export function StudioSection() {
  return (
    <section className="bg-gradient-to-b from-fuchsia-50/50 to-slate-50 py-14 dark:from-[#0d0a1a] dark:to-[#050816] sm:py-20">
      <div className="container max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          {/* Left — mockup (order flips so the phone leads on desktop) */}
          <div className="order-2 mx-auto w-full max-w-[320px] lg:order-1">
            <div className="relative">
              <div aria-hidden className="absolute inset-0 -z-10 scale-105 rounded-[3rem] bg-gradient-to-br from-fuchsia-500/20 to-violet-600/20 blur-3xl" />
              <div className="relative aspect-[776/1630] rounded-[2.6rem] border-[3px] border-neutral-800 bg-neutral-900 p-[3px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]">
                <div className="relative h-full overflow-hidden rounded-[2.35rem] border-[4px] border-black bg-neutral-950 text-white">
                  <div className="absolute left-1/2 top-2 z-20 h-[1.3rem] w-[4.6rem] -translate-x-1/2 rounded-full bg-black" />
                  <div className="flex h-full flex-col gap-2.5 px-3 pb-3 pt-6">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-sm font-bold">Studio</span>
                      <span className="rounded-lg bg-white/10 px-2 py-1 text-[9px] font-semibold">Export</span>
                    </div>
                    {/* preview */}
                    <div className="relative flex-1 overflow-hidden rounded-2xl bg-gradient-to-br from-rose-500 via-fuchsia-600 to-indigo-600">
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/25 backdrop-blur">
                          <Clapperboard className="h-6 w-6" />
                        </span>
                      </span>
                      <span className="absolute bottom-2 left-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold backdrop-blur">00:12 / 00:30</span>
                    </div>
                    {/* toolbar */}
                    <div className="flex justify-around rounded-2xl bg-white/[0.06] py-2 ring-1 ring-white/10">
                      {[Scissors, Music, Type, Wand2].map((Icon, i) => (
                        <span key={i} className="flex flex-col items-center gap-1 text-white/70">
                          <Icon className="h-4 w-4" />
                        </span>
                      ))}
                    </div>
                    {/* timeline */}
                    <div className="rounded-xl bg-white/[0.05] p-2 ring-1 ring-white/10">
                      <div className="flex gap-1">
                        {["from-blue-500 to-indigo-600", "from-fuchsia-500 to-pink-600", "from-emerald-500 to-teal-600", "from-amber-500 to-orange-600"].map((t, i) => (
                          <span key={i} className={`h-8 flex-1 rounded-md bg-gradient-to-br ${t}`} />
                        ))}
                      </div>
                      <div className="mt-1.5 h-1 w-1/3 rounded-full bg-white/40" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right — copy */}
          <div className="order-1 lg:order-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-fuchsia-500/25 bg-fuchsia-500/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-fuchsia-700 dark:border-fuchsia-400/30 dark:text-fuchsia-200">
              <Sparkles className="h-3.5 w-3.5" /> Studio
            </span>
            <h2 className="mt-5 text-3xl font-extrabold leading-[1.05] tracking-[-0.03em] text-slate-900 dark:text-white sm:text-4xl lg:text-5xl">
              Create &amp; Edit.
              <br />
              <span className="bg-gradient-to-r from-fuchsia-600 to-violet-600 bg-clip-text text-transparent dark:from-fuchsia-400 dark:to-violet-400">
                Right in the app.
              </span>
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600 dark:text-white/70">
              Trim, add effects, captions and music — turn your downloads into
              share-ready content without ever leaving Frenz.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <div key={f.title} className="flex gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-300">
                    <f.icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-bold tracking-tight text-slate-900 dark:text-white">{f.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{f.desc}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
