"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

/*
  🔴 CODE-SPLIT, and the route budget is why.

  The prompt renders only when the server answers REAUTH_REQUIRED — rare by
  construction. Keeping it in this module put the modal, its two icons and the
  portal into /admin's initial bundle for every operator who never triggers it,
  and pushed the route 364 bytes over its ceiling. `next/dynamic` fetches it on
  the first prompt instead.

  No `ssr: false` needed: nothing renders until `prompt` is non-null, so the
  JSX is never reached during a server pass and the chunk stays out of the
  route manifest. Same pattern as the install modal and the Multi-Link panel.
*/
const ReauthPrompt = dynamic(() =>
  import("@/features/admin/reauth-prompt").then((m) => m.ReauthPrompt),
);

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

