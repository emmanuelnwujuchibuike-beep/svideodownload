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

  // If already signed in, skip the login screen.
  if (hasSupabase) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect(next || "/account");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <Link href="/" className="mb-8 flex items-center gap-2 text-lg font-bold">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-400 text-white">
          <Download className="h-4 w-4" />
        </span>
        S<span className="text-gradient">Video</span>Download
      </Link>

      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          {isSignUp ? "Create your account" : "Welcome"}
        </h1>
        <p className="mb-6 mt-1 text-center text-sm text-muted-foreground">
          {isSignUp
            ? "Sign up in seconds — then pick your plan."
            : "Sign in to sync your downloads and favorites across devices."}
        </p>

        {errorMessage ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-400"
          >
            {errorMessage}
          </p>
        ) : null}

        <LoginForm next={next} initialSignUp={isSignUp} />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
