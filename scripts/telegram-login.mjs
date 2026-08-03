/**
 * One-time Telegram login → prints a StringSession for TELEGRAM_SESSION.
 *
 * Run this LOCALLY (it needs an interactive terminal to enter the code Telegram
 * texts you). It never has to run on a server.
 *
 *   1. Create an app at https://my.telegram.org → API development tools.
 *      Note the api_id and api_hash.
 *   2. Run:
 *        TELEGRAM_API_ID=1234567 TELEGRAM_API_HASH=abcdef... node scripts/telegram-login.mjs
 *      (or pass them as the first two arguments)
 *   3. Enter your phone number (with country code, e.g. +2348012345678), then the
 *      login code Telegram sends you, then your 2FA password if you have one.
 *   4. Copy the printed session string into the worker env var TELEGRAM_SESSION
 *      (alongside TELEGRAM_API_ID and TELEGRAM_API_HASH).
 *
 * The session authorizes downloads of the Stories / private channels / saved
 * messages that THIS account can see. Keep it secret — it is a full login.
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const apiId = Number(process.env.TELEGRAM_API_ID || process.argv[2] || 0);
const apiHash = process.env.TELEGRAM_API_HASH || process.argv[3] || "";

if (!apiId || !apiHash) {
  console.error(
    "Missing credentials.\nUsage: TELEGRAM_API_ID=.. TELEGRAM_API_HASH=.. node scripts/telegram-login.mjs",
  );
  process.exit(1);
}

const rl = readline.createInterface({ input, output });
const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5,
});

try {
  await client.start({
    phoneNumber: async () => (await rl.question("Phone number (e.g. +234...): ")).trim(),
    phoneCode: async () => (await rl.question("Login code Telegram sent you: ")).trim(),
    password: async () => (await rl.question("2FA password (leave blank if none): ")).trim(),
    onError: (err) => console.error("Login error:", err?.message || err),
  });

  console.log("\n✅ Logged in. Set this on the worker as TELEGRAM_SESSION:\n");
  console.log(client.session.save());
  console.log("\nKeep it secret — it is a full login to this account.\n");
} catch (err) {
  console.error("\n❌ Login failed:", err?.message || err);
  process.exitCode = 1;
} finally {
  await client.disconnect().catch(() => {});
  rl.close();
  // GramJS can keep the event loop alive; exit explicitly.
  process.exit(process.exitCode ?? 0);
}
