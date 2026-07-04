import {
  Bookmark,
  Building2,
  Coffee,
  Headphones,
  Heart,
  Mountain,
  Pencil,
  ShoppingBag,
  Sofa,
  Sparkles,
  TrendingUp,
  User,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import type { ComponentType } from "react";

import { FrenzMark } from "@/components/brand/frenz-logo";
import { AuthPanel } from "@/features/auth/auth-panel";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Icon = ComponentType<{ className?: string }>;
type Corner = "tl" | "tr" | "bl" | "br";

/** The collage scene — floating gradient cards with content hints + colored
 *  action badges, echoing the sample. Positioned by % so it scales cleanly. */
type Card = {
  grad: string;
  content: Icon;
  /** Photo shown in the card. Drop the file at `public/login/<img>` and it takes
   *  over from the gradient automatically; until then the gradient is the fallback. */
  img: string;
  pos: { top: string; left: string; width: string; height: string };
  rotate: string;
  drift?: string;
  badge?: { icon: Icon; corner: Corner };
  z?: string;
};

const CARDS: Card[] = [
  // center — person (clock girl)
  { grad: "from-violet-500 via-purple-600 to-fuchsia-700", content: User, img: "2.png", pos: { top: "10%", left: "33%", width: "34%", height: "80%" }, rotate: "rotate-0", z: "z-20" },
  // top-left — paint splash
  { grad: "from-indigo-500 to-violet-700", content: Mountain, img: "1.png", pos: { top: "0%", left: "6%", width: "31%", height: "44%" }, rotate: "-rotate-6", drift: "motion-safe:animate-drift", badge: { icon: Heart, corner: "tl" } },
  // top-right — circuit globe
  { grad: "from-blue-600 to-violet-700", content: Building2, img: "4.png", pos: { top: "3%", left: "60%", width: "33%", height: "42%" }, rotate: "rotate-6", drift: "motion-safe:animate-drift-slow", badge: { icon: TrendingUp, corner: "tr" } },
  // left — music note
  { grad: "from-purple-500 to-violet-800", content: Headphones, img: "3.png", pos: { top: "35%", left: "-1%", width: "27%", height: "35%" }, rotate: "-rotate-3", badge: { icon: Sparkles, corner: "bl" } },
  // right — blue geometric
  { grad: "from-fuchsia-600 to-purple-800", content: Sofa, img: "6.png", pos: { top: "35%", left: "72%", width: "29%", height: "35%" }, rotate: "rotate-3", badge: { icon: Bookmark, corner: "br" } },
  // bottom-left — neon rock
  { grad: "from-violet-600 to-indigo-800", content: Coffee, img: "7.png", pos: { top: "63%", left: "4%", width: "30%", height: "34%" }, rotate: "rotate-3", drift: "motion-safe:animate-drift-slow", badge: { icon: Pencil, corner: "bl" } },
  // bottom-right — social chains
  { grad: "from-purple-600 to-fuchsia-800", content: ShoppingBag, img: "5.png", pos: { top: "61%", left: "62%", width: "32%", height: "36%" }, rotate: "-rotate-3", drift: "motion-safe:animate-drift", badge: { icon: ShoppingBag, corner: "br" } },
];

const CORNER: Record<Corner, string> = {
  tl: "-left-2 -top-2",
  tr: "-right-2 -top-2",
  bl: "-bottom-2 -left-2",
  br: "-bottom-2 -right-2",
};

function Collage() {
  return (
    <div className="relative mx-auto aspect-[10/11] h-full max-h-[46vh] w-full max-w-[400px]">
      {CARDS.map((c, i) => {
        const Content = c.content;
        return (
          <div
            key={i}
            className={cn("absolute", c.z)}
            style={{ top: c.pos.top, left: c.pos.left, width: c.pos.width, height: c.pos.height }}
          >
            <div className={cn("relative h-full w-full overflow-hidden rounded-[26px] bg-gradient-to-br shadow-xl ring-1 ring-inset ring-white/15", c.grad, c.rotate, c.drift)}>
              {/* Gradient + icon show first; Next optimizes the photo (AVIF/WebP,
                  resized) so the collage stays light on slow connections. */}
              <Content className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-white/25" />
              <Image
                src={`/login/${c.img}`}
                alt=""
                aria-hidden
                fill
                sizes="200px"
                quality={65}
                priority={i === 0}
                className="object-cover"
              />
              {/* Legibility scrim so the white badge chips pop over any photo */}
              <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
              <span aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-white/15 blur-xl" />
              {c.badge ? (
                <span className={cn("absolute flex h-9 w-9 items-center justify-center rounded-2xl bg-white/95 text-violet-600 shadow-lg ring-1 ring-black/5", CORNER[c.badge.corner])}>
                  <c.badge.icon className="h-[18px] w-[18px]" />
                </span>
              ) : null}
            </div>
          </div>
        );
      })}

      {/* Center F mark — overlaps the person card at the bottom */}
      <div className="absolute left-1/2 top-[72%] z-30 -translate-x-1/2">
        <FrenzMark size={72} className="motion-safe:animate-drift-slow" />
      </div>
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  if (hasSupabase) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect(next || "/home");
  }

  return (
    <main className="relative flex h-[100dvh] flex-col overflow-hidden bg-background">
      {/* Ambient brand wash */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet-500/[0.07] via-transparent to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-violet-500/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-24 top-24 h-72 w-72 rounded-full bg-fuchsia-500/15 blur-3xl" />

      {/* Collage — fills the space above the auth block */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pt-4">
        <Collage />
      </div>

      {/* Headline + auth — pinned to the bottom, never scrolls */}
      <div className="relative shrink-0 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1 sm:px-8">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-center text-[30px] font-extrabold leading-tight tracking-[-0.03em] sm:text-4xl">
            <span className="text-foreground">Inspire. </span>
            <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">Create. </span>
            <span className="bg-gradient-to-r from-violet-500 to-fuchsia-500 bg-clip-text text-transparent">Belong.</span>
          </h1>
          <p className="mt-1.5 text-center text-[15px] font-medium text-muted-foreground">Your world. Your way.</p>

          <div className="mt-5">
            <AuthPanel next={next} />
          </div>
        </div>
      </div>
    </main>
  );
}
