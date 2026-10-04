/**
 * Is the database ready for a Kling video job?
 *
 * Reads the two CHECK constraints 0178/0179 widen — by trying an insert that
 * MUST fail, and reading WHICH constraint complains. A value that is accepted
 * gets past its own check and trips a later one (subject/not-null), which is
 * the honest signal; `error: null` on a head count is not (see the 2026-09-20
 * runner incident).
 *
 *   node scripts/probe-kling-constraints.mjs          one pass
 *   node scripts/probe-kling-constraints.mjs 20       poll for 20 minutes
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^"|"$/g, "");
const admin = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const PROBE_ID = "00000000-0000-4000-8000-00000000c0de";

/** true when `row` gets PAST the named constraint (it may still fail on another). */
async function accepted(row, constraint) {
  const { error } = await admin.from("ai_jobs").insert({ id: PROBE_ID, user_id: null, status: "queued", ...row }).select("id");
  await admin.from("ai_jobs").delete().eq("id", PROBE_ID);
  if (!error) return true; // inserted outright — accepted
  return !(error.message ?? "").includes(constraint);
}

async function pass() {
  const checks = {
    "provider=kling": await accepted({ feature: "ai_lip_sync", provider: "kling" }, "ai_jobs_provider_chk"),
    "provider=elevenlabs": await accepted({ feature: "ai_text_to_audio", provider: "elevenlabs" }, "ai_jobs_provider_chk"),
    "feature=ai_text_to_video": await accepted({ feature: "ai_text_to_video", provider: "replicate" }, "ai_jobs_feature_chk"),
    "feature=ai_image_to_video": await accepted({ feature: "ai_image_to_video", provider: "replicate" }, "ai_jobs_feature_chk"),
  };
  // 🔴 teeth: a value that must STILL be refused. If this reads true the probe is
  // measuring nothing — the constraint is gone, not widened.
  const bogusRefused = !(await accepted({ feature: "ai_not_a_feature", provider: "replicate" }, "ai_jobs_feature_chk"));
  const ok = Object.values(checks).every(Boolean) && bogusRefused;
  console.log(new Date().toISOString().slice(11, 19), Object.entries(checks).map(([k, v]) => `${k}:${v ? "ok" : "REFUSED"}`).join(" | "), `| bogus-still-refused:${bogusRefused ? "ok" : "BROKEN"}`, ok ? "← 0178+0179 LIVE" : "← NOT APPLIED");
  return ok;
}

const minutes = Number(process.argv[2] ?? 0);
const deadline = Date.now() + minutes * 60_000;
do {
  if (await pass()) process.exit(0);
  if (Date.now() < deadline) await new Promise((r) => setTimeout(r, 30_000));
} while (Date.now() < deadline);
process.exitCode = 1;
