"use client";

import { createContext, useContext } from "react";

/**
 * Is the admin panel around me actually on screen?
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 * Owner, 2026-09-02: "search in admin dashboard should open that exactly page
 * alone without over requesting and costing vercel usage."
 *
 * `AdminPanel` renders `hidden={!shown}` — the section is hidden with CSS and
 * its children stay MOUNTED. That is deliberate and worth keeping: it is what
 * makes switching sections instant and what stops a half-filled settings form
 * being thrown away when an operator glances at another screen.
 *
 * But a mounted component keeps running, and several admin widgets poll. The
 * analytics dashboard refreshes every 60 seconds on the shared scheduler, so an
 * operator sitting on the Revenue section was still paying for a request a
 * minute against the Traffic section they were not looking at — and one against
 * every other polling panel besides. On a dashboard left open for an hour that
 * is real, entirely wasted Vercel invocations, which is exactly the cost the SSE
 * removal was about in the first place.
 *
 * So visibility becomes something a child can READ, and `useAdminLive`
 * unsubscribes when its panel is off screen. Mounted, but quiet.
 *
 * Defaults to TRUE, deliberately: a live widget used outside an `AdminPanel`
 * must keep working. Failing open here costs a request; failing closed would
 * silently stop a dashboard somebody is looking at.
 */
const PanelVisibleContext = createContext<boolean>(true);

export const PanelVisibleProvider = PanelVisibleContext.Provider;

export function useAdminPanelVisible(): boolean {
  return useContext(PanelVisibleContext);
}
