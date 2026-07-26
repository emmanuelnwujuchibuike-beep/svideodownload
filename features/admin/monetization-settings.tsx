"use client";

import { AlertTriangle, Check, Loader2, ToggleRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MONETAG_SURFACES, type MonetagUnit } from "@/lib/monetization/monetag";
import type { MonetizationSettings } from "@/lib/monetization/settings";
import { cn } from "@/lib/utils";

import { MonetagUnitsEditor } from "./monetag-units-editor";

/*
  Only the boolean switches. `MonetizationSettings` also carries the AdSense
  publisher id and the ads.txt body, which are text fields rendered separately —
  typing this as `keyof` would let one of them be dropped into the toggle grid,
  where `!s[key]` would turn a publisher id into `false`.
*/
type ToggleKey = {
  [K in keyof MonetizationSettings]: MonetizationSettings[K] extends boolean ? K : never;
}[keyof MonetizationSettings];

const ROWS: { key: ToggleKey; label: string; hint: string }[] = [
  { key: "adsense", label: "Google AdSense", hint: "AdSense banner and video units" },
  { key: "monetag", label: "Monetag", hint: "Multitag + per-type tags (In-Page Push, Push, Vignette, OnClick) — configure below" },
  { key: "adsterra", label: "Adsterra", hint: "Adsterra network banners (retired — off by default)" },
  { key: "propellerads", label: "PropellerAds", hint: "PropellerAds network units (retired — off by default)" },
  { key: "affiliates", label: "Affiliate offers", hint: "Affiliate CTA on the download-result page" },
  { key: "recommendedTools", label: "Recommended tools", hint: "Curated tool sections (home/footer/sidebar)" },
  {
    key: "popunder",
    /*
      Named for the MECHANISM, not one of its products. Adsterra's Social Bar is
      a visible floating unit that needs exactly this switch, and a toggle
      called "Pop-under" is one nobody would turn on to make a Social Bar work.
    */
    label: "In-page scripts",
    hint: "Social Bar, pop-under and OnClick units. Off by default — see the warning below.",
  },
  {
    key: "interstitial",
    label: "Full-screen units",
    hint: "Idle interstitial, the after-download panel, and any video unit. Off by default.",
  },
];

