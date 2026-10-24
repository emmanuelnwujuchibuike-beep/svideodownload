import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createTopupReturnController, describeTopupReturn, topupReturnLine, type TopupReturnView, type TopupVerifyAnswer } from "./topup-return";

/**
 * Part 4 — the one-off payment UI. The behaviour that decides what a member is told after a checkout is pure here and
 * tested as is; the components are checked at the source (this suite has no DOM, by design — vitest.config.ts).
 */

const read = (p: string) => readFileSync(p, "utf8");

describe("what a member is told after a credit top-up (server-verified, never the URL)", () => {
  it("credited only when the SERVER settled it", () => {
    expect(describeTopupReturn({ ok: true, credited: true })).toMatchObject({ state: "credited", title: "Payment received", canRecheck: false });
  });

  it("🔴 pending is NEVER shown as success — and offers a status check, not another payment", () => {
    const v = describeTopupReturn({ ok: true, credited: false, pending: true });
    expect(v.state).toBe("pending");
    expect(v.canRecheck).toBe(true);
    expect(`${v.title} ${v.text}`).not.toMatch(/success|received|added to your/i);
    expect(v.text).toMatch(/don't need to pay again/);
  });

  it("not completed: no credits, and never 'nothing was charged' (contact support, don't pay again)", () => {
    const v = describeTopupReturn({ ok: true, credited: false });
    expect(v.state).toBe("not_completed");
    expect(v.text).not.toMatch(/nothing was charged/i);
    expect(v.text).toMatch(/contact support/);
  });

  it("a check that could not run is UNKNOWN — not a failure, not a success; it can be asked again", () => {
    const v = describeTopupReturn({ ok: false, error: "offline" });
    expect(v.state).toBe("unconfirmed");
    expect(v.canRecheck).toBe(true);
    expect(v.text).toMatch(/don't need to pay again/);
  });

  it("the one-line form carries the same meaning", () => {
    expect(topupReturnLine({ ok: true, credited: true })).toMatch(/^Payment received\./);
    expect(topupReturnLine({ ok: true, pending: true })).toMatch(/still being confirmed/);
  });
});

describe("the return flow (createTopupReturnController)", () => {
  const setup = (opts: { plan?: boolean; ref?: string | null; answers?: (TopupVerifyAnswer | Error)[] } = {}) => {
    let url: string | null = opts.ref === undefined ? "frenz_cr_topup_fw_abc" : opts.ref;
    const answers = [...(opts.answers ?? [{ ok: true, pending: true }])];
    const views: TopupReturnView[] = [];
    const verify = vi.fn(async (_ref: string): Promise<TopupVerifyAnswer> => {
      const a = answers.shift() ?? { ok: true, pending: true };
      if (a instanceof Error) throw a;
      return a;
    });
    const settled = vi.fn();
    // the reader REMOVES the reference from the address bar (takeTopupReturnReference does)
    const takeReference = vi.fn(() => {
      const r = url;
      url = null;
      return r;
    });
    const make = () => createTopupReturnController({ hasPlanReturn: () => !!opts.plan, takeReference, verify, onView: (v) => views.push(v), onSettled: settled });
    return { make, verify, views, settled, takeReference };
  };

  it("reads the reference once, asks the server, shows checking → the answer", async () => {
    const t = setup({ answers: [{ ok: true, credited: true }] });
    await t.make().start();
    expect(t.verify).toHaveBeenCalledWith("frenz_cr_topup_fw_abc");
    expect(t.views.map((v) => v.state)).toEqual(["checking", "credited"]);
    expect(t.settled).toHaveBeenCalledTimes(1);
  });

  it("🔴 a REFRESH of the return page verifies nothing again (the reference left the address bar) — and never pays again", async () => {
    const t = setup();
    await t.make().start();
    await t.make().start(); // the page loaded again
    expect(t.verify).toHaveBeenCalledTimes(1);
  });

  it("Check again re-asks about the SAME reference; overlapping taps make ONE request", async () => {
    const t = setup({ answers: [{ ok: true, pending: true }, { ok: true, credited: true }] });
    const c = t.make();
    await c.start();
    const [a, b] = await Promise.all([c.recheck(), c.recheck()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(t.verify.mock.calls.map((x) => x[0])).toEqual(["frenz_cr_topup_fw_abc", "frenz_cr_topup_fw_abc"]);
    expect(t.views.at(-1)?.state).toBe("credited");
  });

  it("a verify that THROWS (offline) is 'couldn't check' — never success, never failure", async () => {
    const t = setup({ answers: [new Error("network")] });
    await t.make().start();
    expect(t.views.at(-1)?.state).toBe("unconfirmed");
  });

  it("no reference (a normal visit) → nothing is asked; an AI-plan return is left for the plan handler", async () => {
    const none = setup({ ref: null });
    await none.make().start();
    expect(none.verify).not.toHaveBeenCalled();
    const plan = setup({ plan: true });
    await plan.make().start();
    expect(plan.verify).not.toHaveBeenCalled();
    expect(plan.takeReference).not.toHaveBeenCalled();
  });
});

describe("the one-off payment screens (source checks)", () => {
  it("every page a top-up can return to verifies with the server — the three workspaces that didn't now do", () => {
    for (const f of ["features/ai/lip-sync/lip-sync-workspace.tsx", "features/ai/text-to-audio/text-to-audio-workspace.tsx", "features/ai/voice-clone/voice-cloning-workspace.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("useTopupReturn(");
      expect(src, f).toContain("<TopupReturnNotice view={topup.view} onRecheck={topup.recheck} onDismiss={topup.dismiss}");
    }
    for (const f of ["features/ai/frenz-ai-dashboard.tsx", "features/ai/frenz-ai-usage-page.tsx", "features/ai/character-replace/use-character-replace-workspace.ts"]) {
      expect(read(f), f).toContain("topupReturnLine(");
    }
  });

  it("the return reader drops the provider's own status words — only the reference goes to the server", () => {
    const client = read("lib/ai/character-replace/client.ts");
    expect(client).toContain(`for (const k of ["trxref", "tx_ref", "transaction_id", "status"]) params.delete(k);`);
    expect(read("features/ai/wallet/use-topup-return.ts")).not.toMatch(/get\("status"\)/);
  });

  it("checkout buttons start ONE checkout however fast they are tapped (a synchronous latch, not just 'busy')", () => {
    for (const f of ["features/ai/wallet/recharge-sheet.tsx", "features/sub/subscribe-card.tsx", "features/account/paid-verification-card.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("const starting = useRef(false);");
      expect(src, f).toMatch(/if \((?:!ready \|\| )?starting\.current\) return;\s+starting\.current = true;/);
    }
  });

  it("paid verification: while a payment may still be on its way there is NO Pay button — only Check again (the same question)", () => {
    const src = read("features/account/paid-verification-card.tsx");
    expect(src).toContain(`{confirming === "pending" || confirming === "unchecked" ? (`);
    expect(src).toContain(`onClick={() => void confirmPaid(1)}`);
    // a check that could not run is its own state, never "failed"
    expect(src).toContain(`setConfirming(json?.status === "pending" ? "pending" : "unchecked");`);
    // the tick comes from the server's answer + a refresh, never from the URL
    expect(src).toContain(`if (json?.status === "paid") {`);
    expect(src).not.toContain("charged in your local currency");
  });

  it("SUB copy names no single provider (Flutterwave or Paystack may take the payment)", () => {
    expect(read("features/sub/subscribe-card.tsx")).not.toContain("Paid securely with Paystack");
    const ret = read("app/(app)/sub/return/page.tsx");
    expect(ret).not.toContain("Paystack hasn't confirmed");
    expect(ret).not.toContain("once Paystack confirms");
  });
});
