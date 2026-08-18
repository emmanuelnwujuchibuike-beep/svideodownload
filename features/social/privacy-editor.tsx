"use client";

import { Activity, Award, Bookmark, CheckCheck, Clock, Crown, Eye, Loader2, MessageSquare, Repeat2, Search, ShieldOff, Sparkles, UserPlus, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { WowOutline } from "@/components/brand/wow-icon";
import { SETTINGS_TINTS } from "@/features/account/settings-ui";
import type { PrivacySettings } from "@/lib/social/profile";
import { cn } from "@/lib/utils";

type Choice = { value: string; label: string };
const VIS: Choice[] = [
  { value: "public", label: "Everyone" },
  { value: "followers", label: "Followers" },
  { value: "private", label: "Only me" },
];
const POLICY: Choice[] = [
  { value: "everyone", label: "Everyone" },
  { value: "followers", label: "Followers" },
  { value: "off", label: "Off" },
];
const REL_POLICY: Choice[] = [
  { value: "everyone", label: "Everyone" },
  { value: "friends", label: "Friends" },
  { value: "nobody", label: "Nobody" },
];

export function PrivacyEditor({ settings }: { settings: PrivacySettings }) {
  const router = useRouter();
  const [state, setState] = useState<PrivacySettings>(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof PrivacySettings>(k: K, v: PrivacySettings[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/privacy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const json = await res.json();
      setMsg(res.ok ? { ok: true, text: "Privacy saved." } : { ok: false, text: json.error ?? "Failed to save." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="privacy" className="scroll-mt-24">
      <p className="mb-3 px-1.5 text-xs text-muted-foreground">You&apos;re always in control — these settings override discovery and recommendations.</p>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="divide-y divide-border/60">
          <SegRow icon={Activity} tint="blue" title="Activity visibility" desc="Who can see your likes, saves and posts" value={state.activity_visibility} choices={VIS} onChange={(v) => set("activity_visibility", v as PrivacySettings["activity_visibility"])} />
          <SegRow icon={Users} tint="emerald" title="Followers list" desc="Who can see who follows you" value={state.followers_visibility} choices={VIS} onChange={(v) => set("followers_visibility", v as PrivacySettings["followers_visibility"])} />
          {/* Per-tab visibility — a hidden tab never appears on your profile. */}
          <SegRow icon={Repeat2} tint="cyan" title="Reposts tab" desc="Who can see the posts you repost" value={state.reposts_visibility} choices={VIS} onChange={(v) => set("reposts_visibility", v as PrivacySettings["reposts_visibility"])} />
          <SegRow icon={WowOutline} tint="rose" title="Wows tab" desc="Who can see the posts you Wow" value={state.likes_visibility} choices={VIS} onChange={(v) => set("likes_visibility", v as PrivacySettings["likes_visibility"])} />
          <SegRow icon={Bookmark} tint="amber" title="Saved tab" desc="Who can see the posts you save" value={state.saves_visibility} choices={VIS} onChange={(v) => set("saves_visibility", v as PrivacySettings["saves_visibility"])} />
          <SegRow icon={MessageSquare} tint="violet" title="Comments" desc="Who can comment on your posts" value={state.comments_policy} choices={POLICY} onChange={(v) => set("comments_policy", v as PrivacySettings["comments_policy"])} />
          <SegRow icon={MessageSquare} tint="purple" title="Messages" desc="Who can send you direct messages" value={state.messages_policy} choices={POLICY} onChange={(v) => set("messages_policy", v as PrivacySettings["messages_policy"])} />
          <ToggleRow icon={Search} tint="slate" title="Search engine indexing" desc="Let Google show your profile" on={state.allow_indexing} onToggle={() => set("allow_indexing", !state.allow_indexing)} />
          <ToggleRow icon={Sparkles} tint="purple" title="Recommendations" desc="Show me in suggestions & trending" on={state.show_in_recommendations} onToggle={() => set("show_in_recommendations", !state.show_in_recommendations)} />
          {/* Public-by-default, hideable (owner). */}
          <ToggleRow icon={Award} tint="amber" title="Show my reputation" desc="Display your rank on your public profile" on={state.show_reputation} onToggle={() => set("show_reputation", !state.show_reputation)} />
          <ToggleRow icon={Crown} tint="violet" title="Show my Pro / Business badge" desc="Display your plan badge next to your name" on={state.show_plan_badge} onToggle={() => set("show_plan_badge", !state.show_plan_badge)} />
          <ToggleRow icon={Eye} tint="cyan" title="Show my view count" desc="Display total views on your public profile" on={state.show_views} onToggle={() => set("show_views", !state.show_views)} />
        </div>
      </div>

      <p className="mb-1.5 ml-1.5 mt-5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Messages</p>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="divide-y divide-border/60">
          <ToggleRow
            icon={CheckCheck}
            tint="emerald"
            title="Read receipts"
            desc="Let people see when you've read their messages"
            on={state.read_receipts_enabled}
            onToggle={() => set("read_receipts_enabled", !state.read_receipts_enabled)}
          />
          <ToggleRow
            icon={MessageSquare}
            tint="blue"
            title="Typing indicators"
            desc={'Show "typing…" while you\'re writing a reply'}
            on={state.typing_indicators_enabled}
            onToggle={() => set("typing_indicators_enabled", !state.typing_indicators_enabled)}
          />
          <SegRow
            icon={Clock}
            tint="amber"
            title="Last seen & online"
            desc="Who can see when you were last active"
            value={state.last_seen_visibility}
            choices={REL_POLICY}
            onChange={(v) => set("last_seen_visibility", v as PrivacySettings["last_seen_visibility"])}
          />
          <SegRow
            icon={UserPlus}
            tint="cyan"
            title="Group invites"
            desc="Who can add you to a group chat"
            value={state.group_invite_policy}
            choices={REL_POLICY}
            onChange={(v) => set("group_invite_policy", v as PrivacySettings["group_invite_policy"])}
          />
        </div>
      </div>

      <p className="mb-1.5 ml-1.5 mt-5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Comment moderation</p>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card p-3.5 shadow-sm">
        <span className="flex items-center gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", SETTINGS_TINTS.rose)}>
            <ShieldOff className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Keyword filter</span>
            <span className="block text-xs text-muted-foreground">Comments containing these words are never posted, on any of your posts</span>
          </span>
        </span>
        <KeywordFilterEditor
          keywords={state.muted_comment_keywords ?? []}
          onChange={(kw) => set("muted_comment_keywords", kw)}
        />
        <div className="mt-4 border-t border-border/60 pt-3">
          <MutedCommenters />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3 px-0.5">
        <button type="button" onClick={save} disabled={busy} className="btn-lux btn-lux-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save privacy
        </button>
        {msg ? <span className={cn("text-sm font-medium", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span> : null}
      </div>
    </div>
  );
}

interface MutedPerson {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Manages who's been muted via a comment's ⋯ menu (comments.tsx) — makes
 *  that action reversible instead of one-way. Lazily fetched on first
 *  expand, not on every Privacy page load. */
function MutedCommenters() {
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState<MutedPerson[] | null>(null);

  useEffect(() => {
    if (!open || muted !== null) return;
    let cancelled = false;
    void fetch("/api/privacy/muted-commenters")
      .then((r) => (r.ok ? r.json() : { muted: [] }))
      .then((j: { muted?: MutedPerson[] }) => {
        if (!cancelled) setMuted(j.muted ?? []);
      })
      .catch(() => {
        if (!cancelled) setMuted([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, muted]);

  const unmute = async (id: string) => {
    setMuted((m) => (m ? m.filter((p) => p.id !== id) : m));
    try {
      await fetch(`/api/privacy/muted-commenters?userId=${id}`, { method: "DELETE" });
    } catch {
      /* best-effort — a refresh of this panel will show the true state */
    }
  };

  return (
    <div className="pl-[3.25rem]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-primary hover:opacity-80">
        {open ? "Hide muted commenters" : "Manage muted commenters"}
      </button>
      {open ? (
        muted === null ? (
          <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
        ) : muted.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No one is muted — mute someone from their comment&apos;s ⋯ menu.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {muted.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5">
                {p.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-xs font-bold text-white">{p.displayName.charAt(0).toUpperCase()}</span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{p.displayName}</span>
                <button type="button" onClick={() => unmute(p.id)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">
                  Unmute
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function KeywordFilterEditor({ keywords, onChange }: { keywords: string[]; onChange: (k: string[]) => void }) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const w = draft.trim().toLowerCase();
    if (!w || keywords.includes(w) || keywords.length >= 50) {
      setDraft("");
      return;
    }
    onChange([...keywords, w]);
    setDraft("");
  };

  return (
    <div className="mt-3 pl-[3.25rem]">
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 40))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a word or phrase…"
          aria-label="Add a filtered word"
          className="w-full max-w-xs rounded-xl border border-border/60 bg-secondary/40 px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50"
        />
        <button type="button" onClick={add} disabled={!draft.trim()} className="rounded-xl bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-secondary/80 disabled:opacity-50">
          Add
        </button>
      </div>
      {keywords.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {keywords.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/50 px-2.5 py-1 text-xs font-medium text-foreground">
              {k}
              <button type="button" onClick={() => onChange(keywords.filter((x) => x !== k))} aria-label={`Remove ${k}`} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SegRow({
  icon: Icon,
  tint = "slate",
  title,
  desc,
  value,
  choices,
  onChange,
}: {
  icon: typeof Eye;
  tint?: keyof typeof SETTINGS_TINTS;
  title: string;
  desc: string;
  value: string;
  choices: Choice[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
      <span className="flex items-center gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", SETTINGS_TINTS[tint])}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block text-xs text-muted-foreground">{desc}</span>
        </span>
      </span>
      <div className="inline-flex rounded-lg bg-secondary p-0.5 ring-1 ring-inset ring-border">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(c.value)}
            aria-pressed={value === c.value}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition",
              value === c.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  tint = "slate",
  title,
  desc,
  on,
  onToggle,
}: {
  icon: typeof Eye;
  tint?: keyof typeof SETTINGS_TINTS;
  title: string;
  desc: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={on} className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition hover:bg-secondary/40">
      <span className="flex items-center gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", SETTINGS_TINTS[tint])}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block text-xs text-muted-foreground">{desc}</span>
        </span>
      </span>
      <span
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border",
        )}
      >
        <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
      </span>
    </button>
  );
}
