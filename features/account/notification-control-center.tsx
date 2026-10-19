"use client";

import { ArrowDown, ArrowUp, Download, Loader2, Moon, Plus, RotateCcw, SlidersHorizontal, Upload, X, ListChecks } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { haptic } from "@/lib/motion/haptics";
import { describeRule, MAX_RULES, RULE_ACTION_LABEL, RULE_FROM_LABEL, RULE_GROUP_LABEL, type DeliveryRule, type RuleAction, type RuleFrom, type RuleGroup } from "@/lib/notifications/rules";
import type { RuleSuggestion } from "@/lib/notifications/suggestions";
import { cn } from "@/lib/utils";

/**
 * NOTIFICATION CONTROL CENTER (Feature 20 Part 5) — below the switches on
 * /account/notifications, never a second settings page:
 *
 *   · Delivery Rules   "when this, from them → push now / hourly summary / app only".
 *                      Each change saves on tap (owner rule: every button responds on
 *                      tap — drawn first, the server confirms, a failure puts it back).
 *   · Suggested rules  a counting rule over your own week, labelled as such — not AI.
 *   · Profiles         Sleep, Work, Driving… already exist as focus modes (/account/presence):
 *                      linked, not rebuilt.
 *   · Backup           export to a file, import from one (validated on the server), reset.
 *
 * Sounds are per device and already live in the inbox's sound picker; the OS push
 * sound cannot be set by a web app (iOS and Android both refuse) — said, not faked.
 */
const GROUPS: RuleGroup[] = ["any", "social", "content", "messages", "earnings", "downloads", "community", "system"];
const FROMS: RuleFrom[] = ["anyone", "favorites", "close_friends"];
const ACTIONS: RuleAction[] = ["immediate", "summary", "in_app"];

