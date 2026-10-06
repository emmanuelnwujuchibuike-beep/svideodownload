/**
 * The download's bytes — from the worker DIRECTLY when the server allows it.
 *
 * FOT brief (owner, 2026-10-06). `/api/download` used to pipe every byte from
 * the Railway worker through Vercel. With `direct=1` the server still does
 * every check (rate limit, daily quota, reward redemption, analytics), then
 * answers a small JSON ticket instead of the file (`x-frenz-direct: 1`); the
 * worker verifies the ticket's signature and streams to the browser itself.
 *
 * A server without the switch on ignores `direct=1` and streams as before, so
 * this is safe to ship first. If the worker cannot be reached directly (CORS,
 * network) the SAME request is made without `direct=1` — the old path. That
 * costs no second quota unit (`t` is the receipt) and no second ad (a reward
 * item may be re-redeemed by design, reward-sessions.ts Part 19).
 */
export async function fetchDownload(target: string, signal: AbortSignal): Promise<Response> {
  if (!target.startsWith("/api/download?")) return fetch(target, { signal });
  const res = await fetch(`${target}&direct=1`, { signal });
  if (!res.ok || res.headers.get("x-frenz-direct") !== "1") return res;
  let ticketUrl: string | null = null;
  try {
    const body = (await res.json()) as { url?: unknown };
    ticketUrl = typeof body.url === "string" && /^https:\/\//.test(body.url) ? body.url : null;
  } catch {
    /* unreadable ticket — fall through to the proxied path */
  }
  if (ticketUrl) {
    try {
      return await fetch(ticketUrl, { signal, mode: "cors", credentials: "omit" });
    } catch (e) {
      if (signal.aborted) throw e;
      /* the worker is not reachable from here — the proxied path below */
    }
  }
  return fetch(target, { signal });
}
