import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifies a Cloudflare Stream webhook request. Cloudflare signs the raw body
 * with the account's webhook secret (from {@link import("./stream").configureStreamWebhook})
 * and sends it as `Webhook-Signature: time=<unix>,sig1=<hex hmac-sha256>`. We
 * recompute the HMAC over `${time}.${rawBody}` and compare in constant time.
 * Must run against the raw request text — `request.json()` would consume the
 * stream before we can verify it.
 */
export function verifyStreamWebhookSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts: Record<string, string> = {};
  for (const kv of header.split(",")) {
    const [k, v] = kv.trim().split("=");
    if (k && v) parts[k] = v;
  }
  const { time, sig1 } = parts;
  if (!time || !sig1) return false;

  const expected = createHmac("sha256", secret).update(`${time}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const gotBuf = Buffer.from(sig1, "hex");
  if (expectedBuf.length !== gotBuf.length) return false;
  try {
    return timingSafeEqual(expectedBuf, gotBuf);
  } catch {
    return false;
  }
}
