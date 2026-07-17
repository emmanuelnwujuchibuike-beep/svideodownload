/**
 * Frenzsave client data layer — stale-while-revalidate caching over the SDK.
 *
 * The instant-feel backbone for Phase 1 (docs/PERFORMANCE.md): cached-first
 * rendering, background revalidation, request dedup, optimistic mutations, and
 * cursor-paginated infinite lists that survive navigation. Dependency-free.
 *
 *   const { data, isLoading } = useQuery("me", () => getApi().me());
 *   const feed = useInfiniteQuery("feed:for_you", (c) => getApi().feed({ cursor: c }));
 *   const rollback = mutate("me", (m) => ({ ...m!, isPremium: true })); // optimistic
 */
export { useQuery } from "./use-query";
export type { QueryOptions, QueryResult } from "./use-query";
export { useInfiniteQuery } from "./use-infinite-query";
export type { InfiniteResult } from "./use-infinite-query";
export { useInView } from "./use-in-view";
export { mutate, seed, invalidate, revalidate, getEntry } from "./cache";
export type { CacheEntry } from "./cache";
