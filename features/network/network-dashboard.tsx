"use client";

import { ArrowLeft, Award, BookOpen, Briefcase, Check, CheckCircle2, ChevronDown, Circle, Compass, Download, FileText, GraduationCap, Handshake, IdCard, Lightbulb, Quote, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { networkPost, PersonLine, roleLabel } from "@/features/network/shared";
import { useStickyState } from "@/features/ui/use-sticky-state";
import { AmbientWash, GLASS, GlassGroup, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import { haptic } from "@/lib/motion/haptics";
import { OPPORTUNITY_KINDS, PRO_OPEN_TO, PRO_OPEN_TO_KEYS, REC_KINDS, relationshipHistory, ROLE_GROUP, type OpportunityKind, type ProOpenTo } from "@/lib/social/professional/engine";
import type { NetworkDashboard, ProConnection, ProRecommendation } from "@/lib/social/professional/server";
import { cn } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";

/**
 * Professional Network™ — the member's own dashboard (Feature 19 · Part 12).
 *
 * Calm on purpose: no follower counts, no "people viewed you" hooks, no
 * score. What you're open to, who confirmed working with you, what people
 * wrote about you (shown only once you approve it), your career as a
 * timeline, and a private checklist of what builds trust. Every control
 * answers on the tap and puts itself back if the server refuses.
 */

const TIMELINE_ICON = { experience: Briefcase, education: GraduationCap, certification: Award, award: Award, publication: BookOpen, project: Lightbulb, connection: Handshake, recommendation: Quote } as const;
const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function NetworkDashboard({ initial }: { initial: NetworkDashboard }) {
  // sticky: a back-swipe replays the cached payload, and the member's changes must survive it
  const [d, setD] = useStickyState("nw-dashboard", initial.loadedAt, initial);
  const dRef = useRef(d);
  dRef.current = d;
  const [note, setNote] = useState<string | null>(initial.ready ? null : "Connections, recommendations and opportunities arrive with the next update.");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [industry, setIndustry] = useState(initial.me.industry ?? "");
  const [open, setOpen] = useState<string | null>(null);

  /** Draw the change, send it, put it back on refusal. */
  const act = async (draw: (x: NetworkDashboard) => NetworkDashboard, body: Record<string, unknown>) => {
    const before = dRef.current;
    haptic("selection");
    setD(draw(before));
    setNote(null);
    const out = await networkPost(body);
    if (out.error) {
      setD(before);
      setNote(out.error);
    }
  };

  const toggleOpen = (k: ProOpenTo) => {
    const next = d.me.openTo.includes(k) ? d.me.openTo.filter((x) => x !== k) : [...d.me.openTo, k];
    void act((x) => ({ ...x, me: { ...x.me, openTo: next } }), { op: "profile", openTo: next });
  };

  const respond = (c: ProConnection, action: "accept" | "decline" | "withdraw" | "end") =>
    void act(
      (x) => {
        const rest = { incoming: x.incoming.filter((y) => y.id !== c.id), outgoing: x.outgoing.filter((y) => y.id !== c.id), connections: x.connections.filter((y) => y.id !== c.id) };
        return { ...x, ...rest, connections: action === "accept" ? [{ ...c, status: "accepted", respondedAt: new Date().toISOString() }, ...rest.connections] : rest.connections };
      },
      { op: "respond", id: c.id, action },
    );

  const decide = (r: ProRecommendation, action: "show" | "hide" | "delete") =>
    void act(
      (x) => ({ ...x, recommendationsReceived: action === "delete" ? x.recommendationsReceived.filter((y) => y.id !== r.id) : x.recommendationsReceived.map((y) => (y.id === r.id ? { ...y, status: action === "show" ? "shown" : "hidden" } : y)) }),
      { op: "decide", id: r.id, action },
    );

  const groups = useMemo(() => {
    const g = { colleagues: 0, mentors: 0, clients: 0, hiring: 0, investment: 0, partners: 0 };
    for (const c of d.connections) g[ROLE_GROUP[c.theirRole]]++;
    return g;
  }, [d.connections]);
  const pendingRecs = d.recommendationsReceived.filter((r) => r.status === "pending");
  const shownRecs = d.recommendationsReceived.filter((r) => r.status !== "pending");
  const met = d.trust.filter((t) => t.met).length;
  const suggestions = d.suggestions.filter((s) => !dismissed.includes(s.id));

  return (
    <div className="relative isolate">
      <AmbientWash />
      <header className="mb-5 flex items-start gap-2 pt-1">
        <Link href="/friends" aria-label="Back" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] active:bg-black/[0.08] dark:hover:bg-white/[0.06]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-[clamp(1.6rem,7vw,2rem)] font-extrabold leading-none tracking-[-0.04em]">Professional network</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">Work, mentors, clients and opportunities. Nothing here is a score.</p>
        </div>
      </header>

      <nav aria-label="Network" className="mb-5 flex flex-wrap gap-2">
        <Link href="/network/discover" prefetch={false} className={primaryPill}>
          <Compass className="h-4 w-4" aria-hidden /> Find people
        </Link>
        <Link href="/network/opportunities" prefetch={false} className={quietPill}>
          <Briefcase className="h-4 w-4" aria-hidden /> Opportunities
        </Link>
        {d.me.handle ? (
          <>
            <Link href={`${profilePath(d.me.handle)}/network`} prefetch={false} className={quietPill}>
              <FileText className="h-4 w-4" aria-hidden /> Your public page
            </Link>
            <Link href={`${profilePath(d.me.handle)}/card`} prefetch={false} className={quietPill}>
              <IdCard className="h-4 w-4" aria-hidden /> Business card
            </Link>
          </>
        ) : null}
      </nav>

      <div aria-live="polite">{note ? <p className={cn("mb-4 rounded-2xl px-3.5 py-2.5 text-[13px]", GLASS)}>{note}</p> : null}</div>

      {/* Collaboration status */}
      <section className="mb-6" aria-labelledby="nw-open">
        <SectionHeader id="nw-open" title="Open to" />
        <div className={cn("rounded-[22px] px-3.5 py-3", GLASS)}>
          <div className="flex flex-wrap gap-1.5">
            {PRO_OPEN_TO_KEYS.map((k) => {
              const on = d.me.openTo.includes(k);
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => toggleOpen(k)} disabled={!d.ready} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]", on && "bg-primary/10 text-primary dark:bg-primary/20")}>
                  {on ? <Check className="h-3.5 w-3.5" aria-hidden /> : null} {PRO_OPEN_TO[k]}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">Shown on your public page, and it&apos;s how the right people find you. Turn any of it off at any time.</p>
          <form
            className="mt-3 flex gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]"
            onSubmit={(e) => {
              e.preventDefault();
              void act((x) => ({ ...x, me: { ...x.me, industry: industry.trim() || null } }), { op: "profile", industry: industry.trim() || null });
            }}
          >
            <label htmlFor="nw-industry" className="sr-only">
              Industry
            </label>
            <input id="nw-industry" value={industry} maxLength={60} onChange={(e) => setIndustry(e.target.value)} placeholder="Your industry, e.g. Fintech" className="min-h-[2.5rem] min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40" disabled={!d.ready} />
            <button type="submit" className={quietPill} disabled={!d.ready || industry.trim() === (d.me.industry ?? "")}>
              Save
            </button>
          </form>
        </div>
      </section>

      {/* Network Dashboard */}
      <section aria-label="Your network" className="mb-6 grid grid-cols-3 gap-2">
        {(
          [
            ["Connections", d.connections.length],
            ["Colleagues", groups.colleagues],
            ["Mentors", groups.mentors],
            ["Clients", groups.clients],
            ["Recommendations", shownRecs.filter((r) => r.status === "shown").length],
            ["Endorsed skills", d.endorsements.length],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className={cn("rounded-2xl px-3 py-2.5", GLASS)}>
            <span className="block text-[20px] font-extrabold tabular-nums leading-tight">{n}</span>
            <span className="block truncate text-[12px] font-medium text-muted-foreground">{label}</span>
          </div>
        ))}
      </section>

      {/* Requests */}
      {d.incoming.length || d.outgoing.length ? (
        <section className="mb-6" aria-labelledby="nw-requests">
          <SectionHeader id="nw-requests" title="Requests" count={d.incoming.length} />
          <GlassGroup label="Requests">
            {d.incoming.map((c) => (
              <li key={c.id} className="px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <PersonLine p={c.person} href={`${profilePath(c.person.handle)}/network`} sub={`Says they were your ${roleLabel(c.theirRole, c.customLabel).toLowerCase()}${c.context ? `, ${c.context}` : ""}`} />
                </div>
                {c.note ? <p className="mt-2 rounded-xl bg-black/[0.03] px-3 py-2 text-[13px] dark:bg-white/[0.05]">{c.note}</p> : null}
                <div className="mt-2 flex gap-2 pl-14">
                  <button type="button" className={cn(primaryPill, "min-h-[2.25rem] px-3.5 text-[12.5px]")} onClick={() => respond(c, "accept")}>
                    Confirm
                  </button>
                  <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")} onClick={() => respond(c, "decline")}>
                    Not right
                  </button>
                </div>
              </li>
            ))}
            {d.outgoing.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3.5 py-3">
                <PersonLine p={c.person} href={`${profilePath(c.person.handle)}/network`} sub={`Waiting for them to confirm: ${roleLabel(c.theirRole, c.customLabel)}`} />
                <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")} onClick={() => respond(c, "withdraw")}>
                  Withdraw
                </button>
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      {/* Recommendations to review */}
      {pendingRecs.length ? (
        <section className="mb-6" aria-labelledby="nw-review">
          <SectionHeader id="nw-review" title="To review" count={pendingRecs.length} />
          <GlassGroup label="Recommendations to review">
            {pendingRecs.map((r) => (
              <li key={r.id} className="px-3.5 py-3">
                <PersonLine p={r.person} href={`${profilePath(r.person.handle)}/network`} sub={`${REC_KINDS[r.kind]} for you`} />
                <blockquote className="mt-2 whitespace-pre-line rounded-xl bg-black/[0.03] px-3 py-2 text-[13.5px] leading-relaxed dark:bg-white/[0.05]">{r.body}</blockquote>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={cn(primaryPill, "min-h-[2.25rem] px-3.5 text-[12.5px]")} onClick={() => decide(r, "show")}>
                    Show on my page
                  </button>
                  <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")} onClick={() => decide(r, "hide")}>
                    Keep private
                  </button>
                  <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")} onClick={() => decide(r, "delete")}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
                  </button>
                </div>
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      {/* AI Network Assistant */}
      {suggestions.length ? (
        <section className="mb-6" aria-labelledby="nw-assist">
          <SectionHeader id="nw-assist" title="People worth knowing" />
          <GlassGroup label="People worth knowing">
            {suggestions.map((s) => (
              <li key={s.id} className="px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <PersonLine p={s.person} href={`${profilePath(s.person.handle)}/network`} />
                  <button type="button" aria-label={`Not now: ${s.person.displayName}`} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] active:bg-black/[0.08]" onClick={() => setDismissed((x) => [...x, s.id])}>
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <ul className="mt-1.5 flex flex-wrap gap-1.5 pl-14">
                  {s.reasons.map((r) => (
                    <li key={r} className="inline-flex items-center gap-1 rounded-full bg-primary/[0.08] px-2 py-0.5 text-[12px] font-medium text-primary">
                      <Lightbulb className="h-3 w-3" aria-hidden /> {r}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </GlassGroup>
          <p className="mt-1.5 px-1 text-[12px] text-muted-foreground">Each one says why. Only public profile facts and confirmed relationships are used.</p>
        </section>
      ) : null}

      {/* Connections + Business relationship history */}
      <section className="mb-6" aria-labelledby="nw-conn">
        <SectionHeader id="nw-conn" title="Connections" count={d.connections.length} />
        {d.connections.length ? (
          <GlassGroup label="Connections">
            {d.connections.map((c) => {
              const expanded = open === c.id;
              const history = relationshipHistory({
                requestedAt: c.createdAt,
                acceptedAt: c.respondedAt,
                recommendations: [...d.recommendationsReceived.filter((r) => r.person.id === c.person.id && r.status === "shown").map((r) => ({ at: r.createdAt, fromMe: false, kind: r.kind })), ...d.recommendationsGiven.filter((r) => r.person.id === c.person.id).map((r) => ({ at: r.createdAt, fromMe: true, kind: r.kind }))],
                endorsements: [],
              });
              return (
                <li key={c.id}>
                  <div className="flex items-center gap-2 px-3.5 py-2.5">
                    <PersonLine p={c.person} href={`${profilePath(c.person.handle)}/network`} sub={`${roleLabel(c.theirRole, c.customLabel)}${c.context ? `, ${c.context}` : ""}`} />
                    <button type="button" aria-expanded={expanded} aria-label={`History with ${c.person.displayName}`} onClick={() => setOpen(expanded ? null : c.id)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] active:bg-black/[0.08]">
                      <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} aria-hidden />
                    </button>
                  </div>
                  {expanded ? (
                    <div className="border-t border-black/[0.06] px-3.5 py-3 dark:border-white/[0.07]">
                      <ol className="space-y-1.5">
                        {history.map((h, i) => (
                          <li key={i} className="flex justify-between gap-3 text-[13px]">
                            <span>{h.label}</span>
                            <time dateTime={h.at} className="shrink-0 text-muted-foreground" suppressHydrationWarning>
                              {fmt(h.at)}
                            </time>
                          </li>
                        ))}
                      </ol>
                      <button type="button" className={cn(quietPill, "mt-3 min-h-[2.25rem] px-3 text-[12.5px]")} onClick={() => respond(c, "end")}>
                        End this connection
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </GlassGroup>
        ) : (
          <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>
            Nobody yet. Open someone&apos;s professional page and ask them to confirm how you worked together.
          </p>
        )}
      </section>

      {/* Career Timeline */}
      <section className="mb-6" aria-labelledby="nw-career">
        <SectionHeader
          id="nw-career"
          title="Career timeline"
          action={
            <Link href="/account/professional" prefetch={false} className="text-[13px] font-semibold text-primary">
              Edit
            </Link>
          }
        />
        {d.timeline.length ? (
          <ol className={cn("rounded-[22px] px-3.5 py-3", GLASS)}>
            {d.timeline.map((t, i) => {
              const Icon = TIMELINE_ICON[t.kind];
              return (
                <li key={t.key} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < d.timeline.length - 1 ? <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-px bg-black/10 dark:bg-white/10" /> : null}
                  <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[14px] font-semibold leading-snug">{t.title}</p>
                    {t.sub || t.when ? <p className="text-[12.5px] text-muted-foreground">{[t.sub, t.when].filter(Boolean).join(" · ")}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>Add your experience, education and certifications to your profile, and they appear here in order.</p>
        )}
      </section>

      {/* Professional Reputation: private checklist */}
      <section className="mb-6" aria-labelledby="nw-trust">
        <SectionHeader id="nw-trust" title="What builds trust" />
        <div className={cn("rounded-[22px] px-3.5 py-3", GLASS)}>
          <p className="text-[13px] text-muted-foreground">
            Only you see this. {met} of {d.trust.length} in place. It never ranks you against anyone.
          </p>
          <ul className="mt-2 space-y-2">
            {d.trust.map((t) => (
              <li key={t.key} className="flex gap-2.5">
                {t.met ? <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-emerald-500" aria-label="Done" /> : <Circle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-muted-foreground/60" aria-label="Not yet" />}
                <span>
                  <span className="block text-[14px] font-medium">{t.label}</span>
                  {!t.met ? <span className="block text-[12.5px] text-muted-foreground">{t.how}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Endorsements received */}
      {d.endorsements.length ? (
        <section className="mb-6" aria-labelledby="nw-endorse">
          <SectionHeader id="nw-endorse" title="Endorsed skills" />
          <GlassGroup label="Endorsed skills">
            {d.endorsements.map((e) => (
              <li key={e.skill} className="px-3.5 py-2.5">
                <p className="text-[14px] font-semibold">
                  {e.skill} <span className="font-normal text-muted-foreground">· {e.count === 1 ? "1 person" : `${e.count} people`}</span>
                </p>
                <p className="truncate text-[12.5px] text-muted-foreground">{e.people.map((p) => p.displayName).join(", ")}</p>
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      {/* Your opportunities */}
      <section className="mb-6" aria-labelledby="nw-opps">
        <SectionHeader
          id="nw-opps"
          title="Your opportunities"
          action={
            <Link href="/network/opportunities#post" prefetch={false} className="text-[13px] font-semibold text-primary">
              Post one
            </Link>
          }
        />
        {d.opportunities.length ? (
          <GlassGroup label="Your opportunities">
            {d.opportunities.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{o.title}</span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    {OPPORTUNITY_KINDS[o.kind as OpportunityKind] ?? o.kind} · {o.status === "open" ? "Open" : "Closed"}
                  </span>
                </span>
                <button
                  type="button"
                  className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}
                  onClick={() => void act((x) => ({ ...x, opportunities: x.opportunities.map((y) => (y.id === o.id ? { ...y, status: o.status === "open" ? "closed" : "open" } : y)) }), { op: "opportunity", id: o.id, status: o.status === "open" ? "closed" : "open" })}
                >
                  {o.status === "open" ? "Close" : "Reopen"}
                </button>
                <button type="button" aria-label={`Delete ${o.title}`} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-black/[0.04] active:bg-black/[0.08]" onClick={() => void act((x) => ({ ...x, opportunities: x.opportunities.filter((y) => y.id !== o.id) }), { op: "opportunity_delete", id: o.id })}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </GlassGroup>
        ) : (
          <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>Hiring, or looking for a partner or a volunteer? Post it, and people who are open to it can find it.</p>
        )}
      </section>

      {/* Recommendations you approved, and the export */}
      {shownRecs.length ? (
        <section className="mb-6" aria-labelledby="nw-recs">
          <SectionHeader id="nw-recs" title="Recommendations" />
          <GlassGroup label="Recommendations">
            {shownRecs.map((r) => (
              <li key={r.id} className="px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <PersonLine p={r.person} href={`${profilePath(r.person.handle)}/network`} sub={`${REC_KINDS[r.kind]}${r.status === "hidden" ? " · private" : ""}`} />
                  <button type="button" className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")} onClick={() => decide(r, r.status === "shown" ? "hide" : "show")}>
                    {r.status === "shown" ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="mt-1.5 line-clamp-3 whitespace-pre-line pl-14 text-[13px] text-foreground/80">{r.body}</p>
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      <section className="mb-8" aria-labelledby="nw-export">
        <SectionHeader id="nw-export" title="Take it with you" />
        <a href="/api/network/export" className={cn(quietPill, "w-full justify-center")} download>
          <Download className="h-4 w-4" aria-hidden /> Export your network (JSON)
        </a>
        <p className="mt-1.5 px-1 text-[12px] text-muted-foreground">Connections, recommendations both ways, endorsements, your career history and opportunities.</p>
      </section>
    </div>
  );
}
