import { Eye, X } from "lucide-react";
import Link from "next/link";

import { PREVIEWABLE_ROLES, roleLabel, type ViewerRole } from "@/lib/profile/audience";
import { cn } from "@/lib/utils";

/**
 * Profile Preview — see your own profile as someone else does
 * (Feature 18 · Part 16, completing what Part 14 declared).
 *
 * ── Why this is worth building ────────────────────────────────────────────────
 * Part 14 gave every section a per-audience visibility rule, and Part 16 lets a
 * member restyle the whole thing. Both are invisible to the person configuring
 * them: the owner ALWAYS sees everything, including empty sections and sections
 * gated to friends. There was no way to answer "what does a stranger actually
 * see?" short of signing out — so the honest answer is that most people never
 * checked, and a section silently hidden from everyone looked fine from inside.
 *
 * ── It is a real render, not a simulation ─────────────────────────────────────
 * `?preview=<role>` feeds the role straight into `resolveProfileLayout`, the
 * same resolver a real visitor's request runs through. Nothing is mocked, so the
 * preview cannot drift from reality — if it shows a section, a visitor gets that
 * section.
 *
 * ── Safety ────────────────────────────────────────────────────────────────────
 * Server-side this ONLY applies on your own profile, and only for the roles in
 * `PREVIEWABLE_ROLES` — which excludes owner and admin. It can therefore only
 * ever REDUCE what is rendered: there is no value of `?preview=` that shows more
 * than the viewer is entitled to, so it is not an access-control surface. It
 * needs no permission of its own beyond already being the owner.
 *
 * Server component — no client JS. Each role is a plain link.
 */
export function ProfilePreviewBar({
  handle,
  active,
  visibleCount,
}: {
  handle: string;
  /** The role being previewed, or null when viewing normally as yourself. */
  active: ViewerRole | null;
  /** How many sections this role can actually see — the whole point. */
  visibleCount: number;
}) {
  return (
    <div className="mx-auto mb-3 w-full max-w-3xl px-4 sm:px-6">
      <div
        className={cn(
          "rounded-2xl border px-3.5 py-3",
          active ? "border-amber-500/40 bg-amber-500/[0.07]" : "border-border/70 bg-secondary/40",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            <Eye className="h-3.5 w-3.5" /> Preview as
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            {PREVIEWABLE_ROLES.map((role) => {
              const on = active === role;
              return (
                <Link
                  key={role}
                  href={on ? `/u/${handle}` : `/u/${handle}?preview=${role}`}
                  scroll={false}
                  aria-pressed={on}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                    on ? "bg-brand-tile text-white shadow-sm" : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {roleLabel(role)}
                </Link>
              );
            })}
          </div>

          {active ? (
            <Link
              href={`/u/${handle}`}
              scroll={false}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <X className="h-3 w-3" /> Exit preview
            </Link>
          ) : null}
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {active ? (
            <>
              You&apos;re seeing your profile as{" "}
              <span className="font-semibold text-foreground">{roleLabel(active).toLowerCase()}</span> would —{" "}
              <span className="font-semibold text-foreground">
                {visibleCount} section{visibleCount === 1 ? "" : "s"}
              </span>{" "}
              visible. Empty sections are hidden from visitors even when they&apos;re switched on.
            </>
          ) : (
            <>Only you can see this bar. Pick a role to check what other people actually get.</>
          )}
        </p>
      </div>
    </div>
  );
}
