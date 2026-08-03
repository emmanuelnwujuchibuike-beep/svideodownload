"use client";

import { Eye, Heart, Loader2, Search, Users } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Admin: adjust a user's followers, or a post's likes / views (owner). A deliberate
 * admin override — look a user/post up, see the current value, set a new one. The
 * counters are trigger-incremented, so the set value persists and real activity
 * applies on top. Not shown to members; every change here is an explicit admin act.
 */
type Msg = { ok: boolean; text: string } | null;

export function StatAdjuster() {
  return (
    <div className="space-y-4">
      <ProfileAdjuster />
      <PostAdjuster />
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        These are manual admin overrides. Real follows, likes and views keep counting on top of whatever you set.
      </p>
    </div>
  );
}

function ProfileAdjuster() {
  const [handle, setHandle] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [followers, setFollowers] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const lookup = async () => {
    if (!handle.trim()) return;
    setLoading(true);
    setMsg(null);
    setName(null);
    try {
      const res = await fetch(`/api/admin/adjust-stats?handle=${encodeURIComponent(handle.trim())}`);
      const d = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: d.error ?? "Not found." });
      } else {
        setName(d.display_name || `@${d.handle}`);
        setFollowers(String(d.followers_count ?? 0));
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    const n = Number(followers);
    if (!Number.isFinite(n) || n < 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/adjust-stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "profile", handle: handle.trim(), followers: Math.round(n) }) });
      const d = await res.json();
      setMsg(res.ok ? { ok: true, text: "Followers updated." } : { ok: false, text: d.error ?? "Couldn't update." });
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-bold"><Users className="h-4 w-4 text-primary" /> Followers</h3>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">User handle</span>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookup()} placeholder="@handle" className="h-10 w-full rounded-lg bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary" />
        </label>
        <button type="button" onClick={lookup} disabled={loading} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-secondary px-3.5 text-sm font-semibold transition hover:bg-secondary/70 active:scale-[0.97] disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Look up
        </button>
      </div>
      {name ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">Followers for {name}</span>
            <input type="number" min={0} value={followers} onChange={(e) => setFollowers(e.target.value)} className="h-10 w-full rounded-lg bg-background px-3 text-sm tabular-nums outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary" />
          </label>
          <button type="button" onClick={save} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 px-4 text-sm font-bold text-white transition hover:opacity-95 active:scale-[0.97] disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
          </button>
        </div>
      ) : null}
      {msg ? <p className={cn("mt-2 text-sm font-medium", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</p> : null}
    </section>
  );
}

function PostAdjuster() {
  const [postId, setPostId] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  const [likes, setLikes] = useState("");
  const [views, setViews] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const lookup = async () => {
    if (!postId.trim()) return;
    setLoading(true);
    setMsg(null);
    setTitle(null);
    try {
      const res = await fetch(`/api/admin/adjust-stats?postId=${encodeURIComponent(postId.trim())}`);
      const d = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: d.error ?? "Not found." });
      } else {
        setTitle(d.title || "Untitled post");
        setLikes(String(d.likes_count ?? 0));
        setViews(String(d.views_count ?? 0));
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/adjust-stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "post", postId: postId.trim(), likes: Math.max(0, Math.round(Number(likes) || 0)), views: Math.max(0, Math.round(Number(views) || 0)) }) });
      const d = await res.json();
      setMsg(res.ok ? { ok: true, text: "Post stats updated." } : { ok: false, text: d.error ?? "Couldn't update." });
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-bold"><Eye className="h-4 w-4 text-primary" /> Post likes &amp; views</h3>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Post ID</span>
          <input value={postId} onChange={(e) => setPostId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookup()} placeholder="post uuid" className="h-10 w-full rounded-lg bg-background px-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary" />
        </label>
        <button type="button" onClick={lookup} disabled={loading} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-secondary px-3.5 text-sm font-semibold transition hover:bg-secondary/70 active:scale-[0.97] disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Look up
        </button>
      </div>
      {title ? (
        <>
          <p className="mt-3 truncate text-xs text-muted-foreground">{title}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label>
              <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Heart className="h-3 w-3" /> Likes</span>
              <input type="number" min={0} value={likes} onChange={(e) => setLikes(e.target.value)} className="h-10 w-full rounded-lg bg-background px-3 text-sm tabular-nums outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary" />
            </label>
            <label>
              <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Eye className="h-3 w-3" /> Views</span>
              <input type="number" min={0} value={views} onChange={(e) => setViews(e.target.value)} className="h-10 w-full rounded-lg bg-background px-3 text-sm tabular-nums outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary" />
            </label>
          </div>
          <button type="button" onClick={save} disabled={busy} className="mt-2 inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 px-4 text-sm font-bold text-white transition hover:opacity-95 active:scale-[0.97] disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
          </button>
        </>
      ) : null}
      {msg ? <p className={cn("mt-2 text-sm font-medium", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</p> : null}
    </section>
  );
}
