"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  FRENZ_AI_MAX_FREE_CREDITS,
  FRENZ_AI_MAX_PAID_CREDITS,
  FRENZ_AI_MAX_PRICE_CENTS,
  FRENZ_AI_MAX_WEEKLY_CREDITS,
  FRENZ_AI_MIN_PRICE_CENTS,
  FRENZ_AI_MIN_PAID_CREDITS,
  FRENZ_AI_MIN_TOPUP_CEILING,
  FRENZ_AI_MIN_TOPUP_FLOOR,
  AI_CURRENCIES,
  aiCurrencySymbol,
  type AiCurrency,
  type AiCleanEngineSetting,
  type LandingSettings,
} from "@/lib/landing/settings";
import { aiTopupOptions, formatCents } from "@/lib/ai/economy";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — the operator switches
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08: "make it configurable in admin dashboard where i can turn
 * off frenz ai from unsigned in users when adsense already approved", "make the
 * free users usage credit to be 2 now… and it should be setable in admin
 * dashboard", and "set in admin dashboard so i can turn off anonymous ai usage
 * to show upgrade to pro and i can remove it later".
 *
 * All three were built into the settings store and the API days ago, and NONE
 * of them had a control. They could only be changed by an API call or a direct
 * database write, which is not what "configurable in admin dashboard" means.
 * This is that panel.
 *
 * ── 🔴 ITS OWN FORM, NOT FIELDS ON THE IMAGES ONE ───────────────────────────
 *
 * `LandingEditor` POSTs only the two image fields it owns. That was fine when
 * every other field defaulted; it is fine again now that the route does partial
 * updates. But keeping these three in a separate form means a save HERE sends
 * only these three, and a save THERE sends only those two — so neither panel
 * can ever clobber a field it does not display.
 *
 * That is the same reasoning that gave reward-network routing its own settings
 * key rather than a field on the big monetization object.
 */
