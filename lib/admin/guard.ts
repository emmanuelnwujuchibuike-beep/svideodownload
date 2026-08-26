/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE HISTORICAL ADMIN GUARD — now a re-export
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 36 route handlers and the support server actions import `getAdminUser` from
 * here. Rather than editing 36 files — a large, risky diff across features this
 * task has no business touching — this module now delegates to the single
 * authority in `require-admin.ts`, so every one of those call sites picks up the
 * hardened implementation with no change of its own:
 *
 *  • `getUser()` errors are treated as "no user" instead of being ignored;
 *  • the role is re-read from the database on every request, so a demoted or
 *    revoked administrator loses access immediately rather than whenever their
 *    JWT happens to expire;
 *  • one place to audit, and one place to change.
 *
 * 🔴 NEW CODE SHOULD IMPORT FROM `@/lib/admin/require-admin` DIRECTLY, and
 * should prefer `requireAdminApi()` over this function: it returns a ready-made
 * 404 response, which is both less code at the call site and a better answer
 * than the mix of 401/403 the older handlers return (a 403 confirms the
 * endpoint exists to anyone enumerating routes).
 *
 * This file is kept — rather than deleted with a codemod — because a
 * re-export is a smaller, more reviewable change than 36 rewritten handlers,
 * and because the behaviour it forwards to is strictly stronger than what was
 * here before.
 */
export { getAdminUser } from "./require-admin";
