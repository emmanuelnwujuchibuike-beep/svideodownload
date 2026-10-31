import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

/*
  Owner, 2026-10-31: "when users sign in on pwa the theme should be set to default light mode not auto". The default is
  light in all three layers (they must agree or the theme flashes on boot), and a stored "system" counts only when the
  toggle wrote it — every first visit used to write "system" automatically.
*/
const boot = readFileSync("features/app-shell/boot-splash.tsx", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");

function fakeStorage(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

/** The pre-paint script's own `mode()`, run as written. */
function bootMode(store: ReturnType<typeof fakeStorage>): string {
  const src = /function mode\(\)\{[\s\S]*?\}catch\(e\)\{return '[a-z]+'\}\}/.exec(boot)?.[0];
  if (!src) throw new Error("mode() not found in THEME_JS");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function("localStorage", "MODE", `${src}; return mode();`)(store, "frenz-theme-mode") as string;
}

const CASES: [string, Record<string, string>, string][] = [
  ["a brand-new device", {}, "light"],
  ["an automatic 'system' (every old first visit wrote one)", { "frenz-theme-mode": "system" }, "light"],
  ["a 'system' the toggle wrote (Auto, chosen)", { "frenz-theme-mode": "system", "frenz-theme-chosen": "1" }, "system"],
  ["a stored dark", { "frenz-theme-mode": "dark" }, "dark"],
  ["a stored light", { "frenz-theme-mode": "light" }, "light"],
];

describe("light is the default theme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each(CASES)("boot script: %s → %s", (_name, init, want) => {
    const store = fakeStorage(init);
    expect(bootMode(store)).toBe(want);
    if (want === "light") expect(store.dump()["frenz-theme-mode"]).toBe("light");
  });

  it.each(CASES)("React side: %s → %s (the same answer, so nothing flashes)", async (_name, init, want) => {
    vi.stubGlobal("localStorage", fakeStorage(init));
    const { getCachedThemeMode } = await import("./theme-mode-client");
    expect(getCachedThemeMode()).toBe(want);
  });

  it("a choice made with the toggle is remembered as a choice", async () => {
    const store = fakeStorage({});
    vi.stubGlobal("localStorage", store);
    const { setThemeModeLocal } = await import("./theme-mode-client");
    setThemeModeLocal("system");
    expect(store.dump()).toMatchObject({ "frenz-theme-mode": "system", "frenz-theme-chosen": "1" });
    expect(bootMode(store)).toBe("system");
  });

  it("next-themes' own fallback agrees", () => {
    expect(layout).toMatch(/defaultTheme="light"/);
    expect(layout).not.toMatch(/defaultTheme="system"/);
  });

  it("teeth: the old boot default (auto) fails", () => {
    const old = "function mode(){try{var v=localStorage.getItem(MODE);if(v)return v;localStorage.setItem(MODE,'system');return 'system'}catch(e){return 'system'}}";
    const run = new Function("localStorage", "MODE", `${old}; return mode();`) as (s: unknown, k: string) => string;
    expect(run(fakeStorage({}), "frenz-theme-mode")).not.toBe("light");
  });
});
