"use client";

import { useEffect, useState } from "react";

import { formatFgc, type GiftSticker, parseFgc, STICKER_RARITIES, type StickerFields, stickerFieldProblem, type StickerRarity } from "@/lib/gift/stickers";

import { postMoney, useAdminRead } from "../frenz-coin/coin-admin-data";
import { Badge, BTN, Card, Empty, Field, INPUT, Message, Toggle, when } from "../frenz-coin/coin-admin-ui";

type SensitiveFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
type Revision = { revision: number; name: string; priceFgc: number; published: boolean; archivedAt: string | null; changed: string[]; at: string };

interface Draft {
  slug: string;
  name: string;
  description: string;
  rarity: StickerRarity;
  price: string;
  imageUrl: string | null;
  animationUrl: string | null;
  category: string;
  featured: boolean;
  published: boolean;
  sortOrder: string;
}

const blank: Draft = { slug: "", name: "", description: "", rarity: "common", price: "", imageUrl: null, animationUrl: null, category: "", featured: false, published: false, sortOrder: "0" };
const fromSticker = (s: GiftSticker): Draft => ({
  slug: s.slug,
  name: s.name,
  description: s.description ?? "",
  rarity: s.rarity,
  price: formatFgc(s.priceFgc).replace(/,/g, ""),
  imageUrl: s.imageUrl,
  animationUrl: s.animationUrl,
  category: s.category ?? "",
  featured: s.featured,
  published: s.published,
  sortOrder: String(s.sortOrder),
});
const RARITY_TONE: Record<StickerRarity, "gray" | "blue" | "amber" | "rose"> = { common: "gray", rare: "blue", epic: "rose", legendary: "amber" };

/** The fields that differ from the sticker (all of them for a new one). Price is parsed exactly; a bad price → NaN, refused by the check. */
function fieldsFor(d: Draft, s: GiftSticker | null): StickerFields {
  const price = parseFgc(d.price) ?? Number.NaN;
  const all: StickerFields = {
    name: d.name,
    description: d.description.trim() ? d.description.trim() : null,
    rarity: d.rarity,
    priceFgc: price,
    imageUrl: d.imageUrl,
    animationUrl: d.animationUrl,
    category: d.category.trim() ? d.category.trim().toLowerCase() : null,
    featured: d.featured,
    published: d.published,
    sortOrder: /^\d{1,6}$/.test(d.sortOrder) ? Number(d.sortOrder) : Number.NaN,
  };
  if (!s) return { slug: d.slug.trim(), ...all };
  const cur: StickerFields = { name: s.name, description: s.description, rarity: s.rarity, priceFgc: s.priceFgc, imageUrl: s.imageUrl, animationUrl: s.animationUrl, category: s.category, featured: s.featured, published: s.published, sortOrder: s.sortOrder };
  return Object.fromEntries(Object.entries(all).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(cur[k as keyof StickerFields]))) as StickerFields;
}

/**
 * Admin → Frenz Coin → Stickers (Frenz Gift Coin Part 3). The catalogue the sticker gallery will sell: create, upload
 * artwork, edit name / description / rarity / category, price in FGC, feature, publish or unpublish, order, archive
 * ("remove from the gallery" — never deleted, history kept). Saves go through /api/admin/gift/stickers (a fresh
 * password, validated again by the database, which keeps every revision and audits it). Nothing is priced until an
 * administrator types a price.
 */
