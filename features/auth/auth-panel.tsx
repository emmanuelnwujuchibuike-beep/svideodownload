"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, KeyRound, Loader2, Mail, Sparkles } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type View = "choices" | "email";
type Status = "idle" | "sending" | "sent" | "error";

/**
 * The login/sign-up entry (Pinterest-style): three big choices — email, Google,
 * "I already have an account" — that expand into a premium email form. Google is
 * wired to Supabase OAuth (works once the provider is enabled).
 */
export function AuthPanel({ next = "/home" }: { next?: string }) {
  const [view, setView] = useState<View>("choices");
  const [isSignUp, setIsSignUp] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const busy = status === "sending";
  const callbackUrl = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const fail = (e: unknown, f: string) => {
    setError(e instanceof Error && e.message ? e.message : f);
    setStatus("error");
  };

  const google = async () => {
    setStatus("sending");
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl() } });
      if (error) fail(error, "Google sign-in isn't available yet — try email.");
    } catch (e) {
      fail(e, "Google sign-in isn't available yet — try email.");
    }
  };

  const magicLink = async () => {
    setStatus("sending");
    setError(null);
    setNotice(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callbackUrl() } });
      if (error) return fail(error, "Couldn't send the link. Try again.");
      setStatus("sent");
    } catch (e) {
      fail(e, "Sign-in is unavailable right now.");
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    setNotice(null);
    try {
      const supabase = createClient();
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: callbackUrl() } });
        if (error) return fail(error, "Couldn't create your account.");
        if (data.session) return window.location.assign(next);
        setNotice("Account created. Check your email to confirm it, then sign in.");
        setIsSignUp(false);
        setStatus("idle");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return fail(error, "Incorrect email or password.");
      window.location.assign(next);
    } catch (e) {
      fail(e, "Sign-in is unavailable right now.");
    }
  };

  if (status === "sent") {
    return (
      <div className="rounded-3xl border border-border/60 bg-card/80 p-6 text-center shadow-elevated backdrop-blur">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500"><Mail className="h-5 w-5" /></div>
        <p className="font-semibold">Check your inbox</p>
        <p className="mt-1 text-sm text-muted-foreground">We sent a secure sign-in link to <span className="font-medium text-foreground">{email}</span>.</p>
        <button type="button" onClick={() => setStatus("idle")} className="mt-3 text-sm font-medium text-primary hover:underline">Back</button>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {view === "choices" ? (
        <motion.div
          key="choices"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="space-y-3"
        >
          <button
            type="button"
            onClick={() => {
              setIsSignUp(true);
              setError(null);
              setView("email");
            }}
            className="group relative inline-flex h-14 w-full items-center justify-center gap-2.5 overflow-hidden rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-[15px] font-bold text-white shadow-lg shadow-violet-600/30 transition hover:shadow-xl hover:shadow-violet-600/45 active:scale-[0.99]"
          >
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <Mail className="h-[18px] w-[18px]" /> Continue with Email
          </button>

          <button
            type="button"
            onClick={google}
            disabled={busy}
            className="inline-flex h-14 w-full items-center justify-center gap-3 rounded-full border border-border/70 bg-background text-[15px] font-semibold text-foreground shadow-sm transition hover:bg-secondary/60 active:scale-[0.99] disabled:opacity-60"
          >
            <GoogleG /> Continue with Google
          </button>

          <button
            type="button"
            onClick={() => {
              setIsSignUp(false);
              setError(null);
              setView("email");
            }}
            className="inline-flex h-14 w-full items-center justify-center rounded-full bg-secondary/70 text-[15px] font-semibold text-foreground transition hover:bg-secondary active:scale-[0.99]"
          >
            I already have an account
          </button>

          {error ? <p className="pt-1 text-center text-sm text-red-400">{error}</p> : null}

          <p className="px-2 pt-1 text-center text-[13px] leading-relaxed text-muted-foreground">
            By continuing, you agree to Frenzsave&apos;s{" "}
            <Link href="/terms" className="font-medium text-violet-500 underline underline-offset-2">Terms of Service</Link>{" "}
            and acknowledge that you&apos;ve read our{" "}
            <Link href="/privacy" className="font-medium text-violet-500 underline underline-offset-2">Privacy Policy</Link>.
          </p>
        </motion.div>
      ) : (
        <motion.div
          key="email"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          <button
            type="button"
            onClick={() => {
              setView("choices");
              setError(null);
              setNotice(null);
            }}
            className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <h2 className="text-lg font-extrabold tracking-tight">{isSignUp ? "Create your account" : "Welcome back"}</h2>
          <p className="mb-4 mt-0.5 text-sm text-muted-foreground">{isSignUp ? "It's free and takes under a minute." : "Sign in to pick up where you left off."}</p>

          <form onSubmit={submit} className="space-y-3">
            <Field icon={<Mail className="h-[18px] w-[18px]" />}>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" aria-label="Email" autoComplete="email" className={INPUT} />
            </Field>
            <Field icon={<KeyRound className="h-[18px] w-[18px]" />}>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                aria-label="Password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                className={INPUT}
              />
            </Field>

            <button
              type="submit"
              disabled={busy}
              className="group relative inline-flex h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-[15px] font-bold text-white shadow-lg shadow-violet-600/25 transition hover:shadow-xl active:scale-[0.99] disabled:opacity-60"
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSignUp ? "Create account" : "Sign in"}
            </button>
          </form>

          <button type="button" onClick={magicLink} disabled={busy || !email.trim()} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50">
            <Sparkles className="h-3.5 w-3.5" /> Email me a sign-in link instead
          </button>

          <button
            type="button"
            onClick={() => {
              setIsSignUp((v) => !v);
              setError(null);
              setNotice(null);
            }}
            className="mt-2 w-full text-center text-xs text-muted-foreground transition hover:text-foreground"
          >
            {isSignUp ? "Already have an account? Sign in" : "Need an account? Create one"}
          </button>

          {error ? <p className="mt-3 text-center text-sm text-red-400">{error}</p> : null}
          {notice ? <p className="mt-3 text-center text-sm text-emerald-500">{notice}</p> : null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const INPUT = "h-[52px] w-full rounded-2xl bg-transparent pl-11 pr-4 text-[15px] outline-none placeholder:text-muted-foreground/60";

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="group relative rounded-2xl bg-secondary/40 ring-1 ring-inset ring-border/60 transition focus-within:bg-background focus-within:shadow-[0_0_0_4px_rgba(139,92,246,0.12)] focus-within:ring-2 focus-within:ring-violet-500/55">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground transition group-focus-within:text-violet-500">{icon}</span>
      {children}
    </div>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}
