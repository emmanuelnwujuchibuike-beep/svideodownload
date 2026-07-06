"use client";

import { Activity, Bookmark, Eye, Loader2, MessageSquare, Repeat2, Search, ShieldCheck, Sparkles, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { WowOutline } from "@/components/brand/wow-icon";
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
    <div id="privacy" className="scroll-mt-24 border-b border-border/60 p-6 sm:p-8">
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Privacy</h2>
      </div>
      <p className="mb-5 text-xs text-muted-foreground">
        You&apos;re always in control — these settings override discovery and recommendations.
      </p>

      <div className="space-y-2.5">
        <SegRow icon={Activity} title="Activity visibility" desc="Who can see your likes, saves and posts" value={state.activity_visibility} choices={VIS} onChange={(v) => set("activity_visibility", v as PrivacySettings["activity_visibility"])} />
        <SegRow icon={Users} title="Followers list" desc="Who can see who follows you" value={state.followers_visibility} choices={VIS} onChange={(v) => set("followers_visibility", v as PrivacySettings["followers_visibility"])} />
        {/* Per-tab visibility — a hidden tab never appears on your profile. */}
        <SegRow icon={Repeat2} title="Reposts tab" desc="Who can see the posts you repost" value={state.reposts_visibility} choices={VIS} onChange={(v) => set("reposts_visibility", v as PrivacySettings["reposts_visibility"])} />
        <SegRow icon={WowOutline} title="Wows tab" desc="Who can see the posts you Wow" value={state.likes_visibility} choices={VIS} onChange={(v) => set("likes_visibility", v as PrivacySettings["likes_visibility"])} />
        <SegRow icon={Bookmark} title="Saved tab" desc="Who can see the posts you save" value={state.saves_visibility} choices={VIS} onChange={(v) => set("saves_visibility", v as PrivacySettings["saves_visibility"])} />
        <SegRow icon={MessageSquare} title="Comments" desc="Who can comment on your posts" value={state.comments_policy} choices={POLICY} onChange={(v) => set("comments_policy", v as PrivacySettings["comments_policy"])} />
        <SegRow icon={MessageSquare} title="Messages" desc="Who can send you direct messages" value={state.messages_policy} choices={POLICY} onChange={(v) => set("messages_policy", v as PrivacySettings["messages_policy"])} />
        <ToggleRow icon={Search} title="Search engine indexing" desc="Let Google show your profile" on={state.allow_indexing} onToggle={() => set("allow_indexing", !state.allow_indexing)} />
        <ToggleRow icon={Sparkles} title="Recommendations" desc="Show me in suggestions & trending" on={state.show_in_recommendations} onToggle={() => set("show_in_recommendations", !state.show_in_recommendations)} />
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save privacy
        </button>
        {msg ? <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span> : null}
      </div>
    </div>
  );
}

function SegRow({
  icon: Icon,
  title,
  desc,
  value,
  choices,
  onChange,
}: {
  icon: typeof Eye;
  title: string;
  desc: string;
  value: string;
  choices: Choice[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-secondary/15 p-3.5">
      <span className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{desc}</span>
        </span>
      </span>
      <div className="inline-flex rounded-lg bg-background p-0.5 ring-1 ring-inset ring-border">
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
  title,
  desc,
  on,
  onToggle,
}: {
  icon: typeof Eye;
  title: string;
  desc: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border/60 bg-secondary/15 p-3.5 text-left transition hover:border-foreground/15"
    >
      <span className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
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
