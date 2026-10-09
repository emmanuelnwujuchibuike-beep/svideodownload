/**
 * The bottom nav's idle warm-up for a SIGNED-OUT visitor: the public tabs a
 * guest actually has (Feed, History, Profile's /profile doorway). Members keep
 * the owner's eight-route list in mobile-nav.tsx. Plain .ts so tests can
 * import it without a JSX transform.
 */
export const GUEST_WARM_ROUTES = ["/quests", "/history", "/profile"] as const;

/** The desktop sidebar's idle warm-up for a signed-out visitor: its public links. */
export const SIDEBAR_GUEST_WARM_ROUTES = ["/reels", "/sounds"] as const;
