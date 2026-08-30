"use client";

import { AlertTriangle, Loader2, Megaphone, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  AD_FORMATS,
  AD_FORMAT_META,
  AD_ZONES,
  AD_ZONE_META,
  EXOCLICK_ZONE_SURFACE,
  isExoClickZone,
  looksLikeHijackScript,
} from "@/lib/monetization/ad-schema";
import type { AdRecord } from "@/lib/monetization/ads";
import { cn } from "@/lib/utils";

type Zone = (typeof AD_ZONES)[number];
type Format = (typeof AD_FORMATS)[number];

interface FormState {
  zone: Zone;
  network: string;
  format: Format;
  script_code: string;
  image_url: string;
  target_url: string;
  headline: string;
  width: string;
  height: string;
  ad_client: string;
  ad_slot_id: string;
  ad_layout: string;
  skippable: boolean;
  skip_after_seconds: number;
  priority: number;
  weight: number;
  active: boolean;
}

const EMPTY: FormState = {
  zone: "under_download",
  network: "adsense",
  format: "adsense",
  script_code: "",
  image_url: "",
  target_url: "",
  headline: "",
  width: "",
  height: "",
  ad_client: "",
  ad_slot_id: "",
  ad_layout: "auto",
  skippable: true,
  skip_after_seconds: 5,
  priority: 100,
  weight: 1,
  active: true,
};

const recordToForm = (r: AdRecord): FormState => ({
  zone: r.zone as Zone,
  network: r.network,
  /*
    Falls back for a row whose stored format is not in the list — a hand-edited
    value, or one from a version where the set differed. Showing something
    selectable keeps the edit form usable; showing the raw value would render an
    empty dropdown that silently rewrites the row on save.
  */
  format: (AD_FORMATS as readonly string[]).includes(r.format) ? (r.format as Format) : "display",
  script_code: r.script_code ?? "",
  image_url: r.image_url ?? "",
  target_url: r.target_url ?? "",
  headline: r.headline ?? "",
  width: r.width != null ? String(r.width) : "",
  height: r.height != null ? String(r.height) : "",
  ad_client: r.ad_client ?? "",
  ad_slot_id: r.ad_slot_id ?? "",
  ad_layout: r.ad_layout ?? "auto",
  skippable: r.skippable ?? true,
  skip_after_seconds: r.skip_after_seconds ?? 5,
  priority: r.priority,
  weight: r.weight,
  active: r.active,
});

