"use client";

import { Check, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { toast } from "@/features/ui/toast";
import { cn } from "@/lib/utils";

const MIN_LENGTH = 8;

/**
 * Optional account password. Sign-in codes always work — a password is an
 * extra way in (and what "Forgot password?" resets). Set/changed through
 * POST /api/v1/app/security/password, which asks for an emailed code when this
 * session signed in with a password (2026-10-23); the forgot-password flow
 * lands here with ?setPassword=1 (after proving email ownership via a code)
 * to set the replacement.
 */
export function PasswordEditor() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when this session signed in WITH a password: the change needs the code we email (owner, 2026-10-23)
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const searchParams = useSearchParams();
  const fromReset = searchParams.get("setPassword") === "1";

  // Arriving from "Forgot password?" — bring the section into view.
  useEffect(() => {
    if (fromReset) sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [fromReset]);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const canSave = password.length >= MIN_LENGTH && password === confirm && !saving && (!codeSentTo || code.length === 6);

  const sendCode = async (): Promise<boolean> => {
    const res = await fetch("/api/v1/app/security/password/code", { method: "POST", credentials: "same-origin" });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: { sentTo?: string }; error?: { message?: string } } | null;
    if (!res.ok || !body?.ok) {
      setError(body?.error?.message ?? "Couldn't send the code. Try again.");
      return false;
    }
    setCodeSentTo(body.data?.sentTo ?? "your email");
    setCode("");
    return true;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/app/security/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password, code: codeSentTo ? code : undefined }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message?: string; details?: { needsCode?: boolean } } } | null;
      if (!res.ok || !body?.ok) {
        // signed in with a password: prove the inbox first, the same way "Forgot password?" does
        if (body?.error?.details?.needsCode && !codeSentTo) {
          await sendCode();
          return;
        }
        throw new Error(body?.error?.message ?? "Couldn't save the password. Try again.");
      }
      setCodeSentTo(null);
      setCode("");
      fetch("/api/v1/app/security/password-changed", { method: "POST" }).catch(() => {});
      setSaved(true);
      setPassword("");
      setConfirm("");
      toast("Password saved — you can now sign in with it too.", "success");
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't save the password. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={sectionRef}
      className={cn("border-b border-border/60 p-6 sm:p-8", fromReset && "bg-violet-500/[0.04]")}
      id="password"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="h-4 w-4 text-muted-foreground" /> Password
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {fromReset
          ? "You're verified — choose your new password below."
          : "Optional: email codes always work, but a password gives you a second way to sign in."}
      </p>

      <form onSubmit={submit} className="mt-4 max-w-md space-y-3">
        <div className="relative">
          <input
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            aria-label="New password"
            className="h-12 w-full rounded-2xl bg-secondary/40 px-4 pr-11 text-[15px] outline-none ring-1 ring-inset ring-border/60 transition placeholder:text-muted-foreground/60 focus:bg-background focus:ring-2 focus:ring-violet-500/55"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
          >
            {show ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        </div>
        <input
          type={show ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          autoComplete="new-password"
          aria-label="Confirm password"
          className="h-12 w-full rounded-2xl bg-secondary/40 px-4 text-[15px] outline-none ring-1 ring-inset ring-border/60 transition placeholder:text-muted-foreground/60 focus:bg-background focus:ring-2 focus:ring-violet-500/55"
        />

        {codeSentTo ? (
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">We sent a 6-digit code to {codeSentTo}. Enter it to save your new password.</p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              aria-label="Code from the email"
              className="h-12 w-full rounded-2xl bg-secondary/40 px-4 text-center font-mono text-lg tracking-[0.4em] outline-none ring-1 ring-inset ring-border/60 transition placeholder:text-[15px] placeholder:tracking-normal placeholder:text-muted-foreground/60 focus:bg-background focus:ring-2 focus:ring-violet-500/55"
            />
            <button type="button" onClick={() => void sendCode()} className="text-xs font-semibold text-violet-600 hover:underline dark:text-violet-400">
              Send a new code
            </button>
          </div>
        ) : null}

        <p aria-live="polite" className="min-h-4 text-xs">
          {tooShort ? (
            <span className="text-amber-500">At least {MIN_LENGTH} characters.</span>
          ) : mismatch ? (
            <span className="text-red-400">Passwords don&apos;t match yet.</span>
          ) : error ? (
            <span className="text-red-400">{error}</span>
          ) : password.length >= MIN_LENGTH && password === confirm ? (
            <span className="text-emerald-500">Looks good.</span>
          ) : null}
        </p>

        <button
          type="submit"
          disabled={!canSave}
          className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 active:scale-[0.99] disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? "Saved" : codeSentTo ? "Verify and save" : "Save password"}
        </button>
      </form>
    </div>
  );
}
