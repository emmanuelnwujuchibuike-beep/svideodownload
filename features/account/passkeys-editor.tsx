"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { Check, Fingerprint, Loader2, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { requestPasskeyStepUp } from "@/features/account/use-passkey-stepup";
import { toast } from "@/features/ui/toast";

interface Passkey {
  id: string;
  label: string;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Passkeys (WebAuthn) — a biometric (Face ID/Touch ID/Windows Hello) step-up
 *  gate for sensitive actions, not a login replacement. Account → Security. */
export function PasskeysEditor() {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    fetch("/api/v1/app/security/passkeys")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setPasskeys(json.data.passkeys);
      })
      .catch(() => setPasskeys([]));
  };

  useEffect(() => {
    load();
  }, []);

  const enroll = async () => {
    setEnrolling(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/v1/app/security/passkeys/register/options", { method: "POST" });
      const optionsJson = await optionsRes.json();
      if (!optionsJson.ok) throw new Error(optionsJson.error?.message);

      const attestation = await startRegistration({ optionsJSON: optionsJson.data.options });

      const verifyRes = await fetch("/api/v1/app/security/passkeys/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: attestation }),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyJson.ok || !verifyJson.data.ok) throw new Error("That passkey couldn't be verified.");
      toast("Passkey added.", "success");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add a passkey. Your device may not support one.");
    } finally {
      setEnrolling(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this passkey?")) return;
    setBusyId(id);
    try {
      let res = await fetch(`/api/v1/app/security/passkeys/${id}`, { method: "DELETE" });
      let json = await res.json();
      if (!json.ok && json.error?.details?.needsStepUp) {
        const cleared = await requestPasskeyStepUp(json.error.details.purpose);
        if (!cleared) throw new Error("Passkey verification was cancelled.");
        res = await fetch(`/api/v1/app/security/passkeys/${id}`, { method: "DELETE" });
        json = await res.json();
      }
      if (!json.ok) throw new Error(json.error?.message);
      setPasskeys((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove that passkey.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const saveRename = async (id: string) => {
    const label = renameValue.trim();
    if (!label) {
      setRenaming(null);
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/app/security/passkeys/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message);
      setPasskeys((prev) => (prev ? prev.map((p) => (p.id === id ? { ...p, label: json.data.passkey.label } : p)) : prev));
    } catch {
      toast("Couldn't rename that passkey.", "error");
    } finally {
      setBusyId(null);
      setRenaming(null);
    }
  };

  return (
    <div className="border-b border-border/60 p-6 sm:p-8">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Fingerprint className="h-4 w-4 text-muted-foreground" /> Passkeys
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Use Face ID, Touch ID, or Windows Hello to verify it&apos;s you for sensitive actions like disabling 2FA or regenerating recovery codes.
      </p>

      <div className="mt-4 space-y-2">
        {passkeys?.map((p) => (
          <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/20 p-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
              <Fingerprint className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              {renaming === p.id ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveRename(p.id);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    maxLength={60}
                    className="h-7 min-w-0 flex-1 rounded-lg bg-background px-2 text-sm outline-none ring-1 ring-inset ring-primary/50"
                  />
                  <button type="button" onClick={() => void saveRename(p.id)} aria-label="Save name" className="text-emerald-500">
                    <Check className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} aria-label="Cancel" className="text-muted-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{p.label}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setRenaming(p.id);
                      setRenameValue(p.label);
                    }}
                    aria-label={`Rename ${p.label}`}
                    className="text-muted-foreground/60 transition hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {p.lastUsedAt ? `Last used ${new Date(p.lastUsedAt).toLocaleDateString()}` : "Never used"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => remove(p.id)}
              disabled={busyId === p.id}
              aria-label={`Remove ${p.label}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
            >
              {busyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={enroll}
        disabled={enrolling}
        className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-2xl border border-border px-5 text-sm font-semibold transition hover:bg-secondary disabled:opacity-50"
      >
        {enrolling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />} Add a passkey
      </button>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
