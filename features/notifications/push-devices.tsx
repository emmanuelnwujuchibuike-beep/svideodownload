"use client";

import { Check, Laptop, Loader2, Monitor, Pencil, Send, Smartphone, Tablet, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { haptic } from "@/lib/motion/haptics";
import { serviceWorkerContainer } from "@/lib/pwa/service-worker-container";
import { cn } from "@/lib/utils";

/**
 * NOTIFICATION DEVICES (Feature 20 Part 6) — every device that receives this
 * member's push notifications, from /api/push/devices: its name, your label, the
 * LAST delivery and how it went, 7-day sent / failed counts, and per device:
 * rename, send a test, stop notifications there.
 *
 * Sign-in sessions are a different list (/account/devices); this is only about
 * where a push lands. "This device" is matched by a short hash of this browser's
 * own push endpoint, computed here — the server never hands an endpoint out.
 *
 * Read when the section opens — never polled.
 */
interface Device {
  id: string;
  key: string;
  name: string;
  platform: "ios" | "android" | "windows" | "mac" | "linux" | "other";
  label: string | null;
  addedAt: string;
  last: { status: string; at: string } | null;
  sent7d: number;
  failed7d: number;
}

const ICON = { ios: Smartphone, android: Smartphone, windows: Monitor, mac: Laptop, linux: Monitor, other: Tablet } as const;
const STATUS: Record<string, { text: string; tone: string }> = {
  sent: { text: "Delivered", tone: "text-emerald-600 dark:text-emerald-400" },
  retried: { text: "Delivered on retry", tone: "text-emerald-600 dark:text-emerald-400" },
  failed: { text: "Failed", tone: "text-red-500" },
  pruned: { text: "Expired — turn notifications on again there", tone: "text-amber-600 dark:text-amber-400" },
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

async function thisDeviceKey(): Promise<string | null> {
  try {
    const sw = serviceWorkerContainer();
    const reg = sw ? await sw.getRegistration() : null;
    const sub = await reg?.pushManager.getSubscription();
    if (!sub?.endpoint || !crypto.subtle) return null;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint));
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  } catch {
    return null;
  }
}

export function PushDevices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [mine, setMine] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [note, setNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/push/devices", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { devices: Device[] }) => alive && setDevices(j.devices))
      .catch(() => alive && setFailed(true));
    void thisDeviceKey().then((k) => alive && setMine(k));
    return () => {
      alive = false;
    };
  }, []);

  const call = async (method: "POST" | "PATCH" | "DELETE", body: unknown) => {
    const res = await fetch("/api/push/devices", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { error?: string; ok?: boolean; status?: string } | null;
    return { ok: !!res?.ok, j };
  };

  const test = async (d: Device) => {
    haptic("selection");
    setBusy(d.id);
    setNote(null);
    const { ok, j } = await call("POST", { id: d.id });
    setBusy(null);
    const delivered = ok && j?.ok;
    setNote({ id: d.id, ok: !!delivered, text: delivered ? "Test sent — check that device." : (j?.error ?? (j?.status === "pruned" ? "That device's subscription has expired. Turn notifications on again there." : "The push service refused it.")) });
    if (j?.status) setDevices((list) => (list ?? []).map((x) => (x.id === d.id ? { ...x, last: { status: j.status!, at: new Date().toISOString() } } : x)));
  };

  const saveName = async () => {
    if (!renaming) return;
    const { id, value } = renaming;
    const label = value.trim() || null;
    const prev = devices;
    setDevices((list) => (list ?? []).map((x) => (x.id === id ? { ...x, label } : x)));
    setRenaming(null);
    const { ok, j } = await call("PATCH", { id, label });
    if (!ok) {
      setDevices(prev);
      setNote({ id, ok: false, text: j?.error ?? "Couldn't rename it." });
    }
  };

  const remove = async (d: Device) => {
    if (!window.confirm(`Stop notifications on ${d.label ?? d.name}?`)) return;
    haptic("light");
    const prev = devices;
    setDevices((list) => (list ?? []).filter((x) => x.id !== d.id));
    const { ok } = await call("DELETE", { id: d.id });
    if (!ok) {
      setDevices(prev);
      setNote({ id: d.id, ok: false, text: "Couldn't remove it." });
    }
  };

  return (
    <div id="devices" className="scroll-mt-24 border-t border-border/60 p-6 sm:p-8">
      <h2 className="text-base font-semibold">Devices that get notifications</h2>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">Every phone and browser where push is on. Each one shows its last delivery, so you can see why something didn&apos;t arrive.</p>
      {failed ? (
        <p className="text-[13px] text-muted-foreground">Couldn&apos;t load your devices. Try again in a moment.</p>
      ) : !devices ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      ) : !devices.length ? (
        <p className="rounded-2xl border border-dashed border-border/70 p-4 text-center text-[13px] text-muted-foreground">No device has push turned on yet. Turn on push above, on each device you use.</p>
      ) : (
        <ul className="space-y-2">
          {devices.map((d) => {
            const Icon = ICON[d.platform];
            const st = d.last ? (STATUS[d.last.status] ?? { text: d.last.status, tone: "text-muted-foreground" }) : null;
            return (
              <li key={d.id} className="rounded-2xl border border-border/60 bg-secondary/15 p-3.5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    {renaming?.id === d.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={renaming.value}
                          maxLength={40}
                          onChange={(e) => setRenaming({ id: d.id, value: e.target.value })}
                          onKeyDown={(e) => (e.key === "Enter" ? void saveName() : e.key === "Escape" ? setRenaming(null) : undefined)}
                          className="min-h-10 min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-2.5 text-sm"
                          aria-label="Device name"
                        />
                        <button type="button" aria-label="Save name" onClick={() => void saveName()} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                          <Check className="h-4 w-4" aria-hidden />
                        </button>
                        <button type="button" aria-label="Cancel" onClick={() => setRenaming(null)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                          <X className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    ) : (
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                        {d.label ?? d.name}
                        {mine && mine === d.key ? <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">This device</span> : null}
                      </p>
                    )}
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {d.label ? `${d.name} · ` : ""}added {ago(d.addedAt)}
                    </p>
                    <p className="mt-1 text-[12px]">
                      {st ? (
                        <>
                          <span className={cn("font-semibold", st.tone)}>{st.text}</span>
                          <span className="text-muted-foreground"> · {ago(d.last!.at)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Nothing sent in the last 7 days</span>
                      )}
                      {d.sent7d || d.failed7d ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · 7 days: {d.sent7d} delivered{d.failed7d ? `, ${d.failed7d} failed` : ""}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  <button type="button" onClick={() => void test(d)} disabled={busy === d.id} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-secondary text-[12.5px] font-semibold">
                    {busy === d.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Test
                  </button>
                  <button type="button" onClick={() => setRenaming({ id: d.id, value: d.label ?? d.name })} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-secondary text-[12.5px] font-semibold">
                    <Pencil className="h-4 w-4" aria-hidden /> Rename
                  </button>
                  <button type="button" onClick={() => void remove(d)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-secondary text-[12.5px] font-semibold text-red-500">
                    <Trash2 className="h-4 w-4" aria-hidden /> Remove
                  </button>
                </div>
                {note?.id === d.id ? <p className={cn("mt-2 text-[12.5px]", note.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>{note.text}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
