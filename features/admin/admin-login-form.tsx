"use client";

import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ADMIN SIGN-IN FORM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 IT POSTS TO THIS ORIGIN, NOT TO SUPABASE ───────────────────────────
 *
 * Every other sign-in surface in this app calls `supabase.auth
 * .signInWithPassword()` from the browser. This one deliberately does not: a
 * browser-to-Supabase call never touches our server, so nothing here could
 * count failures, delay them, or lock an attacker out. See the note on
 * `/api/admin/auth/login` — the throttle only exists because the attempt is
 * observable, and it is only observable because of this fetch.
 *
 * ── What this component never does ────────────────────────────────────────
 *
 *  • It does not put the password in `localStorage`, `sessionStorage`,
 *    IndexedDB, a cookie, or any module-scope variable that outlives the
 *    submit. It lives in React state for the duration of the keystroke and is
 *    handed to `fetch` — nothing else reads it.
 *  • It does not interpret WHY a sign-in failed. The server sends one sentence
 *    for every failure mode and this renders it verbatim; inventing a friendlier
 *    "we don't recognise that email" here would rebuild the enumeration oracle
 *    the server was careful not to provide.
 *  • It does not decide who is an admin. A successful response only means "go
 *    look" — the destination re-checks server-side, so a tampered response
 *    achieves nothing.
 *
 * ── `router.refresh()` before navigating ──────────────────────────────────
 *
 * The session cookies arrive on the login response. Next's client router holds a
 * cached RSC payload rendered when there was no session, so pushing straight to
 * /admin can render that stale, signed-out tree. `refresh()` discards it, and
 * awaiting it means the dashboard is fetched WITH the new cookies.
 */
export function AdminLoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;

    // Local validation is only about avoiding a pointless round trip. It never
    // says anything the server would not also say.
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `same-origin` so the session cookies the response sets are stored.
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        mfaRequired?: boolean;
      };

      if (!res.ok) {
        setError(data.error ?? "Incorrect email or password.");
        setBusy(false);
        return;
      }

      /*
        The account has a verified TOTP factor, so the session is at aal1 and
        the dashboard will bounce it. Send them to the existing challenge screen
        — the same one the member flow uses — rather than building a second one.
      */
      if (data.mfaRequired) {
        router.replace(`/login/mfa-challenge?next=${encodeURIComponent(next)}`);
        return;
      }

      router.refresh();
      router.replace(next);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[26rem]">
        {/* Branding — the mark, not a wordmark image, so this page pulls in
            nothing the rest of the app has not already loaded. */}
        <div className="mb-7 flex flex-col items-center text-center">
          <FrenzLogo size={44} priority />
          <h1 className="mt-4 text-2xl font-bold tracking-[-0.02em] text-foreground">
            Admin sign in
          </h1>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
            Restricted area — authorised staff only
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-3xl border border-border/70 bg-card p-5 shadow-card sm:p-6"
          noValidate
        >
          <label htmlFor="admin-email" className="block text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="admin-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            aria-invalid={!!error}
            className="mt-1.5 h-12 w-full rounded-xl bg-background px-3.5 text-base text-foreground outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary disabled:opacity-60"
          />

          <label
            htmlFor="admin-password"
            className="mt-4 block text-sm font-medium text-foreground"
          >
            Password
          </label>
          <div className="relative mt-1.5">
            <input
              id="admin-password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              aria-invalid={!!error}
              className="h-12 w-full rounded-xl bg-background px-3.5 pr-12 text-base text-foreground outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              // The LABEL changes with state, so a screen reader hears what the
              // button will do rather than a static "toggle password".
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
              className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {/*
            `role="alert"` so the failure is announced. Rendered in the same
            place for every failure mode, because they all carry the same text.
          */}
          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className={cn(
              "mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-base font-semibold text-white shadow-md shadow-violet-500/25 transition active:scale-[0.99]",
              busy && "opacity-70",
            )}
          >
            {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <div className="mt-4 text-center">
            <Link
              href="/admin/forgot-password"
              className="text-sm font-medium text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
