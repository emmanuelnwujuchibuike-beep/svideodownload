# Ad Platform — Part 8 brief (owner, 2026-10-09)

> Recorded from the owner's message, compressed but with every requirement
> kept. **Do not edit the requirements**; record progress in
> `docs/AD_PLATFORM.md` (Part 8 section).

**Part 8: analytics, fraud prevention, safety and advertiser quality.** It
builds on Parts 1–7 and integrates with:

- the campaign engine
- the canonical physical slot inventory
- the providers
- the payment router
- creative validation
- the advertiser dashboard
- the admin dashboard

**Critical requirements**

- Audit before changing.
- No duplicate analytics, payment, campaign or fraud systems.
- Prevent fraudulent impressions, clicks, rewards and campaign activity.
- Detect malicious destinations and unsafe creatives.
- Keep analytics lightweight and cheap.
- Never route large media through Vercel Fast Origin, Vercel Functions or
  Railway.
- No server request per impression, click or rotation.
- Normal campaigns still activate automatically after verified payment and
  automated validation. Review is only for suspicious or exceptional cases.

## 1 · Audit

Inspect each of these, and classify each feature as implemented, incomplete,
duplicated, broken, insecure or missing:

- event tracking and analytics tables
- impression, click, viewability and video-completion tracking
- attribution and slot IDs
- all providers
- fraud prevention, rate limiting, bot protection and abuse detection
- the advertiser and admin dashboards
- payment verification, refunds, chargebacks and reconciliation
- creative upload, storage, validation and URL scanning
- authentication, RLS, admin roles and audit logs
- notifications, logs, error reporting and monitoring
- Vercel Functions, Fast Origin, Railway and media paths

Reuse and extend what works.

## 2 · Centralized ad events

**Attribution.** Every event can be attributed to:

- the campaign, advertiser, creative, canonical slot, placement, format and
  provider
- its type and timestamp
- a session or pseudonymous event id
- validation and delivery metadata

**Events.** The events are:

- eligible, served, impression, viewable impression (where measurable), click
- reward start, reward complete
- creative load failure, empty inventory
- invalid or rejected event, delivery failure

**Rules.**

- The same canonical slot ID is used across providers.
- A provider fallback or a creative swap is not a new impression unless a
  genuinely new qualifying impression occurs.
- Self-serve reporting stays separate from provider reporting. Never claim
  provider metrics an integration does not expose.

## 3 · Metric definitions (documented, consistent across advertiser and admin)

- **Impression:** a qualifying impression under documented rules. A preview,
  a failed load or a hidden placeholder does not count.
- **Click:** a qualifying interaction, with retries and repeats deduplicated.
- **CTR:** clicks ÷ qualifying impressions × 100. Shown as unavailable when
  there is no valid denominator.
- **Fill rate:** filled ÷ eligible, only when both sides are measurable. Do
  not mix inventories or providers.
- **Viewability:** only where it is reliably measurable. Never invented.
- **Reward completion:** only after the supported playback checks succeed. A
  client flag alone is never trusted when rewards or billing depend on it.
- **Spend and revenue:** from verified internal payment records. Refunds,
  chargebacks, promotional credits and outstanding amounts stay
  distinguishable.

## 4 · Lightweight collection

The flow is: browser → batched ingest → validated → aggregated → dashboards.

**Rules.**

- Batch events.
- Validate the schema and the event types.
- Limit the request size and the batch size.
- Use stable event IDs or idempotency keys.
- Reject malformed, duplicate, impossible or unauthorised events.
- Apply rate limits and abuse controls.
- Aggregate periodically or incrementally.
- Use indexed, time-bounded queries.
- Keep raw detail only as long as needed. Summaries outlive it.

**Never.**

- No function invocation or query per 5-second rotation.
- No permanent Railway collector.
- No needless Realtime, per-second polling or huge queries.

Supabase is the data layer, and nothing else is added without measured need.
Analytics failures must never break Download, Frenz AI, Feed, Reels, AI Reels,
serving or payments.

## 5 · Fraud and invalid traffic (centralized, configurable)

**Patterns to investigate.**

