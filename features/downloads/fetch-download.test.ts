import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client-lazy", () => ({
  getClient: async () => ({ auth: { getSession: async () => ({ data: { session: sessionToken ? { access_token: sessionToken } : null } }) } }),
}));
let sessionToken: string | null = null;

import { fetchDownload } from "@/features/downloads/fetch-download";
import { directDownloadBody, DOWNLOAD_ORIGIN } from "@/features/downloads/worker-direct";

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  sessionToken = null;
});

/*
  2026-10-08: the default is now browser → worker in ONE request (no ticket,
  no Vercel). The ticket tests below describe the kill-switch path
  (NEXT_PUBLIC_DOWNLOAD_DIRECT=0), which must still never touch Vercel's proxy.
*/
describe("worker-direct (the default): one request to the worker, never Vercel", () => {
  const WORKER = `${DOWNLOAD_ORIGIN}/api/download`;

  it("POSTs the download as a CORS-simple text/plain body to the worker", async () => {
    const calls: { u: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      calls.push({ u, init });
      return new Response("bytes");
    }));
    const res = await fetchDownload("/api/download?url=https%3A%2F%2Fx.com%2Fa&formatId=f1&kind=video&t=T1&hevc=1", new AbortController().signal);
    expect(await res.text()).toBe("bytes");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.u).toBe(WORKER);
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.headers).toEqual({ "Content-Type": "text/plain;charset=UTF-8" });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ url: "https://x.com/a", formatId: "f1", kind: "video", t: "T1", hevc: true });
  });

  it("a signed-in member's token rides in the BODY, never the URL", async () => {
    sessionToken = "eyJ.member.token";
    const calls: { u: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      calls.push({ u, init });
      return new Response("bytes");
    }));
    await fetchDownload("/api/download?url=u&formatId=f&kind=video", new AbortController().signal);
    expect(calls[0]!.u).not.toContain("token");
    expect(JSON.parse(String(calls[0]!.init?.body)).accessToken).toBe("eyJ.member.token");
  });

  it("worker unreachable (or a pre-direct worker mid-deploy): the ticket door — bytes still from the worker, never via the Vercel proxy", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      calls.push(u);
      if (u === WORKER) throw new TypeError("Failed to fetch");
      if (u === TICKET) return new Response("bytes");
      return ticketResponse();
    }));
    const res = await fetchDownload("/api/download?url=u&formatId=f", new AbortController().signal);
    expect(await res.text()).toBe("bytes");
    expect(calls).toEqual([WORKER, "/api/download?url=u&formatId=f&direct=1", TICKET]);
    expect(calls).not.toContain("/api/download?url=u&formatId=f");
  });

  it("a pre-direct worker's 403 (no CORS header) is recognised and routed to the ticket door", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      calls.push(u);
      if (u === WORKER) return new Response(JSON.stringify({ error: "Forbidden", code: "INTERNAL" }), { status: 403, headers: { "content-type": "application/json" } });
      if (u === TICKET) return new Response("bytes");
      return ticketResponse();
    }));
    const res = await fetchDownload("/api/download?url=u&formatId=f", new AbortController().signal);
    expect(await res.text()).toBe("bytes");
    expect(calls).toEqual([WORKER, "/api/download?url=u&formatId=f&direct=1", TICKET]);
  });

  it("our JSON refusal (429 daily cap) is returned as-is, not retried", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      n += 1;
      return new Response(JSON.stringify({ error: "Daily download limit reached" }), { status: 429, headers: { "content-type": "application/json" } });
    }));
    const res = await fetchDownload("/api/download?url=u&formatId=f", new AbortController().signal);
    expect(res.status).toBe(429);
    expect(n).toBe(1);
  });

  it("forwards only the manager's own parameters", () => {
    expect(directDownloadBody("/api/download?rewardToken=R&itemIndex=2&b=B&evil=1&direct=1", null)).toEqual({ rewardToken: "R", itemIndex: "2", b: "B" });
  });
});

describe("fetchDownload — the kill switch (NEXT_PUBLIC_DOWNLOAD_DIRECT=0), ticket path", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DOWNLOAD_DIRECT", "0"));
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
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DOWNLOAD_DIRECT", "0"));
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
