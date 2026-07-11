"use client";

/**
 * Browser Web Push client. Registers the service worker, asks permission, and
 * subscribes the browser to push via the app's VAPID public key. All no-ops when
 * unsupported or unconfigured, so callers can render an enable button safely.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    !!VAPID_PUBLIC_KEY
  );
}

export type PushState = "unsupported" | "default" | "denied" | "subscribed" | "unsubscribed";

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "default") return "default";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub ? "subscribed" : "unsubscribed";
  } catch {
    return "unsubscribed";
  }
}

/** Thrown by `enablePush()` when the server rejects the save because the
 * session is gone (401) — distinct from a transient/server failure so
 * callers can point the user at signing in again instead of a "try again"
 * that would just fail the same way forever. */
export class PushSessionExpiredError extends Error {
  constructor() {
    super("Your session expired. Sign in again to turn on notifications.");
    this.name = "PushSessionExpiredError";
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Register SW, request permission, subscribe, and persist server-side. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "default";

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource,
    }));

  const json = sub.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  // Throw rather than returning "unsubscribed" here: the browser DID subscribe
  // at this point, only the server-side save failed (network blip, session
  // expired, 500) — silently reporting "unsubscribed" made callers treat a
  // real failure identically to "user declined," which (see push-nudge.tsx)
  // used to hide the whole Enable UI with zero feedback and count it as a
  // decline toward the 5-strikes cutoff. A thrown error forces every caller to
  // show the failure instead of swallowing it.
  //
  // 401 specifically means the session died between page load and this tap
  // (client-side `user` state was stale) — the server route requires auth, so
  // a generic "try again" would just 401 again forever. Surface it distinctly
  // so callers can point at signing in again instead.
  if (res.status === 401) throw new PushSessionExpiredError();
  if (!res.ok) throw new Error("Couldn't save your notification subscription. Please try again.");
  return "subscribed";
}

/**
 * Silently repair this device's subscription when permission is already
 * granted: re-subscribes if the browser dropped it and re-POSTs so the server
 * row is re-homed to the current account (or restored after being pruned by a
 * failed send). Safe to call on every app launch — throttled per session.
 */
export async function syncPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const KEY = "frenz:push-synced";
  try {
    if (sessionStorage.getItem(KEY) === "1") return;
  } catch {
    /* ignore */
  }
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource,
      }));
    const json = sub.toJSON();
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    if (res.ok) sessionStorage.setItem(KEY, "1");
  } catch {
    /* best-effort — the enable button remains the explicit path */
  }
}

/** Unsubscribe this browser and remove it server-side. */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch {
    /* ignore */
  }
  return "unsubscribed";
}
