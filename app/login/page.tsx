import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FrenzWordmark } from "@/components/brand/frenz-logo";
import { LoginForm } from "@/features/auth/login-form";
import { BRAND_ICONS, FLAGSHIP_IDS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const ERROR_MESSAGES: Record<string, string> = {
  callback: "Sign-in link couldn't be verified. Please request a new one.",
  confirm: "That link has expired or was already used. Request a fresh link.",
  auth: "Something went wrong signing you in. Please try again.",
};

/**
 * The collage that sits above the form — a Frenz-branded, Pinterest-style
 * masonry of platform + content tiles. No stock photos: premium gradient tiles
 * with the real platform marks, so it feels alive and on-brand.
 */
type Tile =
  | { kind: "platform"; id: (typeof FLAGSHIP_IDS)[number]; h: string }
  | { kind: "emoji"; emoji: string; grad: string; h: string };

const TILES: Tile[] = [
  { kind: "platform", id: FLAGSHIP_IDS[0]!, h: "h-32" },
  { kind: "emoji", emoji: "🎬", grad: "from-blue-500 to-indigo-600", h: "h-24" },
  { kind: "platform", id: FLAGSHIP_IDS[1]!, h: "h-24" },
  { kind: "emoji", emoji: "🔥", grad: "from-rose-500 to-pink-600", h: "h-32" },
  { kind: "platform", id: FLAGSHIP_IDS[2]!, h: "h-28" },
  { kind: "emoji", emoji: "🎧", grad: "from-violet-500 to-purple-600", h: "h-24" },
  { kind: "emoji", emoji: "✨", grad: "from-amber-400 to-orange-500", h: "h-24" },
  { kind: "platform", id: FLAGSHIP_IDS[3]!, h: "h-32" },
  { kind: "emoji", emoji: "🎉", grad: "from-emerald-500 to-teal-600", h: "h-28" },
];

function Collage() {
  return (
    <div aria-hidden className="columns-3 gap-3 [column-fill:_balance]">
      {TILES.map((t, i) => {
        const grad = t.kind === "platform" ? PLATFORMS[t.id].accent : t.grad;
        const Icon = t.kind === "platform" ? BRAND_ICONS[t.id] : null;
        return (
          <div
            key={i}
            className={cn(
              "mb-3 flex break-inside-avoid items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br text-white shadow-lg ring-1 ring-inset ring-white/15",
              grad,
              t.h,
            )}
          >
            {t.kind === "platform" && Icon ? (
              <Icon className="h-9 w-9 drop-shadow" />
            ) : (
              <span className="text-3xl drop-shadow">{t.kind === "emoji" ? t.emoji : null}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; signup?: string }>;
}) {
  const { next, error, signup } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.auth) : null;
  const isSignUp = signup === "1";

  if (hasSupabase) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect(next || "/home");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {/* Ambient brand glow */}
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-gradient-to-br from-blue-500/20 to-violet-500/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-gradient-to-tr from-violet-500/15 to-fuchsia-500/15 blur-3xl" />

      {/* Top bar */}
      <header className="relative flex items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" aria-label="Frenz home">
          <FrenzWordmark size={30} textClassName="text-lg" />
        </Link>
        <nav className="flex items-center gap-2 text-sm font-semibold">
          <Link
            href="/login"
            className={cn(
              "rounded-full px-4 py-2 transition",
              isSignUp ? "text-muted-foreground hover:text-foreground" : "bg-secondary text-foreground",
            )}
          >
            Log in
          </Link>
          <Link
            href="/login?signup=1"
            className={cn(
              "rounded-full px-4 py-2 text-white shadow-md shadow-violet-500/25 transition hover:opacity-95",
              "bg-gradient-to-r from-blue-600 to-violet-600",
              !isSignUp ? "" : "ring-2 ring-inset ring-white/20",
            )}
          >
            Sign up
          </Link>
        </nav>
      </header>

      <div className="relative mx-auto w-full max-w-md px-5 pb-16 sm:max-w-lg sm:px-8">
        {/* Collage */}
        <div className="mt-2">
          <Collage />
        </div>

        {/* Headline */}
        <h1 className="mt-8 text-center text-[28px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
          {isSignUp ? (
            <>Everything you love,<br className="hidden sm:block" /> now on <span className="text-gradient">Frenz</span></>
          ) : (
            <>Welcome back to <span className="text-gradient">Frenz</span></>
          )}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-center text-[15px] leading-relaxed text-muted-foreground">
          {isSignUp
            ? "Download from anywhere, watch what's trending, and meet friends — all in one place. Free to join."
            : "Sign in to sync your downloads, follow creators and pick up where you left off."}
        </p>

        {errorMessage ? (
          <p role="alert" className="mx-auto mt-5 max-w-sm rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
            {errorMessage}
          </p>
        ) : null}

        {/* Auth */}
        <div className="mx-auto mt-6 max-w-sm">
          <LoginForm next={next} initialSignUp={isSignUp} />

          <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
            By continuing you agree to our{" "}
            <Link href="/terms" className="font-medium underline underline-offset-2 hover:text-foreground">Terms</Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-medium underline underline-offset-2 hover:text-foreground">Privacy Policy</Link>.
          </p>
        </div>

        {/* Social proof */}
        <p className="mt-8 text-center text-xs font-medium text-muted-foreground">
          Join <span className="font-bold text-foreground">8M+</span> members already on Frenz
        </p>
      </div>
    </main>
  );
}
