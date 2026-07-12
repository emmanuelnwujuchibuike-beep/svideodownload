"use client";

import { Check, KeyRound, Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { toast } from "@/features/ui/toast";
import { cn } from "@/lib/utils";

const INPUT =
  "h-12 w-full rounded-2xl bg-secondary/40 px-4 text-[15px] tracking-widest outline-none ring-1 ring-inset ring-border/60 transition placeholder:text-muted-foreground/60 placeholder:tracking-normal focus:bg-background focus:ring-2 focus:ring-violet-500/55";

const LOCK_OPTIONS = [1, 5, 15, 30] as const;

/** Set/change the app-level quick-lock PIN + auto-lock window (Account → Security). */
export function PinSettingsEditor() {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [autoLockMinutes, setAutoLockMinutes] = useState(5);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/app/security/pin/status")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) {
          setHasPin(json.data.hasPin);
          setAutoLockMinutes(json.data.autoLockMinutes);
        }
      })
      .catch(() => setHasPin(false));
  }, []);

  const mismatch = confirmPin.length > 0 && newPin !== confirmPin;
  const validLength = /^\d{4,8}$/.test(newPin);
  const canSave = validLength && newPin === confirmPin && !saving && (!hasPin || /^\d{4,8}$/.test(currentPin));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/app/security/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPin: hasPin ? currentPin : undefined, newPin, autoLockMinutes }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message || "Couldn't save your PIN.");
      setHasPin(true);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setSaved(true);
      toast("PIN saved.", "success");
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your PIN.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-border/60 p-6 sm:p-8">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="h-4 w-4 text-muted-foreground" /> Security PIN
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {hasPin
          ? "Quickly locks your messages and security settings after you've been away."
          : "Optional: add a quick-lock PIN for messages and security settings."}
      </p>

      <form onSubmit={submit} className="mt-4 max-w-md space-y-3">
        {hasPin ? (
          <input
            type="password"
            inputMode="numeric"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="Current PIN"
            autoComplete="off"
            aria-label="Current PIN"
            className={INPUT}
          />
        ) : null}
        <input
          type="password"
          inputMode="numeric"
          value={newPin}
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          placeholder="New 4-8 digit PIN"
          autoComplete="off"
          aria-label="New PIN"
          className={INPUT}
        />
        <input
          type="password"
          inputMode="numeric"
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          placeholder="Confirm PIN"
          autoComplete="off"
          aria-label="Confirm PIN"
          className={INPUT}
        />

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Auto-lock after being away</p>
          <div className="grid grid-cols-4 gap-1.5">
            {LOCK_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setAutoLockMinutes(m)}
                className={cn(
                  "rounded-xl py-2 text-xs font-medium transition",
                  autoLockMinutes === m ? "bg-primary text-primary-foreground" : "bg-secondary/50 text-muted-foreground hover:text-foreground",
                )}
              >
                {m}m
              </button>
            ))}
          </div>
        </div>

        <p aria-live="polite" className="min-h-4 text-xs">
          {newPin.length > 0 && !validLength ? (
            <span className="text-amber-500">4-8 digits.</span>
          ) : mismatch ? (
            <span className="text-red-400">PINs don&apos;t match yet.</span>
          ) : error ? (
            <span className="text-red-400">{error}</span>
          ) : null}
        </p>

        <button
          type="submit"
          disabled={!canSave}
          className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 active:scale-[0.99] disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? "Saved" : hasPin ? "Change PIN" : "Set PIN"}
        </button>
      </form>
    </div>
  );
}
