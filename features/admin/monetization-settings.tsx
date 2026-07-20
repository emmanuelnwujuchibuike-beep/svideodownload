"use client";

import { AlertTriangle, Loader2, ToggleRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { MonetizationSettings } from "@/lib/monetization/settings";
import { cn } from "@/lib/utils";

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
  { key: "adsterra", label: "Adsterra", hint: "Adsterra network banners" },
  { key: "propellerads", label: "PropellerAds", hint: "PropellerAds network units" },
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

  const setText = (key: "adsensePublisherId" | "adsTxt" | "verificationTags", value: string) =>
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

      <div className="grid gap-2.5 sm:grid-cols-2">
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
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save AdSense details
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