export function MonetizationSettings({ settings }: { settings: MonetizationSettings }) {
  const router = useRouter();
  const [state, setState] = useState<MonetizationSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setText = (key: "adsensePublisherId" | "adsTxt" | "verificationTags" | "monetagSnippet", value: string) =>
    setState((s) => ({ ...s, [key]: value }));

  const persist = async (next: MonetizationSettings) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/monetization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const json = await res.json();
      setMsg(
        res.ok
          ? { ok: true, text: "Saved." }
          : { ok: false, text: json.error ?? "Failed to save." },
      );
      if (res.ok) router.refresh();
      return res.ok;
    } catch {
      setMsg({ ok: false, text: "Network error." });
      return false;
    } finally {
      setBusy(false);
    }
  };

  /*
    Toggles SAVE THEMSELVES.

    The old design updated local state and required a separate "Save controls"
    button — and on mobile that button was below a long section and easy to
    miss, so an operator would turn Adsterra off, see the switch flip, leave, and
    find it still running because nothing was persisted. A switch that looks off
    but is on is worse than no switch. Flipping one now writes immediately, with
    an optimistic UI and a rollback if the write fails.
  */
  const toggle = async (key: ToggleKey) => {
    const next = { ...state, [key]: !state[key] };
    setState(next);
    const ok = await persist(next);
    if (!ok) setState((s) => ({ ...s, [key]: !s[key] })); // roll back on failure
  };

  // The text fields (publisher id, ads.txt, verification tags) still save on a
  // button — persisting on every keystroke would be absurd.
  const saveText = () => persist(state);

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <ToggleRight className="h-5 w-5 text-primary" /> Monetization controls
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Each switch saves on tap and takes effect within a few seconds. No
        separate save.
      </p>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {ROWS.map((r) => (
          <button
            key={r.key}
            type="button"
            disabled={busy}
            onClick={() => toggle(r.key)}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/20 p-3.5 text-left transition hover:border-foreground/20 disabled:opacity-70"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{r.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{r.hint}</span>
            </span>
            <Switch on={state[r.key]} />
          </button>
        ))}
      </div>

      {/* Interstitial skip delay — how long before a full-screen ad can be
          skipped. Only meaningful with full-screen units on; saves on change. */}
      {state.interstitial ? (
        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Interstitial skip delay</span>
            <span className="block truncate text-xs text-muted-foreground">How long before a full-screen ad can be skipped.</span>
          </span>
          <select
            value={state.interstitialSkipSeconds}
            disabled={busy}
            onChange={async (e) => {
              const v = Number(e.target.value);
              const prev = state.interstitialSkipSeconds;
              const next = { ...state, interstitialSkipSeconds: v };
              setState(next);
              const ok = await persist(next);
              if (!ok) setState((s) => ({ ...s, interstitialSkipSeconds: prev }));
            }}
            className="h-9 shrink-0 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary"
          >
            <option value={0}>Skip immediately</option>
            <option value={5}>After 5 seconds</option>
            <option value={10}>After 10 seconds</option>
          </select>
        </div>
      ) : null}

      {/*
        Shown only when both are on, and only then — a standing warning about a
        combination nobody has selected is noise that trains people to ignore it.
      */}
      {state.popunder && state.adsense ? (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>In-page scripts are on while AdSense is enabled.</strong> This switch also
            allows pop-under and OnClick units, and Google prohibits anything that interferes with
            navigation — a reviewer who meets one is meeting exactly that. It is the most common
            reason a site is rejected, and it can cost an already-approved account.
            <br />
            <strong className="mt-1 inline-block">
              If your site is still &ldquo;Getting ready&rdquo; or under review, turn this off until
              you are approved.
            </strong>{" "}
            Adsterra <em>banner</em> units are unaffected and safe to keep running. Note this is a
            single switch: enabling it for a Social Bar also enables any pop-under row you have.
          </span>
        </p>
      ) : null}

      {/*
        Site-level AdSense. Deliberately separated from the ad-placement form:
        that form configures an ad UNIT (publisher id + slot id, rendered in a
        placement); these two are what AdSense asks for to VERIFY the site, and
        neither has a slot. There was previously nowhere to put them.
      */}
      <div className="mt-6 space-y-4 border-t border-border/60 pt-5">
        <div>
          <h3 className="text-sm font-semibold">Google AdSense — site setup</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            These verify the site and enable Auto ads. Individual banner and video units are
            configured under Ad placements.
          </p>
        </div>

        <div>
          <label htmlFor="adsense-pub" className="mb-1 block text-xs font-medium text-muted-foreground">
            Publisher ID
          </label>
          <input
            id="adsense-pub"
            value={state.adsensePublisherId}
            onChange={(e) => setText("adsensePublisherId", e.target.value)}
            placeholder="ca-pub-6455244673998965"
            className="h-10 w-full rounded-xl bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {/* Naming the exact failure, because it is silent: the wrong prefix
                produces a script URL that 404s and no ads, with no error. */}
            From the <code className="font-mono">client=</code> part of the AdSense snippet. Must
            start with <code className="font-mono">ca-pub-</code> — the bare{" "}
            <code className="font-mono">pub-</code> form used in ads.txt will not load.
          </p>
          {/*
            The empty state is the one worth calling out. AdSense enabled with
            no publisher id means the loader script is never emitted, so no unit
            can ever fill — and nothing anywhere else says so. ads.txt can be
            Authorised while this is blank, which makes it look done.
          */}
          {state.adsense && !state.adsensePublisherId.trim() ? (
            <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>No publisher ID set.</strong> The AdSense script is not on the site, so no
                AdSense unit can fill — even once your site is approved, and even though ads.txt is
                already authorised. Paste it above and save.
              </span>
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="ads-txt" className="mb-1 block text-xs font-medium text-muted-foreground">
            ads.txt
          </label>
          <textarea
            id="ads-txt"
            value={state.adsTxt}
            onChange={(e) => setText("adsTxt", e.target.value)}
            placeholder="google.com, pub-6455244673998965, DIRECT, f08c47fec0942fa0"
            className="min-h-[80px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Paste the line AdSense gives you. Served at{" "}
            <a href="/ads.txt" target="_blank" rel="noopener" className="font-medium text-primary hover:underline">
              /ads.txt
            </a>{" "}
            as soon as you save — add other networks&apos; lines here too, one per line.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-2 border-t border-border/60 pt-5">
        <h3 className="text-sm font-semibold">Monetag</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Paste the Multitag <code className="font-mono">&lt;script&gt;</code> snippet from your
          Monetag dashboard, then turn the <strong>Monetag</strong> switch above on. It&apos;s parsed
          into a safe script tag in the page head (never injected as raw HTML) and, being
          server-rendered, also satisfies Monetag&apos;s &ldquo;code&rdquo; verification — so you do
          NOT need Monetag&apos;s &ldquo;upload sw.js&rdquo; method, which can&apos;t be used here
          (that path is the app&apos;s own service worker).
        </p>
        <label className="block text-xs font-medium text-muted-foreground">Multitag (all formats)</label>
        <textarea
          value={state.monetagSnippet}
          onChange={(e) => setText("monetagSnippet", e.target.value)}
          placeholder={'<script src="//example.monetag.com/tag.min.js" data-zone="1234567" async data-cfasync="false"></script>'}
          className="min-h-[80px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <p className="text-xs text-muted-foreground">
          Only the <code className="font-mono">https</code> script URL and{" "}
          <code className="font-mono">data-zone</code> are used; anything else in the snippet is
          ignored. Save with the button below.
        </p>

        {/*
          Per-type Monetag tags. Controlled by the parent state so there is one
          settings object and one save path — see MonetagUnitsEditor.
        */}
        <div className="mt-4 border-t border-border/50 pt-4">
          <MonetagUnitsEditor
            units={state.monetagUnits}
            disabled={busy}
            onChange={(next: MonetagUnit[]) => setState((s) => ({ ...s, monetagUnits: next }))}
          />
        </div>

        {/* WHERE Monetag shows. Pro/Business are ad-free regardless; this narrows
            it further by page. Controlled by the parent state (one save path). */}
        <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => setState((s) => ({ ...s, monetagAllPages: !s.monetagAllPages }))}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/20 p-3.5 text-left transition hover:border-foreground/20 disabled:opacity-70"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Show on all pages</span>
              <span className="block truncate text-xs text-muted-foreground">
                {state.monetagAllPages ? "Monetag runs on every page." : "Monetag runs only on the pages ticked below."}
              </span>
            </span>
            <Switch on={state.monetagAllPages} />
          </button>

          {!state.monetagAllPages ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Pages Monetag may show on</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {MONETAG_SURFACES.map((surface) => {
                  const on = state.monetagSurfaces.includes(surface.id);
                  return (
                    <button
                      key={surface.id}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setState((s) => ({
                          ...s,
                          monetagSurfaces: on
                            ? s.monetagSurfaces.filter((id) => id !== surface.id)
                            : [...s.monetagSurfaces, surface.id],
                        }))
                      }
                      className={cn(
                        "flex items-start gap-2.5 rounded-2xl border p-3 text-left transition disabled:opacity-70",
                        on ? "border-primary/50 bg-primary/[0.06]" : "border-border/70 bg-secondary/20 hover:border-foreground/20",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                        )}
                      >
                        {on ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{surface.label}</span>
                        <span className="block text-[11px] text-muted-foreground">{surface.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {state.monetagSurfaces.length === 0 ? (
                <p className="text-[11px] text-amber-500">
                  Nothing ticked — Monetag will not show anywhere until you select a page or turn
                  &ldquo;Show on all pages&rdquo; back on.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6 space-y-2 border-t border-border/60 pt-5">
        <h3 className="text-sm font-semibold">Site verification (other networks)</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          One <code className="font-mono">name|content</code> pair per line — only needed for
          networks other than AdSense, whose tag is added automatically from the publisher ID above.
          {/*
            Kept because the constraint is permanent and the reason is not
            obvious: a future network will ask for the same thing, and the next
            person to hit it should find the answer here rather than by
            overwriting the service worker and losing offline mode.
          */}{" "}
          Always choose the <strong>meta tag</strong> method: the &ldquo;upload a file to your root
          folder&rdquo; option cannot be used, because networks that offer it ask for{" "}
          <code className="font-mono">/sw.js</code> — already the app&apos;s service worker (offline
          mode, push notifications, background downloads).
        </p>
        <textarea
          value={state.verificationTags}
          onChange={(e) => setText("verificationTags", e.target.value)}
          placeholder={"monetag|abc123def456\ngoogle-adsense-account|ca-pub-6455244673998965"}
          className="min-h-[80px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <p className="text-xs text-muted-foreground">
          Rendered as real <code className="font-mono">&lt;meta&gt;</code> tags in the page head on
          every page. The AdSense one is added automatically from the publisher ID above — you only
          need a line here for other networks.
        </p>
      </div>

      {/* This button saves the AdSense TEXT fields above. The switches save
          themselves on tap, so it no longer needs to be reached to turn a
          subsystem off — which on mobile it often could not be. */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={saveText}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save Monetag &amp; AdSense details
        </button>
        {msg ? (
          <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span>
        ) : null}
      </div>
    </section>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        on ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </span>
  );
}
