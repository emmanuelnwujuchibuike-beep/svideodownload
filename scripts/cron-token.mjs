/**
 * Mint, adopt, or inspect the database-backed cron token.
 *
 * The token authorises calls to /api/cron/* WITHOUT a Vercel environment
 * variable — see lib/cron/auth.ts for why that path exists. Only the SHA-256
 * digest is ever stored; the token itself is printed once here and never
 * written to disk, so it cannot leak from this repository (which is public).
 *
 * Usage:
 *   node scripts/cron-token.mjs           # generate a fresh token, print once
 *   node scripts/cron-token.mjs <token>   # adopt a token you already hold
 *   node scripts/cron-token.mjs --show    # is one configured? (no secrets)
 *
 * Rotating is just running it again: the new digest replaces the old one and
 * the previous token stops working within a minute (lib/cron/auth.ts caches
 * the digest for that long).
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const KEY = "cron_token";
const MIN_LENGTH = 16; // mirrors MIN_TOKEN_LENGTH in lib/cron/auth.ts

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const args = process.argv.slice(2).filter((a) => a !== "--");

if (args.includes("--show")) {
  const { data, error } = await db.from("settings").select("value").eq("key", KEY).maybeSingle();
  if (error) {
    console.error("Could not read settings:", error.message);
    process.exit(1);
  }
  if (!data?.value?.sha256) {
    console.log("No cron token configured. Run `npm run cron:token` to mint one.");
  } else {
    // The digest is safe to show; it is not a credential.
    console.log(`Configured. digest ${data.value.sha256.slice(0, 12)}…  set ${data.value.updated_at}`);
  }
  process.exit(0);
}

const supplied = args[0];
if (supplied !== undefined && supplied.length < MIN_LENGTH) {
  console.error(
    `Refusing a ${supplied.length}-character token — lib/cron/auth.ts ignores anything ` +
      `shorter than ${MIN_LENGTH}, so it would never authorise and the failure would ` +
      `look exactly like a wrong value.`,
  );
  process.exit(1);
}

const token = supplied ?? randomBytes(32).toString("hex");

const { error } = await db
  .from("settings")
  .upsert({ key: KEY, value: { sha256: sha256(token), updated_at: new Date().toISOString() } }, {
    onConflict: "key",
  });

if (error) {
  console.error("Could not store the token:", error.message);
  process.exit(1);
}

console.log("");
console.log("  Cron token stored (only its SHA-256 digest is in the database).");
console.log("");
if (!supplied) {
  console.log("  Copy this into the GitHub repo secret CRON_SECRET — it is shown once:");
  console.log("");
  console.log(`      ${token}`);
  console.log("");
}
console.log("  GitHub → Settings → Secrets and variables → Actions → CRON_SECRET");
console.log("  Then: Actions → any Cron workflow → Run workflow. Expect HTTP 200.");
console.log("");
