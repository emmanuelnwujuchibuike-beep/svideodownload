import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import {
  REWARD_SURFACES,
  networkDef,
  surfaceDef,
  type RewardNetwork,
  type RewardNetworkMap,
  type RewardSurface,
} from "@/lib/monetization/reward-networks";
import { setRewardNetworks } from "@/lib/monetization/reward-networks-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const surfaceSchema = z.object({
  network: z.enum(["gpt_rewarded", "rewarded_video", "interstitial", "offerium", "none"]),
  /*
    GPT ad unit paths are `/networkCode/adUnitName`, optionally nested. Checked
    here rather than only in the form because a malformed path produces a slot
    that never fills, with nothing on screen to say why — the same reason the
    AdSense publisher id is validated at save time.
  */
  gptAdUnitPath: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^\/\d+(?:\/[A-Za-z0-9._\-]+)+$/.test(v), {
      message: "Ad unit path must look like /1234567/rewarded_unit",
    })
    .default(""),
});

const schema = z.object(
  Object.fromEntries(REWARD_SURFACES.map((s) => [s.id, surfaceSchema])) as Record<
    RewardSurface,
    typeof surfaceSchema
  >,
);

/** Admin-only: which ad network pays for which reward moment. */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid reward network settings." },
      { status: 400 },
    );
  }

  /*
    Two refusals the enum alone cannot express, both worth stating rather than
    quietly correcting — an admin who picked something needs to know it did not
    take, not discover later that the gate is running a different network.
  */
  for (const def of REWARD_SURFACES) {
    const chosen = parsed.data[def.id].network as RewardNetwork;
    if (!def.supports.includes(chosen)) {
      return NextResponse.json(
        {
          error: `${networkDef(chosen).label} isn't available on "${def.label}". ${def.note ?? ""}`.trim(),
        },
        { status: 400 },
      );
    }
    const nd = networkDef(chosen);
    if (!nd.available) {
      return NextResponse.json(
        { error: `${nd.label} can't be selected yet — ${nd.unavailableReason}` },
        { status: 400 },
      );
    }
    // A GPT path on a surface that isn't using GPT is dead config; refusing it
    // is how an admin finds out they left the network on the wrong row.
    if (chosen !== "gpt_rewarded" && parsed.data[def.id].gptAdUnitPath) {
      return NextResponse.json(
        {
          error: `"${surfaceDef(def.id).label}" has a GPT ad unit set but isn't using the Google rewarded network.`,
        },
        { status: 400 },
      );
    }
  }

  try {
    await setRewardNetworks(parsed.data as RewardNetworkMap);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  }
}
