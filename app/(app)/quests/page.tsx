import type { Metadata } from "next";

import { QuestsPage } from "@/features/quests/quests-page";

export const metadata: Metadata = { title: "Earn credits", robots: { index: false, follow: false } };

/**
 * /quests — daily and weekly quests (0192). A thin page on purpose: the board
 * is the client's (features/quests/quests-page.tsx keeps it and re-checks only
 * when stale), so an entry or a back-swipe paints from memory instead of
 * waiting for a server render. A guest is told to sign in by the page itself
 * (the API answers 401) — no server auth round trip on entry.
 */
export default function Quests() {
  return <QuestsPage />;
}
