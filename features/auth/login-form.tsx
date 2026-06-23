"use client";

import { CheckCircle2, KeyRound, Loader2, Mail, Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "error";
type Mode = "magic" | "password";

export function LoginForm({ next = "/account" }: { next?: string }) {
  const [mode, setMode] = useState<Mode>("magic");
  const [isSignUp, setIsSignUp] = useState(false);
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
          // Email confirmation is disabled → we're signed in immediately.
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
      <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-500">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold">Check your inbox</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a magic sign-in link to{" "}
          <span className="font-medium text-foreground">{email}</span>. Click it
          to finish signing in.
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
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-7">
      {/* Method toggle */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => {
            setMode("magic");
            setError(null);
            setNotice(null);
          }}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 transition ${
            mode === "magic"
              ? "bg-card text-foreground shadow-soft"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sparkles className="h-4 w-4" /> Magic link
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("password");
            setError(null);
            setNotice(null);
          }}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 transition ${
            mode === "password"
              ? "bg-card text-foreground shadow-soft"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <KeyRound className="h-4 w-4" /> Password
        </button>
      </div>

      {mode === "magic" ? (
        <form onSubmit={sendMagicLink} className="space-y-3">
          <EmailField email={email} setEmail={setEmail} />
          <SubmitButton busy={busy} label="Send magic link" />
        </form>
      ) : (
        <form onSubmit={submitPassword} className="space-y-3">
          <EmailField email={email} setEmail={setEmail} />
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              aria-label="Password"
              className="h-12 w-full rounded-xl bg-background px-4 pl-10 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
            />
          </div>
          {isSignUp ? (
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                className={`h-12 w-full rounded-xl bg-background px-4 pl-10 text-sm outline-none ring-1 ring-inset transition focus:ring-2 ${
                  confirmPassword.length > 0 && confirmPassword !== password
                    ? "ring-red-400/60 focus:ring-red-400"
                    : "ring-border focus:ring-primary"
                }`}
              />
            </div>
          ) : null}
          <SubmitButton
            busy={busy}
            label={isSignUp ? "Create account" : "Sign in"}
          />
          <button
            type="button"
            onClick={() => {
              setIsSignUp((v) => !v);
              setConfirmPassword("");
              setError(null);
              setNotice(null);
            }}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {isSignUp
              ? "Already have an account? Sign in"
              : "Need an account? Create one"}
          </button>
        </form>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-center text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 text-center text-sm text-green-500">{notice}</p>
      ) : null}

      <p className="mt-5 text-center text-xs text-muted-foreground">
        {mode === "magic"
          ? "No password needed. We'll email you a secure sign-in link."
          : "Use a password if email links aren't arriving."}
      </p>
    </div>
  );
}

function EmailField({
  email,
  setEmail,
}: {
  email: string;
  setEmail: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        aria-label="Email address"
        autoComplete="email"
        className="h-12 w-full rounded-xl bg-background px-4 pl-10 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}

function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:shadow-primary/40 active:scale-[0.99] disabled:opacity-60"
    >
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