export function FrenzAISettings({ settings }: { settings: LandingSettings }) {
  const router = useRouter();
  const [publicEnabled, setPublicEnabled] = useState(settings.frenzAiPublicEnabled);
  const [freeEnabled, setFreeEnabled] = useState(settings.frenzAiFreeEnabled);
  const [credits, setCredits] = useState(String(settings.frenzAiFreeDailyCredits));
  const [proCredits, setProCredits] = useState(String(settings.frenzAiProDailyCredits));
  const [businessCredits, setBusinessCredits] = useState(String(settings.frenzAiBusinessDailyCredits));
  const [weekly, setWeekly] = useState(String(settings.frenzAiWeeklyFreeCredits));
  const [price, setPrice] = useState(String(settings.frenzAiVideoPriceCents));
  const [currency, setCurrency] = useState<AiCurrency>(settings.frenzAiCurrency);
  const [minTopup, setMinTopup] = useState(String(settings.frenzAiMinTopupCents));
  // The symbol the operator will actually be charging in — see the currency note.
  const symbol = aiCurrencySymbol(currency);
  const [engine, setEngine] = useState<AiCleanEngineSetting>(settings.frenzAiEngine);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/landing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 🔴 Only what this panel owns. The route merges, so the image fields it
        // knows nothing about are left exactly as they are.
        body: JSON.stringify({
          frenzAiPublicEnabled: publicEnabled,
          frenzAiFreeEnabled: freeEnabled,
          frenzAiFreeDailyCredits: Number(credits) || 0,
          /*
            🔴 The CURRENT value when a box is empty, never 0. Zero is a legal
            free credit count and an illegal paid one, so an empty paid field
            has to mean "leave it alone" rather than "set it to zero" — the
            route's schema would refuse a 0 and the operator would meet a
            validation error on a field they never touched.
          */
          frenzAiProDailyCredits: Number(proCredits) || settings.frenzAiProDailyCredits,
          frenzAiBusinessDailyCredits:
            Number(businessCredits) || settings.frenzAiBusinessDailyCredits,
          /*
            🔴 Weekly may legitimately be ZERO ("no free AI this week"), so
            `|| settings…` would silently swallow a deliberate 0 and send the
            old value back. An empty field is the only thing that means "leave
            it alone" here.
          */
          frenzAiWeeklyFreeCredits:
            weekly.trim() === "" ? settings.frenzAiWeeklyFreeCredits : Number(weekly),
          // Price may NOT be zero — the schema refuses it — so here `||` is
          // guarding an empty field rather than discarding a meaningful 0.
          frenzAiVideoPriceCents: Number(price) || settings.frenzAiVideoPriceCents,
          frenzAiCurrency: currency,
          frenzAiMinTopupCents: Number(minTopup) || settings.frenzAiMinTopupCents,
          frenzAiEngine: engine,
        }),
      });
      const json = await res.json();
      setMsg(
        res.ok
          ? { ok: true, text: "Saved. Applies to the next job anybody starts." }
          : { ok: false, text: json.error ?? "Failed to save." },
      );
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Sparkles className="h-5 w-5 text-primary" /> Frenz AI access
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Who may use AI Clean, and how much they get. Every job costs real provider
        credit, so these are the levers that bound that spend.
      </p>

      <form onSubmit={save} className="space-y-6">
        <Toggle
          label="Visible to signed-out visitors"
          hint="Off hides Frenz AI from anyone not signed in — including the AdSense crawler. Leave on until AdSense has approved the site, which is the reason it is public."
          checked={publicEnabled}
          onChange={setPublicEnabled}
        />

        <Toggle
          label="Free members can use AI Clean"
          hint={
            'Off shows "AI Clean is a Pro feature right now" instead of a counter. Deliberately not the same as setting credits to zero — zero would say "you have used your 0 free cleans today", which is nonsense. Paid plans are unaffected either way.'
          }
          checked={freeEnabled}
          onChange={setFreeEnabled}
        />

        <div>
          <label htmlFor="frenz-ai-credits" className="block text-sm font-semibold">
            Free cleans per day
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            For guests and free members. Zero is allowed and means nobody gets a
            free clean; use the switch above if you want the interface to say
            &ldquo;Pro feature&rdquo; instead of showing a counter.
          </p>
          <input
            id="frenz-ai-credits"
            type="number"
            inputMode="numeric"
            min={0}
            max={FRENZ_AI_MAX_FREE_CREDITS}
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            disabled={!freeEnabled}
            className={cn(
              "mt-2 w-28 rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !freeEnabled && "opacity-50",
            )}
          />
          <span className="ml-2 text-xs text-muted-foreground">
            0&ndash;{FRENZ_AI_MAX_FREE_CREDITS}
          </span>
        </div>

        {/*
          ── 🔴 THE WEEKLY CEILING AND THE PRICE ────────────────────────────

          Owner, 2026-09-09: the standing Frenz AI rule (§6/§7/§10/§20), and
          separately "make the price per video be adjustable from the admin
          dashboard".

          These two are the whole economy an operator can steer: how much is
          free, and what the rest costs. Both apply to the NEXT request — they
          are read server-side per job, so a change here needs no deploy and
          takes effect immediately.

          🔴 THE PRICE FIELD IS IN CENTS, and it says so on the label rather
          than in a tooltip. A field measured in cents that looks like it might
          be dollars is a two-order-of-magnitude mistake waiting to happen —
          somebody types 50 meaning fifty cents, or types 0.5 meaning the same
          and gets 0. The live dollar value is rendered beside the input so the
          operator can see what they have actually set before saving.
        */}
        <div>
          <p className="text-sm font-semibold">Free weekly allowance</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Applies on top of the daily limit — a member gets whichever is lower.
            Someone on 2 a day and {weekly || FRENZ_AI_MAX_WEEKLY_CREDITS} a week
            who cleans on three days has used the week, and Thursday&apos;s daily
            reset does not give them another. The week starts Monday 00:00 UTC.
          </p>
          <input
            id="frenz-ai-weekly"
            type="number"
            inputMode="numeric"
            min={0}
            max={FRENZ_AI_MAX_WEEKLY_CREDITS}
            value={weekly}
            onChange={(e) => setWeekly(e.target.value)}
            className="mt-2 w-28 rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="ml-2 text-xs text-muted-foreground">0&ndash;{FRENZ_AI_MAX_WEEKLY_CREDITS}</span>
        </div>

        {/*
          ── 🔴 THE CURRENCY, AND WHY IT IS NOT OPTIONAL ────────────────────

          Owner, 2026-09-09: "i need to set up currency? what if user from us
          want to pay and is in naira? cause my default currency in paystack is
          naira and i want users to be billed in usd."

          Paystack amounts are in the SUBUNIT of the account's currency and the
          API never reports which one it assumed. `50` is ₦0.50 on a naira
          account and $0.50 on a dollar one. Nothing in the response
          distinguishes them, so a mismatch here is silent and permanent.

          ⚠️ SETTING THIS TO USD DOES NOT ENABLE USD. Charging in a currency
          other than the account's default is a capability Paystack grants
          per-merchant — a Nigerian account needs USD switched on for it (a
          business account, requested through their dashboard or support).
          Until then a USD transaction is REFUSED at checkout, which is the
          loud failure we want rather than a silent mispricing.
        */}
        <div>
          <label htmlFor="frenz-ai-currency" className="block text-sm font-semibold">
            Billing currency
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Must match what your Paystack account can actually charge. Setting a
            currency here does not enable it — Paystack grants that per account,
            and a currency it cannot process is refused at checkout.
          </p>
          <select
            id="frenz-ai-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as AiCurrency)}
            className="mt-2 rounded-xl border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(Object.keys(AI_CURRENCIES) as AiCurrency[]).map((code) => (
              <option key={code} value={code}>
                {code} ({AI_CURRENCIES[code]})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="frenz-ai-price" className="block text-sm font-semibold">
            Price per AI video, in {currency} minor units
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Charged only after a member&apos;s free allowance is used. Pro and
            Business pay this too — a subscription does not include AI.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              id="frenz-ai-price"
              type="number"
              inputMode="numeric"
              min={FRENZ_AI_MIN_PRICE_CENTS}
              max={FRENZ_AI_MAX_PRICE_CENTS}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-28 rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {/* What they have actually typed, in the units a person thinks in. */}
            <span className="text-sm font-semibold tabular-nums">
              = {formatCents(Number(price) || 0, symbol)}
            </span>
            <span className="text-xs text-muted-foreground">per video</span>
          </div>
        </div>

        {/*
          ── 🔴 THE SMALLEST DEPOSIT (owner, 2026-09-09) ────────────────────

          "whats the minimum deposit? it should be configurable from admin
          dashboard."

          ONE field, not four. The amounts offered to a member are this times
          1, 2, 5 and 10 — so the ladder is always ordered, always starts where
          the operator said, and there is one number to reason about rather
          than four that could be set into nonsense.

          🔴 The floor of {FRENZ_AI_MIN_TOPUP_FLOOR} is about the CARD
          PROCESSOR, not about us: below roughly a unit of currency, the
          per-transaction fee is a large fraction of the sale, so a tiny top-up
          costs more to collect than it collects.
        */}
        <div>
          <label htmlFor="frenz-ai-min-topup" className="block text-sm font-semibold">
            Minimum deposit, in {currency} minor units
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Members are offered this, and 2×, 5× and 10× of it. Anything else is
            refused server-side, so the ladder is the only thing anybody can buy.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              id="frenz-ai-min-topup"
              type="number"
              inputMode="numeric"
              min={FRENZ_AI_MIN_TOPUP_FLOOR}
              max={FRENZ_AI_MIN_TOPUP_CEILING}
              value={minTopup}
              onChange={(e) => setMinTopup(e.target.value)}
              className="w-32 rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {/* The whole ladder, so the operator sees what a member will be
                offered before saving rather than after. */}
            <span className="text-xs text-muted-foreground">
              offers{" "}
              <span className="font-semibold text-foreground">
                {aiTopupOptions(Number(minTopup) || 0)
                  .map((c) => formatCents(c, symbol))
                  .join(" · ")}
              </span>
            </span>
          </div>
        </div>

        {/*
          ── 🔴 THE PAID CAPS (owner, 2026-09-09) ───────────────────────────

          "pro and business cap should be able to change in admin dashboard, if
          is not set yet set it up."

          The note above this field used to say the opposite — that paid limits
          were "deliberately not settable here" because "an operator raising one
          by mistake is how a stolen session becomes an unbounded bill". That
          risk is real and it has not gone away; it is simply not an argument
          about who decides. It now lives in the BOUNDS: the floor sits above
          the free allowance so a slip cannot give a subscriber less than a free
          member gets, and the ceiling caps what a slipped digit can commit to.

          🔴 The numbers are no longer printed anywhere in the product — the
          member's screen shows their live remaining count instead — precisely
          because an operator can change these at any time. A printed ceiling
          would turn this field into a promise the product had already made.
        */}
        <div>
          <p className="text-sm font-semibold">Paid cleans per day</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pro and Business. These are not shown anywhere in the app, so you can
            change them without contradicting something a member has already
            read. Between {FRENZ_AI_MIN_PAID_CREDITS} and {FRENZ_AI_MAX_PAID_CREDITS}
            &nbsp;— the floor is there so a mistyped value can never leave a
            paying member with less than a free one.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-4">
            {(
              [
                { id: "frenz-ai-pro-credits", label: "Pro", value: proCredits, set: setProCredits },
                {
                  id: "frenz-ai-business-credits",
                  label: "Business",
                  value: businessCredits,
                  set: setBusinessCredits,
                },
              ] as const
            ).map((field) => (
              <label key={field.id} htmlFor={field.id} className="block">
                <span className="block text-xs font-semibold text-muted-foreground">{field.label}</span>
                <input
                  id={field.id}
                  type="number"
                  inputMode="numeric"
                  min={FRENZ_AI_MIN_PAID_CREDITS}
                  max={FRENZ_AI_MAX_PAID_CREDITS}
                  value={field.value}
                  onChange={(e) => field.set(e.target.value)}
                  className={cn(
                    "mt-1 w-28 rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                />
              </label>
            ))}
          </div>
        </div>

        {/*
          ── 🔴 THE ENGINE ──────────────────────────────────────────────────

          Owner, 2026-09-09: "i dont see a switch in admin dashboard to switch
          the propainter off or on."

          It shipped as an environment variable, which means a deploy and me.
          This is the control, and the setting is now the authority — the env
          var survives only as the fallback for a deploy with no settings row.

          The hint states the trade honestly in both directions. Quality is not
          free here: the second engine adds a GPU call and roughly 210s, and it
          has a genuine weakness that a screenshot of a good result would hide.
        */}
        <div>
          <p className="text-sm font-semibold">Background reconstruction</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            What rebuilds the picture behind removed captions. Measured on a real
            clip: the fast engine leaves a visible rectangular smear on every
            setting it has — including the tightest mask it can make — because it
            fills from a single frame and cannot know what was behind the text.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <EngineChoice
              value="classical"
              selected={engine}
              onSelect={setEngine}
              title="Fast"
              body="One CPU call, ~25s of inference. Cheapest. Leaves a smeared band where the caption was."
            />
            <EngineChoice
              value="propainter"
              selected={engine}
              onSelect={setEngine}
              title="Best quality"
              body="Adds a GPU pass (~210s) that rebuilds the region from frames where it was not covered. No rectangular edge. Costs more per job, and a caption that never moves over a background that never moves gives it nothing to borrow from."
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="btn-lux btn-lux-primary">
            {busy ? "Saving…" : "Save"}
          </button>
          {msg ? (
            <p className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-rose-500")}>
              {msg.text}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

/** A labelled switch. A real checkbox, so it is keyboard- and reader-native. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

/**
 * One engine option, as a radio card rather than a toggle.
 *
 * A two-state switch would have to be labelled for one of them ("use
 * ProPainter"), which makes the other the unnamed default and hides what it
 * actually does. Two cards let both sides state their cost and their weakness,
 * which is the information an operator needs to choose — this is a money
 * decision, not a preference.
 *
 * A real `<input type="radio">` under a label, so it is keyboard reachable and
 * announced as a group, rather than a div with a click handler.
 */
function EngineChoice({
  value,
  selected,
  onSelect,
  title,
  body,
}: {
  value: "classical" | "propainter";
  selected: string;
  onSelect: (v: "classical" | "propainter") => void;
  title: string;
  body: string;
}) {
  const active = selected === value;
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-2xl border p-3 transition",
        active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
      )}
    >
      <input
        type="radio"
        name="frenz-ai-engine"
        value={value}
        checked={active}
        onChange={() => onSelect(value)}
        className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{body}</span>
      </span>
    </label>
  );
}
