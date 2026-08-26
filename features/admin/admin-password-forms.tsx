"use client";

import { CheckCircle2, Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { createClient } from "@/lib/supabase/client";
import { MIN_ADMIN_PASSWORD_LENGTH, validateAdminPassword } from "@/lib/admin/password-policy";
import { cn } from "@/lib/utils";

/* ─────────────────────────── shared chrome ─────────────────────────── */

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[26rem]">
        <div className="mb-7 flex flex-col items-center text-center">
          <FrenzLogo size={44} priority />
          <h1 className="mt-4 text-2xl font-bold tracking-[-0.02em] text-foreground">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-card sm:p-6">{children}</div>
      </div>
    </main>
  );
}

const inputClass =
  "h-12 w-full rounded-xl bg-background px-3.5 text-base text-foreground outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary disabled:opacity-60";

const buttonClass =
  "mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-base font-semibold text-white shadow-md shadow-violet-500/25 transition active:scale-[0.99]";

/* ─────────────────────────── forgot password ─────────────────────────── */

/**
 * Step 1 — ask for the email.
 *
 * 🔴 THE SUCCESS STATE IS UNCONDITIONAL. Submitting shows the same confirmation
 * whether or not the address belongs to an administrator, because the SERVER
 * returns the same thing either way. This component could not distinguish them
 * if it wanted to, which is the point: the anti-enumeration property lives in
 * the API and this UI cannot accidentally undo it.
 */
export function AdminForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim()) {
      setError("Enter your admin email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/admin/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
    } catch {
      // Only a TRANSPORT failure is reported. A non-2xx from the server is not
      // — the server answers 200 for every outcome by design.
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Shell title="Check your email" subtitle="Password reset requested">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <MailCheck className="h-6 w-6" aria-hidden />
          </span>
          <p role="status" className="mt-4 text-sm leading-relaxed text-muted-foreground">
            If an account exists for this email, a password reset link has been sent.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            The link expires shortly and can only be used once.
          </p>
          <Link
            href="/admin/login"
            className="mt-5 text-sm font-semibold text-foreground underline-offset-2 hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Forgot password" subtitle="We'll email you a secure reset link">
      <form onSubmit={submit} noValidate>
        <label htmlFor="fp-email" className="block text-sm font-medium text-foreground">
          Admin email
        </label>
        <input
          id="fp-email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          className={cn("mt-1.5", inputClass)}
        />
        {error ? (
          <p role="alert" className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={cn(buttonClass, busy && "opacity-70")}>
          {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
          {busy ? "Sending…" : "Send reset link"}
        </button>
        <div className="mt-4 text-center">
          <Link href="/admin/login" className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Back to sign in
          </Link>
        </div>
      </form>
    </Shell>
  );
}

/* ─────────────────────────── reset password ─────────────────────────── */

type Stage = "checking" | "ready" | "invalid" | "done";

/**
 * Step 2 — set the new password.
 *
 * ── How the emailed link becomes a session ────────────────────────────────
 * Supabase's recovery link carries its token in the URL FRAGMENT (`#access_token
 * =…`). A fragment is never sent to the server, which is deliberate on
 * Supabase's part — it keeps the token out of server logs, proxies and the
 * Referer header. So the exchange has to happen in the browser: the client
 * library reads the fragment, establishes a recovery session, and stores it in
 * the same cookies every other session uses.
 *
 * That is why this component waits for a session before showing the form. The
 * NEW PASSWORD itself is still submitted to our own API, which re-validates the
 * policy server-side and revokes other sessions — neither of which can be
 * trusted to a client call.
 */
export function AdminResetPasswordForm() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    /*
      Two ways the session can appear, and both are handled:
       • it is already established by the time this effect runs (the library
         parses the fragment on construction), or
       • it arrives momentarily, announced as a PASSWORD_RECOVERY event.
      Listening only for the event misses the first case; checking only once
      misses the second.
    */
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setStage("ready");
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setStage((s) => (s === "ready" ? s : data.session ? "ready" : "invalid"));
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;

    // Instant feedback from the SAME module the server uses, so the two can
    // never disagree about what a valid password is.
    const verdict = validateAdminPassword(password);
    if (!verdict.ok) {
      setError(verdict.reason ?? "Choose a stronger password.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not update the password.");
        setBusy(false);
        return;
      }
      setStage("done");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  };

  if (stage === "checking") {
    return (
      <Shell title="Reset password" subtitle="Checking your reset link…">
        <div className="flex items-center justify-center py-6">
          <Loader2 aria-hidden className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  if (stage === "invalid") {
    return (
      <Shell title="Link expired" subtitle="This reset link is no longer valid">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Reset links are single-use and time-limited. Request a new one to continue.
        </p>
        <Link href="/admin/forgot-password" className={buttonClass}>
          Request a new link
        </Link>
      </Shell>
    );
  }

  if (stage === "done") {
    return (
      <Shell title="Password updated" subtitle="You can sign in with your new password">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-6 w-6" aria-hidden />
          </span>
          <p role="status" className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Your password has been changed and every other signed-in device has been signed out.
          </p>
          <button type="button" onClick={() => router.replace("/admin/login")} className={buttonClass}>
            Back to sign in
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Create a new password" subtitle={`At least ${MIN_ADMIN_PASSWORD_LENGTH} characters`}>
      <form onSubmit={submit} noValidate>
        <label htmlFor="rp-password" className="block text-sm font-medium text-foreground">
          New password
        </label>
        <div className="relative mt-1.5">
          <input
            id="rp-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            className={cn(inputClass, "pr-12")}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <label htmlFor="rp-confirm" className="mt-4 block text-sm font-medium text-foreground">
          Confirm new password
        </label>
        <input
          id="rp-confirm"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
          className={cn("mt-1.5", inputClass)}
        />

        {error ? (
          <p role="alert" className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={busy} className={cn(buttonClass, busy && "opacity-70")}>
          {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>
    </Shell>
  );
}
