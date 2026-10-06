import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchDownload } from "@/features/downloads/fetch-download";

/**
 * FOT brief (owner, 2026-10-06): a download's bytes come from the worker
 * directly when the server hands out a ticket, and from the old proxied path
 * whenever anything about the direct path does not work.
 */

const TICKET = "https://worker.example/api/download/direct?ticket=abc";

function ticketResponse(url: unknown = TICKET): Response {
  return new Response(JSON.stringify({ url, expiresAt: "x" }), {
    status: 200,
    headers: { "content-type": "application/json", "x-frenz-direct": "1" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchDownload", () => {
  it("asks for a ticket and takes it straight to the worker", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      calls.push(u);
      return u === TICKET ? new Response("bytes") : ticketResponse();
    }));
    const res = await fetchDownload("/api/download?url=x&t=1", new AbortController().signal);
    expect(await res.text()).toBe("bytes");
    expect(calls).toEqual(["/api/download?url=x&t=1&direct=1", TICKET]);
  });

  it("a server with the switch off streams as before — one request, no second hop", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      calls.push(u);
      return new Response("bytes", { headers: { "content-type": "video/mp4" } });
    }));
    const res = await fetchDownload("/api/download?url=x", new AbortController().signal);
    expect(await res.text()).toBe("bytes");
    expect(calls).toHaveLength(1);
  });

  it("falls back to the proxied path when the worker cannot be reached (CORS / network)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      calls.push(u);
      if (u === TICKET) throw new TypeError("Failed to fetch");
      return u.endsWith("&direct=1") ? ticketResponse() : new Response("proxied");
    }));
    const res = await fetchDownload("/api/download?url=x", new AbortController().signal);
    expect(await res.text()).toBe("proxied");
    expect(calls).toEqual(["/api/download?url=x&direct=1", TICKET, "/api/download?url=x"]);
  });

  it("never follows a ticket that is not https", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      calls.push(u);
      return u.endsWith("&direct=1") ? ticketResponse("javascript:alert(1)") : new Response("proxied");
    }));
    await fetchDownload("/api/download?url=x", new AbortController().signal);
    expect(calls).toEqual(["/api/download?url=x&direct=1", "/api/download?url=x"]);
  });

  it("passes a refusal (429) straight back for its own message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Daily download limit reached" }), { status: 429 })));
    const res = await fetchDownload("/api/download?url=x", new AbortController().signal);
    expect(res.status).toBe(429);
  });

  it("leaves a same-origin wallpaper path alone", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      calls.push(u);
      return new Response("img");
    }));
    await fetchDownload("/api/wallpaper?id=a&dl=1", new AbortController().signal);
    expect(calls).toEqual(["/api/wallpaper?id=a&dl=1"]);
  });
});

describe("a broken direct door never fails a download", () => {
  it("a 404 / gateway page from the worker falls back to the proxied path", async () => {
    for (const bad of [
      new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } }),
      new Response("<html>502</html>", { status: 502, headers: { "content-type": "text/html" } }),
    ]) {
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (u: string) => {
        calls.push(u);
        if (u === TICKET) return bad;
        return u.endsWith("&direct=1") ? ticketResponse() : new Response("proxied");
      }));
      const res = await fetchDownload("/api/download?url=x", new AbortController().signal);
      expect(await res.text()).toBe("proxied");
      expect(calls).toHaveLength(3);
    }
  });

  it("our own JSON refusal from the worker is shown, not retried through Vercel", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) =>
      u === TICKET
        ? new Response(JSON.stringify({ error: "too large", code: "FILE_TOO_LARGE" }), { status: 413, headers: { "content-type": "application/json" } })
        : ticketResponse(),
    ));
    const res = await fetchDownload("/api/download?url=x", new AbortController().signal);
    expect(res.status).toBe(413);
  });
});
