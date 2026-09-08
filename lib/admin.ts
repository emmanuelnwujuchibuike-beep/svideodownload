/**
 * Admin access helper. A user is an admin if their `profiles.role` is "admin"
 * OR their email is listed in the ADMIN_EMAILS env var (comma-separated). The
 * env-var path lets you grant yourself admin without running SQL.
 */
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/**
 * Is this person an operator?
 *
 * ── 🔴 THREE SIGNALS, AND WHY ────────────────────────────────────────────────
 *
 * `isAdminFlag` (profiles.is_admin) is the one that matters now. Until
 * migration 0144, admin-ness had to live in `role` — the same column that holds
 * the BILLING PLAN — so granting admin cancelled a subscription and the Paystack
 * sync then wrote the plan back and wiped the grant. Those are now different
 * fields and cannot collide.
 *
 * `role === "admin"` is kept so nothing that already worked regresses.
 *
 * `ADMIN_EMAILS` is kept as the recovery path: it is the only signal that works
 * when the database is the thing that is wrong, which is exactly the situation
 * this function needed to be fixed for. It is a server env var, deliberately not
 * NEXT_PUBLIC_.
 *
 * ⚠️ The database has its own copy of this decision in `public.is_admin()`, and
 * SQL cannot read an env var. They agree on the first two signals; the third is
 * app-only. That gap is why 0144 SEEDS the configured address into the column —
 * so the two definitions match in practice rather than in theory.
 */
export function isAdmin(
  role: string | null | undefined,
  email: string | null | undefined,
  isAdminFlag?: boolean | null,
): boolean {
  return isAdminFlag === true || role === "admin" || isAdminEmail(email);
}
