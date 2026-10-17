/** The shape of an unsubscribe token (lib/email/consent.ts): 32 bytes of HMAC, base64url. Pure, for the page. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
