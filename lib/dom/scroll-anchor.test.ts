import { afterEach, describe, expect, it, vi } from "vitest";

import { readAnchor } from "./scroll-anchor";
import { anchorTarget, restoreToAnchor } from "./scroll-anchor-restore";

/**
 * Owner, 2026-10-15: "when am in feed page watch something and goes to a different page and
 * come back it starts to lag and come down to where I was slowly … and also doesn't get it
 * accurately". The return lands on the same POST, and stays on it as the media above loads.
 */
const ATTR = "data-feed-post";

/** A tiny page: cards stacked from `top` (document coordinates), each `h` tall. */
function page(cards: { id: string; h: number }[], scrollY: () => number, top = 60) {
  const els = () => {
    let y = top;
    return cards.map((c) => {
      const at = y;
      y += c.h;
      return {
        getAttribute: () => c.id,
        getBoundingClientRect: () => ({ top: at - scrollY(), bottom: at + c.h - scrollY() }),
      };
    });
  };
  return {
    querySelectorAll: () => els(),
    querySelector: (sel: string) => els().find((e) => sel.includes(`"${e.getAttribute()}"`)) ?? null,
  } as unknown as ParentNode;
}

describe("readAnchor / anchorTarget", () => {
  it("the reader's place is the first card crossing the probe line, and how far into it they are", () => {
    const root = page([{ id: "a", h: 500 }, { id: "b", h: 400 }, { id: "c", h: 600 }], () => 700);
    // a: 60..560, b: 560..960, c: 960..1560 → at scrollY 700, b is at -140..260
    expect(readAnchor(ATTR, 72, root)).toEqual({ id: "b", offset: -140 });
  });

  it("🔴 media above sizing itself moves the target with it: the same post, not the same pixel", () => {
    const anchor = { id: "b", offset: -140 };
    const before = page([{ id: "a", h: 500 }, { id: "b", h: 400 }], () => 0);
    expect(anchorTarget(anchor, ATTR, 0, before)).toBe(700);
    // the photo in "a" arrives 300 px taller than its placeholder
    const after = page([{ id: "a", h: 800 }, { id: "b", h: 400 }], () => 0);
    expect(anchorTarget(anchor, ATTR, 0, after)).toBe(1000);
  });

  it("teeth: a post no longer on the page gives no target (the saved pixel is the fallback)", () => {
    expect(anchorTarget({ id: "gone", offset: 0 }, ATTR, 0, page([{ id: "a", h: 500 }], () => 0))).toBeNull();
  });
});

describe("restoreToAnchor", () => {
  afterEach(() => vi.unstubAllGlobals());

  function browser() {
    const listeners = new Map<string, () => void>();
    const observers: (() => void)[] = [];
    const win = {
      scrollY: 0,
      scrollTo: vi.fn(({ top }: { top: number }) => {
        win.scrollY = top;
      }),
      addEventListener: (t: string, f: () => void) => listeners.set(t, f),
      removeEventListener: (t: string) => listeners.delete(t),
      setTimeout: (f: () => void) => setTimeout(f, 10_000) as unknown as number,
      clearTimeout: (id: number) => clearTimeout(id),
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", { body: {} });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: () => void) {}
        observe() {
          observers.push(() => this.cb());
        }
        disconnect() {
          observers.length = 0;
        }
      },
    );
    return { win, listeners, resize: () => observers.forEach((f) => f()) };
  }

  it("lands on the post ONCE, and corrects only when the page changes size — no frame loop", () => {
    const b = browser();
    const cards = [{ id: "a", h: 500 }, { id: "b", h: 400 }];
    const stop = restoreToAnchor({ anchor: { id: "b", offset: -140 }, fallbackY: 999, attr: ATTR, scope: () => page(cards, () => b.win.scrollY) });
    expect(b.win.scrollY).toBe(700);
    expect(b.win.scrollTo).toHaveBeenCalledTimes(1);
    cards[0]!.h = 800; // the photo above loads
    b.resize();
    expect(b.win.scrollY).toBe(1000);
    b.resize(); // a resize that moved nothing scrolls nothing
    expect(b.win.scrollTo).toHaveBeenCalledTimes(2);
    stop();
  });

  // owner, 2026-10-28: the return glided through the feed (html has `scroll-behavior: smooth`, which "auto" obeys),
  // loading every card's media on the way — it must JUMP
  it("jumps instantly — never a smooth glide past every post above", () => {
    const b = browser();
    const cards = [{ id: "a", h: 500 }, { id: "b", h: 400 }];
    const stop = restoreToAnchor({ anchor: { id: "b", offset: 0 }, fallbackY: 0, attr: ATTR, scope: () => page(cards, () => b.win.scrollY) });
    expect(b.win.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "instant" }));
    stop();
  });

  it("the reader's first touch ends it: a later resize no longer moves the page", () => {
    const b = browser();
    const cards = [{ id: "a", h: 500 }, { id: "b", h: 400 }];
    restoreToAnchor({ anchor: { id: "b", offset: 0 }, fallbackY: 0, attr: ATTR, scope: () => page(cards, () => b.win.scrollY) });
    b.listeners.get("touchstart")!();
    cards[0]!.h = 900;
    b.resize();
    expect(b.win.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("no saved post (an older snapshot) falls back to the saved pixel", () => {
    const b = browser();
    restoreToAnchor({ anchor: null, fallbackY: 420, attr: ATTR, scope: () => page([], () => 0) });
    expect(b.win.scrollY).toBe(420);
  });
});