const newId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function patch(body: unknown): Promise<string | null> {
  try {
    const res = await fetch("/api/notification-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't save.";
  } catch {
    return "Network error.";
  }
}

export function NotificationControlCenter({ initialRules }: { initialRules: DeliveryRule[] }) {
  const [rules, setRules] = useState<DeliveryRule[]>(initialRules);
  const [draft, setDraft] = useState<{ group: RuleGroup; from: RuleFrom; then: RuleAction } | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [suggestions, setSuggestions] = useState<RuleSuggestion[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [backupBusy, setBackupBusy] = useState<"import" | "reset" | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const file = useRef<HTMLInputElement | null>(null);

  // draw first, then save; a refusal puts the old list back and says why
  const commit = (next: DeliveryRule[]) => {
    const prev = rules;
    setRules(next);
    setNote(null);
    void patch({ rules: next }).then((err) => {
      if (err) {
        setRules(prev);
        setNote({ ok: false, text: err });
      }
    });
  };

  const addDraft = () => {
    if (!draft) return;
    haptic("selection");
    commit([...rules, { id: newId(), when: { group: draft.group, from: draft.from }, then: draft.then }]);
    setDraft(null);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    haptic("selection");
    const next = [...rules];
    [next[i], next[j]] = [next[j]!, next[i]!];
    commit(next);
  };
  const remove = (id: string) => {
    haptic("light");
    commit(rules.filter((r) => r.id !== id));
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const res = await fetch("/api/notification-settings/suggestions", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { suggestions?: RuleSuggestion[] };
      setSuggestions(res.ok ? (j.suggestions ?? []) : []);
    } catch {
      setSuggestions([]);
    } finally {
      setSuggesting(false);
    }
  };
  const apply = (s: RuleSuggestion) => {
    haptic("selection");
    commit([...rules, { id: newId(), ...s.rule }]);
    setSuggestions((list) => (list ?? []).filter((x) => x.group !== s.group));
  };

  const exportSettings = async () => {
    haptic("selection");
    const res = await fetch("/api/notification-settings", { cache: "no-store" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { settings?: Record<string, unknown> } | null;
    if (!j?.settings) return setNote({ ok: false, text: "Couldn't export." });
    const { lastDigestSentAt: _s, ...settings } = j.settings;
    const blob = new Blob([JSON.stringify({ app: "frenz", kind: "notification-settings", version: 1, settings }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "frenz-notification-settings.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const importSettings = async (f: File) => {
    setBackupBusy("import");
    setNote(null);
    try {
      if (f.size > 64_000) throw new Error("That file is too large to be a settings backup.");
      const parsed = JSON.parse(await f.text()) as { kind?: string; settings?: Record<string, unknown> };
      if (parsed.kind !== "notification-settings" || !parsed.settings) throw new Error("That isn't a Frenz notification settings file.");
      const { lastDigestSentAt: _s, ...settings } = parsed.settings;
      // the server validates every field again (zod + cleanRules); unknown keys are dropped
      const err = await patch(settings);
      if (err) throw new Error(err);
      setNote({ ok: true, text: "Imported. Reloading your settings…" });
      window.location.reload();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Couldn't import that file." });
    } finally {
      setBackupBusy(null);
    }
  };

  const reset = async () => {
    if (!resetArmed) return setResetArmed(true);
    setBackupBusy("reset");
    const err = await patch({ reset: true });
    setBackupBusy(null);
    setResetArmed(false);
    if (err) return setNote({ ok: false, text: err });
    setNote({ ok: true, text: "Back to the defaults. Reloading…" });
    window.location.reload();
  };

  return (
    <div id="control-center" className="scroll-mt-24 p-6 sm:p-8">
      <div className="mb-1 flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="text-base font-semibold">Delivery rules</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Decide how each kind of notification reaches you. The first rule that matches wins. Security alerts always arrive, and nothing breaks through Do Not Disturb or a focus mode.
      </p>

      {rules.length ? (
        <ol className="space-y-2">
          {rules.map((r, i) => (
            <li key={r.id} className="flex items-center gap-2 rounded-2xl border border-border/60 bg-secondary/15 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 text-[13.5px] font-medium">{describeRule(r)}</span>
              <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="inline-flex h-11 w-9 items-center justify-center rounded-xl text-muted-foreground disabled:opacity-30">
                <ArrowUp className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" aria-label="Move down" disabled={i === rules.length - 1} onClick={() => move(i, 1)} className="inline-flex h-11 w-9 items-center justify-center rounded-xl text-muted-foreground disabled:opacity-30">
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" aria-label={`Delete rule: ${describeRule(r)}`} onClick={() => remove(r.id)} className="inline-flex h-11 w-9 items-center justify-center rounded-xl text-muted-foreground">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-2xl border border-dashed border-border/70 p-4 text-center text-[13px] text-muted-foreground">No rules yet. Everything follows your switches above.</p>
      )}

      {draft ? (
        <div className="mt-3 space-y-2.5 rounded-2xl border border-primary/30 bg-primary/5 p-3.5">
          <RuleSelect label="When" value={draft.group} options={GROUPS} labels={RULE_GROUP_LABEL} onChange={(v) => setDraft({ ...draft, group: v })} />
          <RuleSelect label="From" value={draft.from} options={FROMS} labels={{ ...RULE_FROM_LABEL, anyone: "anyone" }} onChange={(v) => setDraft({ ...draft, from: v })} />
          <RuleSelect label="Then" value={draft.then} options={ACTIONS} labels={RULE_ACTION_LABEL} onChange={(v) => setDraft({ ...draft, then: v })} />
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={addDraft} className="min-h-11 flex-1 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
              Add rule
            </button>
            <button type="button" onClick={() => setDraft(null)} className="min-h-11 rounded-xl bg-secondary px-4 text-sm font-semibold text-muted-foreground">
              Cancel
            </button>
          </div>
        </div>
      ) : rules.length < MAX_RULES ? (
        <button type="button" onClick={() => setDraft({ group: "social", from: "anyone", then: "summary" })} className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-secondary px-4 text-sm font-semibold">
          <Plus className="h-4 w-4" aria-hidden /> Add a rule
        </button>
      ) : null}

      {/* Suggested rules */}
      <div className="mt-6 rounded-2xl border border-border/60 bg-secondary/15 p-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <ListChecks className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Suggested rules</span>
            <span className="block text-xs text-muted-foreground">Based on how many notifications each kind sent you in the last 7 days.</span>
          </span>
          {suggestions === null ? (
            <button type="button" onClick={() => void suggest()} disabled={suggesting} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-secondary px-3.5 text-[13px] font-semibold">
              {suggesting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Check
            </button>
          ) : null}
        </div>
        {suggestions?.length ? (
          <ul className="mt-3 space-y-2">
            {suggestions.map((s) => (
              <li key={s.group} className="flex items-center gap-2 rounded-xl bg-background/70 p-3">
                <span className="min-w-0 flex-1 text-[13px]">{s.text}</span>
                <button type="button" onClick={() => apply(s)} className="min-h-11 shrink-0 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground">
                  Apply
                </button>
              </li>
            ))}
          </ul>
        ) : suggestions ? (
          <p className="mt-2 text-[12.5px] text-muted-foreground">Nothing to suggest. No kind of notification has been noisy this week.</p>
        ) : null}
      </div>

      {/* Profiles = the focus modes that already exist */}
      <Link href="/account/presence" className="mt-3 flex min-h-11 items-center gap-3 rounded-2xl border border-border/60 bg-secondary/15 p-3.5 transition hover:border-foreground/15">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
          <Moon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Notification profiles</span>
          <span className="block text-xs text-muted-foreground">Sleep, Work, Meeting, Driving, Gaming, Vacation, on a schedule or by hand. Set them in Presence and focus.</span>
        </span>
      </Link>

      {/* Backup */}
      <div className="mt-6">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">Backup</p>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={() => void exportSettings()} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-secondary px-2 text-[13px] font-semibold">
            <Download className="h-4 w-4" aria-hidden /> Export
          </button>
          <button type="button" onClick={() => file.current?.click()} disabled={backupBusy === "import"} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-secondary px-2 text-[13px] font-semibold">
            {backupBusy === "import" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />} Import
          </button>
          <button type="button" onClick={() => void reset()} disabled={backupBusy === "reset"} className={cn("inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold", resetArmed ? "bg-red-500 text-white" : "bg-secondary")}>
            {backupBusy === "reset" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />} {resetArmed ? "Tap to reset" : "Reset"}
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importSettings(f);
          }}
        />
        <p className="mt-2 text-[11.5px] text-muted-foreground">Reset puts every switch back to its default and removes your rules. Notification sounds are set per device, in Chats.</p>
      </div>

      {note ? <p className={cn("mt-3 text-sm", note.ok ? "text-green-600 dark:text-green-500" : "text-red-500")}>{note.text}</p> : null}
    </div>
  );
}

function RuleSelect<T extends string>({ label, value, options, labels, onChange }: { label: string; value: T; options: T[]; labels: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center gap-3 text-xs font-semibold text-muted-foreground">
      <span className="w-10 shrink-0">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-border/60 bg-background px-3 text-sm font-medium text-foreground">
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o]}
          </option>
        ))}
      </select>
    </label>
  );
}
