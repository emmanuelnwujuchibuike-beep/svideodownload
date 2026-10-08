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
 * this is safe to ship first.
 *
 * 🔴 NO VERCEL FALLBACK FOR THE BYTES (owner, 2026-10-08: "don't add Vercel to
 * the Download path or include Vercel fast origin to it"). This used to retry
 * WITHOUT `direct=1` whenever the worker could not be reached — which streams
 * every byte back through Vercel, the exact cost the direct path exists to
 * remove, and on the same flaky network it rarely helped. Now a failed direct
 * attempt asks for a FRESH ticket once and goes to the worker again (a deploy
 * restart or a dropped connection is usually gone by then); if that fails too,
 * the download fails honestly with our own JSON error. The second ticket costs
 * no second quota unit (`t` is the receipt) and no second ad (a reward item may
 * be re-redeemed by design, reward-sessions.ts Part 19).
 */
const DIRECT_ATTEMPTS = 2;

function unreachable(): Response {
  return new Response(JSON.stringify({ error: "We couldn't reach the download server. Please try again.", code: "DOWNLOAD_FAILED" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

export async function fetchDownload(target: string, signal: AbortSignal): Promise<Response> {
  if (!target.startsWith("/api/download?")) return fetch(target, { signal });
  for (let attempt = 0; attempt < DIRECT_ATTEMPTS; attempt++) {
    const res = await fetch(`${target}&direct=1`, { signal });
    if (!res.ok || res.headers.get("x-frenz-direct") !== "1") return res;
    let ticketUrl: string | null = null;
    try {
      const body = (await res.json()) as { url?: unknown };
      ticketUrl = typeof body.url === "string" && /^https:\/\//.test(body.url) ? body.url : null;
    } catch {
      /* unreadable ticket — ask for another */
    }
    if (!ticketUrl) continue;
    try {
      const direct = await fetch(ticketUrl, { signal, mode: "cors", credentials: "omit" });
      /*
        Use the worker's answer when it is the file, or one of OUR refusals (JSON:
        too large, rate limited, expired). Anything else — a 404 from a worker
        mid-deploy, a gateway's HTML error page — is worth one more ticket.
      */
      if (direct.ok || (direct.headers.get("content-type") ?? "").includes("application/json")) return direct;
    } catch (e) {
      if (signal.aborted) throw e;
      /* not reachable this time — one more ticket, then an honest failure */
    }
  }
  return unreachable();
}
