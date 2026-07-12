"use client";

import { AlertTriangle, Check, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";

import { requestPasskeyStepUp } from "@/features/account/use-passkey-stepup";
import { toast } from "@/features/ui/toast";
import { createClient } from "@/lib/supabase/client";

type Stage = "loading" | "off" | "enrolling" | "on";

/** TOTP two-factor authentication — enroll/verify/unenroll via Supabase's
 *  native `auth.mfa` API. Account → Security. */
export function MfaEditor() {
  const [stage, setStage] = useState<Stage>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const { data, error } = await createClient().auth.mfa.listFactors();
      if (error) throw error;
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setStage("on");
      } else {
        setStage("off");
      }
    } catch {
      setStage("off");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const startEnroll = async () => {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      const challenge = await supabase.auth.mfa.challenge({ factorId: data.id });
      if (challenge.error) throw challenge.error;
      setChallengeId(challenge.data.id);
      setStage("enrolling");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start enrollment.");
    } finally {
      setBusy(false);
    }
  };

  const confirmEnroll = async () => {
    if (!factorId || !challengeId || code.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
      if (error) throw error;
      await fetch("/api/v1/app/security/mfa-event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ factorId }),
      }).catch(() => {});
      setStage("on");
      setCode("");
      setQrCode(null);
      setSecret(null);
      toast("Two-factor authentication enabled.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code isn't right — check your app and try again.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!factorId) return;
    if (!confirm("Turn off two-factor authentication? Anyone with your password or sign-in code alone will be able to sign in.")) return;
    setBusy(true);
    setError(null);
    try {
      // Routed through our OWN backend (not a bare client-side
      // `supabase.auth.mfa.unenroll()`) so the passkey step-up requirement
      // is actually enforced server-side, not just a UI-level nudge.
      let res = await fetch("/api/v1/app/security/mfa/unenroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ factorId }),
      });
      let json = await res.json();
      if (!json.ok && json.error?.details?.needsStepUp) {
        const cleared = await requestPasskeyStepUp(json.error.details.purpose);
        if (!cleared) throw new Error("Passkey verification was cancelled.");
        res = await fetch("/api/v1/app/security/mfa/unenroll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ factorId }),
        });
        json = await res.json();
      }
      if (!json.ok) throw new Error(json.error?.message || "Couldn't turn off two-factor authentication.");
      setFactorId(null);
      setStage("off");
      toast("Two-factor authentication turned off.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't turn off two-factor authentication.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-border/60 p-6 sm:p-8">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Two-factor authentication
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Require a code from an authenticator app (Google Authenticator, Authy, 1Password, etc.) when signing in.
      </p>

      {stage === "loading" ? (
        <div className="mt-4 flex h-10 items-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : stage === "off" ? (
        <button
          type="button"
          onClick={startEnroll}
          disabled={busy}
          className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Set up two-factor authentication
        </button>
      ) : stage === "enrolling" ? (
        <div className="mt-4 max-w-sm space-y-4">
          <p className="text-sm text-muted-foreground">Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
          {qrCode ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrCode} alt="Authenticator QR code" className="mx-auto h-44 w-44 rounded-2xl border border-border/60 bg-white p-2" />
          ) : null}
          {secret ? (
            <p className="rounded-xl bg-secondary/40 px-3 py-2 text-center text-xs tracking-widest text-muted-foreground">
              Can&apos;t scan? Enter manually: <span className="font-semibold text-foreground">{secret}</span>
            </p>
          ) : null}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="h-12 w-full rounded-2xl bg-secondary/40 px-4 text-center text-lg tracking-[0.3em] outline-none ring-1 ring-inset ring-border/60 focus:bg-background focus:ring-2 focus:ring-violet-500/55"
          />
          {error ? (
            <p className="flex items-center gap-1.5 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmEnroll}
              disabled={busy || code.length < 6}
              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirm
            </button>
            <button
              type="button"
              onClick={() => {
                setStage("off");
                setCode("");
                setError(null);
              }}
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-border px-4 text-sm font-medium transition hover:bg-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.04] p-3.5">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-500">
            <ShieldCheck className="h-4 w-4" /> Enabled
          </p>
          <button
            type="button"
            onClick={disable}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-red-400 disabled:opacity-50"
          >
            <ShieldOff className="h-3.5 w-3.5" /> Turn off
          </button>
        </div>
      )}
    </div>
  );
}
