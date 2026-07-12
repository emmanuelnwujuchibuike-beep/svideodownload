/**
 * Postgres `bytea` columns round-trip through PostgREST/supabase-js as
 * hex-encoded strings (`\x0102ab...`), NOT raw Buffer/Uint8Array — a bare
 * `Buffer` in an `.insert()`/`.update()` payload gets JSON-serialized via
 * Buffer's own `toJSON()` (`{"type":"Buffer","data":[...]}`), which fails to
 * cast to `bytea` server-side. Every bytea column in this app (security_pin,
 * webauthn_credentials.public_key) must go through these two helpers.
 */
export function toBytea(buf: Buffer): string {
  return `\\x${buf.toString("hex")}`;
}

export function fromBytea(value: string): Buffer {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return Buffer.from(hex, "hex");
}
