"use client";

import { BAKED_APP_BUILD, fetchServerBuild } from "@/lib/pwa/app-version";

/**
 * Client-side self-diagnostics — "can the application inspect itself."
 * On-demand only (never runs automatically, no background cost) — call it
 * from a future Admin Center diagnostics panel or a browser devtools
 * console command during a support investigation. Not wired into a UI yet:
 * FRENZ_CORE.md's rule is "everything connects through Frenz Admin Center;
 * no per-feature admin panels," so this is the reusable check logic ready
 * for that panel rather than a new ad-hoc debug page bolted on here.
 */

export interface DiagnosticsReport {
  timestamp: number;
  manifest: { ok: boolean; detail: string };
  serviceWorker: { ok: boolean; detail: string };
  storage: { ok: boolean; detail: string; usedMb?: number; quotaMb?: number };
  notifications: { ok: boolean; detail: string };
  connectivity: { ok: boolean; detail: string };
  caches: { ok: boolean; detail: string; names?: string[] };
  appVersion: { ok: boolean; detail: string };
}

async function checkManifest(): Promise<DiagnosticsReport["manifest"]> {
  try {
    const res = await fetch("/manifest.webmanifest", { cache: "no-store" });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const json = await res.json();
    return json?.name ? { ok: true, detail: `"${json.name}", ${(json.icons ?? []).length} icons` } : { ok: false, detail: "missing name field" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "fetch failed" };
  }
}

async function checkServiceWorker(): Promise<DiagnosticsReport["serviceWorker"]> {
  if (!("serviceWorker" in navigator)) return { ok: false, detail: "unsupported in this browser" };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { ok: false, detail: "not registered" };
    const state = reg.active ? "active" : reg.installing ? "installing" : reg.waiting ? "waiting" : "unknown";
    return { ok: !!reg.active, detail: `${state}, scope=${reg.scope}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "check failed" };
  }
}

/** Pure decision logic, split out from the async `navigator.storage.estimate()`
 * read so it's testable without a DOM — same split as memory-pressure.ts's
 * `shouldFlagMemoryPressure()`. `quota === 0` (API present but returned no
 * real reading) is treated as healthy — there's no usable signal to flag on. */
export function isStorageHealthy(usage: number, quota: number): boolean {
  return quota === 0 || usage / quota < 0.9;
}

async function checkStorage(): Promise<DiagnosticsReport["storage"]> {
  if (!navigator.storage?.estimate) return { ok: false, detail: "Storage API unsupported" };
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const usedMb = Math.round(usage / 1_048_576);
    const quotaMb = Math.round(quota / 1_048_576);
    return { ok: isStorageHealthy(usage, quota), detail: `${usedMb}MB / ${quotaMb}MB`, usedMb, quotaMb };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "estimate failed" };
  }
}

function checkNotifications(): DiagnosticsReport["notifications"] {
  if (!("Notification" in window)) return { ok: false, detail: "unsupported in this browser" };
  const perm = Notification.permission;
  return { ok: perm !== "denied", detail: perm };
}

function checkConnectivity(): DiagnosticsReport["connectivity"] {
  return { ok: navigator.onLine, detail: navigator.onLine ? "online" : "offline" };
}

async function checkCaches(): Promise<DiagnosticsReport["caches"]> {
  if (!("caches" in window)) return { ok: false, detail: "Cache API unsupported" };
  try {
    const names = await caches.keys();
    return { ok: true, detail: `${names.length} cache(s)`, names };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "keys() failed" };
  }
}

async function checkAppVersion(): Promise<DiagnosticsReport["appVersion"]> {
  if (!BAKED_APP_BUILD) return { ok: true, detail: "no build stamp configured (dev)" };
  const build = await fetchServerBuild();
  if (!build) return { ok: false, detail: "couldn't reach /api/app-version" };
  return {
    ok: build === BAKED_APP_BUILD,
    detail: build === BAKED_APP_BUILD ? `up to date (${BAKED_APP_BUILD})` : `stale: running ${BAKED_APP_BUILD}, server has ${build}`,
  };
}

/** Runs every check in parallel and returns a structured report. Every
 * individual check is independently try/caught, so one failing check (a
 * flaky fetch, an unsupported API) never prevents the rest from reporting. */
export async function runDiagnostics(): Promise<DiagnosticsReport> {
  const [manifest, serviceWorker, storage, caches, appVersion] = await Promise.all([
    checkManifest(),
    checkServiceWorker(),
    checkStorage(),
    checkCaches(),
    checkAppVersion(),
  ]);
  return {
    timestamp: Date.now(),
    manifest,
    serviceWorker,
    storage,
    notifications: checkNotifications(),
    connectivity: checkConnectivity(),
    caches,
    appVersion,
  };
}
