"use client";

import { AlertTriangle, Check, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { OtpInput } from "@/features/auth/otp-input";
import { createClient } from "@/lib/supabase/client";

type Stage = "loading" | "totp" | "recovery" | "error";

/**
 * The MFA step-up screen every login flow redirects to when the signed-in
 * account has a verified 2FA factor this session hasn't satisfied yet (see
 * lib/auth/mfa.ts#needsMfaStepUp, wired into the OAuth/magic-link callback
 * routes and AuthPanel's box-code + password paths).
 */
export function MfaChallengeForm({ next }: { next: string }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;
        const totp = data.totp.find((f) => f.status === "verified") ?? data.all.find((f) => f.status === "verified");
        if (!totp) {
          setStage("error");
          setError("No verified authenticator found. Try signing in again.");
          return;
        }
        setFactorId(totp.id);
        const challenge = await supabase.auth.mfa.challenge({ factorId: totp.id });
        if (challenge.error) throw challenge.error;
        setChallengeId(challenge.data.id);
        setStage("totp");
      } catch {
        setStage("error");
        setError("Couldn't start the verification challenge. Try signing in again.");
      }
    })();
  }, []);

  const verifyTotp = async (code: string) => {
    if (!factorId || !challengeId || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
      if (error) {
        setError("That code isn't right — try again.");
        setShakeKey((k) => k + 1);
        return;
      }
      // The OAuth/magic-link callback routes normally set this right after a
      // successful sign-in so boot-splash.tsx shows the colored logo on this
      // one load — but they return here (the MFA gate) BEFORE ever reaching
      // that line, so an MFA-enrolled account's login silently lost it.
      // Not httpOnly server-side either, so setting it client-side works.
      document.cookie = "frenz_just_signed_in=1; path=/; max-age=30";
      window.location.assign(next);
    } catch {
      setError("Verification failed — check your connection and try again.");
      setShakeKey((k) => k + 1);
    } finally {
      setVerifying(false);
    }
  };

  const redeemRecovery = async () => {
    if (!recoveryCode.trim() || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/app/security/recovery-codes/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: recoveryCode.trim() }),
      });
      const json = await res.json();
      if (!json.ok || !json.data.ok) {
        setError("Invalid or already-used code.");
        return;
      }
      // Two-factor was removed server-side — land on Security with a
      // re-enroll prompt rather than wherever `next` originally pointed.
      window.location.assign("/account/security?recovered=1");
    } catch {
      setError("Couldn't verify that code. Check your connection and try again.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="rounded-3xl border border-border/70 bg-card/80 p-7 text-center shadow-elevated backdrop-blur">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10 text-violet-500">
        <ShieldCheck className="h-6 w-6" />
      </div>
      <h1 className="text-lg font-semibold">Verify it&apos;s you</h1>

      {stage === "loading" ? (
        <p className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Preparing your authenticator challenge…
        </p>
      ) : stage === "error" ? (
        <p className="mt-3 flex items-center justify-center gap-2 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      ) : stage === "recovery" ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">Enter one of your saved recovery codes.</p>
          <input
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="XXXX-XXXX-XXXX"
            autoFocus
            autoCapitalize="characters"
            className="mt-4 h-12 w-full rounded-2xl bg-secondary/40 px-4 text-center text-[15px] tracking-widest outline-none ring-1 ring-inset ring-border/60 focus:bg-background focus:ring-2 focus:ring-violet-500/55"
          />
          {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
          <button
            type="button"
            onClick={redeemRecovery}
            disabled={verifying || !recoveryCode.trim()}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 disabled:opacity-50"
          >
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Use this code
          </button>
          <button
            type="button"
            onClick={() => {
              setStage("totp");
              setError(null);
            }}
            className="mt-3 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            Back to authenticator code
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
          <div className="mt-5">
            <OtpInput length={6} onComplete={verifyTotp} disabled={verifying} shake={shakeKey} />
          </div>
          <div className="mt-4 min-h-6 text-sm" aria-live="polite">
            {verifying ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Verifying
              </span>
            ) : error ? (
              <span className="text-red-400">{error}</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              setStage("recovery");
              setError(null);
            }}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            <KeyRound className="h-3.5 w-3.5" /> Use a recovery code instead
          </button>
        </>
      )}
    </div>
  );
}
