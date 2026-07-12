"use client";

/**
 * Browser Web Push client. Registers the service worker, asks permission, and
 * subscribes the browser to push via the app's VAPID public key. All no-ops when
 * unsupported or unconfigured, so callers can render an enable button safely.
 */

// .trim() guards against the single most common way this silently breaks: a
// trailing newline/space picked up when the key was pasted into an env-var
// dashboard. Untrimmed, atob() below decodes to the wrong byte length and
// `subscribe()` rejects with an opaque InvalidAccessError that surfaced to
// users as a generic "failed" — see PushSubscribeFailedError below.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || undefined;

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

/** Thrown when the BROWSER itself rejects `pushManager.subscribe()` — a real
 * failure, but distinct from `enablePush()`'s other thrown error (the server
 * rejecting the save): this one never reaches the network at all (a bad/
 * malformed VAPID key, the push service being unreachable from this device,
 * or the user's browser blocking it outright), so callers showing "check
 * your connection" for THIS case were blaming the wrong layer. */
export class PushSubscribeFailedError extends Error {
  constructor(cause: unknown) {
    super("This browser couldn't connect to the push service. Try again in a moment.");
    this.name = "PushSubscribeFailedError";
    this.cause = cause;
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
  let sub = existing;
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource,
      });
    } catch (err) {
      // Distinct from the fetch failure below — this never reached our
      // server at all, so "check your connection" (the old, one-size-fits-
      // all copy) was misleading whenever this was really a bad VAPID key or
      // the push service rejecting the browser outright.
      throw new PushSubscribeFailedError(err);
    }
  }

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
 *
 * CROSS-ACCOUNT PUSH LEAK (2026-07-12): this used to throttle on a single
 * global `sessionStorage` flag with no user in it at all. `/api/push/subscribe`
 * upserts on the endpoint's unique conflict and re-homes that row's `user_id`
 * to whoever calls it — that's the ONLY mechanism that moves a device's
 * subscription from one account to another on a shared browser. But the old
 * flag stayed "1" across a sign-out/sign-in in the SAME TAB (`sessionStorage`
 * isn't cleared by `supabase.auth.signOut()`), so switching accounts without
 * closing the tab made this function silently no-op for the new account —
 * the subscribe call that would have re-homed the row never fired again, so
 * the row stayed pointed at whichever account synced first in that tab
 * forever. Every future push to THAT account kept arriving on this device
 * even after signing into someone else — indistinguishable from "notifications
 * aren't scoped to the signed-in account." Keying the throttle by userId (and
 * re-syncing whenever the current user differs from the last one synced in
 * this tab) makes every account switch re-home the row to whoever's actually
 * signed in now, while still not spamming re-subscribes for the same user.
 */
export async function syncPush(userId?: string | null): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const KEY = "frenz:push-synced-uid";
  try {
    if (userId && sessionStorage.getItem(KEY) === userId) return;
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
    if (res.ok && userId) sessionStorage.setItem(KEY, userId);
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
