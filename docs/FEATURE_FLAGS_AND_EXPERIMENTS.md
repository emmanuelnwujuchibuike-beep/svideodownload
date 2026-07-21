# Feature flags & experiments — developer guide

How to gate a feature behind a flag, and how to run an A/B test. Both are declared
in code and controlled at runtime from `/admin`. See `docs/CONSTITUTION.md` for why
they exist; this is how to use them.

Two rules up front:

- **Declare in code, control in the DB.** A flag/experiment's identity, default and
  targeting live in a `.ts` registry (typed, reviewed in a PR). Only its runtime
  *state* (kill switch, rollout %, pause) is admin-editable.
- **Default OFF.** A new flag ships behavior-preserving; you ramp it afterwards. A
  new experiment ships `draft` (enrols nobody) until you set it `running`.

---

## Feature flags

### 1. Declare the flag

Add one entry to `FLAGS` in [lib/platform/flags.ts](../lib/platform/flags.ts):

```ts
{
  id: "new-share-sheet",          // stable, kebab-case, never reuse/rename
  label: "New share sheet",
  description: "The redesigned share sheet. OFF ⇒ the current one.",
  category: "product",            // product | experiment | ops | kill-switch
  defaultEnabled: false,
  // Optional:
  // rollout: 25,                 // baseline % (admin can override)
  // plans: ["pro", "business"],  // entitlement gate (hard AND)
  // adminBypass: true,           // admins always see it (to preview)
  // clientReadable: true,        // REQUIRED to read it on the client (see below)
  consumer: "features/share/share-button.tsx",  // where it's read; "pending" until wired
}
```

### 2a. Read it on the server (dynamic pages / route handlers)

```ts
import { isEnabled } from "@/lib/platform/flags-store";

// Build the caller's context (plan / admin / userId). On a page that already has
// the session, reuse what you have; otherwise resolve it like app/api/flags/route.ts.
const on = await isEnabled("new-share-sheet", { plan, isAdmin, userId });
```

`isEnabled` is server-only. On a **static** page or a **client** component you can't
call it — use the client hook instead.

### 2b. Read it on the client (static pages, client islands)

Mark the flag `clientReadable: true`, then:

```tsx
"use client";
import { useFlag } from "@/lib/platform/use-flag";

function ShareButton() {
  const newSheet = useFlag("new-share-sheet"); // false until resolved, then real
  return newSheet ? <NewShareSheet /> : <ShareSheet />;
}
```

`useFlag` fetches `GET /api/flags` **lazily and once per session**, shared across every
consumer — a page with no `useFlag` makes no request, so flags never tax the hot path
of pages that don't use them. Only `clientReadable` flags are ever sent, and only their
resolved boolean (never the rollout %, override, or another user's assignment).

### 3. Ramp / kill from `/admin`

`/admin` → **Feature flags**. Per flag: **On** (force), **Off** (kill switch, wins over
any rollout), or **Auto** (follow the rollout %). Changes propagate within ~10s.

### Resolution order (first decisive rule wins)

1. **Plan gate** — `plans` excludes the caller ⇒ OFF (not overridable).
2. **Admin preview** — `adminBypass` + admin ⇒ ON.
3. **Manual override** — On/Off from admin (kill switch).
4. **Rollout %** — deterministic per user (`bucketOf`); an **anonymous** visitor can't
   be bucketed, so a partial rollout is OFF for them. Use 100% or a plan gate for anon.

---

## Experiments (A/B)

An experiment differs from a flag: instead of "on/off" it assigns one of N variants and
**measures** them — every enrolled exposure is logged so you can compare arms.

### 1. Declare the experiment

Add to `EXPERIMENTS` in [lib/platform/experiments.ts](../lib/platform/experiments.ts):

```ts
{
  id: "cta-copy",
  label: "CTA copy",
  description: "Does 'Get it free' beat 'Download now'?",
  status: "draft",                // draft/concluded ⇒ everyone gets control, nothing logged
  variants: [
    { id: "control", weight: 50 },   // FIRST variant is the control by convention
    { id: "treatment", weight: 50 }, // weights are relative; need not sum to 100
  ],
  // plans: ["free"],              // optional eligibility gate
}
```

### 2. Assign + log exposure (server)

```ts
import { assignAndExpose } from "@/lib/platform/experiments-store";

// Returns the variant to render AND logs an exposure iff the visitor is enrolled.
const variant = await assignAndExpose("cta-copy", { plan, isAdmin, userId });
return variant === "treatment" ? "Get it free" : "Download now";
```

Assignment is deterministic per user and stable across requests. If you need to decide
whether to log yourself, use `getAssignment()` (returns `{ variant, enrolled }`) and call
`trackExposure()` only when `enrolled`.

### 3. Launch, watch, decide (`/admin`)

- Set `status: "running"` in code to start enrolling.
- `/admin` → **Experiments** shows the **live exposure split** per variant.
- **Pause** (everyone → control) is a safety lever; **Force variant** ships the winner —
  both without a redeploy.
- When done, set `status: "concluded"` (freezes it) and, if it won, promote the change
  out of the experiment into plain code.

### Reading results

Exposures are logged to the shared `events` table as `type = 'experiment_exposure'`,
`metadata { experiment, variant }` — the same pipeline as every other event. Join your
conversion event against it by `user_id` to compare arms. The admin panel's split comes
from the `experiment_exposure_counts()` aggregate.

---

## Gotchas

- **Anonymous visitors** can't be bucketed: partial rollouts and running experiments both
  fall back to OFF / control for them. This is deliberate (deterministic assignment needs a
  stable id). Gate anon-facing changes with a 100% flag or a plan gate, not a partial ramp.
- **The static root layout can't read a runtime flag** without un-static-ing every route —
  use a client component + `useFlag` instead (that's the whole reason the client path exists).
- **A migration must be applied** for admin overrides to persist (`0091` flags, `0092`
  experiments). Until then everything runs at its declared default — safe, just not editable.
```