export function GiftStickers({ sensitiveFetch }: { sensitiveFetch: SensitiveFetch }) {
  const list = useAdminRead<{ stickers: GiftSticker[] }>("/api/admin/gift/stickers");
  const [editing, setEditing] = useState<GiftSticker | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (list.loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (list.error && !list.data) return <Message kind="error">{list.error}</Message>;
  const stickers = list.data?.stickers ?? [];

  if (editing) {
    return (
      <StickerEditor
        key={editing === "new" ? "new" : `${editing.id}:${editing.revision}`}
        sticker={editing === "new" ? null : editing}
        sensitiveFetch={sensitiveFetch}
        onDone={async (text) => {
          setEditing(null);
          setNotice(text);
          await list.reload();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card
        title="Sticker catalogue"
        action={
          <div className="flex gap-2">
            <button type="button" className={`${BTN} border border-border`} onClick={() => void list.reload()} disabled={list.refreshing}>
              {list.refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button type="button" className={`${BTN} bg-foreground text-background`} onClick={() => { setNotice(null); setEditing("new"); }}>
              New sticker
            </button>
          </div>
        }
      >
        {notice ? <div className="mb-3"><Message kind="ok">{notice}</Message></div> : null}
        <p className="mb-3 text-xs text-muted-foreground">Members see published stickers in display order. Unpublished and archived stickers can&apos;t be bought. Completed gifts keep the name, price and artwork they were sent with.</p>
        {stickers.length === 0 ? (
          <Empty>No stickers yet. Create one, upload its artwork, set a price in FGC, then publish it.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {stickers.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- admin-only list of uploaded artwork */}
                  {s.imageUrl ? <img src={s.imageUrl} alt="" className="h-full w-full object-contain" loading="lazy" /> : <span className="text-[10px] text-muted-foreground">No art</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{s.name}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{formatFgc(s.priceFgc)} FGC</span>
                    <span>· order {s.sortOrder}</span>
                    {s.category ? <span>· {s.category}</span> : null}
                    <span>· rev {s.revision}</span>
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {s.rarity !== "common" ? <Badge tone={RARITY_TONE[s.rarity]}>{s.rarity}</Badge> : null}
                  {s.featured ? <Badge tone="blue">featured</Badge> : null}
                  {s.archivedAt ? <Badge tone="gray">archived</Badge> : s.published ? <Badge tone="green">published</Badge> : <Badge tone="amber">draft</Badge>}
                </div>
                <button type="button" className={`${BTN} border border-border`} onClick={() => { setNotice(null); setEditing(s); }} aria-label={`Edit ${s.name}`}>
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StickerEditor({ sticker, sensitiveFetch, onDone, onCancel }: { sticker: GiftSticker | null; sensitiveFetch: SensitiveFetch; onDone: (msg: string) => void | Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(() => (sticker ? fromSticker(sticker) : blank));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const history = useAdminRead<{ revisions: Revision[] }>(sticker ? `/api/admin/gift/stickers?id=${sticker.id}` : null);

  const fields = fieldsFor(d, sticker);
  const changes = Object.keys(fields).length;
  const problem = changes ? stickerFieldProblem(fields, !sticker) : null;
  const dirty = changes > 0;
  const err = (f: keyof StickerFields) => (problem?.field === f ? problem.message : undefined);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setMsg(null);
    setD((x) => ({ ...x, [k]: v }));
  };

  const upload = async (file: File) => {
    setUploading(true);
    setMsg(null);
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/admin/gift/stickers/artwork", { method: "POST", body, credentials: "same-origin" });
      const json = (await res.json().catch(() => null)) as { image?: string; animation?: string | null; error?: string } | null;
      if (!res.ok || !json?.image) setMsg(json?.error ?? "Couldn't upload the artwork.");
      else setD((x) => ({ ...x, imageUrl: json.image!, animationUrl: json.animation ?? null }));
    } catch {
      setMsg("Couldn't reach the server.");
    }
    setUploading(false);
  };

  const save = async (extra: StickerFields = {}) => {
    const send = { ...fields, ...extra };
    if (busy || !Object.keys(send).length) return;
    const p = stickerFieldProblem(send, !sticker);
    if (p) return setMsg(p.message);
    setBusy(true);
    setMsg(null);
    const r = await postMoney<{ sticker: GiftSticker; unchanged: boolean; changed: string[] }>(sensitiveFetch, "/api/admin/gift/stickers", { id: sticker?.id ?? null, expectedRevision: sticker?.revision ?? null, fields: send });
    setBusy(false);
    if (!r.ok) return setMsg(r.error);
    await onDone(r.data.unchanged ? "Nothing changed." : `${r.data.sticker.name} saved (revision ${r.data.sticker.revision}: ${r.data.changed.join(", ")}). Recorded in the audit log.`);
  };

  const leave = () => {
    if (dirty && !window.confirm("Discard your unsaved changes to this sticker?")) return;
    onCancel();
  };

  return (
    <div className="space-y-5">
      <Card title={sticker ? `Edit ${sticker.name}` : "New sticker"} action={<button type="button" className={`${BTN} border border-border`} onClick={leave}>Back to the catalogue</button>}>
        {sticker?.archivedAt ? <div className="mb-3"><Message kind="info">Archived {when(sticker.archivedAt)}: not in the gallery and can&apos;t be bought. Restore it to sell it again.</Message></div> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-4 sm:row-span-3">
            <div className="flex h-36 w-36 items-center justify-center overflow-hidden rounded-2xl bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of uploaded artwork */}
              {d.animationUrl || d.imageUrl ? <img src={(d.animationUrl ?? d.imageUrl)!} alt={d.name ? `${d.name} artwork` : "Sticker artwork"} className="h-full w-full object-contain" /> : <span className="text-xs text-muted-foreground">No artwork</span>}
            </div>
            <label className={`${BTN} cursor-pointer border border-border`}>
              {uploading ? "Uploading…" : d.imageUrl ? "Replace artwork" : "Upload artwork"}
              <input type="file" accept="image/png,image/webp,image/gif,image/jpeg" className="sr-only" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            </label>
            <span className="text-center text-[11px] text-muted-foreground">PNG, WebP, GIF or JPEG up to 8 MB. Stored as a 512 px WebP; an animated GIF/WebP keeps its animation for the gift itself, and the gallery shows a still frame.</span>
          </div>
          <Field htmlFor="st-slug" label="Slug" hint={sticker ? "Fixed once created" : "e.g. red-rose. Lowercase, numbers and dashes."} error={err("slug")}>
            <input id="st-slug" className={INPUT} value={d.slug} disabled={!!sticker} onChange={(e) => set("slug", e.target.value)} />
          </Field>
          <Field htmlFor="st-name" label="Name" hint="Up to 40 characters" error={err("name")}>
            <input id="st-name" className={INPUT} value={d.name} maxLength={40} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field htmlFor="st-price" label="Price (FGC)" hint="Paid by the sender in Gift Coins, up to 2 decimals" error={err("priceFgc")}>
            <input id="st-price" inputMode="decimal" className={INPUT} value={d.price} onChange={(e) => set("price", e.target.value)} />
          </Field>
          <Field htmlFor="st-desc" label="Description" hint="Optional, up to 200 characters" error={err("description")}>
            <input id="st-desc" className={INPUT} value={d.description} maxLength={200} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field htmlFor="st-rarity" label="Rarity" hint="Rare and above are tagged in the gallery" error={err("rarity")}>
            <select id="st-rarity" className={INPUT} value={d.rarity} onChange={(e) => set("rarity", e.target.value as StickerRarity)}>
              {STICKER_RARITIES.map((r) => (
                <option key={r} value={r}>
                  {r[0]!.toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="st-cat" label="Category" hint="A gallery chip, e.g. love, fun, luxe (optional)" error={err("category")}>
            <input id="st-cat" className={INPUT} value={d.category} maxLength={24} onChange={(e) => set("category", e.target.value)} />
          </Field>
          <Field htmlFor="st-order" label="Display order" hint="Lower shows first (0 to 100000)" error={err("sortOrder")}>
            <input id="st-order" inputMode="numeric" className={INPUT} value={d.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
          </Field>
          <div className="flex flex-col gap-3">
            <Toggle id="st-featured" label="Featured" checked={d.featured} onChange={(v) => set("featured", v)} hint="Shown in the gallery's banner" />
            <Toggle id="st-published" label="Published" checked={d.published} onChange={(v) => set("published", v)} hint={d.imageUrl ? "Members can buy it" : "Needs artwork first"} />
          </div>
        </div>
      </Card>

      {sticker ? (
        <Card title="History">
          {history.loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : history.error ? (
            <Message kind="error">{history.error}</Message>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {(history.data?.revisions ?? []).map((h) => (
                <li key={h.revision} className="flex flex-wrap gap-x-2 text-muted-foreground">
                  <span className="font-semibold text-foreground">Rev {h.revision}</span>
                  <span>{when(h.at)}</span>
                  <span>· {h.name}</span>
                  <span>· {formatFgc(h.priceFgc)} FGC</span>
                  <span>· {h.changed.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <div className="sticky bottom-3 z-10 rounded-2xl border border-border bg-card/95 p-3 shadow-card backdrop-blur">
        {msg ? <div className="mb-3"><Message kind="error">{msg}</Message></div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{problem ? problem.message : dirty ? `${changes} unsaved change${changes === 1 ? "" : "s"}` : "No changes"} · saving asks for your password</span>
          <div className="flex flex-wrap gap-2">
            {sticker ? (
              <button type="button" className={`${BTN} border border-border`} disabled={busy || dirty} title={dirty ? "Save or discard your changes first" : undefined} onClick={() => void save({ archived: !sticker.archivedAt })}>
                {sticker.archivedAt ? "Restore" : "Archive (remove from gallery)"}
              </button>
            ) : null}
            <button type="button" className={`${BTN} bg-foreground text-background`} disabled={busy || uploading || !dirty || !!problem} aria-busy={busy} onClick={() => void save()}>
              {busy ? "Saving…" : sticker ? "Save sticker" : "Create sticker"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