- rapid repeat impressions
- repeat clicks on the same campaign
- automated click sequences and bot-like traffic
- abnormal volume from one session or device
- advertiser self-clicks
- impossible timing or playback sequences
- manipulated campaign or slot IDs
- replayed payloads
- coordinated traffic across accounts
- invalid reward completions
- suspicious payment or campaign activity

**Approach.**

- Use multiple signals, never only an IP or user agent.
- Account for shared networks, carriers and privacy tools. A shared IP alone
  is never fraud.
- Use configurable thresholds, rate limits, risk scores and escalation.

**Responses, from mildest to strongest.**

1. Accept.
2. Accept and flag.
3. Exclude from billable and qualifying counts.
4. Rate-limit ingest.
5. Require verification.
6. Suspend reward eligibility for that event.
7. Flag the campaign or account for review.
8. Temporarily pause the campaign on credible serious risk.
9. Block a confirmed malicious campaign.

Keep the evidence. Never permanently ban on a weak or isolated signal.

## 6 · Click and impression fraud

- Trusted validation backs every consequential decision. A client cannot make
  an event billable just by sending it.
- Deduplicate event IDs.
- Validate the campaign, creative, placement and slot, and check that the
  campaign was eligible at the event time.
- Apply frequency and rate limits.
- Reject events for expired, paused, blocked or ineligible campaigns.
- Detect click patterns and automation.
- Keep previews and admin testing separate.
- Keep raw and qualifying counts apart.
- Never count one event twice because of retries or fallback.
- Arbitrary client campaign IDs never become trusted events.
- Provider numbers and Frenzsave-measured numbers stay distinct.
- Never promise every event is genuine. Explain that filtering and
  adjustments follow documented policy.

## 7 · Rewards and payments

**Ad-related rewards.** Use the existing ledger; build no new economy.

- Verify on the server.
- Make rewards idempotent, with no repeats from duplicate events.
- Verify the campaign, the user and the action.
- Never reward on a browser completion claim alone.
- Keep the source event and the reason.
- Prevent self-referral and attribution manipulation.

**Campaign payments.**

- Success only through the existing verification.
- Validate the reference, amount, currency, purpose and campaign link.
- Handle duplicate webhooks and callback/webhook races.
- Flag mismatches and suspicious attempts.
- Never activate an unpaid campaign.
- Refunds and chargebacks go through the existing architecture, and the
  campaign is reassessed after a chargeback.
- No separate ledger. Analytics never grant entitlements.

## 8 · Destination URL safety

Validate at submission and on every live change. The checks are:

- syntax, and the scheme (HTTPS)
- reputation, where reliable data exists
- phishing, malware and scam indicators
- prohibited redirects and suspicious chains
- a destination that changes after approval
- misleading or impersonating domains
- bypass by encoding or redirect parameters
- prohibited content

**Network safety.**

- No SSRF: never reach internal services, private IPs or metadata endpoints.
- Any server fetch goes through a dedicated, restricted mechanism with
  timeouts, size limits, redirect limits and network restrictions.
- Never download large media through Vercel to inspect it.
- Documented safe-failure: a scanner outage never marks an unverified URL
  safe.

## 9 · Creative content safety

**Checks.**

- format, size, dimensions and duration
- corrupt files, spoofed types and malicious payloads
- unsafe or prohibited content
- deceptive claims, scams and impersonation
- phishing and malicious download links
- policy violations

**Rules.**

- Reuse existing moderation if there is any.
- Validation stays separate from payment: paid is not safe, and safe is not
  paid.
- Uploads go directly to storage. Workers read objects directly. Delivery is
  through storage/CDN URLs.
- Vercel and Railway carry metadata only. No buffering of large media, no
  proxied previews, no needless copies.
- Store validation results. Do not re-process unchanged objects. Revalidate
  on a change or a new safety issue.

## 10 · Safe live editing (Part 6)

1. Check authorization and ownership.
2. Upload directly.
3. Validate the object.
4. Validate the URL if it changed.
5. Run the safety checks.
6. The old creative keeps serving meanwhile.
7. Swap atomically only after success.
8. Keep the campaign ID, payments and start date.
9. Audit the change.
10. Clean up abandoned assets safely.

