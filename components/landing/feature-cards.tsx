import { Download, Flame, MessageCircle, Users } from "lucide-react";
import Link from "next/link";

const FEATURES = [
  {
    icon: Download,
    title: "Download",
    body: "Save videos, reels & audio from every major platform — fast, HD, no watermark.",
    href: "/#download",
    accent: "from-blue-600 to-cyan-400",
  },
  {
    icon: Flame,
    title: "Trending",
    body: "Watch what's hot right now and discover the reels everyone's talking about.",
    href: "/explore",
    accent: "from-rose-500 to-orange-400",
  },
  {
    icon: Users,
    title: "Community",
    body: "Meet new people, follow creators and build real connections.",
    href: "/explore",
    accent: "from-violet-600 to-fuchsia-500",
  },
  {
    icon: MessageCircle,
    title: "Chat",
    body: "Message creators and friends — start a private conversation instantly.",
    href: "/messages",
    accent: "from-emerald-500 to-teal-400",
  },
] as const;

/** Four-up value props — what FrenzSave is beyond a downloader. */
export function FeatureCards() {
  return (
    <section className="container max-w-6xl py-12 sm:py-16">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <Link
            key={f.title}
            href={f.href}
            className="group rounded-2xl border border-border/70 bg-card p-5 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-foreground/15 hover:shadow-card"
          >
            <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${f.accent} text-white shadow-md ring-1 ring-white/20 transition-transform duration-300 group-hover:scale-110`}>
              <f.icon className="h-5 w-5" />
            </span>
            <h3 className="mt-4 font-semibold tracking-tight">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
