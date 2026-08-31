/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE DEAD FIRST TAP — don't make hydration faster, stop LOSING the tap
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "some buttons occasionally feel delayed or require two presses", and
 * later: "the dead first tap happens to all pages, also in signed in pages not
 * only the landing pages."
 *
 * ── The measurement this is built on ────────────────────────────────────────
 *
 * A button is painted and looks pressable long before React attaches its
 * handler. Measured on `/` (production build, slow-4G + 4× CPU, Pixel 7, in-page
 * timestamps): the Download button enters the DOM at ~1.7s and becomes
 * interactive at ~4.9s. Every tap in that ~3s window does nothing, which is
 * exactly why people press twice.
 *
 * ── Why this is not "make hydration faster" ─────────────────────────────────
 *
 * Because that was tried, repeatedly, and measured:
 *
 *  • −243 kB of first-load JavaScript (the Supabase client leaving the landing
 *    entirely — see lib/perf/budget.test.ts) moved the button's interactive
 *    time from 4945ms to 4947ms. No change.
 *  • Suspense boundaries around the below-fold sections did not help either,
 *    and were WORSE than neutral: splitting the tree into separate hydration
 *    units let the shell's effects run before the hero's boundary hydrated, so
 *    `useEntitlements().ready` was false in the server HTML and true on the
 *    client. That is a hydration mismatch, and React's answer to a mismatch is
 *    to throw away the server markup and re-render the subtree on the client —
 *    more main-thread work in the exact window we are trying to shorten. Both
 *    mismatches disappeared when those boundaries were removed.
 *
 * The remaining cost is hydrating a real client tree on a throttled phone. It
 * can be reduced, but it cannot be made zero, so a tap will always be able to
 * land before it finishes. The honest fix is to not throw that tap away.
 *
 * ── 🔴 What the tap ACTUALLY did, measured ──────────────────────────────────
 *
 * "Nothing happens" turned out to be wrong, and the truth is worse. The paste
 * box is a real `<form>` whose only submit handler is React's `onSubmit`, which
 * does not exist until hydration. A press before then is handled by the
 * BROWSER, which does what an un-actioned form says to do: a native GET submit
 * to the current URL.
 *
 * Recorded from the driver, tapping the painted-but-not-hydrated button once:
 *
 *     navigations: [ '…:3123/', '…:3123/?', '…:3123/', … ]
 *                              ^^^^^^^^^^ the native submit
 *
 * So the first tap RELOADS THE PAGE. The pasted link is thrown away, the whole
 * load starts over, and the visitor — who sees a flicker and an empty box —
 * presses again. That is the "requires two presses" report, exactly.
 *
 * ── What this does ──────────────────────────────────────────────────────────
 *
 * Listeners installed from <head> so they exist before any markup is parsed:
 *
 *   • a `submit` on a form with no `action` of its own that NOTHING handled —
 *     read in the BUBBLE phase, after React's own listener, so "nothing handled
 *     it" is `defaultPrevented === false` rather than a guess about hydration
 *     → `preventDefault()` (this is the reload, and it was never intended: a
 *     React form with no action has nowhere to submit TO) and remember the
 *     intent
 *   • a click on a plain `<button>` that is not yet hydrated → remember it
 *   • either, once its element hydrates within 4 seconds → replay it
 *   • anything already hydrated → ignore; React owns it and a replay would
 *     double-fire
 *
 * Text typed before hydration is restored on the way through. A controlled
 * input's React state is `""` until it hydrates, so the first render after
 * hydration would otherwise wipe what was pasted — which is the same lost
 * link by a different route.
 *
 * ── 🔴 Why this does not violate the no-global-navigation-runtime rule ──────
 *
 * There is a standing rule in this codebase (learned the hard way, twice) never
 * to add app-wide runtime that touches navigation: no `history.pushState`
 * patch, no MutationObserver on <html>, no intercepting clicks to route. This
 * deliberately does none of that:
 *
 *   • It never calls `stopPropagation`, so every event still reaches its
 *     normal destination. The one `preventDefault` it makes is on a submit
 *     NOTHING else handled, whose only default action is the unwanted reload.
 *   • It only ever considers `<button>`. Anchors, `<Link>`, and anything else
 *     navigational are ignored outright, so App Router prefetch and the native
 *     page transitions cannot be affected by it.
 *   • It adds no React component to the root layout and no observer. It is one
 *     listener and one `setTimeout`, in the same `<head>` boot-script shape the
 *     theme, locale and a11y scripts already use.
 *
 * ── Guards, and the failure each one prevents ───────────────────────────────
 *
 *  • `defaultPrevented` at event time — what prevents a double action. If a
 *    real handler ran, this stands down entirely; only an unhandled submit is
 *    ever held or replayed. (The older `hydrated()` test was a PREDICTION of
 *    that, and a wrong one — see the note on the submit listener.)
 *  • `form[action]` is left completely alone. A form with a real action is
 *    MEANT to submit natively and must keep working with JavaScript broken;
 *    only an action-less React form is being rescued here.
 *  • 4s expiry — a replay is a courtesy to someone still waiting, not a
 *    licence to fire a stale intent at a page they have moved on from.
 *  • `isConnected` — the button may have been re-rendered away.
 *  • `disabled` re-checked at replay time, not just at click time: a form that
 *    hydrated into a busy state must not be re-submitted.
 *  • `data-no-tap-replay` — an escape hatch for any control where replaying is
 *    genuinely wrong (a destructive confirm, say).
 *  • One replay per page load, then the poll stops. After hydration the page
 *    works normally and there is nothing left for this to do.
 */

