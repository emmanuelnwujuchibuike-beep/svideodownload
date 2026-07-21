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
        className="fixed left-4 top-[max(1rem,var(--frenz-safe-top))] z-20 flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-card/80 text-foreground shadow-md backdrop-blur-md transition hover:bg-secondary active:scale-95"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>

      {/*
        The hero constellation, in its OWN bounded box.

        `items-center` is safe now that the hero has a fixed aspect-ratio /
        max-height rather than filling the column: its size is known at first
        paint, so it does not slide when the webfont swaps the headline below
        (the CLS 0.1614 the old `flex-1` + `h-full` collage caused). The box owns
        its space, so nothing overlaps the title.
      */}
      {/*
        `overflow-hidden` is the safety net: on a short laptop window this column
        shrinks, and the constellation now sizes to the space it is GIVEN (see
        LoginCollage — height-driven, not a fixed width), so it can never grow
        past this box into the title below. On a tall phone it caps at its normal
        size, so the mobile layout is unchanged.
      */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 py-3">
        <LoginCollage />
      </div>

      {/*
        Title + auth — pinned to the bottom, generously spaced.

        The headline stands ALONE in its own block with real breathing room above
        and below, never over the image. `text-balance` keeps the three words
        from breaking awkwardly.
      */}
      <div className="relative shrink-0 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 sm:px-8">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-balance text-center text-[32px] font-extrabold leading-[1.05] tracking-[-0.035em] sm:text-[40px]">
            <span className="bg-gradient-to-r from-blue-500 to-blue-600 bg-clip-text text-transparent">Download.</span>{" "}
            <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">Discover.</span>{" "}
            <span className="bg-gradient-to-r from-violet-500 to-fuchsia-500 bg-clip-text text-transparent">Meet.</span>
          </h1>
          <p className="mt-2.5 text-center text-[15px] font-medium text-muted-foreground">
            One place for every platform you already use.
          </p>

          <div className="mt-7">
            <AuthPanel next={next} />
          </div>

          {/*
            Trademark disclaimer. Deliberately the quietest thing on the page —
            10px, dimmed, tight leading — so it satisfies the legal need to
            disclaim affiliation with the brands whose logos appear in the hero
            without pulling any weight from the headline or the CTAs. It is the
            last element in the flow, below the auth panel, so it reads as a
            footnote rather than a message. `text-pretty` keeps the brand list
            from breaking into a lonely orphan on the last line.
          */}
          <p className="mt-5 text-pretty text-center text-[10px] leading-[1.5] text-muted-foreground/60">
            Frenzsave is an independent service and is not affiliated with, endorsed by, or
            sponsored by TikTok, Instagram, YouTube, Snapchat, Facebook, X, or Google. All
            trademarks and logos are the property of their respective owners.
          </p>
        </div>
      </div>
    </main>
  );
}
