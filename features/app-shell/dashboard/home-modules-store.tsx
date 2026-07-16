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

  /**
   * Keys this session has deliberately toggled. Once a key is in here, no
   * server payload may ever decide it again for the life of this JS context.
   *
   * This exists because of a REAL regression (owner, 2026-07-16: "the switch to
   * hide continue watching no longer save when i leave the home page"). Leaving
   * and returning to Home is served from Next's client Router Cache
   * (staleTimes.dynamic = 6h), and that cached payload still carries the
   * PRE-toggle `hiddenModules` — it was rendered before the change. A re-seed
   * that trusts "the server said something different" therefore reads a stale
   * snapshot as news and undoes the user's own tap, which looks exactly like
   * "it didn't save" even though the PATCH succeeded.
   *
   * The previous implementation of this feature avoided the problem with a
   * `router.refresh()` after every write — which is precisely what makes Home
   * re-render on entry, the thing the owner also asked to stop. Tracking local
   * ownership instead fixes the save WITHOUT re-introducing that reload.
   */
  const locallyOwned = useRef<Set<HomeModuleKey>>(new Set());

  // Re-seed from the server only for keys this session hasn't touched — so a
  // change made elsewhere (the Home Modules Editor, another tab) still lands,
  // while a key the user just toggled here is never overwritten. Guarded on the
  // serialized value too: `initialHidden` is a fresh array every render, so a
  // naive dependency would re-run this constantly.
  const lastFromServer = useRef(initialHidden.join(","));
  useEffect(() => {
    const next = initialHidden.join(",");
    if (next === lastFromServer.current) return;
    lastFromServer.current = next;
    setHidden((cur) => {
      const owned = locallyOwned.current;
      if (owned.size === 0) return initialHidden;
      // Server decides every key we don't own; we keep our own.
      const merged = initialHidden.filter((k) => !owned.has(k));
      for (const k of cur) if (owned.has(k) && !merged.includes(k)) merged.push(k);
      return merged;
    });
  }, [initialHidden]);

  const apply = useCallback((key: HomeModuleKey, action: "hide" | "show") => {
    // This tap is now the authority for this key — see `locallyOwned`.
    locallyOwned.current.add(key);
    // Optimistic first — this is the whole point: the section appears or
    // disappears on the tap, not after a round-trip.
    setHidden((prev) =>
      action === "hide" ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key),
    );
    setPending(key);

    const body = action === "hide" ? { hideModule: key } : { showModule: key };
    void patch(body)
      .catch(() => {
        // The write failed, so this key isn't really ours — release it and roll
        // back, so the section returns to where it was and the control can
        // simply be tapped again.
        locallyOwned.current.delete(key);
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