export function AdManager({ ads }: { ads: AdRecord[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openNew = () => {
    setForm(EMPTY);
    setErr(null);
    setEditing("new");
  };
  const openEdit = (r: AdRecord) => {
    setForm(recordToForm(r));
    setErr(null);
    setEditing(r.id);
  };
  const close = () => {
    setEditing(null);
    setErr(null);
  };

  const payload = () => ({
    zone: form.zone,
    network: form.network.trim(),
    format: form.format,
    script_code: form.script_code.trim() || null,
    image_url: form.image_url.trim() || null,
    target_url: form.target_url.trim() || null,
    headline: form.headline.trim() || null,
    width: form.width ? Number(form.width) : null,
    height: form.height ? Number(form.height) : null,
    /*
      Sent only for AdSense rows. Posting a stale publisher id alongside a
      display row would satisfy the database CHECK (which only fires the other
      way) and leave a misleading value behind after a format change.
    */
    ad_client: form.format === "adsense" ? form.ad_client.trim() || null : null,
    /*
      Sent for AdSense AND ExoClick — the column holds "the network's numeric id
      for this placement", which is an ad unit id for one and a Zone ID for the
      other. Still cleared for every other format, so a format change cannot
      leave a stale id behind that the next reader would misinterpret.
    */
    ad_slot_id:
      form.format === "adsense" || form.format === "exoclick"
        ? form.ad_slot_id.trim() || null
        : null,
    ad_layout: form.format === "adsense" ? form.ad_layout.trim() || null : null,
    skippable: form.skippable,
    skip_after_seconds: form.skip_after_seconds,
    priority: form.priority,
    weight: form.weight,
    active: form.active,
  });

  const save = async () => {
    if (!form.network.trim()) {
      setErr("Network is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const isNew = editing === "new";
      const res = await fetch(isNew ? "/api/admin/ads" : `/api/admin/ads/${editing}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Failed to save.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this ad placement?")) return;
    await fetch(`/api/admin/ads/${id}`, { method: "DELETE" });
    router.refresh();
  };

  /*
    🔴 The list is GROUPED BY NETWORK (owner, 2026-08-30: "the add placement
    settings is confusing, i want the exoclick placement should be separated and
    identified so i dont mistake it for adsterra slot").

    Every row used to render identically — same layout, same badge colours — and
    the only thing telling two networks apart was a free-text `network` field the
    operator typed themselves. On a list of a dozen placements that is not a
    distinction anyone can scan, and mixing up which row belongs to which network
    is how the wrong unit gets switched off.

    ExoClick is grouped on its FORMAT, not on that typed name: the format is
    structural and cannot be misspelled, whereas `network` is whatever was typed
    into the box. Everything else groups by the network name, lowercased so
    "Adsterra" and "adsterra" are one group rather than two.
  */
  const groups = useMemo(() => {
    const byKey = new Map<string, { label: string; exoclick: boolean; rows: AdRecord[] }>();
    for (const r of ads) {
      const exoclick = r.format === "exoclick";
      const key = exoclick ? "\0exoclick" : (r.network || "—").trim().toLowerCase();
      const existing = byKey.get(key);
      if (existing) existing.rows.push(r);
      else {
        byKey.set(key, {
          // The first row's own casing, so a group reads the way the operator
          // typed it rather than force-lowercased back at them.
          label: exoclick ? "ExoClick" : (r.network || "Unlabelled").trim(),
          exoclick,
          rows: [r],
        });
      }
    }
    // ExoClick first — it is the one being actively configured — then the rest
    // alphabetically so the order is stable between renders and refreshes.
    return [...byKey.entries()]
      .sort(([a], [b]) => (a === "\0exoclick" ? -1 : b === "\0exoclick" ? 1 : a.localeCompare(b)))
      .map(([key, g]) => ({ key, ...g }));
  }, [ads]);

  const toggleActive = async (r: AdRecord) => {
    await fetch(`/api/admin/ads/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    router.refresh();
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card px-3 py-6 sm:px-6 shadow-card">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Megaphone className="h-5 w-5 text-primary" /> Ad placements
        </h2>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        One row per placement, <strong>grouped by network</strong>. Pick the format that matches the
        code your network gave you — a <strong>banner</strong> and a <strong>Social Bar</strong> use
        the same host but need different formats here.
        {/*
          "the global toggles above" was written when this panel and the switches
          were one scrolling column. They are separate TABS now, so "above" points
          at nothing and the sentence reads as a missing control.
        */}{" "}
        Every network is additionally gated by its switch in the <em>Ad settings</em> tab — a row
        marked <strong>Live</strong> here still serves nothing if its network is off there.
      </p>

      {editing ? (
        <AdForm
          form={form}
          setForm={setForm}
          onSave={save}
          onCancel={close}
          busy={busy}
          err={err}
          isNew={editing === "new"}
        />
      ) : null}

      {ads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No ad placements yet. Add one and seed your network embed code.
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div
              key={g.key}
              className={cn(
                // ExoClick gets a real container — a rule and a heading are not
                // enough to stop a mis-tap on a list that scrolls.
                g.exoclick &&
                  "rounded-2xl border border-violet-500/30 bg-violet-500/[0.04] p-3 sm:p-4",
              )}
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <h3
                  className={cn(
                    "text-xs font-bold uppercase tracking-[0.08em]",
                    g.exoclick ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground",
                  )}
                >
                  {g.label}
                </h3>
                <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {g.rows.length} {g.rows.length === 1 ? "placement" : "placements"}
                </span>
              </div>
              {/*
                Said on the GROUP, once, rather than on every row: a "Live" pill
                on an ExoClick row means the ROW is enabled, which is not the
                same as the network serving. Without this, five rows all reading
                "Live" while nothing renders is completely unexplained.
              */}
              {g.exoclick ? (
                <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                  Vertical 9:16 units. A row marked <strong>Live</strong> still serves nothing until{" "}
                  <strong>ExoClick</strong> is switched on in <em>Ad settings</em> — and each page
                  has its own switch there.
                </p>
              ) : null}

              <ul className="divide-y divide-border/60">
                {g.rows.map((r) => {
                  const exo = r.format === "exoclick";
                  const surface = isExoClickZone(r.zone) ? EXOCLICK_ZONE_SURFACE[r.zone] : null;
                  return (
                    <li key={r.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Human labels, matching the form. An operator scanning this
                              list should not have to translate `result_top` or `pop`. */}
                          <span className="text-sm font-semibold">
                            {AD_ZONE_META[r.zone as keyof typeof AD_ZONE_META]?.label ?? r.zone}
                          </span>
                          {/* The network chip is redundant inside a group named
                              after the network — dropped there, kept nowhere else
                              so nothing is lost. */}
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              exo
                                ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
                                : "bg-primary/10 text-primary",
                            )}
                          >
                            {AD_FORMAT_META[r.format as keyof typeof AD_FORMAT_META]?.label ??
                              r.format}
                          </span>
                          {/*
                            Which per-page switch governs this row. The whole
                            point of the split is "clear the pages AdSense
                            reviews", so the row has to say which side it is on
                            — otherwise that decision means opening two tabs and
                            cross-referencing zone names.
                          */}
                          {surface ? (
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                surface === "marketing"
                                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                  : "bg-secondary text-muted-foreground",
                              )}
                            >
                              {surface === "marketing" ? "Public · AdSense sees this" : "Signed-in app"}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {/*
                            An ExoClick row has no headline, no script and no
                            target url, so the original fallback rendered a bare
                            "—" — the least useful thing a row could say about
                            itself. The zone id IS the configuration here, so it
                            is what the row shows.
                          */}
                          {exo
                            ? r.ad_slot_id
                              ? `Zone ID ${r.ad_slot_id}`
                              : "No Zone ID — this row cannot serve"
                            : r.headline || (r.script_code ? "script embed" : r.target_url || "—")}
                        </p>
                        {/* Flags EXISTING rows too, not just what is being typed — the
                            ones already live are the ones showing blank right now. */}
                        {r.format === "display" && looksLikeHijackScript(r.script_code) ? (
                          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                            <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
                            In-page script in a Banner slot — renders blank. Change Format, or use a Banner/Video here.
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleActive(r)}
                        aria-pressed={r.active}
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                          r.active ? "bg-green-500/15 text-green-500" : "bg-secondary text-muted-foreground",
                        )}
                      >
                        {r.active ? "Live" : "Off"}
                      </button>
                      <button type="button" onClick={() => openEdit(r)} aria-label="Edit" className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => remove(r.id)} aria-label="Delete" className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-red-400">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AdForm({
  form,
  setForm,
  onSave,
  onCancel,
  busy,
  err,
  isNew,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  err: string | null;
  isNew: boolean;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const input =
    "h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary";
  const label = "mb-1 block text-xs font-medium text-muted-foreground";
  const needsScript = form.format === "display" || form.format === "video";
  const isAdSense = form.format === "adsense";
  const isExoClick = form.format === "exoclick";
  const isNative = form.format === "native";
  const zoneMeta = AD_ZONE_META[form.zone];

  return (
    <div className="mb-5 rounded-2xl border border-primary/30 bg-secondary/20 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">{isNew ? "New ad placement" : "Edit ad"}</p>
        <button type="button" onClick={onCancel} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={label}>Placement</label>
          {/* Human labels, not raw ids. An operator choosing "result_top" cannot
              be expected to know it means the strip above a fetched result, and
              a mis-placed ad is invisible to everyone but the visitor. */}
          <select className={input} value={form.zone} onChange={(e) => set("zone", e.target.value as Zone)}>
            {AD_ZONES.map((z) => (
              <option key={z} value={z}>
                {AD_ZONE_META[z].label}
                {AD_ZONE_META[z].deprecated ? " — legacy" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Network</label>
          <input className={input} value={form.network} onChange={(e) => set("network", e.target.value)} placeholder="adsense / adsterra / house" />
        </div>
        <div>
          <label className={label}>Format</label>
          {/* Labels, not raw ids — `pop` is also how a Social Bar is served,
              which nobody could guess from the word "pop". */}
          <select className={input} value={form.format} onChange={(e) => set("format", e.target.value as Format)}>
            {AD_FORMATS.map((f) => (
              <option key={f} value={f}>
                {AD_FORMAT_META[f].label}
              </option>
            ))}
          </select>
        </div>

        {/* What this placement actually is, in the operator's terms. */}
        <p className="sm:col-span-3 -mt-1 text-xs leading-relaxed text-muted-foreground">
          {zoneMeta.description}
          {zoneMeta.persistent ? " This placement is never dismissible." : ""}
        </p>
        <p className="sm:col-span-3 -mt-2 text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">{AD_FORMAT_META[form.format].label}:</strong>{" "}
          {AD_FORMAT_META[form.format].description}
        </p>

        {isAdSense ? (
          <>
            <div>
              <label className={label}>Publisher ID</label>
              <input className={input} value={form.ad_client} onChange={(e) => set("ad_client", e.target.value)} placeholder="ca-pub-1234567890123456" />
            </div>
            <div>
              <label className={label}>Ad unit ID</label>
              <input className={input} value={form.ad_slot_id} onChange={(e) => set("ad_slot_id", e.target.value)} placeholder="1234567890" />
            </div>
            <div>
              <label className={label}>Ad format</label>
              <select className={input} value={form.ad_layout} onChange={(e) => set("ad_layout", e.target.value)}>
                <option value="auto">auto (responsive)</option>
                <option value="fluid">fluid (in-article)</option>
                <option value="rectangle">rectangle</option>
                <option value="horizontal">horizontal</option>
                <option value="vertical">vertical</option>
              </select>
            </div>
            <p className="sm:col-span-3 text-xs leading-relaxed text-muted-foreground">
              Both IDs come from the AdSense ad unit screen. Leave width and height blank for a
              responsive unit — set them only to pin an exact size.
            </p>
          </>
        ) : null}

        {isExoClick ? (
          <>
            <div className="sm:col-span-1">
              <label className={label}>ExoClick Zone ID</label>
              <input
                className={input}
                inputMode="numeric"
                value={form.ad_slot_id}
                onChange={(e) => set("ad_slot_id", e.target.value)}
                placeholder="1234567"
              />
            </div>
            {/*
              The two things an operator gets wrong here, said before they do.

              (1) Pasting the whole embed. ExoClick's dashboard shows a three-line
              snippet and the natural move is to copy all of it — but the loader
              and the push are already handled once for the whole page, so only
              the number is wanted. (2) Seeding every zone and then reporting that
              nothing shows, because the network switch is off by default and
              deliberately so.
            */}
            <p className="sm:col-span-2 self-end text-xs leading-relaxed text-muted-foreground">
              Just the <strong className="text-foreground">number</strong> from the Zone ID column in
              your ExoClick dashboard — not the <code className="font-mono">&lt;ins&gt;</code> snippet.
              Renders a 9:16 vertical unit.
              <br />
              <strong className="text-amber-600 dark:text-amber-400">
                Nothing serves until you turn on ExoClick
              </strong>{" "}
              in Monetization controls, which is off by default so an AdSense review never meets an
              ExoClick creative by accident.
            </p>
          </>
        ) : null}

        {needsScript ? (
          <div className="sm:col-span-3">
            <label className={label}>
              {form.format === "video" ? "Video URL" : "Embed / script code"}
            </label>
            <textarea
              className="min-h-[90px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
              value={form.script_code}
              onChange={(e) => set("script_code", e.target.value)}
              placeholder={form.format === "video" ? "https://…/ad.mp4" : "<script ...>…</script>"}
            />
            {/*
              The blank-slot warning. Both products are a one-line <script src>,
              so without this an operator has no feedback until a visitor
              complains that a blank area redirects them.
            */}
            {/*
              Fires on a self-injecting script saved as a BANNER. Both fixes are
              offered because the same script host serves two very different
              products — a Social Bar (visible, wants the in-page format) and an
              OnClick unit (invisible, wants the banner code instead). Naming
              only one fix is how "why doesn't my Social Bar show" happens.
            */}
            {form.format === "display" && looksLikeHijackScript(form.script_code) ? (
              <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  This is a <strong>self-injecting script</strong> (Social Bar, Native, interstitial
                  or OnClick — Adsterra&apos;s single <code className="font-mono">&lt;script&gt;</code>{" "}
                  family), not a banner. A banner runs in a sandboxed frame and a script like this
                  cannot attach itself from inside one, so the slot renders <strong>blank</strong>.
                  Pick one of these:
                  <br />
                  <strong className="mt-1 inline-block">Full-screen interstitial or reward slot?</strong>{" "}
                  Use a <strong>Banner</strong> here instead — the network invocation containing{" "}
                  <code className="font-mono">atOptions</code> (set size e.g. 300×600) — or, for a
                  reward, a direct <strong>Video (.mp4) URL</strong>. Both render inside the slot and{" "}
                  <em>don&apos;t</em> need the in-page-scripts switch.
                  <br />
                  <strong className="mt-1 inline-block">Social Bar / other in-page unit?</strong>{" "}
                  Change Format to <em>{AD_FORMAT_META.pop.label}</em> and turn on{" "}
                  <strong>In-page scripts</strong> in Monetization controls. That switch does{" "}
                  <em>not</em> create a pop-under — the behaviour comes from which network zone you
                  made, so a Social Bar zone stays a Social Bar.
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Only for placements the visitor waits through — a skip control on a
            banner is meaningless, and on the reward unit it would break the
            exchange. Read from the zone registry rather than by naming zone ids
            here, which is how three copies of that list came to exist. */}
        {zoneMeta.supportsSkip ? (
          <>
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" checked={form.skippable} onChange={(e) => set("skippable", e.target.checked)} className="h-4 w-4 rounded border-border" />
              Skippable
            </label>
            <div>
              <label className={label}>Skip appears after (seconds)</label>
              <input type="number" min={0} max={120} className={input} value={form.skip_after_seconds} onChange={(e) => set("skip_after_seconds", Number(e.target.value) || 0)} />
            </div>
            <div />
          </>
        ) : null}

        {isNative ? (
          <>
            <div className="sm:col-span-3">
              <label className={label}>Headline</label>
              <input className={input} value={form.headline} onChange={(e) => set("headline", e.target.value)} placeholder="Sponsored headline" />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Target URL</label>
              <input className={input} value={form.target_url} onChange={(e) => set("target_url", e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <label className={label}>Image URL</label>
              <input className={input} value={form.image_url} onChange={(e) => set("image_url", e.target.value)} placeholder="https://…" />
            </div>
          </>
        ) : null}

        {form.format === "display" || isAdSense ? (
          <>
            <div>
              <label className={label}>Width (px)</label>
              <input type="number" className={input} value={form.width} onChange={(e) => set("width", e.target.value)} placeholder="300" />
            </div>
            <div>
              <label className={label}>Height (px)</label>
              <input type="number" className={input} value={form.height} onChange={(e) => set("height", e.target.value)} placeholder="250" />
            </div>
            <div />
          </>
        ) : null}

        <div>
          <label className={label}>Priority</label>
          <input type="number" className={input} value={form.priority} onChange={(e) => set("priority", Number(e.target.value) || 0)} />
        </div>
        <div>
          <label className={label}>Weight</label>
          <input type="number" className={input} value={form.weight} onChange={(e) => set("weight", Number(e.target.value) || 1)} />
        </div>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} className="h-4 w-4 rounded border-border" />
          Live
        </label>
      </div>

      {err ? <p className="mt-3 text-sm text-red-400">{err}</p> : null}

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onSave} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {isNew ? "Create" : "Save changes"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}
