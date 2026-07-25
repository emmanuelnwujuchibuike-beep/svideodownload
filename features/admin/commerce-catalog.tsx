import type {
  BillingCapability,
  CommerceAiCapability,
  CommerceService,
  CommerceType,
  PaymentCapability,
  SubscriptionTier,
} from "@/lib/platform/commerce-platform";
import { cn } from "@/lib/utils";

/**
 * The Commerce catalogue — the Enterprise Commerce Platform described by itself.
 * Read-only, sourced from `lib/platform/commerce-platform.ts`: every service,
 * commerce type, payment capability, plan, billing/promotion feature and AI
 * capability, mapped to the real code that provides it (or honestly `planned`).
 *
 * No live money figures here — real revenue/MRR/subscribers live in the Revenue
 * section. This describes the commerce architecture, not the numbers.
 */

const STATUS: Record<string, string> = {
  live: "bg-green-500/15 text-green-500",
  partial: "bg-amber-500/15 text-amber-500",
  planned: "bg-secondary text-muted-foreground",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS[status] ?? STATUS.planned)}>
      {status}
    </span>
  );
}

function Src({ source }: { source: string }) {
  if (!source) return null;
  return <code className="font-mono text-[11px] text-muted-foreground">{source}</code>;
}

function Card({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <h3 className="font-semibold">{title}</h3>
      <p className="mb-4 mt-0.5 text-sm text-muted-foreground">{blurb}</p>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Row({
  name,
  status,
  source,
  description,
  note,
  tag,
}: {
  name: string;
  status: string;
  source: string;
  description: string;
  note?: string;
  tag?: string;
}) {
  return (
    <div className="border-b border-border/40 pb-2.5 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{name}</span>
        <StatusPill status={status} />
        {tag ? <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{tag}</span> : null}
        <Src source={source} />
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
      {note ? <p className="text-[11px] text-muted-foreground/70">{note}</p> : null}
    </div>
  );
}

function Chip({ label, status, note }: { label: string; status: string; note?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        status === "live"
          ? "border-green-500/30 text-foreground"
          : status === "partial"
            ? "border-amber-500/30 text-foreground"
            : "border-border/60 text-muted-foreground",
      )}
      title={note}
    >
      {label}
      {status !== "live" ? <StatusPill status={status} /> : null}
    </span>
  );
}

export function CommerceCatalog({
  services,
  types,
  payments,
  tiers,
  billing,
  ai,
}: {
  services: CommerceService[];
  types: CommerceType[];
  payments: PaymentCapability[];
  tiers: SubscriptionTier[];
  billing: BillingCapability[];
  ai: CommerceAiCapability[];
}) {
  const all = [...services, ...payments, ...tiers, ...billing, ...ai];
  const live = all.filter((e) => e.status === "live").length;
  const planned = all.filter((e) => e.status === "planned").length;
  const billingRows = billing.filter((b) => b.kind === "billing");
  const promoRows = billing.filter((b) => b.kind === "promotion");

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The Enterprise Commerce Platform described by itself: {all.length} catalogued capabilities
        ({live} live, {planned} planned) across {types.length} commerce types. Every live row points
        at the real module that provides it — a test fails the build if one doesn&apos;t. Live
        revenue, MRR and subscribers are in the <strong>Revenue</strong> section.
      </p>

      <Card title={`Services · ${services.length}`} blurb="The backend capabilities — payments, checkout, subscriptions, plans, pricing, the revenue decision engine and analytics.">
        {services.map((s) => (
          <Row key={s.id} name={s.name} status={s.status} source={s.source} description={s.capability} note={s.note} />
        ))}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Commerce types · ${types.length}`} blurb="What can be sold, and the service that powers each. Marketplace/creator/products are concept-stage.">
          <div className="flex flex-wrap gap-2">
            {types.map((t) => (
              <Chip key={t.id} label={t.label} status={t.status} note={t.note ?? (t.poweredBy ? `Powered by ${t.poweredBy}` : "Planned")} />
            ))}
          </div>
        </Card>

        <Card title={`Subscription tiers · ${tiers.length}`} blurb="Free, Pro and Business are live. Creator/professional/enterprise/family/usage-based are planned.">
          {tiers.map((t) => (
            <div key={t.id} className="border-b border-border/40 pb-2 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{t.label}</span>
                <StatusPill status={t.status} />
                <Src source={t.source} />
              </div>
              {t.note ? <p className="mt-0.5 text-[11px] text-muted-foreground/70">{t.note}</p> : null}
            </div>
          ))}
        </Card>
      </div>

      <Card title={`Payment platform · ${payments.length}`} blurb="Paystack is the integrated PSP (Africa-primary). Card/recurring/one-time are live; wallets/regional are Paystack-config-gated; refunds/split/multi-provider planned.">
        {payments.map((p) => (
          <Row key={p.id} name={p.name} status={p.status} source={p.source} description={p.description} note={p.note} />
        ))}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Billing · ${billingRows.length}`} blurb="History + renewal + analytics are live; formal invoices/tax/dunning are planned.">
          {billingRows.map((b) => (
            <Row key={b.id} name={b.name} status={b.status} source={b.source} description={b.description} note={b.note} />
          ))}
        </Card>

        <Card title={`Promotions · ${promoRows.length}`} blurb="Coupons, referrals, loyalty and campaigns — all planned.">
          {promoRows.map((b) => (
            <Row key={b.id} name={b.name} status={b.status} source={b.source} description={b.description} note={b.note} />
          ))}
        </Card>
      </div>

      <Card title={`Commerce Intelligence (AI) · ${ai.length}`} blurb="Analytics today are real but descriptive (counts + derived MRR). The predictive/AI layer is honestly planned.">
        {ai.map((c) => (
          <Row key={c.id} name={c.name} status={c.status} source={c.source} description={c.description} />
        ))}
      </Card>
    </div>
  );
}
