"use client";

import { Check, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { toast } from "@/features/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const MIN_LENGTH = 8;

/**
 * Optional account password. Sign-in codes always work — a password is an
 * extra way in (and what "Forgot password?" resets). Set/changed via
 * supabase.auth.updateUser on the live session; the forgot-password flow
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
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const searchParams = useSearchParams();
  const fromReset = searchParams.get("setPassword") === "1";

  // Arriving from "Forgot password?" — bring the section into view.
  useEffect(() => {
    if (fromReset) sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [fromReset]);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const canSave = password.length >= MIN_LENGTH && password === confirm && !saving;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) throw error;
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
          {saved ? "Saved" : "Save password"}
        </button>
      </form>
    </div>
  );
}
