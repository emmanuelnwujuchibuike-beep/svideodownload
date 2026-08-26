"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import { useCallback, useState } from "react";

import { Portal } from "@/components/ui/portal";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE CLIENT HALF OF THE SENSITIVE-ACTION GATE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A sensitive admin route answers `403 { code: "REAUTH_REQUIRED" }` when the
 * administrator's last password entry is stale. Without this, that response
 * would surface as a generic failure and the operator would see a button that
 * simply does not work.
 *
 * `sensitiveFetch` performs the request, and if the server asks for a password
 * it raises the prompt, waits, re-authenticates, and REPLAYS the original
 * request. The caller writes one `await` and never handles the case.
 *
 * ── 🔴 The server is what decides, always ─────────────────────────────────
 *
 * This component never checks whether re-auth is needed — it only reacts to the
 * server saying so. A client-side "has it been ten minutes?" timer would be
 * both wrong (clocks drift, tabs sleep) and pointless (skippable). The cookie
 * is HttpOnly, so this code could not read the marker even if it wanted to.
 *
 * ── Why the password never lands in component state for longer than a tick ──
 *
 * It goes into the prompt's own state, is posted to `/api/admin/auth/reauth`,
 * and the state is cleared as soon as the promise settles. Nothing persists it.
 */
export function useSensitiveAction() {
  const [prompt, setPrompt] = useState<null | {
    resolve: (ok: boolean) => void;
  }>(null);

  /** Raise the prompt and resolve once the operator succeeds or cancels. */
  const askForPassword = useCallback(
    () => new Promise<boolean>((resolve) => setPrompt({ resolve })),
    [],
  );

  /**
   * `fetch`, with the re-authentication handshake built in.
   *
   * Retries the original request EXACTLY once after a successful re-auth. Once,
   * not in a loop: if the server still says REAUTH_REQUIRED after a fresh
   * password, something is wrong with the marker rather than with the operator,
   * and retrying forever would just spin.
   */
  const sensitiveFetch = useCallback(
    async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
      const run = () => fetch(input, { credentials: "same-origin", ...init });

      let res = await run();
      if (res.status !== 403) return res;

      const body = (await res
        .clone()
        .json()
        .catch(() => ({}))) as { code?: string };
      if (body.code !== "REAUTH_REQUIRED") return res;

      const confirmed = await askForPassword();
      if (!confirmed) return res;

      res = await run();
      return res;
    },
    [askForPassword],
  );

  const node = prompt ? (
    <ReauthPrompt
      onDone={(ok) => {
        prompt.resolve(ok);
        setPrompt(null);
      }}
    />
  ) : null;

  return { sensitiveFetch, reauthPrompt: node };
}

function ReauthPrompt({ onDone }: { onDone: (ok: boolean) => void }) {
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
