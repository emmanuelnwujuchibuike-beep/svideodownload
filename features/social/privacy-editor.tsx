"use client";

import { Activity, Award, Bookmark, CheckCheck, Clock, Crown, Eye, Loader2, MessageSquare, Repeat2, Search, Sparkles, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

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

      <div className="mt-5 flex items-center gap-3 px-0.5">
        <button type="button" onClick={save} disabled={busy} className="btn-lux btn-lux-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save privacy
        </button>
        {msg ? <span className={cn("text-sm font-medium", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span> : null}
      </div>
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
