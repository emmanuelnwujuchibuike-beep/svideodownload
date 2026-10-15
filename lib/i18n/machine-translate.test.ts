import { beforeEach, describe, expect, it, vi } from "vitest";

/** The server half: one model call per new string per language, then the shared cache; never a broken page. */
const store = new Map<string, unknown>();
vi.mock("@/lib/cache", () => ({
  cacheGet: async (k: string) => store.get(k) ?? null,
  cacheSet: async (k: string, v: unknown) => void store.set(k, v),
}));

const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status = 500;
  }
  class RateLimitError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    beta = { messages: { parse } };
  }
  return { default: Anthropic };
});

const { translateTexts } = await import("./machine-translate");

const answer = (translations: string[], stop_reason = "end_turn") => ({ stop_reason, parsed_output: { translations } });

describe("translateTexts", () => {
  beforeEach(() => {
    store.clear();
    parse.mockReset();
    process.env.ANTHROPIC_API_KEY = "test";
  });

  it("translates once, then serves everyone from the cache", async () => {
    parse.mockResolvedValueOnce(answer(["Télécharger", "Enregistrer"]));
    expect(await translateTexts("fr", "French", ["Download", "Save", "Download"])).toEqual(["Télécharger", "Enregistrer", "Télécharger"]);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0]![0].messages[0].content).toContain('["Download","Save"]'); // duplicates sent once
    expect(await translateTexts("fr", "French", ["Save"])).toEqual(["Enregistrer"]);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("asks with the default model, low effort, structured output and the refusal fallback on", async () => {
    parse.mockResolvedValueOnce(answer(["Hola"]));
    await translateTexts("es", "Spanish", ["Hello"]);
    const req = parse.mock.calls[0]![0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.output_config.effort).toBe("low");
    expect(req.output_config.format).toBeTruthy();
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
  });

  it("teeth: a wrong count, a refusal or an error leaves the English and caches nothing", async () => {
    parse.mockResolvedValueOnce(answer(["Uno"])); // 1 for 2
    expect(await translateTexts("es", "Spanish", ["One", "Two"])).toEqual(["One", "Two"]);
    parse.mockResolvedValueOnce(answer(["Uno", "Dos"], "refusal"));
    expect(await translateTexts("es", "Spanish", ["One", "Two"])).toEqual(["One", "Two"]);
    parse.mockRejectedValueOnce(new Error("network"));
    expect(await translateTexts("es", "Spanish", ["One", "Two"])).toEqual(["One", "Two"]);
    expect(store.size).toBe(0);
  });

  it("an empty translation keeps the original for that string", async () => {
    parse.mockResolvedValueOnce(answer(["", "Dos"]));
    expect(await translateTexts("es", "Spanish", ["One", "Two"])).toEqual(["One", "Dos"]);
  });

  it("no API key: English, and no call", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await translateTexts("es", "Spanish", ["One"])).toEqual(["One"]);
    expect(parse).not.toHaveBeenCalled();
  });
});
