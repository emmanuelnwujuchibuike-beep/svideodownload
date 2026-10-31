import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(async (k: string) => store.get(k) ?? null),
  cacheSet: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
}));
vi.mock("server-only", () => ({}));

import { googleLang, protectForGoogle, restoreFromGoogle, translateTexts } from "./machine-translate";

/**
 * The page translator's server, on Google's free web endpoint — no API key (owner, 2026-10-31: "Don't use anthropic … I
 * made translator on my other app project without any API key"). The model it replaced needed a key production never
 * had, so every language answered in English.
 */
const fetchMock = vi.fn();
const answer = (arr: unknown, status = 200) => new Response(JSON.stringify(arr), { status, headers: { "content-type": "application/json" } });
/** Google's echo for the requests below: "FR:" + the protected HTML it was sent, so the test sees what was asked */
const echo = async (_url: string, init: RequestInit) => answer(new URLSearchParams(String(init.body)).getAll("q").map((q) => `FR:${q}`));

beforeEach(() => {
  store.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("translateTexts (Google, no key)", () => {
  it("translates once, then serves everyone from the cache — one request for the whole screen", async () => {
    fetchMock.mockImplementation(echo);
    expect(await translateTexts("fr", "French", ["Download", "Upgrade to Pro", "Download"])).toEqual(["FR:Download", "FR:Upgrade to Pro", "FR:Download"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("translate.googleapis.com/translate_a/t?client=gtx&sl=en&tl=fr&format=html");
    expect(new URLSearchParams(String(init.body)).getAll("q")).toEqual(["Download", "Upgrade to Pro"]);
    fetchMock.mockClear();
    expect(await translateTexts("fr", "French", ["Upgrade to Pro"])).toEqual(["FR:Upgrade to Pro"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("🔴 brand names, {placeholders}, @handles and links are sent as translate=no and come back untouched", async () => {
    fetchMock.mockImplementation(echo);
    const sent = protectForGoogle("Share your Frenz link with {name} & @peace_ejike — https://frenzsave.com/x <b>");
    expect(sent).toBe(
      'Share your <span translate="no">Frenz</span> link with <span translate="no">{name}</span> &amp; <span translate="no">@peace_ejike</span> — <span translate="no">https://frenzsave.com/x</span> &lt;b&gt;',
    );
    // what Google really answered into Chinese on 2026-10-31, entities and all
    expect(restoreFromGoogle('分享您的<span translate="no">Frenz</span>链接 &amp; <span translate="no">{name}</span>')).toBe("分享您的Frenz链接 & {name}");
    const [out] = await translateTexts("zh", "Chinese", ["Hello {name}"]);
    expect(out).toBe("FR:Hello {name}");
  });

  it("asks Google with ITS code where ours differs", async () => {
    expect([googleLang("zh"), googleLang("he"), googleLang("fil"), googleLang("yo")]).toEqual(["zh-CN", "iw", "tl", "yo"]);
    fetchMock.mockImplementation(echo);
    await translateTexts("he", "Hebrew", ["Search"]);
    expect(fetchMock.mock.calls[0]![0]).toContain("&tl=iw&");
  });

  it("teeth: a wrong count, an error status or a network failure leaves the English and caches nothing", async () => {
    fetchMock.mockResolvedValueOnce(answer(["only one"]));
    expect(await translateTexts("fr", "French", ["A b", "C d"])).toEqual(["A b", "C d"]);
    fetchMock.mockResolvedValueOnce(answer({ error: 1 }, 429));
    expect(await translateTexts("fr", "French", ["A b"])).toEqual(["A b"]);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await translateTexts("fr", "French", ["A b"])).toEqual(["A b"]);
    expect(store.size).toBe(0);
  });

  it("an empty translation keeps the original for that string; a [translation, source] pair is read too", async () => {
    fetchMock.mockResolvedValueOnce(answer(["", ["Rechercher", "en"]]));
    expect(await translateTexts("fr", "French", ["Keep me", "Search"])).toEqual(["Keep me", "Rechercher"]);
  });

  it("long screens are split by characters as well as by count", async () => {
    fetchMock.mockImplementation(echo);
    const long = Array.from({ length: 10 }, (_, i) => `${"word ".repeat(150)}${i}`);
    await translateTexts("fr", "French", long);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("no Anthropic anywhere in the translator (owner: 'Don't use anthropic')", () => {
    // the code, not the comments that tell the history
    const src = readFileSync("lib/i18n/machine-translate.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/@anthropic-ai|ANTHROPIC_API_KEY|claude-/i);
    expect(src).toContain("translate.googleapis.com/translate_a/t");
  });
});
