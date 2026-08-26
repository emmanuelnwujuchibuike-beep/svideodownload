"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { Portal } from "@/components/ui/portal";
import { cn } from "@/lib/utils";

/**
 * The password prompt raised by useSensitiveAction().
 *
 * Split into its OWN module so it can be dynamically imported: it renders only
 * when the server answers REAUTH_REQUIRED, which is rare, and the admin route
 * is at its weight ceiling. Keeping it in the hook module put the modal, its
 * icons and the portal in the initial /admin bundle for every operator who
 * never triggers it. Same reasoning as the install modal and the Multi-Link
 * panel elsewhere in this codebase.
 */
export function ReauthPrompt({ onDone }: { onDone: (ok: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Incorrect password.");
        setBusy(false);
        return;
      }
      // Cleared before the promise resolves, so it never outlives the prompt.
      setPassword("");
      onDone(true);
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  };

  /*
    🔴 PORTALLED. A `fixed` overlay resolves against the nearest ancestor
    carrying a transform/filter/backdrop-filter, and the admin shell has several
    — this is the clipped-overlay bug this project has hit three times. See
    components/ui/portal.tsx.
  */
  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm your password"
        className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      >
        <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-2xl">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold">Confirm your password</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                This action changes sensitive settings.
              </p>
            </div>
          </div>

          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            disabled={busy}
            aria-label="Password"
            className="mt-4 h-12 w-full rounded-xl bg-background px-3.5 text-base outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary disabled:opacity-60"
          />

          {error ? (
            <p role="alert" className="mt-2 text-sm font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => onDone(false)}
              className="h-11 flex-1 rounded-xl border border-border bg-background text-sm font-semibold transition hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !password}
              className={cn(
                "inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-sm font-semibold text-white transition disabled:opacity-60",
              )}
            >
              {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
              Confirm
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
