import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchDownload } from "@/features/downloads/fetch-download";

/**
 * FOT brief (owner, 2026-10-06): a download's bytes come from the worker
 * directly when the server hands out a ticket. Owner, 2026-10-08: a failure is
 * retried at the worker with a fresh ticket — never through the Vercel proxy.
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

  it("worker unreachable: ONE fresh ticket and the worker again — never the Vercel proxy (owner, 2026-10-08)", async () => {
    const calls: string[] = [];
    let workerTries = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      calls.push(u);
      if (u === TICKET) {
        workerTries += 1;
        if (workerTries === 1) throw new TypeError("Failed to fetch");
        return new Response("bytes");
      }
      return ticketResponse();
    }));
    const res = await fetchDownload("/api/download?url=x", new AbortController().signal);
    expect(await res.text()).toBe("bytes");
    expect(calls).toEqual(["/api/download?url=x&direct=1", TICKET, "/api/download?url=x&direct=1", TICKET]);
  });

  it("worker unreachable twice: an honest 503 JSON error, still no request without direct=1", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      calls.push(u);
      if (u === TICKET) throw new TypeError("Failed to fetch");
      return ticketResponse();
    }));
    const res = await fetchDownload("/api/download?url=x", new AbortController().signal);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("DOWNLOAD_FAILED");
    expect(calls.filter((u) => u === "/api/download?url=x")).toHaveLength(0);
  });

  it("never follows a ticket that is not https", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      calls.push(u);
      return ticketResponse("javascript:alert(1)");
    }));
    const res = await fetchDownload("/api/download?url=x", new AbortController().signal);
    expect(res.status).toBe(503);
    expect(calls.every((u) => u === "/api/download?url=x&direct=1")).toBe(true);
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

describe("a broken direct door gets one more ticket, never Vercel", () => {
  it("a 404 / gateway page from the worker is retried once with a fresh ticket", async () => {
    for (const bad of [
      new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } }),
      new Response("<html>502</html>", { status: 502, headers: { "content-type": "text/html" } }),
    ]) {
      const calls: string[] = [];
      let n = 0;
      vi.stubGlobal("fetch", vi.fn(async (u: string) => {
        calls.push(u);
        if (u === TICKET) return n++ === 0 ? bad : new Response("bytes");
        return ticketResponse();
      }));
      const res = await fetchDownload("/api/download?url=x", new AbortController().signal);
      expect(await res.text()).toBe("bytes");
      expect(calls).toHaveLength(4);
      expect(calls).not.toContain("/api/download?url=x");
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
