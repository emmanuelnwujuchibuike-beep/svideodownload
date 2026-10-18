"use client";

import { ArrowLeft, Check, ChevronRight, Clock, Lightbulb, Loader2, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { AmbientWash, GLASS, GlassGroup, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import { History } from "@/features/graph/graph-page";
import type { PrivacyCenter } from "@/lib/privacy/center";
import { BOUNDARY_MODES, describeBundle, PRESETS } from "@/lib/privacy/relationship";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * Relationship Privacy Center™ (Feature 19 · Part 17) — who can find, reach,
 * follow, mention, invite and remember you, in one place.
 *
 * Every control saves on the tap (and is put back if the server refuses), writes
 * the same setting every other part of Frenz enforces, and shows up in your
 * private change log below. Presets and Boundary Modes say exactly what they'll
 * change before you choose them. The advisor only suggests.
 */

type S = PrivacyCenter["settings"] & Record<string, unknown>;

const SELECT = "min-h-[2.5rem] max-w-[11rem] rounded-full border border-border bg-background px-3 text-[13px] font-semibold";

const CONTROLS: { key: string; label: string; options: [string, string][] }[] = [
  { key: "messages_policy", label: "Message you", options: [["everyone", "Everyone"], ["followers", "Followers"], ["off", "Nobody"]] },
  { key: "friend_requests_policy", label: "Send friend requests", options: [["everyone", "Everyone"], ["friends_of_friends", "Friends of friends"], ["verified", "Verified accounts"], ["nobody", "Nobody"]] },
  { key: "follow_policy", label: "Follow you", options: [["everyone", "Everyone"], ["approval", "With your approval"], ["friends_of_friends", "Friends of friends"], ["verified", "Verified accounts"], ["friends", "Friends"], ["nobody", "Nobody"]] },
  { key: "mention_policy", label: "Mention you", options: [["everyone", "Everyone"], ["following", "People you follow"], ["friends", "Friends"], ["nobody", "Nobody"]] },
  { key: "collab_invite_policy", label: "Invite you to collaborate", options: [["everyone", "Everyone"], ["following", "People you follow"], ["friends", "Friends"], ["nobody", "Nobody"]] },
  { key: "memory_tag_policy", label: "Add you to a memory", options: [["friends", "Friends"], ["nobody", "Nobody"]] },
  { key: "comments_policy", label: "Comment on your posts", options: [["everyone", "Everyone"], ["followers", "Followers"], ["off", "Nobody"]] },
];
const SEE: { key: string; label: string; options: [string, string][] }[] = [
  { key: "friends_visibility", label: "Your friend list", options: [["public", "Everyone"], ["friends", "Friends"], ["private", "Only you"]] },
  { key: "last_seen_visibility", label: "When you were last on", options: [["everyone", "Everyone"], ["friends", "Friends"], ["nobody", "Nobody"]] },
];
const DURATIONS: [string, number | null][] = [
  ["1 hour", 1],
  ["1 day", 24],
  ["1 week", 168],
  ["Until I turn it off", null],
];

async function patch(cols: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cols) }).catch(() => null);
  if (res?.ok) return null;
  const j = (await res?.json().catch(() => null)) as { error?: string } | null;
  return j?.error ?? (res ? "Couldn't save that." : "You're offline.");
}
async function post(body: Record<string, unknown>): Promise<{ error: string | null; data: Record<string, unknown> | null }> {
  const res = await fetch("/api/privacy-center", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as Record<string, unknown> | null;
  return res?.ok ? { error: null, data } : { error: (data?.error as string) ?? (res ? "Couldn't save that." : "You're offline."), data: null };
}

export function PrivacyCenterPage({ initial }: { initial: PrivacyCenter }) {
  const [c, setC] = useState(initial);
  const ref = useRef(c);
  ref.current = c;
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const s = c.settings as S;

  /** Draw on the tap, save, put back on refusal. */
  const setting = async (cols: Record<string, unknown>) => {
    const before = ref.current;
    haptic("selection");
    setNote(null);
    setC({ ...before, settings: { ...before.settings, ...cols } as PrivacyCenter["settings"] });
    const err = await patch(cols);
    if (err) {
      setC(before);
      setNote(err);
    }
  };
  const refresh = async () => {
    const r = await fetch("/api/privacy-center").then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (r) setC(r);
  };
  const run = async (key: string, body: Record<string, unknown>, ok: string) => {
    haptic("selection");
    setBusy(key);
    setNote(null);
    const out = await post(body);
    setBusy(null);
    if (out.error) return setNote(out.error);
    setNote(ok);
    await refresh();
  };

  const filters = s.request_filters ?? {};
  const mode = s.boundary_mode ? BOUNDARY_MODES[s.boundary_mode] : null;
  return (
    <div className="relative isolate">
      <AmbientWash />
      <header className="mb-4 flex items-start gap-2 pt-1">
        <Link href="/account" prefetch={false} aria-label="Back" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] active:bg-black/[0.08]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div>
          <h1 className="text-[clamp(1.6rem,7vw,2rem)] font-extrabold leading-none tracking-[-0.04em]">Privacy Center</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">Who can find you, reach you, mention you and remember you. Changes apply everywhere at once.</p>
        </div>
      </header>
      <div aria-live="polite">{note ? <p className={cn("mb-4 rounded-2xl px-3.5 py-2.5 text-[13px]", GLASS)}>{note}</p> : null}</div>

      {/* Boundary Mode */}
      <section className="mb-6" aria-labelledby="pc-mode">
        <SectionHeader id="pc-mode" title="Boundary Mode" />
        {mode ? (
          <div className="rounded-[22px] bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 px-4 py-4 text-white">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-white/70">On now</p>
            <p className="text-[19px] font-extrabold">{mode.label}</p>
            <p className="mt-0.5 text-[13px] text-white/80">{describeBundle(mode.bundle).join(" · ")}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-white/75">
              <Clock className="h-3.5 w-3.5" aria-hidden /> {s.boundary_until ? `Ends ${new Date(s.boundary_until).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Until you turn it off"}
            </p>
            <button type="button" disabled={busy === "end"} onClick={() => void run("end", { op: "boundary_end" }, "Your usual settings are back.")} className="mt-3 inline-flex min-h-[2.75rem] items-center gap-2 rounded-full bg-white px-4 text-[14px] font-bold text-indigo-700 transition active:scale-[0.97]">
              {busy === "end" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} End now and restore my settings
            </button>
          </div>
        ) : (
          <BoundaryPicker busy={busy} onStart={(m, h) => void run(`mode-${m}`, { op: "boundary_start", mode: m, hours: h }, `${BOUNDARY_MODES[m]!.label} is on. Your usual settings come back when it ends.`)} />
        )}
      </section>

      {/* Advisor */}
      {c.advice.length ? (
        <section className="mb-6" aria-labelledby="pc-advice">
          <SectionHeader id="pc-advice" title="Privacy Advisor" count={c.advice.length} />
          <GlassGroup label="Suggestions">
            {c.advice.map((a) => (
              <li key={a.id}>
                <Link href={a.href} prefetch={false} className="flex items-start gap-3 px-3.5 py-3 transition active:bg-black/[0.04]">
                  <Lightbulb className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-500" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold">{a.title}</span>
                    <span className="block text-[12.5px] text-muted-foreground">{a.why}</span>
                  </span>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </GlassGroup>
          <p className="mt-1.5 px-1 text-[11.5px] text-muted-foreground">Suggestions only. Nothing changes until you do.</p>
        </section>
      ) : null}

      {/* Who can reach you */}
      <section id="who-can-reach" className="mb-6 scroll-mt-24" aria-labelledby="pc-reach">
        <SectionHeader id="pc-reach" title="Who can" />
        <GlassGroup label="Who can">
          {CONTROLS.map((ctl) => (
            <li key={ctl.key} className="flex items-center gap-3 px-3.5 py-2.5">
              <label htmlFor={`pc-${ctl.key}`} className="min-w-0 flex-1 text-[14px] font-medium">
                {ctl.label}
              </label>
              <select id={`pc-${ctl.key}`} value={String(s[ctl.key] ?? ctl.options[0]![0])} onChange={(e) => void setting({ [ctl.key]: e.target.value })} className={SELECT}>
                {ctl.options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </GlassGroup>
      </section>

      {/* Who can see */}
      <section id="who-can-see" className="mb-6 scroll-mt-24" aria-labelledby="pc-see">
        <SectionHeader id="pc-see" title="Who can see" />
        <GlassGroup label="Who can see">
          {SEE.map((ctl) => (
            <li key={ctl.key} className="flex items-center gap-3 px-3.5 py-2.5">
              <label htmlFor={`pc-${ctl.key}`} className="min-w-0 flex-1 text-[14px] font-medium">
                {ctl.label}
              </label>
              <select id={`pc-${ctl.key}`} value={String(s[ctl.key] ?? ctl.options[0]![0])} onChange={(e) => void setting({ [ctl.key]: e.target.value })} className={SELECT}>
                {ctl.options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </li>
          ))}
          <li className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="min-w-0 flex-1 text-[14px] font-medium">Suggest me to others</span>
            <Toggle on={!!s.show_in_recommendations} label="Suggest me to others" onClick={() => void setting({ show_in_recommendations: !s.show_in_recommendations })} />
          </li>
          <li>
            <Link href="/account/discovery" prefetch={false} className="flex items-center gap-3 px-3.5 py-3 text-[14px] font-medium transition active:bg-black/[0.04]">
              <span className="min-w-0 flex-1">Search and discovery</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        </GlassGroup>
      </section>

      {/* Friend request filters */}
      <section id="filters" className="mb-6 scroll-mt-24" aria-labelledby="pc-filters">
        <SectionHeader id="pc-filters" title="Friend request filters" />
        <GlassGroup label="Filters">
          <li className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="min-w-0 flex-1 text-[14px] font-medium">From accounts with no profile photo</span>
            <Toggle on={!!filters.noPhoto} label="Filter requests from accounts with no photo" onClick={() => void setting({ request_filters: { ...filters, noPhoto: !filters.noPhoto } })} />
          </li>
          <li className="flex items-center gap-3 px-3.5 py-2.5">
            <label htmlFor="pc-newacct" className="min-w-0 flex-1 text-[14px] font-medium">
              From brand-new accounts
            </label>
            <select id="pc-newacct" value={String(filters.minAccountDays ?? 0)} onChange={(e) => void setting({ request_filters: { ...filters, minAccountDays: Number(e.target.value) } })} className={SELECT}>
              <option value="0">Don&apos;t filter</option>
              <option value="7">Under a week old</option>
              <option value="30">Under a month old</option>
            </select>
          </li>
        </GlassGroup>
        <p className="mt-1.5 px-1 text-[12px] text-muted-foreground">Filtered requests are still kept for you to review. You just aren&apos;t notified, and the sender isn&apos;t told.</p>
      </section>

      {/* Presets */}
      <section className="mb-6" aria-labelledby="pc-presets">
        <SectionHeader id="pc-presets" title="Quick presets" />
        <div className="flex snap-x gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          {Object.entries(PRESETS).map(([k, p]) => (
            <div key={k} className={cn("flex w-[15rem] shrink-0 snap-start flex-col rounded-[22px] p-3.5", GLASS)}>
              <p className="text-[14.5px] font-bold">{p.label}</p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">{p.blurb}</p>
              <ul className="mt-2 space-y-0.5 text-[11.5px] text-muted-foreground">
                {describeBundle(p.bundle).slice(0, 5).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <button type="button" disabled={busy === `preset-${k}`} onClick={() => void run(`preset-${k}`, { op: "preset", key: k }, `${p.label} applied. You can still change anything.`)} className={cn(quietPill, "mt-auto min-h-[2.25rem] justify-center pt-0 text-[12.5px]")}>
                {busy === `preset-${k}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Lightbulb className="h-3.5 w-3.5" aria-hidden />} Apply
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* People you've limited */}
      <section id="blocked" className="mb-6 scroll-mt-24" aria-labelledby="pc-limited">
        <SectionHeader id="pc-limited" title="People you've limited" />
        <GlassGroup label="Limited">
          {(
            [
              ["Blocked", c.counts.blocked, "/account/privacy"],
              ["Muted", c.counts.muted, "/account/privacy"],
              ["Restricted", c.counts.restricted, "/account/privacy"],
              ["Trusted contacts", c.counts.trusted, "/account/relationships"],
            ] as const
          ).map(([l, n, href]) => (
            <li key={l}>
              <Link href={href} prefetch={false} className="flex items-center gap-3 px-3.5 py-3 transition active:bg-black/[0.04]">
                <span className="min-w-0 flex-1 text-[14px] font-medium">{l}</span>
                <span className="text-[13px] tabular-nums text-muted-foreground">{n}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </GlassGroup>
        {c.temporaryBlocks.length ? (
          <div className={cn("mt-2 rounded-[20px] px-3.5 py-3", GLASS)}>
            <p className="text-[13.5px] font-semibold">Temporary blocks</p>
            <ul className="mt-1 space-y-1 text-[13px]">
              {c.temporaryBlocks.map((t) => (
                <li key={t.id} className="flex justify-between gap-2">
                  <span className="truncate">{t.name}</span>
                  <span className="shrink-0 text-muted-foreground">lifts {new Date(t.until).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* Consent Center */}
      <Consents c={c} onChanged={refresh} setNote={setNote} />

      {/* Audit log */}
      <section className="mb-2" aria-labelledby="pc-log">
        <p id="pc-log" className="sr-only">
          Your relationship log
        </p>
        <History />
      </section>
      <p className="mb-8 px-1 text-[12px] text-muted-foreground">
        <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-600" aria-hidden />
        Your log is only yours. People are never told who blocked them.
      </p>
    </div>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={cn("relative h-6 w-11 shrink-0 touch-manipulation rounded-full transition", on ? "bg-primary" : "bg-muted")}>
      <span aria-hidden className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none", on ? "left-[1.375rem]" : "left-0.5")} />
    </button>
  );
}

function BoundaryPicker({ busy, onStart }: { busy: string | null; onStart: (mode: string, hours: number | null) => void }) {
  const [pick, setPick] = useState<string | null>(null);
  return (
    <div className={cn("rounded-[22px] p-3", GLASS)}>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(BOUNDARY_MODES).map(([k, m]) => (
          <button key={k} type="button" aria-pressed={pick === k} onClick={() => (haptic("selection"), setPick(pick === k ? null : k))} className={cn("rounded-2xl px-3 py-2.5 text-left transition active:scale-[0.98]", pick === k ? "bg-foreground text-background" : "bg-black/[0.04] dark:bg-white/[0.06]")}>
            <span className="block text-[13.5px] font-bold">{m.label}</span>
            <span className={cn("block text-[11.5px]", pick === k ? "text-background/75" : "text-muted-foreground")}>{m.blurb}</span>
          </button>
        ))}
      </div>
      {pick ? (
        <div className="mt-3">
          <p className="text-[12.5px] text-muted-foreground">{describeBundle(BOUNDARY_MODES[pick]!.bundle).join(" · ")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(pick === "weekend" ? ([["Until Monday morning", null]] as [string, number | null][]) : DURATIONS).map(([l, h]) => (
              <button key={l} type="button" disabled={!!busy} onClick={() => onStart(pick, h)} className={cn(primaryPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                {busy === `mode-${pick}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null} {l}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-2 px-1 text-[12px] text-muted-foreground">Pick one to see exactly what it changes. Your usual settings come back when it ends.</p>
      )}
    </div>
  );
}

function Consents({ c, onChanged, setNote }: { c: PrivacyCenter; onChanged: () => Promise<void>; setNote: (s: string | null) => void }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const hide = (k: string) => setGone((g) => new Set(g).add(k));
  const show = (k: string) => setGone((g) => {
    const n = new Set(g);
    n.delete(k);
    return n;
  });
  const respond = async (postId: string, accept: boolean) => {
    haptic("selection");
    hide(`c-${postId}`);
    const res = await fetch("/api/studio/collab", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId, accept }) }).catch(() => null);
    if (!res?.ok) {
      show(`c-${postId}`);
      setNote("Couldn't answer that invite.");
    } else void onChanged();
  };
  const leave = async (id: string) => {
    haptic("selection");
    hide(`m-${id}`);
    const out = await post({ op: "leave_memory", memoryId: id });
    if (out.error) {
      show(`m-${id}`);
      setNote(out.error);
    }
  };
  const invites = c.consents.collabInvites.filter((i) => !gone.has(`c-${i.postId}`));
  const mems = c.consents.memories.filter((m) => !gone.has(`m-${m.id}`));
  const total = invites.length + mems.length + c.consents.proRequests.length;
  return (
    <section className="mb-6" aria-labelledby="pc-consent">
      <SectionHeader id="pc-consent" title="Consent Center" count={total} />
      {!total ? (
        <p className={cn("rounded-[20px] px-4 py-4 text-center text-[13px] text-muted-foreground", GLASS)}>Nothing is waiting on your consent, and you aren&apos;t on anyone&apos;s shared memories.</p>
      ) : (
        <GlassGroup label="Consent">
          {invites.map((i) => (
            <li key={i.postId} className="flex items-center gap-2 px-3.5 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">Collaborate on “{i.postTitle ?? "a post"}”</span>
                <span className="block text-[12.5px] text-muted-foreground">{i.invitedByHandle ? `@${i.invitedByHandle} invited you` : "An invite"}</span>
              </span>
              <button type="button" aria-label="Accept" onClick={() => void respond(i.postId, true)} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-700">
                <Check className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" aria-label="Decline" onClick={() => void respond(i.postId, false)} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.05] text-muted-foreground">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
          {c.consents.proRequests.map((p) => (
            <li key={p.id}>
              <Link href="/network" prefetch={false} className="flex items-center gap-2 px-3.5 py-3 transition active:bg-black/[0.04]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{p.name} wants to confirm you worked together</span>
                  <span className="block text-[12.5px] text-muted-foreground">Review it in your network</span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
          {mems.map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-3.5 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">You&apos;re on “{m.title}”</span>
                <span className="block text-[12.5px] text-muted-foreground">A memory {m.ownerName} shared</span>
              </span>
              <button type="button" onClick={() => void leave(m.id)} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                Remove me
              </button>
            </li>
          ))}
        </GlassGroup>
      )}
    </section>
  );
}
