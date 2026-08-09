"use client";

import { AlertCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { Downloader } from "@/features/downloader/downloader";
import { sourceUrlSchema } from "@/lib/validation";

/**
 * The result of a link submitted from the hero CTA — shown right where the
 * visitor was looking.
 *
 * ── Two entry points, two results (owner, 2026-08-09) ─────────────────────────
 * "users who use below download section should get review from the below
 * section but users who use the button should get a different review that
 * appears at below the wallpaper button."
 *
 * Both used to land in the same place: the hero CTA submitted `?url=`, which is
 * the PWA Share Target's parameter, so its result appeared inside the purple
 * download card under the phone mockup — a scroll away from the button that had
 * just been tapped, past the whole mockup. The two paths are now told apart by
 * WHICH parameter carries the link:
 *
 *   ?paste=…  → the hero CTA        → renders here, under Wallpaper Gallery
 *   ?url=…    → PWA / shared link   → renders in the download section below
 *
 * Separate parameters rather than a `?from=hero` flag, because the parameter IS
 * the routing decision: each tool reads its own and ignores the other, so
 * neither can accidentally claim the other's link and there is no shared state
 * between them to get out of step.
 *
 * ── Why it renders nothing until there is a link ──────────────────────────────
 * The overwhelming majority of visitors never submit anything, and an empty
 * panel wedged between the CTA stack and the trust row would push the page down
 * for all of them to serve none of them. No parameter, no markup, no layout.
 *
 * Must sit inside <Suspense>: useSearchParams() suspends during prerender, and
 * the boundary is what keeps `/` statically generated. The fallback is `null`,
 * which is also the state for every visitor without a link — so the static HTML
 * and the hydrated page agree and nothing shifts.
 */
export function HeroLinkDownloader() {
  const raw = useSearchParams().get("paste")?.trim();
  if (!raw) return null;

  /*
    Validated here, with the same schema the server uses, because `Downloader`
    treats `initialUrl` as already-checked and fetches it on mount. A hand-typed
    or truncated `?paste=` would otherwise go straight to the extractor and come
    back as a generic failure.
  */
  const parsed = sourceUrlSchema.safeParse(raw);

  return (
    <div id="hero-result" className="mt-4 scroll-mt-28">
      {parsed.success ? (
        <Downloader initialUrl={parsed.data} resultOnly />
      ) : (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.04] p-4 text-left"
        >
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/12 text-red-500">
            <AlertCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white">That doesn&apos;t look like a link</p>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-white/60">
              {parsed.error.issues[0]?.message ?? "Paste the full address of the post, starting with https://"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
