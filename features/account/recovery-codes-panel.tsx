"use client";

import { AlertTriangle, Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { requestPasskeyStepUp } from "@/features/account/use-passkey-stepup";
import { toast } from "@/features/ui/toast";

/** Generate/view MFA recovery codes — Account → Security. Plaintext codes
 *  are shown exactly once, right after generation; only a remaining-count
 *  is ever displayed afterward. */
export function RecoveryCodesPanel() {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch("/api/v1/app/security/recovery-codes")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) {
          setRemaining(json.data.remaining);
          setGeneratedAt(json.data.generatedAt);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const generate = async () => {
    if (remaining && remaining > 0) {
      if (!confirm("Generating new codes invalidates any existing ones. Continue?")) return;
    }
    setBusy(true);
    setError(null);
    try {
      let res = await fetch("/api/v1/app/security/recovery-codes/generate", { method: "POST" });
      let json = await res.json();
      if (!json.ok && json.error?.details?.needsStepUp) {
        const cleared = await requestPasskeyStepUp(json.error.details.purpose);
        if (!cleared) {
          setError("Passkey verification was cancelled.");
          return;
        }
        res = await fetch("/api/v1/app/security/recovery-codes/generate", { method: "POST" });
        json = await res.json();
      }
      if (!json.ok) throw new Error(json.error?.message);
      setCodes(json.data.codes as string[]);
      setAcknowledged(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't generate recovery codes.");
    } finally {
      setBusy(false);
    }
  };

  const copyAll = () => {
    if (!codes) return;
    navigator.clipboard?.writeText(codes.join("\n")).then(() => toast("Copied.", "success"));
  };

  const dismiss = () => {
    setCodes(null);
    load();
  };

  return (
    <div className="border-b border-border/60 p-6 sm:p-8">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="h-4 w-4 text-muted-foreground" /> Recovery codes
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        One-time codes to get back in if you lose access to your authenticator app.
      </p>

      {codes ? (
        <div className="mt-4 max-w-sm rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5" /> Save these somewhere safe — shown only once.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
            {codes.map((c) => (
              <span key={c} className="rounded-lg bg-secondary/50 px-2 py-1.5 text-center">
                {c}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={copyAll}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" /> Copy all
          </button>
          <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="h-3.5 w-3.5" />
            I&apos;ve saved these codes
          </label>
          <button
            type="button"
            onClick={dismiss}
            disabled={!acknowledged}
            className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Done
          </button>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-secondary/20 p-3.5">
          <p className="text-sm">
            {remaining === null ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : remaining > 0 ? (
              <>
                <span className="font-medium">{remaining} unused codes</span>
                {generatedAt ? <span className="text-muted-foreground"> · generated {new Date(generatedAt).toLocaleDateString()}</span> : null}
              </>
            ) : (
              <span className="text-muted-foreground">No recovery codes generated yet.</span>
            )}
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-medium transition hover:bg-secondary disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {remaining && remaining > 0 ? "Regenerate" : "Generate codes"}
          </button>
        </div>
      )}
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
