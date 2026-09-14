/**
 * What `server-only` resolves to under vitest (vitest.config.ts alias).
 *
 * The real package throws on import outside a React Server Components
 * build — correct in the app, where it is the fence that keeps a service-role
 * module out of a client bundle, and useless in a unit test, where the fence
 * would stop the very module under test from loading. The alias swaps the
 * fence for nothing; `next build` still uses the real one.
 */
export {};
