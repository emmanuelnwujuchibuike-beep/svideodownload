/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADMIN PASSWORD POLICY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Length and blocklist. No composition rules.
 *
 * ── Why no "must contain a symbol" ────────────────────────────────────────
 * Composition rules are the reason people write `Password1!` and then reuse it.
 * NIST SP 800-63B dropped them for exactly that: they measurably reduce entropy
 * by pushing everyone onto the same handful of predictable shapes, while a long
 * passphrase — which they discourage, because it may contain no digits — is
 * stronger than anything a symbol rule produces. Length plus a blocklist is the
 * current guidance and it is what this enforces.
 *
 * 🔴 NOTHING IN THIS FILE LOGS, THROWS, OR RETURNS THE PASSWORD. The failure
 * value is a human-readable REASON, never the input. A validator that echoed the
 * rejected password into an error message would put it into every log line and
 * error tracker that touches the response.
 *
 * Pure and dependency-free, so it runs identically on the server (authoritative)
 * and in the browser (instant feedback). The browser copy is a courtesy; the
 * server call is the one that decides.
 */

/** NIST's floor is 8. The owner asked for 12, which is the stronger of the two. */
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

/**
 * Supabase's own hard ceiling. bcrypt truncates at 72 BYTES, and anything past
 * it is silently ignored — a user who believes their 200-character passphrase is
 * being checked in full is wrong, so it is refused rather than quietly cut.
 * Counted in BYTES, not characters: one emoji is four bytes.
 */
export const MAX_ADMIN_PASSWORD_BYTES = 72;

/**
 * The blocklist.
 *
 * Deliberately small and shipped in-process. "Reject obviously compromised
 * passwords where practical" — the practical part matters: the full Have I Been
 * Pwned corpus is ~850MB and the online k-anonymity API would put a
 * third-party network call in the middle of an admin password change, which
 * fails closed the day that service is slow.
 *
 * These are the shapes that actually appear at the top of every breach corpus,
 * normalised (lowercased, digits/symbols stripped) before comparison so
 * `P@ssw0rd123!` and `password` collapse to the same entry. A determined weak
 * password will still get through; this stops the careless one.
 *
 * If a full corpus check is ever wanted, the honest place is an offline bloom
 * filter shipped as an asset — not a request on the critical path.
 */
const BLOCKED_STEMS = [
  "password",
  "passwd",
  "letmein",
  "welcome",
  "admin",
  "administrator",
  "qwerty",
  "qwertyuiop",
  "iloveyou",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "superman",
  "trustno",
  "changeme",
  "secret",
  "master",
  "frenz",
  "frenzsave",
];

/**
 * Lowercase, undo common leetspeak, then strip everything that is not a letter.
 *
 * 🔴 THE SUBSTITUTION PASS MUST COME FIRST, and its own test is what proved it.
 * Stripping non-letters up front turns `P@ssw0rd1234` into `psswrd`, which
 * matches no blocked word at all — the blocklist would wave through the single
 * most predictable password shape there is. Mapping `@→a` and `0→o` before the
 * strip collapses it back to `password…`, which is what it obviously is.
 */
const LEET: Record<string, string> = {
  "@": "a",
  "4": "a",
  "8": "b",
  "3": "e",
  "1": "l",
  "!": "i",
  "0": "o",
  "$": "s",
  "5": "s",
  "7": "t",
  "+": "t",
};

function stem(input: string): string {
  const unleet = input
    .toLowerCase()
    .replace(/[@48310!$57+]/g, (c) => LEET[c] ?? c);
  return unleet.replace(/[^a-z]/g, "");
}

/**
 * Longest first, so a compound word is removed whole.
 *
 * `administrator1` reduces to `administratorl`. Removing the SHORTER `admin`
 * first leaves `istratorl` — nine characters of residue, enough to pass. Taking
 * `administrator` first leaves `l`, which is the honest answer.
 */
const BLOCKED_LONGEST_FIRST = [...BLOCKED_STEMS].sort((a, b) => b.length - a.length);

export interface PasswordVerdict {
  ok: boolean;
  /** Why it was refused. Safe to show a user; never contains the password. */
  reason?: string;
}

export function validateAdminPassword(password: string): PasswordVerdict {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, reason: "Enter a password." };
  }

  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `Use at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`,
    };
  }

  // Byte length, because bcrypt's limit is in bytes.
  if (new TextEncoder().encode(password).length > MAX_ADMIN_PASSWORD_BYTES) {
    return {
      ok: false,
      reason: "That password is too long. Use 72 bytes or fewer.",
    };
  }

  // All one character ("aaaaaaaaaaaa" clears the length rule otherwise).
  if (new Set(password).size < 5) {
    return { ok: false, reason: "Use a more varied password." };
  }

  /*
    🔴 MEASURE WHAT IS LEFT AFTER THE BLOCKED WORDS ARE REMOVED.

    The first version asked "does the stem contain a blocked word, and is the
    stem shorter than the word + 8?". Its own test caught the hole:
    `passwordpassword` has a 16-character stem and `"password".length + 8` is
    also 16, so the comparison was false and it passed. Any doubled weak word
    slipped through the same way.

    Removing every blocked stem and measuring the REMAINDER is the honest
    question — "once the guessable parts are gone, is there any password left?".
    `passwordpassword` reduces to nothing. `correct horse battery staple`
    reduces to itself. A long passphrase that merely contains "master" inside a
    larger word keeps plenty of residue and is accepted.
  */
  const s = stem(password);
  if (s.length > 0) {
    let residue = s;
    for (const blocked of BLOCKED_LONGEST_FIRST) {
      residue = residue.split(blocked).join("");
    }
    if (residue.length < 6) {
      return {
        ok: false,
        reason: "That password is too easy to guess. Choose something less common.",
      };
    }
  }

  return { ok: true };
}
