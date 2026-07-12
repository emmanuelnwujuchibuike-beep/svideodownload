/* Web Push receive + notification click. */
var SWX = (self.SWX = self.SWX || {});

// actorId is always server-derived today (see lib/social/friends.ts) — this
// is a fail-closed backstop, not a trust boundary fix, so a future
// notification type that's wired up less carefully can't turn a malformed
// value into a path-traversal-shaped fetch instead of just a 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Frenz", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Frenz";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon.png",
    badge: "/icon.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    // actorId/conversationId ride along so an action button (Accept/Decline
    // on a friend request, Mark as read/Mute on a message) can act directly
    // without opening a window — see notificationclick below.
    data: { url: data.url || "/home", actorId: data.actorId, conversationId: data.conversationId },
    vibrate: [60, 30, 60],
    // Notification.actions — real interactive buttons (Chrome/Edge/Android;
    // Firefox/Safari silently ignore unsupported entries per spec, so this
    // degrades to a plain notification there, not an error.
    actions: Array.isArray(data.actions) ? data.actions : undefined,
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Flag the app icon while the app is closed — the page replaces this
      // with the exact unread count the moment it next opens.
      "setAppBadge" in self.navigator ? self.navigator.setAppBadge().catch(() => {}) : Promise.resolve(),
    ]),
  );
});

// Friend-request Accept/Decline act directly on the request — no window
// needed, so the recipient never has to leave whatever they're doing.
// Cookies (the httpOnly Supabase session) travel with a same-origin SW
// fetch exactly like a normal page fetch, so this authenticates as the
// signed-in recipient without any extra plumbing.
async function respondToFriendRequestFromPush(actorId, action, tag) {
  if (!UUID_RE.test(actorId)) {
    SWX.log("friend request action skipped — malformed actorId", actorId);
    return;
  }
  try {
    const res = await fetch(`/api/friends/${actorId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      await self.registration.showNotification(action === "accept" ? "Friend request accepted" : "Request declined", {
        tag, // replaces the original request notification rather than stacking
        icon: "/icon.png",
        badge: "/icon.png",
        silent: true,
      });
    }
    SWX.log("friend request action", action, res.status);
  } catch (err) {
    SWX.log("friend request action failed", err);
  }
}

// Mark-as-read/Mute act directly on the thread — same "no window needed"
// pattern as the friend-request buttons above; the mark-read GET is the
// SAME endpoint the open thread itself calls, which already marks the
// conversation read as a side effect (see lib/social/messages.ts's
// getConversation) — no separate mark-read route to keep in sync.
async function respondToMessageActionFromPush(conversationId, action) {
  if (!UUID_RE.test(conversationId)) {
    SWX.log("message action skipped — malformed conversationId", conversationId);
    return;
  }
  try {
    if (action === "mark_read") {
      const res = await fetch(`/api/messages/${conversationId}`, { credentials: "include" });
      SWX.log("message mark_read action", res.status);
    } else if (action === "mute") {
      const res = await fetch(`/api/conversations/${conversationId}/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ muted: true }),
      });
      SWX.log("message mute action", res.status);
    }
  } catch (err) {
    SWX.log("message action failed", err);
  }
}

self.addEventListener("notificationclick", (event) => {
  const notifData = event.notification.data || {};
  const url = notifData.url || "/home";
  event.notification.close();
  if ("clearAppBadge" in self.navigator) self.navigator.clearAppBadge().catch(() => {});

  // actorId should always accompany an accept/decline action (see
  // lib/social/friends.ts), but if a malformed/stale payload ever ships
  // one without the other, fall through to opening the app instead of
  // silently doing nothing — a dead button is worse than a normal tap.
  if ((event.action === "accept" || event.action === "decline") && notifData.actorId) {
    event.waitUntil(respondToFriendRequestFromPush(notifData.actorId, event.action, event.notification.tag));
    return; // background action — never opens/focuses a window
  }

  if ((event.action === "mark_read" || event.action === "mute") && notifData.conversationId) {
    event.waitUntil(respondToMessageActionFromPush(notifData.conversationId, event.action));
    return; // background action — never opens/focuses a window
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
