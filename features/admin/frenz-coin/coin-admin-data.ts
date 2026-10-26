"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
  Frenz Coin Part 6 — the console's reads and writes.

  Reads (useAdminRead): fetched when a tab first opens, never on a timer. "Refresh" and a successful action re-read in
  the background while the last answer stays on screen; a newer read aborts the older one, and a stale answer can
  never overwrite a newer one (sequence check). Leaving the tab aborts what is in flight.

  Writes (postMoney): through the dashboard's sensitiveFetch (a fresh password when the server asks — REAUTH_REQUIRED
  is answered with the prompt and the request replayed once). A money request is NEVER aborted once sent. Duplicate
  presses are blocked by the caller's busy flag and, where the route supports it, by a replay key generated once per
  intended action and reused on retry.
*/

export type ReadState<T> = { data: T | null; error: string | null; loading: boolean; refreshing: boolean };

export function useAdminRead<T>(url: string | null) {
  const [state, setState] = useState<ReadState<T>>({ data: null, error: null, loading: !!url, refreshing: false });
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!url) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: s.data === null, refreshing: s.data !== null, error: null }));
    try {
      const res = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: c.signal });
      const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
      if (mine !== seq.current) return;
      if (!res.ok) setState((s) => ({ ...s, loading: false, refreshing: false, error: body?.error ?? (res.status === 403 ? "Administrators only." : "Couldn't load this.") }));
      else setState({ data: body as T, error: null, loading: false, refreshing: false });
    } catch {
      if (c.signal.aborted || mine !== seq.current) return;
      setState((s) => ({ ...s, loading: false, refreshing: false, error: "Couldn't reach the server. Check your connection." }));
    }
  }, [url]);

  useEffect(() => {
    void load();
    return () => ctrl.current?.abort();
  }, [load]);

  return { ...state, reload: load };
}

export type MoneyResult<T> = { ok: true; data: T } | { ok: false; error: string; reason: string | null; status: number };
type SensitiveFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

/** One money action. Never throws, never aborted. A REAUTH_REQUIRED that the operator cancels is reported plainly. */
export async function postMoney<T>(sensitiveFetch: SensitiveFetch, url: string, body?: unknown): Promise<MoneyResult<T>> {
  let res: Response;
  try {
    res = await sensitiveFetch(url, { method: "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, error: "Couldn't reach the server. Nothing is known to have changed — check the list before trying again.", reason: "network", status: 0 };
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string; reason?: string; code?: string }) | null;
  if (res.ok) return { ok: true, data: json as T };
  if (json?.code === "REAUTH_REQUIRED") return { ok: false, error: "Password not confirmed — nothing was changed.", reason: "reauth", status: res.status };
  // a bare 403 means the request arrived without an admin session — e.g. the admin password was just changed, which
  // signs out every other session (owner, 2026-10-25: "forbidden … because I changed admin password")
  if (res.status === 403 && (json?.error === "Forbidden" || !json?.error)) return { ok: false, error: "Your admin session changed (for example after a password change). Refresh the page, sign in again, and save once more — nothing was changed.", reason: "session", status: 403 };
  return { ok: false, error: json?.error ?? "Couldn't complete that. Nothing was changed.", reason: json?.reason ?? null, status: res.status };
}

/** A replay key for one intended action: the same while the operator retries the same thing, new for anything else. */
export function useReplayKey() {
  const k = useRef<{ sig: string; key: string } | null>(null);
  return useCallback((sig: string) => {
    if (!k.current || k.current.sig !== sig) k.current = { sig, key: `adm_${crypto.randomUUID().replace(/-/g, "")}` };
    return k.current.key;
  }, []);
}
