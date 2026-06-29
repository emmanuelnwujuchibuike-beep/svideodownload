import { Download, Flame, MessageCircle, Users } from "lucide-react";
import Link from "next/link";

const FEATURES = [
  {
    icon: Download,
    title: "Download",
    body: "Download videos from all major platforms without watermark.",
    href: "/#download",
    accent: "from-blue-500 to-indigo-500",
  },
  {
    icon: Flame,
    title: "Trending",
    body: "Watch trending reels and discover what's hot around the world.",
    href: "/explore",
    accent: "from-rose-500 to-pink-500",
  },
  {
    icon: Users,
    title: "Community",
    body: "Meet new people, follow creators, and build real connections.",
    href: "/explore",
    accent: "from-violet-500 to-purple-500",
  },
  {
    icon: MessageCircle,
    title: "Chat",
    body: "Join public chats or start private conversations instantly.",
    href: "/messages",
    accent: "from-emerald-500 to-teal-500",
  },
] as const;

/** Four-up value props — what FrenzSave is beyond a downloader. */
export function FeatureCards() {
  return (
    <section className="container max-w-6xl py-8 sm:py-10">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <Link
            key={f.title}
            href={f.href}
            className="group rounded-2xl border border-border/70 bg-card p-6 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-foreground/15 hover:shadow-card"
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${f.accent} text-white shadow-md transition-transform duration-300 group-hover:scale-110`}>
              <f.icon className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-lg font-bold tracking-tight">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
