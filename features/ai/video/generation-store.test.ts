import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { generationPollIntervalMs } from "@/features/ai/video/active-generation";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PHONE GOT HOT WHILE A VIDEO GENERATED (owner, 2026-10-04)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two causes, both measurable, both guarded here.
 *
 *  1 · `useVideoGeneration` ran `setInterval(tick, 3000)` for the whole
 *      generation. A Kling video takes about two minutes, so ~40 requests —
 *      each a radio wake-up, a TLS round trip, a function invocation and a
 *      React render — to learn a status that Kling only ever reports as
 *      `submitted / processing / succeeded / failed`. There is no percentage
 *      to discover, which is why the UI draws an indeterminate shuttle. The
 *      only thing a poll can find is the terminal transition, and nobody can
 *      perceive learning that four seconds sooner.
 *
 *      Worse, the old loop kept FIRING while the tab was hidden — `tick`
 *      returned immediately, but the timer still woke the phone every 3s.
 *
 *  2 · `.ai-cta::before` (the Generate button's gradient) animates on
 *      `animation-play-state: var(--ai-play, running)`. `--ai-play` is set by
 *      exactly one component, `FrenzAIEnvironment`, which resolves tab
 *      visibility and `prefers-reduced-motion` into it. The two video
 *      workspaces shipped WITHOUT that ancestor, so the variable was never
 *      set, the fallback `running` applied, and the gradient animated for
 *      ever — including on a hidden tab.
 */

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * The file with its comments removed.
 *
 * 🔴 Needed because these files DESCRIBE the bug they fixed — the header of
 * `active-generation.ts` names `setInterval(tick, 3000)` in prose. A guard
 * matching raw text would fire on the explanation and force the next person
 * to delete the record of why the code is shaped this way, which is the one
 * thing it must not do.
 */
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the poll is paced to the job, not to the spinner", () => {
  it("starts at 5s, settles to 10s, then 15s", () => {
    expect(generationPollIntervalMs(0)).toBe(5_000);
    expect(generationPollIntervalMs(19_999)).toBe(5_000);
    expect(generationPollIntervalMs(20_000)).toBe(10_000);
    expect(generationPollIntervalMs(119_999)).toBe(10_000);
    expect(generationPollIntervalMs(120_000)).toBe(15_000);
  });

  it("never polls faster than every 5 seconds, at any age", () => {
    /*
      Teeth, and the actual regression: the old loop was 3s flat. A schedule
      that drifts back under 5s puts the request count back where it was.
    */
    for (const elapsed of [0, 1_000, 10_000, 60_000, 300_000, 3_600_000]) {
      expect(generationPollIntervalMs(elapsed), `at ${elapsed}ms`).toBeGreaterThanOrEqual(5_000);
    }
  });

  it("costs a two-minute generation far fewer requests than the 3s loop", () => {
    let t = 0;
    let requests = 0;
    while (t < 120_000) {
      t += generationPollIntervalMs(t);
      requests += 1;
    }
    const oldLoop = Math.floor(120_000 / 3_000); // 40
    expect(oldLoop).toBe(40);
    expect(requests).toBeLessThanOrEqual(16);
    expect(requests * 2).toBeLessThan(oldLoop); // at least a 2× reduction
  });
});

describe("nothing runs when there is nothing to watch", () => {
  const store = src("features/ai/video/active-generation.ts");

  it("the timer is cancelled on a hidden tab, not just skipped", () => {
    // The old shape — a bare interval that fires into a visibility check — is
    // what woke the phone every 3s for nothing.
    expect(code("features/ai/video/active-generation.ts")).not.toContain("setInterval");
    expect(store).toContain("clearTimeout(timer)");
    expect(store).toContain('document.removeEventListener("visibilitychange"');
  });

  it("the poll stops on a terminal phase and gives up eventually", () => {
    expect(store).toContain("GIVE_UP_AFTER_MS");
    expect(store).toContain("stopPoll()");
  });

  it("the hook no longer owns a loop of its own", () => {
    const hook = code("features/ai/video/use-video-generation.ts");
    expect(hook).not.toContain("setInterval");
    expect(hook).not.toContain("POLL_MS");
  });
});

