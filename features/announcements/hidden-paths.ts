/**
 * Pages that never carry the announcement bar (owner, 2026-10-18): the Messages inbox and every
 * chat under it. The bar sat over the inbox header and clashed with the thread's own chrome.
 * Hidden means unmounted AND `--frenz-announce-h` back to 0, so those pages get their space back.
 */
export const announcementHiddenOn = (pathname: string | null | undefined) => !!pathname && (pathname === "/messages" || pathname.startsWith("/messages/"));
