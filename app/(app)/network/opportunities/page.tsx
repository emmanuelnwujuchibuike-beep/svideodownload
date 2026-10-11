import { ArrowLeft, ExternalLink, MapPin, MessageCircle, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AmbientWash, GLASS, GlassGroup, PersonAvatar, quietPill, SectionHeader } from "@/features/friends/ui";
import { OpportunityForm } from "@/features/network/opportunity-form";
import { OPPORTUNITY_KINDS, type OpportunityKind } from "@/lib/social/professional/engine";
import { listOpportunities } from "@/lib/social/professional/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Opportunities", robots: { index: false, follow: false } };

const FIELD = "min-h-[2.75rem] w-full rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

/**
 * /network/opportunities — open positions, internships, freelance, volunteer,
 * partnership, research and creator roles (Feature 19 · Part 12). Applying is a
 * message to the person who posted it, or their own https link. No tracking of
 * who looked.
 */
export default async function OpportunitiesRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/network/opportunities");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 60) : "");
  const f = { kind: one("kind"), q: one("q"), remote: one("remote") === "1" };
  const { items, ready } = await listOpportunities(user.id, f);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <div className="relative isolate">
        <AmbientWash />
        <header className="mb-4 flex items-start gap-2 pt-1">
          <Link href="/network" aria-label="Back to your network" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] active:bg-black/[0.08]">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div>
            <h1 className="text-[clamp(1.6rem,7vw,2rem)] font-extrabold leading-none tracking-[-0.04em]">Opportunities</h1>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground">Roles, projects and partnerships from people on Frenz.</p>
          </div>
        </header>

        <form method="get" className={cn("mb-5 grid gap-2 rounded-[22px] p-3 min-[480px]:grid-cols-[1fr_auto]", GLASS)}>
          <input name="q" aria-label="Search" defaultValue={f.q} placeholder="Search titles, places" className={FIELD} />
          <select name="kind" aria-label="Kind" defaultValue={f.kind} className={FIELD}>
            <option value="">Every kind</option>
            {(Object.keys(OPPORTUNITY_KINDS) as OpportunityKind[]).map((k) => (
              <option key={k} value={k}>
                {OPPORTUNITY_KINDS[k]}
              </option>
            ))}
          </select>
          <label className="flex min-h-[2.75rem] items-center gap-2 px-1 text-[14px]">
            <input type="checkbox" name="remote" value="1" defaultChecked={f.remote} className="h-4 w-4 accent-[hsl(var(--primary))]" /> Remote
          </label>
          <button type="submit" className={cn(quietPill, "justify-center")}>
            <Search className="h-4 w-4" aria-hidden /> Search
          </button>
        </form>

        <section className="mb-6" aria-labelledby="op-list">
          <SectionHeader id="op-list" title="Open now" count={items.length} />
          {items.length ? (
            <GlassGroup label="Open opportunities">
              {items.map((o) => (
                <li key={o.id} className="px-3.5 py-3">
                  <p className="text-[15px] font-semibold leading-snug">{o.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted-foreground">
                    <span>{OPPORTUNITY_KINDS[o.kind as OpportunityKind] ?? o.kind}</span>
                    {o.location || o.remote ? (
                      <span className="inline-flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" aria-hidden /> {[o.location, o.remote ? "Remote" : null].filter(Boolean).join(", ")}
                      </span>
                    ) : null}
                  </p>
                  {o.description ? <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-[13.5px]">{o.description}</p> : null}
                  {o.owner ? (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <Link href={`/u/${o.owner.handle}/network`} prefetch={false} className="flex min-w-0 items-center gap-2 rounded-xl transition active:opacity-70">
                        <PersonAvatar user={o.owner} size={36} />
                        <span className="truncate text-[13px] font-medium">{o.owner.displayName}</span>
                      </Link>
                      <span className="flex-1" />
                      {o.owner.id !== user.id ? (
                        <Link href={`/messages/new/${o.owner.id}`} prefetch={false} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                          <MessageCircle className="h-4 w-4" aria-hidden /> Message
                        </Link>
                      ) : null}
                      {o.link ? (
                        <a href={o.link} target="_blank" rel="nofollow noopener noreferrer" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                          Details <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </GlassGroup>
          ) : (
            <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>{ready ? "Nothing open matches right now." : "Opportunities arrive with the next update."}</p>
          )}
        </section>

        <section className="mb-8">
          <OpportunityForm ready={ready} />
        </section>
      </div>
    </div>
  );
}