- On failure, keep the old creative and explain why.
- If the existing creative or link is confirmed dangerous, pause or block.
- Editing never bypasses blocks, payment, duration or policy.

## 11 · Admin fraud and safety center (inside the Part 7 admin)

**It shows.**

- flagged campaigns and suspicious advertisers
- invalid-traffic summaries and click/impression anomaly alerts
- creative failures and unsafe-URL alerts
- suspicious reward events
- payment discrepancies and chargebacks
- provider concerns, where available
- review queues and investigation status
- evidence and reason codes, risk level, timestamps and action history

**Admins can.**

- review and dismiss false positives, with a reason
- exclude invalid events
- request revalidation
- pause or block a campaign and restrict an account
- restore after verification
- add notes and outcomes

Do not expose raw IPs broadly. There is no manual review for every campaign;
escalate only failures and campaigns over the threshold.

## 12 · Advertiser reporting

**Advertisers see.**

- impressions, clicks and CTR
- viewability and completion, where available
- performance over time
- status, payments and spend
- adjustments to qualifying metrics

**Advertisers never see.**

- other advertisers' data
- IPs
- detection rules
- private user data
- risk scores
- credentials

When filtering or an investigation changes the counts, explain it without
revealing the mechanisms. Document the traffic-quality policy, with no
invented deductions and no guarantees.

## 13 · Privacy, retention, access

- Collect only the minimum, using pseudonymous IDs.
- Use RLS and server authorization. Advertisers never get raw event tables.
- Set configurable retention for raw events, evidence and reports, and
  anonymize or delete on schedule.
- Keep payment and audit records as the law requires.
- Secure admin access and logs.
- Protect ingestion against replay and unauthorised writes.
- An anonymous event is not trusted by default.

## 14 · Monitoring and alerts (reuse existing)

**Alerts.**

- a spike in suspicious clicks
- high invalid traffic
- repeated creative load failures
- more rejected URLs
- a provider failure across slots
- a reward completion anomaly
- payment discrepancies
- an empty-inventory surge
- unexpected metric changes

**Rules.**

- Aggregate, threshold and dedupe the alerts.
- Use the existing admin notifications.
- A decision never waits on alert delivery.
- No high-frequency polling or Realtime.

## 15 · Performance and cost

- Index the tables. Partition only at real scale.
- Batch and aggregate, with payload limits and pagination.
- Cache safe summaries.
- No full scans or re-aggregating history.
- No duplicate scans. Cache validation results.
- Queue expensive checks. No large media in synchronous Vercel requests or
  through Railway.
- No request per rotation and no needless permanent services.
- A fraud failure never corrupts payments or credits.
- Justify any new service: its workload and cost.

## 16 · Tests (22 areas)

1. duplicate impressions
2. duplicate clicks and replays
3. invalid campaign and slot IDs
4. repeat clicks and suspicious patterns
5. bot sequences
6. a shared network without a blanket ban
7. reward completion manipulation
8. duplicate reward processing
9. callback/webhook races
10. wrong amount or currency
11. refunds and chargebacks
12. malicious and malformed URLs
13. redirect chains and SSRF
14. unsafe, malformed and oversized creatives
15. a failed replacement keeping the old creative
16. a live URL change being revalidated
17. admin review and audited overrides
18. advertiser isolation
19. retention and deletion
20. load
21. failures not breaking core features
22. direct-to-storage upload and CDN delivery

Never claim a test that did not run.

## 17 · Final report

Report:

- the systems found, reused and extended
- the event definitions, dedupe, metrics, fraud rules and actions
- URL and creative validation
- admin workflows
- payment and reward safeguards
- privacy and retention
- DB changes
- media paths, with evidence that large media bypasses application servers
- the tests actually run
- the limitations

Never claim perfect fraud prevention.

**Architecture.**

- Events: EVENT → VALIDATION → DEDUP → FRAUD/RISK → QUALIFYING ANALYTICS →
  AGGREGATED REPORTING → ADMIN REVIEW WHEN NEEDED.
- Campaigns: PAYMENT VERIFICATION → CREATIVE/URL SAFETY → ELIGIBILITY → LIVE.
