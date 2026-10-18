"use client";

import { ArrowLeft, Award, BadgeCheck, BookOpen, Briefcase, Check, ExternalLink, GraduationCap, Handshake, IdCard, Lightbulb, MapPin, MessageCircle, Plus, Quote } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { networkPost, PersonLine, roleLabel } from "@/features/network/shared";
import { useStickyState } from "@/features/ui/use-sticky-state";
import { AmbientWash, GLASS, GlassGroup, PersonAvatar, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import { haptic } from "@/lib/motion/haptics";
import { OPPORTUNITY_KINDS, PRO_OPEN_TO, PRO_ROLE_KEYS, PRO_ROLES, REC_KINDS, REC_MAX, REC_MIN, ROLE_INVERSES, type OpportunityKind, type ProRole, type RecKind } from "@/lib/social/professional/engine";
import type { PublicNetwork } from "@/lib/social/professional/server";
import { cn } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";

/**
 * Someone's professional page (Feature 19 · Part 12): what they're open to,
 * their skills with endorsements, recommendations they approved, their career
 * (only the sections their profile shows THIS viewer), connections (when their
 * friend-list setting allows), and their open opportunities.
 *
 * Connect asks them to confirm how you worked together, naming both sides.
 * Endorse and Recommend are only offered to people who know them.
 */

const TIMELINE_ICON = { experience: Briefcase, education: GraduationCap, certification: Award, award: Award, publication: BookOpen, project: Lightbulb, connection: Handshake, recommendation: Quote } as const;

export function PublicNetworkPage({ data }: { data: PublicNetwork }) {
  // sticky per person: a back-swipe replays the cached payload, and endorsements must survive it
  const [skills, setSkills] = useStickyState(`pn-skills-${data.person.id}`, data.loadedAt, data.skills);
  const skillsRef = useRef(skills);
  skillsRef.current = skills;
  const [conn, setConn] = useStickyState(`pn-conn-${data.person.id}`, data.loadedAt, data.viewer.connection);
  const [note, setNote] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "connect" | "recommend">("none");
  const p = data.person;

  const endorse = async (skill: string, on: boolean) => {
    const before = skillsRef.current;
    haptic("selection");
    setSkills(before.map((s) => (s.skill === skill ? { ...s, endorsedByViewer: on, count: s.count + (on ? 1 : -1) } : s)));
    const out = await networkPost({ op: "endorse", subjectId: p.id, skill, on });
    if (out.error) {
      setSkills(before);
      setNote(out.error);
    }
  };

  return (
    <div className="relative isolate">
      <AmbientWash />
      <header className="mb-4 flex items-start gap-2 pt-1">
        <Link href={`${profilePath(p.handle)}`} aria-label="Back to profile" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] active:bg-black/[0.08]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PersonAvatar user={p} size={52} />
          <div className="min-w-0">
            <h1 className="flex items-center gap-1 text-[22px] font-extrabold leading-tight tracking-[-0.03em]">
              <span className="truncate">{p.displayName}</span>
              {p.verified ? <BadgeCheck className="h-5 w-5 shrink-0 text-primary" aria-label="Verified" /> : null}
            </h1>
            <p className="truncate text-[13.5px] text-muted-foreground">{[p.headline, data.industry].filter(Boolean).join(" · ") || `@${p.handle}`}</p>
          </div>
        </div>
      </header>

      {data.openTo.length ? (
        <ul className="mb-4 flex flex-wrap gap-1.5" aria-label="Open to">
          {data.openTo.map((o) => (
            <li key={o} className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">
              {PRO_OPEN_TO[o]}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Actions */}
      <div className="mb-5 flex flex-wrap gap-2">
        {data.viewer.isOwner ? (
          <Link href="/network" prefetch={false} className={primaryPill}>
            Your network dashboard
          </Link>
        ) : !data.viewer.signedIn ? (
          <Link href={`/login?next=${profilePath(p.handle)}/network`} prefetch={false} className={primaryPill}>
            Sign in to connect
          </Link>
        ) : conn?.status === "accepted" ? (
          <span className={cn(quietPill, "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
            <Check className="h-4 w-4" aria-hidden /> Connected
          </span>
        ) : conn?.status === "pending" ? (
          <span className={quietPill}>{conn.outgoing ? "Waiting for them to confirm" : "They asked you: see your network"}</span>
        ) : (
          <button type="button" className={primaryPill} aria-expanded={panel === "connect"} onClick={() => setPanel(panel === "connect" ? "none" : "connect")}>
            <Handshake className="h-4 w-4" aria-hidden /> Connect
          </button>
        )}
        {data.viewer.signedIn && !data.viewer.isOwner ? (
          <Link href={`/messages/new/${p.id}`} prefetch={false} className={quietPill}>
            <MessageCircle className="h-4 w-4" aria-hidden /> Message
          </Link>
        ) : null}
        {data.viewer.canVouch ? (
          <button type="button" className={quietPill} aria-expanded={panel === "recommend"} onClick={() => setPanel(panel === "recommend" ? "none" : "recommend")}>
            <Quote className="h-4 w-4" aria-hidden /> Recommend
          </button>
        ) : null}
        <Link href={`${profilePath(p.handle)}/card`} prefetch={false} className={quietPill}>
          <IdCard className="h-4 w-4" aria-hidden /> Card
        </Link>
      </div>

      <div aria-live="polite">{note ? <p className={cn("mb-4 rounded-2xl px-3.5 py-2.5 text-[13px]", GLASS)}>{note}</p> : null}</div>

      {panel === "connect" ? (
        <ConnectForm
          name={p.displayName}
          onDone={(msg, id) => {
            setPanel("none");
            setNote(msg);
            if (id) setConn({ id, status: "pending", outgoing: true });
          }}
          onDraft={() => setConn({ id: "pending", status: "pending", outgoing: true })}
          onFail={(msg) => {
            setConn(null);
            setNote(msg);
          }}
          targetId={p.id}
        />
      ) : null}
      {panel === "recommend" ? (
        <RecommendForm
          name={p.displayName}
          subjectId={p.id}
          already={data.viewer.myRecommendationKinds}
          onDone={(msg) => {
            setPanel("none");
            setNote(msg);
          }}
        />
      ) : null}

      {/* Skills + endorsements */}
      {skills.length ? (
        <section className="mb-6" aria-labelledby="pn-skills">
          <SectionHeader id="pn-skills" title="Skills" />
          <ul className="flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <li key={s.skill}>
                {data.viewer.canVouch ? (
                  <button type="button" aria-pressed={s.endorsedByViewer} onClick={() => void endorse(s.skill, !s.endorsedByViewer)} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[13px]", s.endorsedByViewer && "bg-primary/10 text-primary dark:bg-primary/20")}>
                    {s.endorsedByViewer ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />} {s.skill}
                    {s.count ? <span className="tabular-nums text-muted-foreground">· {s.count}</span> : null}
                  </button>
                ) : (
                  <span className={cn(quietPill, "min-h-[2.25rem] cursor-default px-3 text-[13px]")}>
                    {s.skill}
                    {s.count ? <span className="tabular-nums text-muted-foreground">· {s.count}</span> : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {data.viewer.canVouch ? <p className="mt-1.5 px-1 text-[12px] text-muted-foreground">Tap a skill to endorse it. Tap again to take it back.</p> : null}
        </section>
      ) : null}

      {/* Recommendations they approved */}
      {data.recommendations.length ? (
        <section className="mb-6" aria-labelledby="pn-recs">
          <SectionHeader id="pn-recs" title="Recommendations" count={data.recommendations.length} />
          <GlassGroup label="Recommendations">
            {data.recommendations.map((r) => (
              <li key={r.id} className="px-3.5 py-3">
                <PersonLine p={r.person} href={`${profilePath(r.person.handle)}/network`} sub={REC_KINDS[r.kind]} />
                <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed">{r.body}</p>
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      {/* Career Timeline */}
      {data.timeline.length ? (
        <section className="mb-6" aria-labelledby="pn-career">
          <SectionHeader id="pn-career" title="Career" />
          <ol className={cn("rounded-[22px] px-3.5 py-3", GLASS)}>
            {data.timeline.map((t, i) => {
              const Icon = TIMELINE_ICON[t.kind];
              return (
                <li key={t.key} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < data.timeline.length - 1 ? <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-px bg-black/10 dark:bg-white/10" /> : null}
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
        </section>
      ) : null}

      {/* Connections */}
      {data.connections?.length ? (
        <section className="mb-6" aria-labelledby="pn-conn">
          <SectionHeader id="pn-conn" title="Confirmed connections" count={data.connections.length} />
          <GlassGroup label="Confirmed connections">
            {data.connections.slice(0, 30).map((c) => (
              <li key={c.id} className="flex items-center px-3.5 py-2.5">
                <PersonLine p={c.person} href={`${profilePath(c.person.handle)}/network`} sub={`${roleLabel(c.theirRole, c.customLabel)}${c.context ? `, ${c.context}` : ""}`} />
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      {/* Opportunities */}
      {data.opportunities.length ? (
        <section className="mb-8" aria-labelledby="pn-opps">
          <SectionHeader id="pn-opps" title="Open opportunities" />
          <GlassGroup label="Open opportunities">
            {data.opportunities.map((o) => (
              <li key={o.id} className="px-3.5 py-3">
                <p className="text-[14.5px] font-semibold">{o.title}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted-foreground">
                  <span>{OPPORTUNITY_KINDS[o.kind as OpportunityKind] ?? o.kind}</span>
                  {o.location || o.remote ? (
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" aria-hidden /> {[o.location, o.remote ? "Remote" : null].filter(Boolean).join(", ")}
                    </span>
                  ) : null}
                </p>
                {o.description ? <p className="mt-1 line-clamp-3 text-[13px]">{o.description}</p> : null}
                {o.link ? (
                  <a href={o.link} target="_blank" rel="nofollow noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-primary">
                    Details <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                ) : null}
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      {!skills.length && !data.recommendations.length && !data.timeline.length && !data.opportunities.length && !data.connections?.length ? (
        <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>Nothing professional shared yet.</p>
      ) : null}
    </div>
  );
}

function ConnectForm({ name, targetId, onDone, onDraft, onFail }: { name: string; targetId: string; onDone: (msg: string, id?: string) => void; onDraft: () => void; onFail: (msg: string) => void }) {
  const [theirRole, setTheirRole] = useState<ProRole>("colleague");
  const [myRole, setMyRole] = useState<ProRole>("colleague");
  const [custom, setCustom] = useState("");
  const [context, setContext] = useState("");
  const [note, setNote] = useState("");
  const inverses = ROLE_INVERSES[theirRole];
  return (
    <form
      className={cn("mb-5 space-y-3 rounded-[22px] px-3.5 py-3", GLASS)}
      onSubmit={async (e) => {
        e.preventDefault();
        haptic("selection");
        onDraft();
        const out = await networkPost({ op: "request", targetId, theirRole, myRole, customLabel: theirRole === "custom" ? custom : null, context: context || null, note: note || null });
        if (out.error) onFail(out.error);
        else onDone(`Sent. ${name} confirms it before it shows anywhere.`, out.data?.id as string | undefined);
      }}
    >
      <p className="text-[14px] font-semibold">How did you work with {name}?</p>
      <div className="grid gap-2 min-[420px]:grid-cols-2">
        <label className="text-[12.5px] text-muted-foreground">
          They were your
          <select
            className="mt-1 block min-h-[2.5rem] w-full rounded-xl border border-border bg-background px-2.5 text-[14px] text-foreground"
            value={theirRole}
            onChange={(e) => {
              const r = e.target.value as ProRole;
              setTheirRole(r);
              setMyRole(ROLE_INVERSES[r][0]!);
            }}
          >
            {PRO_ROLE_KEYS.map((r) => (
              <option key={r} value={r}>
                {PRO_ROLES[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12.5px] text-muted-foreground">
          And you were their
          <select className="mt-1 block min-h-[2.5rem] w-full rounded-xl border border-border bg-background px-2.5 text-[14px] text-foreground" value={myRole} onChange={(e) => setMyRole(e.target.value as ProRole)} disabled={inverses.length < 2}>
            {inverses.map((r) => (
              <option key={r} value={r}>
                {PRO_ROLES[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {theirRole === "custom" ? <input aria-label="Relationship" required maxLength={40} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Co-author, bandmate…" className="min-h-[2.5rem] w-full rounded-xl border border-border bg-background px-3 text-[15px]" /> : null}
      <input aria-label="Where" maxLength={80} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Where, e.g. at Acme, 2021–2023" className="min-h-[2.5rem] w-full rounded-xl border border-border bg-background px-3 text-[15px]" />
      <textarea aria-label="A note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A short note (optional)" className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[15px]" />
      <button type="submit" className={primaryPill}>
        Ask them to confirm
      </button>
    </form>
  );
}

function RecommendForm({ name, subjectId, already, onDone }: { name: string; subjectId: string; already: RecKind[]; onDone: (msg: string) => void }) {
  const [kind, setKind] = useState<RecKind>((Object.keys(REC_KINDS) as RecKind[]).find((k) => !already.includes(k)) ?? "recommendation");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className={cn("mb-5 space-y-3 rounded-[22px] px-3.5 py-3", GLASS)}
      onSubmit={async (e) => {
        e.preventDefault();
        haptic("selection");
        setSending(true);
        setErr(null);
        const out = await networkPost({ op: "recommend", subjectId, kind, body });
        setSending(false);
        if (out.error) setErr(out.error);
        else onDone(`Sent to ${name}. It shows on their page only if they approve it.`);
      }}
    >
      <label className="block text-[12.5px] text-muted-foreground">
        What are you writing?
        <select className="mt-1 block min-h-[2.5rem] w-full rounded-xl border border-border bg-background px-2.5 text-[14px] text-foreground" value={kind} onChange={(e) => setKind(e.target.value as RecKind)}>
          {(Object.keys(REC_KINDS) as RecKind[]).map((k) => (
            <option key={k} value={k}>
              {REC_KINDS[k]}
              {already.includes(k) ? " (replace yours)" : ""}
            </option>
          ))}
        </select>
      </label>
      <textarea aria-label="Your words" rows={5} minLength={REC_MIN} maxLength={REC_MAX} required value={body} onChange={(e) => setBody(e.target.value)} placeholder={`What was it like to work with ${name}?`} className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-[15px]" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {body.trim().length}/{REC_MAX}
        </span>
        <button type="submit" className={primaryPill} disabled={sending || body.trim().length < REC_MIN}>
          {sending ? "Sending…" : "Send for their approval"}
        </button>
      </div>
      {err ? <p className="text-[13px] font-medium text-rose-600">{err}</p> : null}
    </form>
  );
}
