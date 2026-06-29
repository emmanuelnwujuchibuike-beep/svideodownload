import { Download, Flame, Lock, MessageCircle, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/features/auth/login-form";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const ERROR_MESSAGES: Record<string, string> = {
  callback: "Sign-in link couldn't be verified. Please request a new one.",
  confirm: "That link has expired or was already used. Request a fresh link.",
  auth: "Something went wrong signing you in. Please try again.",
};

const PERKS = [
  { icon: Download, text: "Download from 20+ platforms — no watermark" },
  { icon: Flame, text: "Watch trending reels & the latest news" },
  { icon: Users, text: "Meet new friends & follow creators" },
  { icon: MessageCircle, text: "Chat with people in real time" },
  { icon: Lock, text: "100% secure & private — you're in control" },
];

const CLUSTER = [
  { from: "from-rose-500 to-pink-600", emoji: "👩🏽" },
  { from: "from-blue-500 to-indigo-600", emoji: "🧑🏻" },
  { from: "from-violet-500 to-purple-600", emoji: "👨🏾" },
  { from: "from-amber-500 to-orange-600", emoji: "👩🏼" },
  { from: "from-emerald-500 to-teal-600", emoji: "🧑🏼" },
];

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
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Left — brand / marketing panel */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-blue-600 via-violet-600 to-purple-700 p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-white/15 blur-3xl motion-safe:animate-drift" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 h-72 w-72 rounded-full bg-fuchsia-400/20 blur-3xl motion-safe:animate-drift-slow" />

        <Link href="/" className="relative inline-flex items-center gap-2.5 text-xl font-bold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/25 backdrop-blur">
            <Download className="h-4 w-4" />
          </span>
          Frenz
        </Link>

        <div className="relative my-auto max-w-md py-10">
          <h2 className="text-4xl font-extrabold leading-[1.05] tracking-[-0.03em]">
            Download. Discover. Connect.
          </h2>
          <p className="mt-4 text-white/85">
            One account for everything — save videos, watch what&apos;s trending, meet new
            people and chat. Free to join.
          </p>

          <ul className="mt-8 space-y-3.5">
            {PERKS.map((p) => (
              <li key={p.text} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/20">
                  <p.icon className="h-4 w-4" />
                </span>
                <span className="text-sm text-white/90">{p.text}</span>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex items-center gap-3">
            <div className="flex -space-x-2">
              {CLUSTER.map((g, i) => (
                <span key={i} className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br ${g.from} text-base ring-2 ring-white/80`}>
                  {g.emoji}
                </span>
              ))}
            </div>
            <span className="text-sm font-medium text-white/85">Join 8M+ members already on Frenz</span>
          </div>
        </div>

        <p className="relative text-xs text-white/60">© {new Date().getFullYear()} Frenz</p>
      </aside>

      {/* Right — form panel */}
      <section className="flex flex-col items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          {/* Mobile brand */}
          <Link href="/" className="mb-8 flex items-center justify-center gap-2.5 text-lg font-bold tracking-tight lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-violet-600 to-purple-600 text-white shadow-md shadow-violet-500/30">
              <Download className="h-4 w-4" />
            </span>
            <span className="text-gradient">Frenz</span>
          </Link>

          <h1 className="text-center text-2xl font-extrabold tracking-[-0.02em] sm:text-3xl lg:text-left">
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mb-7 mt-2 text-center text-sm text-muted-foreground lg:text-left">
            {isSignUp
              ? "It's free and takes less than a minute."
              : "Sign in to sync downloads, follow creators and chat."}
          </p>

          {errorMessage ? (
            <p
              role="alert"
              className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-400"
            >
              {errorMessage}
            </p>
          ) : null}

          <LoginForm next={next} initialSignUp={isSignUp} />

          <p className="mt-6 text-center text-xs text-muted-foreground">
            By continuing you agree to our{" "}
            <Link href="/terms" className="font-medium underline underline-offset-2 hover:text-foreground">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-medium underline underline-offset-2 hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
