import { SHOWCASE_PLATFORMS } from "@/lib/platforms";

export function PlatformShowcase() {
  return (
    <section id="platforms" className="border-t border-border/60 py-20">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Every platform you use, one downloader
          </h2>
          <p className="mt-3 text-muted-foreground">
            From short-form video to long-form audio — SVideoDownload supports
            them all through a single, unified extraction engine.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {SHOWCASE_PLATFORMS.map((p) => (
            <div
              key={p.id}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div
                className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${p.accent} text-sm font-bold text-white shadow`}
              >
                {p.name.slice(0, 2)}
              </div>
              <h3 className="font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {p.audioOnly ? "Audio • MP3 / M4A" : "Video + Audio • MP4 / MP3"}
              </p>
              {p.watermarkFree ? (
                <span className="mt-3 inline-block rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-400">
                  No watermark
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