/*
 * Written as a string for `dangerouslySetInnerHTML` — the same mechanism as
 * ThemeBootScript. It must run BEFORE hydration, which rules out a React
 * component: by the time one could mount, the window this exists for is over.
 */
const PENDING_TAP_JS = `
(function () {
  try {
    var pending = null;
    var MAX_AGE_MS = 4000;
    var POLL_MS = 40;
    var GIVE_UP_MS = 20000;
    /* How many times a submit replay may be re-attempted while React declines
       to handle it. At POLL_MS that is ~2s of retrying, itself still bounded by
       MAX_AGE_MS from the moment of the tap. See the note in poll(). */
    var MAX_REPLAY_TRIES = 50;
    var timer = null;
    /* True only while poll() is dispatching its own replay event. */
    var replaying = false;

    /* A DOM node React has hydrated carries a __react* key. This is the same
       signal the measurement harness uses, and it is per-ELEMENT, so it is true
       only once THIS button's subtree is really live. */
    function hydrated(el) {
      for (var k in el) { if (k.charCodeAt(0) === 95 && k.indexOf('__react') === 0) return true; }
      return false;
    }

    function replayable(el) {
      return el && el.isConnected && !el.disabled && !el.hasAttribute('data-no-tap-replay');
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      pending = null;
    }

    function arm() {
      if (timer) return;
      timer = setInterval(poll, POLL_MS);
      setTimeout(stop, GIVE_UP_MS);
    }

    /* Text typed before hydration lives only in the DOM. A controlled input's
       React state is "" until it hydrates, so the first render after hydration
       would wipe it. Remember what the visitor actually typed, and put it back
       through the NATIVE value setter + an 'input' event, which is the only way
       React's onChange sees a value it did not set itself. */
    var typed = [];
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (!el || !el.form || hydrated(el)) return;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
      for (var i = 0; i < typed.length; i++) {
        if (typed[i].el === el) { typed[i].v = el.value; return; }
      }
      typed.push({ el: el, v: el.value });
    }, true);

    function restoreTyped(form) {
      for (var i = 0; i < typed.length; i++) {
        var rec = typed[i];
        if (rec.el.form !== form || !rec.el.isConnected) continue;
        if (rec.el.value === rec.v || !rec.v) continue;
        try {
          var proto = rec.el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          var d = Object.getOwnPropertyDescriptor(proto, 'value');
          d.set.call(rec.el, rec.v);
          rec.el.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e2) { /* best effort — the replay below still runs */ }
      }
    }

    function poll() {
      if (!pending) { stop(); return; }
      if (Date.now() - pending.t > MAX_AGE_MS) { stop(); return; }
      var el = pending.el;
      if (!replayable(el)) { stop(); return; }
      if (!hydrated(el)) return;
      var p = pending;
      if (p.kind === 'submit') {
        restoreTyped(el);
        /*
          🔴 A DISPATCHED EVENT, NEVER requestSubmit().

          requestSubmit() asks the BROWSER to submit. React's onSubmit runs and
          cancels it — but only if React is really listening on this form. If it
          is not (the form re-rendered, the handler sits elsewhere, hydration
          half-finished), the browser goes ahead and does the native GET submit,
          which is precisely the page-reload this whole script exists to stop.
          Replaying through requestSubmit therefore risks RE-CREATING the bug at
          the moment it is trying to fix it.

          Dispatching a cancelable submit event has the half we want and not the
          half we don't: it bubbles to React's root listener, so the form's own
          onSubmit runs — and because it is only an event, no native submission
          is ever scheduled.

          🔴 …BUT IT HAS TO BE VERIFIED, NOT ASSUMED (measured 2026-08-31).

          The replay used to fire once and stop, on the premise that a hydrated
          element is one React will dispatch to. Instrumenting a real
          slow-network tap showed that premise is false, and by how much:

            +2656ms  real press   — form not hydrated, native submit HELD  ✅
            +3551ms  replay       — form has __reactFiber AND __reactProps
                                    carrying onSubmit … and defaultPrevented
                                    came back FALSE                       ❌

          handleSubmit in downloader.tsx calls preventDefault as its first
          statement, so defaultPrevented === false is a direct read of "React
          never ran the handler". There is a window where a node already carries
          React's keys but the root cannot yet dispatch to it — and the replay
          landed in it, dropped the tap, and stopped. The reload was gone; the
          download simply never started, which is exactly the half of this fix
          that had never been confirmed.

          So the replay now READS ITS OWN RESULT. Dispatching it cancelable
          makes defaultPrevented an honest receipt: true means a React handler
          ran, false means nothing did. On false the intent stays armed and the
          next poll tries again, bounded by MAX_REPLAY_TRIES and MAX_AGE_MS.

          Retrying is safe here precisely because this is a dispatched event: it
          has no default action, so a retry cannot navigate. And a form whose
          handler does NOT preventDefault is, by this script's own definition,
          one React is not handling — the case it exists to hold back.
        */
        var ev;
        try {
          ev = new Event('submit', { bubbles: true, cancelable: true });
          /* The listener below must ignore THIS event: it is our own replay, and
             re-arming from it would reset the pending timestamp on every attempt
             and keep the intent alive forever. poll() reads the result instead. */
          replaying = true;
          try { el.dispatchEvent(ev); } finally { replaying = false; }
        } catch (e3) { stop(); return; }
        if (ev.defaultPrevented) { stop(); return; }
        p.tries = (p.tries || 0) + 1;
        if (p.tries >= MAX_REPLAY_TRIES) stop();
        return;
      }
      stop();
      /* A plain .click() dispatches a bubbling click that React's delegated
         root listener picks up, so this goes through the component's own
         onClick — no synthetic-event plumbing needed. */
      el.click();
    }

    /*
      THE RELOAD. An action-less React form has nowhere to submit to, so a
      native submit is never what anyone wanted — it just reloads the page and
      throws away what was typed. Held back until React can handle it properly.

      🔴 BUBBLE PHASE, AND GATED ON defaultPrevented — NOT ON hydrated()
      (measured 2026-08-31).

      This ran in the CAPTURE phase and decided whether to intervene by asking
      hydrated(form): "React owns it, it calls preventDefault itself". Both
      halves of that were wrong, and together they let the original bug back
      through on roughly half of all cold taps:

        • Capture runs BEFORE React's listener, so at decision time there was
          nothing to observe — the code had to PREDICT what React would do.
        • hydrated() only asks whether the node carries a __react* key. A node
          acquires those keys BEFORE the root can dispatch events to it. In that
          window the prediction says "React owns it" and React does not run, so
          nothing calls preventDefault and the browser performs the native GET
          submit. The probe caught it landing on "GET /?" — a bare question mark
          because the paste input has no name, which is the unmistakable
          signature of an action-less form submitting natively.

      React attaches its listener to the ROOT CONTAINER, which sits between the
      form and document. So a listener here in the BUBBLE phase runs strictly
      AFTER React's, and defaultPrevented is then a fact rather than a
      forecast: true means a real handler ran, false means none did. Preventing
      here is still in time — the default action is performed only once
      propagation has finished.
    */
    document.addEventListener('submit', function (e) {
      /* Our own replay dispatch — poll() inspects the outcome itself. */
      if (replaying) return;
      /* Someone real handled it — React, or any other listener. Leave it be. */
      if (e.defaultPrevented) return;
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      /* A form with a real action is meant to work without JS. Never touch it. */
      if (form.hasAttribute('action')) return;
      if (form.hasAttribute('data-no-tap-replay')) return;

      e.preventDefault();
      pending = { kind: 'submit', el: form, submitter: e.submitter || null, t: Date.now() };
      arm();
    }, false);

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var btn = t.closest('button');
      /* Buttons only. Anchors and every other navigational element are left
         entirely alone — see the header comment. */
      if (!btn || !replayable(btn)) return;
      /* A submit button's intent is the form's, and the submit listener above
         is what carries it — recording the click too would replay it twice. */
      if (btn.form && (btn.type === 'submit' || !btn.type)) return;

      if (hydrated(btn)) {
        /* React owns this one. Any tap we were holding is now stale intent. */
        stop();
        return;
      }

      pending = { kind: 'click', el: btn, t: Date.now() };
      arm();
    }, true);
  } catch (err) {
    /* A dead first tap is a papercut; breaking every page over it is not. */
  }
})();
`;

/**
 * Records a tap that lands on a not-yet-hydrated button and replays it once
 * React attaches. Rendered in `<head>` (app/layout.tsx) so the listener exists
 * before the first button is parsed.
 */
export function PendingTapScript() {
  return <script dangerouslySetInnerHTML={{ __html: PENDING_TAP_JS }} />;
}
