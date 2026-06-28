"use client";

import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  last_used: string | null;
  revoked: boolean;
  created_at: string;
}

export function ApiKeys({
  dailyLimit,
  usedToday = 0,
}: {
  dailyLimit: number;
  usedToday?: number;
}) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () =>
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d) => setKeys(d.keys ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setCreating(true);
    setFresh(null);
    try {
      const res = await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = await res.json();
      if (json.key) {
        setFresh(json.key as string);
        await load();
      }
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch(`/api/keys/${id}`, { method: "DELETE" });
    setKeys((k) => k.filter((x) => x.id !== id));
  };

  const copy = () => {
    if (!fresh) return;
    navigator.clipboard?.writeText(fresh);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const active = keys.filter((k) => !k.revoked);

  return (
    <div className="mt-7 rounded-2xl border border-border/70 bg-secondary/20 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="h-4 w-4 text-primary" /> Developer API
        </h3>
        <span className="text-xs text-muted-foreground">{dailyLimit.toLocaleString()} req/day</span>
      </div>

      {/* Today's usage — lets the user monitor their daily API consumption */}
      <div className="mb-4 rounded-xl border border-border/60 bg-background/50 p-3">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground">API usage today</span>
          <span className="font-semibold">
            {usedToday.toLocaleString()} / {dailyLimit.toLocaleString()}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={
              "h-full rounded-full transition-all " +
              (usedToday >= dailyLimit
                ? "bg-red-500"
                : usedToday / dailyLimit >= 0.8
                  ? "bg-amber-500"
                  : "bg-gradient-to-r from-blue-600 to-cyan-400")
            }
            style={{ width: `${Math.min(100, dailyLimit > 0 ? (usedToday / dailyLimit) * 100 : 0)}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {usedToday >= dailyLimit
            ? "Daily limit reached — calls return 429 until midnight UTC."
            : `${Math.max(0, dailyLimit - usedToday).toLocaleString()} requests left today · resets midnight UTC`}
        </p>
      </div>

      {fresh ? (
        <div className="mb-3 rounded-xl border border-green-500/30 bg-green-500/10 p-3">
          <p className="mb-1 text-xs font-medium text-green-600 dark:text-green-400">
            Copy your key now — it won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-background px-2 py-1.5 font-mono text-xs">
              {fresh}
            </code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading keys…</p>
      ) : active.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">
          No API keys yet. Create one to use the REST API.
        </p>
      ) : (
        <ul className="mb-3 divide-y divide-border/60">
          {active.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-mono text-xs">{k.key_prefix}…</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {k.last_used ? `used ${new Date(k.last_used).toLocaleDateString()}` : "never used"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => revoke(k.id)}
                aria-label="Revoke"
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          New key
        </button>
        <a href="/developers" className="text-xs font-medium text-primary hover:underline">
          API docs →
        </a>
      </div>
    </div>
  );
}
