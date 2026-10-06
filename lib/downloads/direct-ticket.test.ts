import { describe, expect, it } from "vitest";

import {
  TICKET_TTL_MS,
  directAllowedOrigin,
  directDownloadsEnabled,
  mintDirectTicket,
  verifyDirectTicket,
} from "@/lib/downloads/direct-ticket";

const SECRET = "test-secret-not-real";
const data = { url: "https://www.tiktok.com/@a/video/1", formatId: "best", kind: "video" as const, title: "clip" };
const T0 = 1_800_000_000_000;

describe("direct download tickets (FOT brief 2026-10-06)", () => {
  it("round-trips what Vercel authorised", () => {
    const { ticket } = mintDirectTicket({ data, hevc: true, ip: "1.2.3.4", maxBytes: "none" }, SECRET, T0);
    const p = verifyDirectTicket(ticket, SECRET, T0 + 1000);
    expect(p?.data).toEqual(data);
    expect(p?.hevc).toBe(true);
    expect(p?.ip).toBe("1.2.3.4");
  });

  it("refuses an altered payload — the URL or format cannot be swapped", () => {
    const { ticket } = mintDirectTicket({ data, hevc: false, ip: "x", maxBytes: "none" }, SECRET, T0);
    const [, sig] = ticket.split(".");
    const forged = Buffer.from(JSON.stringify({ data: { ...data, formatId: "bestvideo" }, hevc: false, ip: "x", exp: T0 + 9e9, n: "a" })).toString("base64url");
    expect(verifyDirectTicket(`${forged}.${sig}`, SECRET, T0)).toBeNull();
  });

  it("refuses a ticket signed with another secret", () => {
    const { ticket } = mintDirectTicket({ data, hevc: false, ip: "x", maxBytes: "none" }, "other", T0);
    expect(verifyDirectTicket(ticket, SECRET, T0)).toBeNull();
  });

  it("expires", () => {
    const { ticket } = mintDirectTicket({ data, hevc: false, ip: "x", maxBytes: "none" }, SECRET, T0);
    expect(verifyDirectTicket(ticket, SECRET, T0 + TICKET_TTL_MS - 1)).not.toBeNull();
    expect(verifyDirectTicket(ticket, SECRET, T0 + TICKET_TTL_MS)).toBeNull();
  });

  it("refuses garbage and an empty secret", () => {
    expect(verifyDirectTicket(null, SECRET)).toBeNull();
    expect(verifyDirectTicket("abc", SECRET)).toBeNull();
    expect(verifyDirectTicket("a.b", SECRET)).toBeNull();
    const { ticket } = mintDirectTicket({ data, hevc: false, ip: "x", maxBytes: "none" }, SECRET, T0);
    expect(verifyDirectTicket(ticket, "", T0)).toBeNull();
    expect(() => mintDirectTicket({ data, hevc: false, ip: "x", maxBytes: "none" }, "", T0)).toThrow();
  });

  it("is OFF unless explicitly switched on with a worker and a secret", () => {
    expect(directDownloadsEnabled({})).toBe(false);
    expect(directDownloadsEnabled({ DOWNLOAD_WORKER_URL: "https://w", WORKER_SECRET: "s" })).toBe(false);
    expect(directDownloadsEnabled({ DOWNLOAD_DIRECT: "1", WORKER_SECRET: "s" })).toBe(false);
    expect(directDownloadsEnabled({ DOWNLOAD_DIRECT: "1", DOWNLOAD_WORKER_URL: "https://w", WORKER_SECRET: "s" })).toBe(true);
  });

  it("answers CORS only for the site's own origins", () => {
    expect(directAllowedOrigin("https://frenzsave.com", {})).toBe("https://frenzsave.com");
    expect(directAllowedOrigin("https://evil.example", {})).toBeNull();
    expect(directAllowedOrigin(null, {})).toBeNull();
    expect(directAllowedOrigin("http://localhost:3124", { DOWNLOAD_DIRECT_ORIGINS: "http://localhost:3124" })).toBe("http://localhost:3124");
  });
});