describe("every AI workspace sets --ai-play, so its CTA can stop animating", () => {
  /*
    `FrenzAIEnvironment` is the only component that writes `--ai-play`. A
    workspace rendering `.ai-cta` without it animates on the `running`
    fallback for ever, hidden tab included.
  */
  const WORKSPACES = [
    "features/ai/video/text-to-video-workspace.tsx",
    "features/ai/video/image-to-video-workspace.tsx",
    "features/ai/text-to-audio/text-to-audio-workspace.tsx",
    "features/ai/voice-clone/voice-cloning-workspace.tsx",
    "features/ai/lip-sync/lip-sync-workspace.tsx",
  ];

  it.each(WORKSPACES)("%s is wrapped in FrenzAIEnvironment", (rel) => {
    expect(src(rel)).toContain("<FrenzAIEnvironment");
  });

  it("the variable really is what gates the CTA animation", () => {
    // teeth: if the CSS stops reading --ai-play, the wrapper above is pointless
    // and this suite would otherwise keep passing while the bug returned.
    const css = src("app/globals.css");
    const cta = css.slice(css.indexOf(".ai-cta::before"), css.indexOf(".ai-cta::after"));
    expect(cta).toContain("animation-play-state: var(--ai-play");
  });
});

describe("the card can be tucked to the side", () => {
  const store = src("features/ai/video/active-generation.ts");
  const card = src("features/ai/video/generation-progress-card.tsx");

  it("the minimised flag lives on the RECORD, so it survives navigation", () => {
    /*
      Owner: "make users able to hide this floating progress bar to go beside
      and they can see the progress without it occupying the screen."

      Local component state would re-expand the card on every route change —
      this card deliberately outlives its page, so the preference has to
      outlive it too, or the member re-hides it endlessly.
    */
    expect(store).toContain("minimised: boolean");
    expect(store).toContain("export function setGenerationMinimised");
    // persisted with the rest of the record
    expect(store).toContain("minimised: parsed.minimised === true");
  });

  it("a NEW generation always opens expanded", () => {
    const start = store.slice(store.indexOf("export function startGeneration"), store.indexOf("export function dismissGeneration"));
    expect(start).toContain("minimised: false");
  });

  it("the pill still reports progress rather than hiding it", () => {
    const pill = card.slice(card.indexOf("if (gen.minimised)"), card.indexOf("return (\n    <Portal>\n      <div"));
    expect(pill).toContain("Ready");
    expect(pill).toContain("Making…");
    expect(pill).toContain("animate-ping");
  });

  it("minimise is offered while RUNNING, which dismiss deliberately is not", () => {
    /*
      Dismissing a running job would read as "stop that" and nothing here can
      stop it. Minimising is the honest version of the same wish, so it is the
      one offered in every phase.
    */
    expect(card).toContain('aria-label="Minimise"');
    expect(card).toContain("{!running ? (");
  });

  it("the pill shares the card's lane, so it cannot land on the downloads pill", () => {
    // FloatingDownloadProgress owns bottom-right at 4.75rem / lg:1.5rem.
    expect(card).toContain("bottom-[calc(10.25rem+env(safe-area-inset-bottom))] right-3");
    expect(card).toContain("lg:bottom-[7.5rem] lg:right-6");
  });
});

describe("the progress card outlives the page that started it", () => {
  const store = src("features/ai/video/active-generation.ts");

  it("keeps the record outside React and across a reload", () => {
    expect(store).toContain("sessionStorage");
    expect(store).toContain("export function restoreActiveGeneration");
  });

  it("🔴 never persists the signed result URL", () => {
    /*
      A result link is short-lived and ownership-checked. Persisting one would
      restore a dead URL into a <video> and render a broken result — which is
      exactly what `getAiJobResult`'s own comment warns about.
    */
    expect(store).toContain("const { resultUrl: _resultUrl, ...durable } = current;");
    expect(store).toContain("JSON.stringify(durable)");
  });

  it("mints the result link, which is what made a SUCCESSFUL run show 'Preparing…' for ever", () => {
    // The old hook read `job.resultUrl` off /api/ai/jobs/:id — a field that
    // route has never returned, so `src` was always null.
    expect(store).toContain("getAiJobResult");
    expect(src("app/api/ai/jobs/[id]/route.ts")).not.toContain("resultUrl");
  });
});
