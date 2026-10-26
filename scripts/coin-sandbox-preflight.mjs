// Frenz Coin Part 8 — refuse to run any sandbox test unless the environment is PROVABLY isolated.
//
//   FRENZ_PRODUCTION_SUPABASE_REF=<prod ref> FRENZ_SANDBOX_SUPABASE_REF=<disposable ref> node scripts/coin-sandbox-preflight.mjs [--env-file .env.sandbox]
//
// Reads environment variables only (no network, no database). Prints PASS / REFUSE per check — never a value.
// Exit 0 only when every check passes. Checks:
//   · the Supabase URL's project ref is the named DISPOSABLE ref, and is not the named production ref;
//   · Flutterwave keys are test keys (FLWSECK_TEST- / FLWPUBK_TEST-); Paystack keys, if present, are sk_test_ / pk_test_;
//   · the transaction-PIN pepper is set (32+ characters) — PINs fail closed without it;
//   · Frenz Coin cannot be "on" by environment (it is a database setting; this only reminds).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The checks, as data: [ok, label]. Pure — testable. */
export function preflight(env) {
  const out = [];
  const add = (ok, label) => out.push({ ok: !!ok, label });
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(url)?.[1] ?? null;
  const prod = (env.FRENZ_PRODUCTION_SUPABASE_REF ?? "").trim();
  const sandbox = (env.FRENZ_SANDBOX_SUPABASE_REF ?? "").trim();
  add(!!prod, "FRENZ_PRODUCTION_SUPABASE_REF is named (so it can be refused)");
  add(!!sandbox, "FRENZ_SANDBOX_SUPABASE_REF is named (the disposable project, verified by a person)");
  add(!!ref, "NEXT_PUBLIC_SUPABASE_URL is a Supabase project URL");
  add(!!ref && !!sandbox && ref === sandbox, "the configured project IS the named disposable project");
  add(!!ref && !!prod && ref !== prod, "the configured project is NOT production");
  add(!!sandbox && !!prod && sandbox !== prod, "the disposable ref is not the production ref");
  const fsk = env.FLUTTERWAVE_SECRET_KEY ?? "";
  add(fsk.startsWith("FLWSECK_TEST-"), "FLUTTERWAVE_SECRET_KEY is a TEST key (FLWSECK_TEST-)");
  const fpk = env.FLUTTERWAVE_PUBLIC_KEY ?? "";
  add(!fpk || fpk.startsWith("FLWPUBK_TEST-"), "FLUTTERWAVE_PUBLIC_KEY is absent or a TEST key (FLWPUBK_TEST-)");
  add(!!(env.FLUTTERWAVE_SECRET_HASH ?? "").trim(), "FLUTTERWAVE_SECRET_HASH is set (webhook signature checks)");
  const psk = env.PAYSTACK_SECRET_KEY ?? "";
  add(!psk || psk.startsWith("sk_test_"), "PAYSTACK_SECRET_KEY is absent or a TEST key (sk_test_)");
  const ppk = env.PAYSTACK_PUBLIC_KEY ?? "";
  add(!ppk || ppk.startsWith("pk_test_"), "PAYSTACK_PUBLIC_KEY is absent or a TEST key (pk_test_)");
  add((env.FRENZ_COIN_PIN_PEPPER ?? "").trim().length >= 32, "FRENZ_COIN_PIN_PEPPER is set (32+ characters, a sandbox-only value)");
  return out;
}

function readEnvFile(path) {
  const env = {};
  for (const l of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--env-file");
  const env = { ...(i > 0 ? readEnvFile(process.argv[i + 1]) : {}), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^FRENZ_(PRODUCTION|SANDBOX)_SUPABASE_REF$/.test(k))) };
  const checks = preflight(i > 0 ? env : process.env);
  for (const c of checks) console.log(`${c.ok ? "PASS  " : "REFUSE"} ${c.label}`);
  const bad = checks.filter((c) => !c.ok).length;
  console.log(bad ? `\n${bad} check(s) refused — do NOT run sandbox tests against this environment.` : "\nAll checks passed — isolated sandbox environment.");
  process.exit(bad ? 1 : 0);
}
