import { ArrowLeft, BadgeCheck, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AmbientWash, GLASS, GlassGroup, PersonAvatar, primaryPill, SectionHeader } from "@/features/friends/ui";
import { PRO_OPEN_TO, PRO_OPEN_TO_KEYS, type ProOpenTo } from "@/lib/social/professional/engine";
import { discoverProfessionals } from "@/lib/social/professional/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Find people", robots: { index: false, follow: false } };

const FIELD = "min-h-[2.75rem] w-full rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

/**
 * /network/discover — professional discovery (Feature 19 · Part 12).
 *
 * A plain GET form: it works before the page has hydrated (a tap is never
 * dead), every search is a URL the router cache keeps, and back returns to the
 * results instantly. Only people who allow discovery appear, never anyone
 * blocked, suspended, or hidden from strangers.
 */
export default async function DiscoverRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/network/discover");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 60) : "");
  const f = { q: one("q"), skill: one("skill"), openTo: one("open"), country: one("country"), language: one("language"), industry: one("industry"), verified: one("verified") === "1" };
  const searched = Object.entries(f).some(([, v]) => !!v);
  const { people, ready } = searched ? await discoverProfessionals(user.id, f) : { people: [], ready: true };

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <div className="relative isolate">
        <AmbientWash />
        <header className="mb-4 flex items-start gap-2 pt-1">
          <Link href="/network" aria-label="Back to your network" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] active:bg-black/[0.08]">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div>
            <h1 className="text-[clamp(1.6rem,7vw,2rem)] font-extrabold leading-none tracking-[-0.04em]">Find people</h1>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground">By skill, what they&apos;re open to, place and language.</p>
          </div>
        </header>

        <form method="get" className={cn("mb-5 grid gap-2 rounded-[22px] p-3 min-[480px]:grid-cols-2", GLASS)}>
          <label className="min-[480px]:col-span-2">
            <span className="sr-only">Role or headline</span>
            <input name="q" defaultValue={f.q} placeholder="Role or headline, e.g. product designer" className={FIELD} />
          </label>
          <label>
            <span className="sr-only">Skill</span>
            <input name="skill" defaultValue={f.skill} placeholder="Skill, e.g. Figma" className={FIELD} />
          </label>
          <label>
            <span className="sr-only">Open to</span>
            <select name="open" defaultValue={f.openTo} className={FIELD}>
              <option value="">Open to anything</option>
              {PRO_OPEN_TO_KEYS.map((k) => (
                <option key={k} value={k}>
                  {PRO_OPEN_TO[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Country</span>
            <input name="country" defaultValue={f.country} placeholder="Country" className={FIELD} />
          </label>
          <label>
            <span className="sr-only">Language</span>
            <input name="language" defaultValue={f.language} placeholder="Language" className={FIELD} />
          </label>
          <label>
            <span className="sr-only">Industry</span>
            <input name="industry" defaultValue={f.industry} placeholder="Industry" className={FIELD} />
          </label>
          <label className="flex min-h-[2.75rem] items-center gap-2 px-1 text-[14px]">
            <input type="checkbox" name="verified" value="1" defaultChecked={f.verified} className="h-4 w-4 accent-[hsl(var(--primary))]" /> Verified only
          </label>
          <button type="submit" className={cn(primaryPill, "justify-center min-[480px]:col-span-2")}>
            <Search className="h-4 w-4" aria-hidden /> Search
          </button>
        </form>

        {!ready ? <p className={cn("mb-4 rounded-2xl px-3.5 py-2.5 text-[13px]", GLASS)}>Professional search arrives with the next update.</p> : null}

        {searched ? (
          <section aria-labelledby="dc-results">
            <SectionHeader id="dc-results" title="People" count={people.length} />
            {people.length ? (
              <GlassGroup label="People">
                {people.map((p) => (
                  <li key={p.id}>
                    <Link href={`/u/${p.handle}/network`} prefetch={false} className="flex items-center gap-3 px-3.5 py-3 transition active:bg-black/[0.04]">
                      <PersonAvatar user={p} size={44} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1">
                          <span className="truncate text-[14.5px] font-semibold">{p.displayName}</span>
                          {p.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified" /> : null}
                        </span>
                        <span className="block truncate text-[12.5px] text-muted-foreground">{[p.headline, p.industry, p.country].filter(Boolean).join(" · ") || `@${p.handle}`}</span>
                        {p.openTo.length || p.skills.length ? (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {p.openTo.slice(0, 2).map((o) => (
                              <span key={o} className="rounded-full bg-emerald-500/10 px-1.5 py-px text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                                {PRO_OPEN_TO[o as ProOpenTo]}
                              </span>
                            ))}
                            {p.skills.slice(0, 3).map((s) => (
                              <span key={s} className="rounded-full bg-black/[0.05] px-1.5 py-px text-[11px] font-medium text-foreground/70 dark:bg-white/[0.08]">
                                {s}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </GlassGroup>
            ) : (
              <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>Nobody matches yet. Try fewer filters.</p>
            )}
          </section>
        ) : (
          <p className="px-1 text-[13px] text-muted-foreground">Only people who let themselves be found appear. Nobody is told you searched.</p>
        )}
      </div>
    </div>
  );
}
