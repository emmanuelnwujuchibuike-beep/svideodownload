import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { browserCorsHeaders, readTextJson, trustedClientIp } from "./browser-direct";

/**
 * The worker answers the browser directly (2026-10-08). What keeps that from
 * being a way around the limits: the IP it keys on is the edge's, every check
 * runs on the worker, and only the site's origins get CORS.
 */
describe("browser-direct calls to the worker", () => {
  it("keys limits on the edge's IP, never on the first X-Forwarded-For hop the browser wrote", () => {
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 102.89.1.2" }))).toBe("102.89.1.2");
    expect(trustedClientIp(new Headers({ "x-real-ip": "102.89.1.2", "x-forwarded-for": "6.6.6.6" }))).toBe("102.89.1.2");
    expect(trustedClientIp(new Headers())).toBe("anonymous");
  });

  it("answers CORS only for the site's own origins, with no credentials", () => {
    const ok = browserCorsHeaders(new Request("https://w.example/api/download", { headers: { origin: "https://frenzsave.com" } }));
    expect(ok["Access-Control-Allow-Origin"]).toBe("https://frenzsave.com");
    expect(ok).not.toHaveProperty("Access-Control-Allow-Credentials");
    const evil = browserCorsHeaders(new Request("https://w.example/api/download", { headers: { origin: "https://evil.example" } }));
    expect(evil).not.toHaveProperty("Access-Control-Allow-Origin");
  });

  it("reads a text/plain JSON body and refuses anything else", async () => {
    expect(await readTextJson(new Request("https://w/x", { method: "POST", body: '{"url":"u"}' }))).toEqual({ url: "u" });
    expect(await readTextJson(new Request("https://w/x", { method: "POST", body: "[1]" }))).toBeNull();
    expect(await readTextJson(new Request("https://w/x", { method: "POST", body: "x".repeat(20_000) }))).toBeNull();
  });

  it("the download route runs EVERY check on a secret-less call: reward redemption, the daily cap with the verified member, the limiter", () => {
    const src = readFileSync(join(process.cwd(), "app/api/download/route.ts"), "utf8");
    expect(src).toContain("if (isBrowserDirectCall(request)) return browserDirectDownload(request);");
    const fn = src.slice(src.indexOf("async function browserDirectDownload"), src.indexOf("export function OPTIONS"));
    expect(fn).toContain("const clientIp = trustedClientIp(request.headers);");
    expect(fn).toContain("const userId = await userIdFromAccessToken(body.accessToken);");
    expect(fn).toContain("await redeemRewardItem({");
    expect(fn).toContain("await enforceDailyCap(request, clientIp, idParam(body.t), idParam(body.b), data, userId);");
    // processDownload runs the per-IP limiter first
    expect(fn).toContain("return processDownload(data, clientIp, body.hevc === true, false, maxBytes, cors);");
  });

  it("the metadata route keys its limiter on the trusted IP for a secret-less call", () => {
    const src = readFileSync(join(process.cwd(), "app/api/metadata/route.ts"), "utf8");
    expect(src).toContain("const id = browser ? trustedClientIp(request.headers) : clientId(request.headers);");
  });
});
