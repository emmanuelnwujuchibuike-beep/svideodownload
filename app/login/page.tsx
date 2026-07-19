import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthPanel } from "@/features/auth/auth-panel";
import { LoginCollage } from "@/features/auth/login-collage";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

      <Link
        href="/"
        aria-label="Back to Frenz"
        className="fixed left-4 top-[max(1rem,env(safe-area-inset-top))] z-20 flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-card/80 text-foreground shadow-md backdrop-blur-md transition hover:bg-secondary active:scale-95"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>

      {/*
        Collage — fills the space above the auth block.

        `items-start`, NOT `items-center`. Measured: centering made the collage's
        Y position a function of THIS container's height, which is `flex-1` —
        i.e. whatever is left after the auth block below. That block contains the
        big gradient headline, so when the webfont swaps in, the headline
        reflows, the auth block grows (~210px on a 390x844 screen), and the
        centred collage slides up with it. That single move was CLS 0.1614 —
        POOR, and the largest layout shift in the app.

        Pinned to the top, the collage's Y is `container top + padding`: fixed
        before any font or image arrives. The slack simply sits below it instead
        of being split above and below, which on a real viewport is a difference
        of about 18px and invisible.

        The alternative — `font-display: optional` so the font never swaps —
        would fix every such shift app-wide, but it means some visitors never see
        Inter at all on a slow connection. Not worth trading the brand's
        typography for one page's metric.
      */}
      <div className="relative flex min-h-0 flex-1 items-start justify-center px-4 pt-4">
        <LoginCollage />
      </div>

      {/* Headline + auth — pinned to the bottom, never scrolls */}
      <div className="relative shrink-0 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1 sm:px-8">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-center text-[30px] font-extrabold leading-tight tracking-[-0.03em] sm:text-4xl">
            <span className="bg-gradient-to-r from-blue-500 to-blue-600 bg-clip-text text-transparent">Download. </span>
            <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">Discover. </span>
            <span className="bg-gradient-to-r from-violet-500 to-fuchsia-500 bg-clip-text text-transparent">Meet.</span>
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
