"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import type { HomeModuleKey } from "@/lib/social/home-preferences";

/**
 * Client-side visibility for Home's optional sections.
 *
 * Why this exists (owner, 2026-07-16): "the turn on button takes time to load,
 * it just loads and disappears, I want it to load and show instantly."
 *
 * That was real and exactly reproducible. Module visibility was decided
 * SERVER-side (`visibleModules` in home/page.tsx filtered the list before
 * render), so the restore chip could only ever PATCH the preference and then
 * optimistically remove its own chip — the module itself couldn't come back
 * until Home was fetched again. The chip's own code said so: "The module itself
 * is server-rendered, so it appears on the next Home load — deliberately NOT a
 * router.refresh() here". So the honest description of the old behaviour is the
 * owner's: it spins, the chip vanishes, and nothing appears.
 *
 * The fix is to move the VISIBILITY decision to the client while the server
 * still renders every module. Toggling is then pure local state — instant, both
 * ways — and the PATCH is just persistence that happens behind it. A
 * `router.refresh()` would have "worked" too but would blow away the whole
 * client Router Cache, which is the cause of the separate "Home reloads on
 * every entry" bug that was fixed the same day.
 *
 * Cost: a viewer who has something hidden still pays that module's server
 * render (its children are built, then not displayed). That's one query for the
 * minority who hide anything, and zero change for the common case where nothing
 * is hidden — a good trade for a toggle that actually works.
 */

interface HomeModulesValue {
  hidden: HomeModuleKey[];
  hide: (key: HomeModuleKey) => void;
  show: (key: HomeModuleKey) => void;
  /** True while a given key's PATCH is still in flight (for a spinner). */
  pending: HomeModuleKey | null;
}

const Ctx = createContext<HomeModulesValue | null>(null);

async function patch(body: { hideModule: HomeModuleKey } | { showModule: HomeModuleKey }) {
  const res = await fetch("/api/home-preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("save failed");
}

export function HomeModulesProvider({
  initialHidden,
  children,
}: {
  initialHidden: HomeModuleKey[];
  children: ReactNode;
}) {
  const [hidden, setHidden] = useState<HomeModuleKey[]>(initialHidden);
  const [pending, setPending] = useState<HomeModuleKey | null>(null);

  // Re-seed ONLY when the server genuinely reports a different value than the
  // last one we saw from it — never on every render. `initialHidden` is a fresh
  // array each render, so a naive dependency would re-seed constantly and stomp
  // the optimistic state a tap just set. This is the same shape as the
  // version-guard in features/data/cache.ts, which exists because a slow
  // in-flight fetch resolving after an optimistic write silently reverted it.
  const lastFromServer = useRef(initialHidden.join(","));
  useEffect(() => {
    const next = initialHidden.join(",");
    if (next !== lastFromServer.current) {
      lastFromServer.current = next;
      setHidden(initialHidden);
    }
  }, [initialHidden]);

  const apply = useCallback((key: HomeModuleKey, action: "hide" | "show") => {
    // Optimistic first — this is the whole point: the section appears or
    // disappears on the tap, not after a round-trip.
    setHidden((prev) => {
      const next = action === "hide" ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key);
      return next;
    });
    setPending(key);

    const body = action === "hide" ? { hideModule: key } : { showModule: key };
    void patch(body)
      .then(() => {
        // Keep the server-seed guard in step with what we just persisted, so a
        // later RSC payload carrying the OLD value can't re-seed over it.
        setHidden((cur) => {
          lastFromServer.current = cur.join(",");
          return cur;
        });
      })
      .catch(() => {
        // Roll back — the section returns to where it was and the control can
        // simply be tapped again.
        setHidden((prev) =>
          action === "hide" ? prev.filter((k) => k !== key) : prev.includes(key) ? prev : [...prev, key],
        );
      })
      .finally(() => setPending((p) => (p === key ? null : p)));
  }, []);

  const hide = useCallback((key: HomeModuleKey) => apply(key, "hide"), [apply]);
  const show = useCallback((key: HomeModuleKey) => apply(key, "show"), [apply]);

  return <Ctx.Provider value={{ hidden, hide, show, pending }}>{children}</Ctx.Provider>;
}

/** Throws nothing when used outside the provider — Home is the only consumer,
 *  but a module component rendered elsewhere (e.g. /downloads) must not crash. */
export function useHomeModules(): HomeModulesValue {
  return (
    useContext(Ctx) ?? {
      hidden: [],
      hide: () => {},
      show: () => {},
      pending: null,
    }
  );
}

/** Renders its module only when the viewer hasn't hidden it. The children are
 *  a server-rendered subtree passed down as a prop — this gate just decides
 *  whether it's displayed. */
export function HomeModuleGate({ module, children }: { module: HomeModuleKey; children: ReactNode }) {
  const { hidden } = useHomeModules();
  if (hidden.includes(module)) return null;
  return <>{children}</>;
}
