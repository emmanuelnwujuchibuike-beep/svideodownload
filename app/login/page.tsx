import { Download } from "lucide-react";
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
    if (user) redirect(next || "/account");
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-16">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-10 hidden h-[320px] w-[500px] -translate-x-1/2 rounded-full bg-gradient-to-b from-primary/15 via-sky-500/8 to-transparent blur-[70px] md:block"
      />

      {/* Brand */}
      <Link
        href="/"
        className="mb-10 flex items-center gap-2.5 text-lg font-bold tracking-tight transition-opacity hover:opacity-80"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-400 text-white shadow-md shadow-blue-500/30">
          <Download className="h-4 w-4" />
        </span>
        S<span className="text-gradient">Video</span>Download
      </Link>

      {/* Card */}
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-border/70 bg-card shadow-luxury">
        <div className="p-8">
          <h1 className="text-center text-2xl font-bold tracking-[-0.02em]">
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mb-7 mt-2 text-center text-sm text-muted-foreground">
            {isSignUp
              ? "Sign up in seconds — then pick your plan."
              : "Sign in to sync your downloads and access the API."}
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
        </div>

        <div className="border-t border-border/50 bg-secondary/30 px-8 py-4 text-center text-xs text-muted-foreground">
          By continuing you agree to our{" "}
          <Link href="/terms" className="font-medium underline underline-offset-2 hover:text-foreground">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-medium underline underline-offset-2 hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </div>
      </div>
    </main>
  );
}
