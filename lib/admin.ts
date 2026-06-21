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

export function isAdmin(
  role: string | null | undefined,
  email: string | null | undefined,
): boolean {
  return role === "admin" || isAdminEmail(email);
}
