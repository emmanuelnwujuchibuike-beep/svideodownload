/**
 * PHISHING PROTECTION (Feature 20 Part 7) — why a link in a message or caption deserves a
 * warning, in words a member understands. Explainable rules on the URL itself; no lookup
 * service, nothing sent anywhere.
 *
 *   impersonates   the address mentions Frenz but is not frenzsave.com (or its subdomains):
 *                  "frenzsave-login.com", "frenz-save.co", "frenzsave.com.verify.io"
 *   disguised      the address uses look-alike characters (punycode, "xn--")
 *   bare-ip        the address is a raw number, not a name — common in phishing
 *   credentials    the address hides a username before the real host ("frenzsave.com@evil.io")
 *
 * Pure; the caller decides how to show it. Null = nothing to warn about.
 */
export type LinkWarning = "impersonates" | "disguised" | "bare-ip" | "credentials";

const OFFICIAL = /(^|\.)frenzsave\.com$/;

export function linkWarning(href: string): LinkWarning | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (u.username || u.password) return "credentials";
  if (OFFICIAL.test(host)) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return "bare-ip";
  if (host.split(".").some((label) => label.startsWith("xn--"))) return "disguised";
  if (/fren[sz]{1,2}[\W_]*sa?ve|frenz/.test(host.replace(/[0o]/g, "o").replace(/[1l]/g, "l"))) return "impersonates";
  return null;
}

export const LINK_WARNING_TEXT: Record<LinkWarning, string> = {
  impersonates: "Not a Frenz link — Frenz only uses frenzsave.com",
  disguised: "This address uses look-alike letters",
  "bare-ip": "This link has no website name — be careful",
  credentials: "This link hides its real address",
};
