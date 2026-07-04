"use client";

import { CheckCircle2, KeyRound, Loader2, Mail, Sparkles } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Status = "idle" | "sending" | "sent" | "error";
type Mode = "magic" | "password";

export function LoginForm({
  next = "/home",
  initialSignUp = false,
}: {
  next?: string;
  initialSignUp?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(initialSignUp ? "password" : "magic");
  const [isSignUp, setIsSignUp] = useState(initialSignUp);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const busy = status === "sending";

  const callbackUrl = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const fail = (e: unknown, fallback: string) => {
    setError(e instanceof Error && e.message ? e.message : fallback);
    setStatus("error");
  };

  // Google OAuth — wired now; works as soon as the Google provider is enabled in
  // Supabase. Redirects the browser, so there's no follow-up here on success.
  const signInWithGoogle = async () => {
    setStatus("sending");
    setError(null);
    setNotice(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl() },
      });
      if (error) fail(error, "Google sign-in isn't available yet. Try email for now.");
    } catch (err) {
      fail(err, "Google sign-in isn't available yet. Try email for now.");
    }
  };

  const sendMagicLink = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    setNotice(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: callbackUrl() },
      });
      if (error) {
        fail(error, "Couldn't send the sign-in link. Please try again.");
        return;
      }
      setStatus("sent");
    } catch (err) {
      fail(err, "Sign-in is unavailable right now.");
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    setNotice(null);
    try {
      const supabase = createClient();

      if (isSignUp) {
        if (password !== confirmPassword) {
          setError("Passwords don't match. Please re-enter them.");
          setStatus("error");
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: callbackUrl() },
        });
        if (error) {
          fail(error, "Couldn't create your account.");
          return;
        }
        if (data.session) {
          window.location.assign(next);
          return;
        }
        setNotice(
          "Account created. Check your email to confirm it, then sign in with your password.",
        );
        setIsSignUp(false);
        setStatus("idle");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        fail(error, "Incorrect email or password.");
        return;
      }
      window.location.assign(next);
    } catch (err) {
      fail(err, "Sign-in is unavailable right now.");
    }
  };

  if (status === "sent") {
    return (
      <div className="rounded-3xl border border-border/70 bg-card/80 p-7 text-center shadow-elevated backdrop-blur">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-500">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold">Check your inbox</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a magic sign-in link to{" "}
          <span className="font-medium text-foreground">{email}</span>. Click it to finish signing in.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 text-sm font-medium text-primary hover:underline"
        >
          Use a different method
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-border/70 bg-card/80 p-5 shadow-elevated backdrop-blur sm:p-6">
      {/* Continue with Google */}
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy}
        className="inline-flex h-[52px] w-full items-center justify-center gap-3 rounded-2xl border border-border/70 bg-background text-[15px] font-semibold text-foreground shadow-sm transition hover:bg-secondary/60 active:scale-[0.99] disabled:opacity-60"
      >
        <GoogleG />
        {isSignUp ? "Sign up with Google" : "Continue with Google"}
      </button>

      {/* Divider */}
      <div className="my-4 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        <span className="h-px flex-1 bg-border/70" />
        or use email
        <span className="h-px flex-1 bg-border/70" />
      </div>

      {/* Method toggle */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-secondary/60 p-1 text-sm font-medium">
        {(
          [
            { m: "magic" as const, Icon: Sparkles, label: "Magic link" },
            { m: "password" as const, Icon: KeyRound, label: "Password" },
          ]
        ).map(({ m, Icon, label }) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
              setNotice(null);
            }}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-xl py-2.5 transition",
              mode === m ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {mode === "magic" ? (
        <form onSubmit={sendMagicLink} className="space-y-3">
          <Field icon={<Mail className="h-[18px] w-[18px]" />}>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              aria-label="Email address"
              autoComplete="email"
              className={INPUT}
            />
          </Field>
          <SubmitButton busy={busy} label="Send magic link" />
        </form>
      ) : (
        <form onSubmit={submitPassword} className="space-y-3">
          <Field icon={<Mail className="h-[18px] w-[18px]" />}>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              aria-label="Email address"
              autoComplete="email"
              className={INPUT}
            />
          </Field>
          <Field icon={<KeyRound className="h-[18px] w-[18px]" />}>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              aria-label="Password"
              className={INPUT}
            />
          </Field>
          {isSignUp ? (
            <Field
              icon={<KeyRound className="h-[18px] w-[18px]" />}
              invalid={confirmPassword.length > 0 && confirmPassword !== password}
            >
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                autoComplete="new-password"
                aria-label="Confirm password"
                aria-invalid={confirmPassword.length > 0 && confirmPassword !== password}
                className={INPUT}
              />
            </Field>
          ) : null}
          <SubmitButton busy={busy} label={isSignUp ? "Create account" : "Sign in"} />
          <button
            type="button"
            onClick={() => {
              setIsSignUp((v) => !v);
              setConfirmPassword("");
              setError(null);
              setNotice(null);
            }}
            className="w-full pt-0.5 text-center text-xs text-muted-foreground transition hover:text-foreground"
          >
            {isSignUp ? "Already have an account? Sign in" : "Need an account? Create one"}
          </button>
        </form>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-center text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {notice ? <p className="mt-3 text-center text-sm text-green-500">{notice}</p> : null}

      <p className="mt-5 text-center text-xs text-muted-foreground">
        {mode === "magic"
          ? "No password needed — we'll email you a secure sign-in link."
          : "Use a password if email links aren't arriving."}
      </p>
    </div>
  );
}

/** Shared premium input styling — tall, rounded, soft fill, glowing focus ring. */
const INPUT =
  "h-[52px] w-full rounded-2xl bg-transparent pl-11 pr-4 text-[15px] outline-none placeholder:text-muted-foreground/60";

/** Luxury input shell: icon + a focus-glow ring around the field. */
function Field({ icon, invalid, children }: { icon: ReactNode; invalid?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "group relative rounded-2xl bg-secondary/40 ring-1 ring-inset transition",
        "focus-within:bg-background focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.10)]",
        invalid
          ? "ring-red-400/60 focus-within:ring-2 focus-within:ring-red-400"
          : "ring-border/60 focus-within:ring-2 focus-within:ring-primary/55",
      )}
    >
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground transition group-focus-within:text-primary">
        {icon}
      </span>
      {children}
    </div>
  );
}

function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="group relative inline-flex h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 text-[15px] font-bold text-white shadow-lg shadow-violet-500/25 transition hover:shadow-xl hover:shadow-violet-500/40 active:scale-[0.99] disabled:opacity-60"
    >
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Working…
        </>
      ) : (
        label
      )}
    </button>
  );
}

/** The official multi-colour Google "G" (inline SVG — no icon dependency). */
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
