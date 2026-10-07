import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/* Part 7 §56: sign-out drops the service worker's image cache — by a prefix that must match the worker's own name. */
const ROOT = path.resolve(__dirname, "../..");
const signOut = readFileSync(path.join(ROOT, "lib/auth/sign-out.ts"), "utf8");
const swConfig = readFileSync(path.join(ROOT, "public/sw/config.js"), "utf8");

describe("sign-out forgets cached private images", () => {
  it("is called from signOutClient", () => {
    const body = signOut.slice(signOut.indexOf("export async function signOutClient"));
    expect(body).toMatch(/forgetCachedImages\(\);/);
  });

  it("the prefix it deletes is the worker's image cache name (teeth: a renamed cache would be missed)", () => {
    const prefix = /n\.startsWith\("([^"]+)"\)/.exec(signOut)?.[1];
    const swName = /SWX\.IMAGE_CACHE = `([^$`]+)\$\{SWX\.VERSION\}`/.exec(swConfig)?.[1];
    expect(prefix).toBeTruthy();
    expect(swName).toBe(prefix);
  });

  it("the worker caches no API answer and no private page", () => {
    expect(swConfig).toMatch(/SWX\.API_CACHE_ALLOWLIST = \[\];/);
    const pages = /SWX\.PAGE_CACHE_ALLOWLIST_PREFIXES = \[([^\]]*)\]/.exec(swConfig)?.[1] ?? "";
    for (const priv of ["/ai", "/studio", "/messages", "/home", "/account", "/admin", "/history"]) expect(pages).not.toContain(`"${priv}`);
  });
});
