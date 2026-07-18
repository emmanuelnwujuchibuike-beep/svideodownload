"use client";

import { Command as CommandIcon, CornerDownLeft, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { useUser } from "@/features/auth/use-user";
import { COMMANDS } from "@/lib/navigation/registry";
import { searchNavigation, type NavViewer } from "@/lib/navigation/queries";
import { createClient } from "@/lib/supabase/client";

/**
 * Universal Command Center™ — the palette.
 *
 * Renders nothing of its own logic: every result comes from
 * `lib/navigation/queries`, so what the palette knows is exactly what the nav
 * registry knows, and the workspace switcher and adaptive nav will agree with it by
 * construction.
 *
 * ── Why it is portalled ────────────────────────────────────────────────────────
 *
 * `createPortal` to `document.body`, not an in-place fixed div. The site header
 * carries `backdrop-blur-xl`, and a filtered ancestor becomes the containing block
 * for `position: fixed` descendants — the bug that has already been fixed this way
 * on every other menu in this app. Rendering at the body escapes it entirely.
 *
 * ── Accessibility ─────────────────────────────────────────────────────────────
 *
 * A real `role="dialog" aria-modal`, a labelled combobox, `aria-activedescendant`
 * pointing at the highlighted option (so a screen reader announces the selection as
 * you arrow through it without moving DOM focus off the input), focus moved to the
 * input on open and RESTORED to the trigger on close, Escape to dismiss, and a
 * live region reporting the result count. Arrow keys wrap. Touch targets are 44px.
 */
export function CommandCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { user } = useUser();
  const { plan } = useEntitlements();
  const { resolvedTheme, setTheme } = useTheme();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocusTo = useRef<Element | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const viewer: NavViewer = useMemo(
    () => ({
      plan: plan ?? "free",
      // Admin entries are additionally gated server-side on every route they reach;
      // this flag only decides whether the palette OFFERS them. A non-admin who
      // guesses the URL is still redirected by the page itself.
      isAdmin: false,
      signedIn: !!user,
    }),
    [plan, user],
  );

  const results = useMemo(() => searchNavigation(query, viewer), [query, viewer]);

  // Clamp the highlight whenever the result set shrinks, or Enter fires on a stale
  // index and navigates somewhere the user never saw.
  useEffect(() => setActive((a) => Math.min(a, Math.max(0, results.length - 1))), [results.length]);

  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement;
    setQuery("");
    setActive(0);
    // rAF: the dialog must be in the DOM and painted before focus lands, or iOS
    // Safari drops the keyboard.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const close = useCallback(() => {
    onClose();
    // Return focus where it came from — losing it to <body> strands keyboard users.
    if (restoreFocusTo.current instanceof HTMLElement) restoreFocusTo.current.focus();
  }, [onClose]);

  const run = useCallback(
    async (index: number) => {
      const hit = results[index];
      if (!hit) return;

      if (hit.kind === "command") {
        const cmd = COMMANDS.find((c) => c.id === hit.id);
        if (cmd?.action === "toggle-theme") {
          setTheme(resolvedTheme === "dark" ? "light" : "dark");
          close();
          return;
        }
        if (cmd?.action === "copy-link") {
          try {
            await navigator.clipboard.writeText(window.location.href);
          } catch {
            /* clipboard denied — nothing to recover, and failing loudly here would
               interrupt a navigation action the user did not think was risky */
          }
          close();
          return;
        }
        if (cmd?.action === "sign-out") {
          close();
          await createClient().auth.signOut();
          router.refresh();
          return;
        }
        if (cmd?.action === "install-app") {
          close();
          return;
        }
      }

      if (hit.href) {
        close();
        router.push(hit.href);
      }
    },
    [results, close, router, setTheme, resolvedTheme],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void run(active);
    }
  };

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command center"
    >
      <button
        type="button"
        aria-label="Close command center"
        onClick={close}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search or jump to…"
            aria-label="Search or jump to"
            role="combobox"
            aria-expanded
            aria-controls="command-center-results"
            aria-activedescendant={results[active] ? `cc-opt-${results[active]!.id}` : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul
          ref={listRef}
          id="command-center-results"
          role="listbox"
          aria-label="Results"
          className="max-h-[52vh] overflow-y-auto overscroll-contain p-2"
        >
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matches for “{query}”.
            </li>
          ) : (
            results.map((r, i) => {
              const Icon = r.icon;
              return (
                <li key={r.id} data-index={i}>
                  <button
                    type="button"
                    id={`cc-opt-${r.id}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void run(i)}
                    className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                      i === active ? "bg-secondary" : ""
                    }`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.label}</span>
                      {r.hint ? (
                        <span className="block truncate text-xs text-muted-foreground">{r.hint}</span>
                      ) : null}
                    </span>
                    {i === active ? (
                      <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CommandIcon className="h-3 w-3" aria-hidden /> Navigate with ↑ ↓, open with Enter
          </span>
          <span aria-live="polite">
            {results.length} result{results.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
