"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MEDIA ACTION SHEET — the ••• overflow, rebuilt as a native action sheet
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner brief (2026-08-11), with a reference screenshot: "upgrade the media
 * dotted menu list to the screenshot above, follow every pattern and make it
 * more flutter native app, with native app smoothness and performance."
 *
 * ── What the reference actually specifies ──────────────────────────────────
 *
 * Read top to bottom it is five grouped cards, a Cancel card, and three row
 * shapes — and the row shapes are the part that matters, because the old sheet
 * only had one:
 *
 *   1. a DISCLOSURE row  — icon, label, chevron. The chevron is on every row,
 *      including destructive ones, so it reads as "this leads somewhere".
 *   2. a SWITCH row      — "Following creator" with a live purple toggle. The
 *      old sheet said "Following creator" with a tick, which states a fact but
 *      does not look like something you can turn off.
 *   3. an INLINE PICKER  — "Playback speed: 1×" with 0.5×/1×/1.5×/2× beside it.
 *      The old row CYCLED on tap, so reaching 2× from 1× was three taps and a
 *      toast each time, and the sheet closed under you on the first one.
 *
 * ── Why this is its own file ───────────────────────────────────────────────
 *
 * `reel-viewer.tsx` is ~2,900 lines and the sheet was 90 of them inlined in the
 * middle of the render. The three row shapes, the drag-to-dismiss gesture and
 * the focus/escape handling are all reusable — the image viewer and post viewer
 * have their own near-identical overflow menus, and the next one should import
 * this rather than grow a fourth copy.
 *
 * ── "Native smoothness" is mostly a list of things NOT to do ───────────────
 *
 * 🔴 NO `backdrop-blur` on the scrim. This sheet opens over a PLAYING VIDEO, and
 *    a backdrop filter re-samples what is behind it every frame the backdrop
 *    changes — so a blurred scrim over video is a full-screen GPU pass at the
 *    video's frame rate, for as long as the sheet is open. The reference shows
 *    a plain dark ground anyway. See the download-heat incident (2026-08-10).
 *
 * 🔴 Row press states are CSS, not React state. `active:duration-0` with a
 *    240ms base gives the iOS feel exactly — instant on press-down, a soft fade
 *    on release — with zero re-renders. A `pressed` state per row would
 *    re-render the whole sheet twice per tap.
 *
 * 🔴 Only transform and opacity animate. The panel drags on a `y` motion value
 *    and the scrim reads that same value, so a drag is one composited frame,
 *    not a React update.
 *
 * ── The drag gesture, and the one rule that makes it feel right ────────────
 *
 * Dragging down dismisses; dragging up is locked (elastic 0 at the top), so the
 * sheet never floats off its own edge. Release dismisses on DISTANCE or on
 * VELOCITY — a fast flick that only travelled 40px is still a dismiss, which is
 * the difference between a sheet that feels physical and one that feels like it
 * is measuring you.
 *
 * Drag is disabled while the content is scrolled away from the top, which is
 * what stops the gesture fighting the scroller. That is also precisely how iOS
 * behaves: you scroll back to the top, and then the sheet starts to move.
 */

import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { Children, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

/** How far down a release must be to dismiss, in px. */
const DISMISS_DISTANCE = 130;
/** …or how fast, in px/s, for a flick that never got that far. */
const DISMISS_VELOCITY = 650;

/*
  The icon column width, and therefore the divider inset.

  A native grouped list hangs its separators off the TEXT, not off the card
  edge — the icon column stays clear. That is 16px of padding + a 22px glyph +
  14px of gap. Written once here because the row and the separator have to agree
  to the pixel; when they disagree it does not look like a bug, it looks cheap.
*/
const TEXT_INSET = "52px";

/**
 * Shared row chrome: the press feedback, the height, the layout.
 *
 * 🔴 `duration-200`, not `duration-[240ms]`. This project's Tailwind build has
 * `tailwindcss-animate` installed, whose `duration` utility SHADOWS the core one
 * and only accepts values from the scale — so `duration-[240ms]` compiles to
 * absolutely nothing, silently, and the row would fade back at whatever the
 * browser default is. Verified by grepping the built CSS for
 * `transition-duration`, which lists the scale and no arbitrary values. See the
 * silent-CSS-class-traps note in project memory.
 *
 * The pairing is what produces the iOS feel: 200ms is the fade OUT, and
 * `active:duration-0` makes the press itself land instantly. A single duration
 * for both directions reads as laggy on the way in.
 */
const ROW_BASE =
  "relative flex w-full items-center gap-3.5 px-4 text-left transition-colors duration-200 active:duration-0 min-h-[52px]";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Group                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * One card of rows.
 *
 * Separators are real elements inserted between children rather than a
 * `before:` pseudo-variant, because a `before:` utility silently emits nothing
 * if `content-['']` is missed — and a missing hairline is exactly the kind of
 * defect that survives review (see the silent-CSS-class-traps note in project
 * memory). `Children.toArray` drops the `null`s that conditional rows produce,
 * so a hidden row never leaves a separator behind it.
 */
export function SheetGroup({ children }: { children: React.ReactNode }) {
  const rows = Children.toArray(children);
  if (rows.length === 0) return null;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[22px] bg-card",
        // An inset ring reads as the card catching light; a border draws a hard
        // 1px edge. Same recipe as the native-canvas cards elsewhere.
        "shadow-[0_8px_24px_-8px_rgba(15,23,42,0.16)] ring-1 ring-inset ring-slate-900/[0.06]",
        "dark:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] dark:ring-white/10",
      )}
    >
      {rows.map((row, i) => (
        <div key={i}>
          {i > 0 ? (
            <div
              aria-hidden
              className="h-px bg-slate-900/[0.07] dark:bg-white/[0.08]"
              style={{ marginLeft: TEXT_INSET }}
            />
          ) : null}
          {row}
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Rows                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

type IconType = React.ComponentType<{ className?: string; strokeWidth?: number }>;

function RowIcon({ icon: Icon, danger }: { icon: IconType; danger?: boolean }) {
  return (
    <Icon
      className={cn("h-[22px] w-[22px] shrink-0", danger ? "text-red-500" : "text-foreground")}
      strokeWidth={1.75}
    />
  );
}

/**
 * A disclosure row — the default shape. Icon, label, chevron.
 *
 * `value` renders the current setting inline before the chevron (video quality
 * uses it), which is the standard native way to show a setting's state without
 * spending a whole second line on it.
 */
export function SheetRow({
  icon,
  label,
  value,
  onClick,
  danger,
}: {
  icon: IconType;
  label: string;
  value?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        haptic("light");
        onClick();
      }}
      className={cn(
        ROW_BASE,
        danger ? "text-red-500 active:bg-red-500/[0.08]" : "text-foreground active:bg-slate-900/[0.055] dark:active:bg-white/[0.07]",
      )}
    >
      <RowIcon icon={icon} danger={danger} />
      <span className="min-w-0 flex-1 truncate text-[16px] font-medium tracking-[-0.01em]">{label}</span>
      {value ? <span className="shrink-0 text-[15px] text-muted-foreground">{value}</span> : null}
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-slate-400 dark:text-white/30" strokeWidth={2} />
    </button>
  );
}

/**
 * A switch row.
 *
 * The whole row is the hit target, not just the 51px switch — a 31pt control at
 * the far right edge of a phone is reachable but not comfortable, and native
 * settings rows have always let you tap the label.
 *
 * The knob is a spring, not a tween, because a switch is the one control where
 * the motion IS the feedback: it has to arrive with a little weight or the
 * change does not feel like it happened.
 */
export function SheetToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: IconType;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => {
        haptic("selection");
        onChange(!checked);
      }}
      className={cn(ROW_BASE, "text-foreground active:bg-slate-900/[0.055] dark:active:bg-white/[0.07]")}
    >
      <RowIcon icon={icon} />
      <span className="min-w-0 flex-1 truncate text-[16px] font-medium tracking-[-0.01em]">{label}</span>
      <span
        aria-hidden
        className={cn(
          "relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-[hsl(var(--brand-purple))]" : "bg-slate-200 dark:bg-white/15",
        )}
      >
        <motion.span
          className="absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_5px_rgba(15,23,42,0.28)]"
          animate={{ x: checked ? 20 : 0 }}
          transition={reduce ? { duration: 0 } : springs.press}
        />
      </span>
    </button>
  );
}

/**
 * A row whose value is picked inline from a short fixed set.
 *
 * The selection thumb is a `layoutId` element, so it TRAVELS between segments
 * instead of the highlight teleporting. That is the whole reason this reads as
 * a native segmented control and not as four buttons.
 *
 * `selected` may legitimately be null: the speed ladder has six rungs and the
 * reference shows four, so a viewer sitting on 0.75× gets no lit segment while
 * the row's own label still states the true rate. Showing a wrong segment as
 * selected would be worse than showing none.
 */
export function SheetSegmentedRow<T extends string | number>({
  icon,
  label,
  options,
  selected,
  onSelect,
  onLabelClick,
  formatOption,
}: {
  icon: IconType;
  label: string;
  options: readonly T[];
  selected: T | null;
  onSelect: (value: T) => void;
  /** Tapping the label itself (the reference keeps the row tappable). */
  onLabelClick?: () => void;
  formatOption: (value: T) => string;
}) {
  const reduce = useReducedMotion();
  const thumbId = useId();
  return (
    <div className={cn(ROW_BASE, "gap-2 pr-[7px] text-foreground")}>
      <RowIcon icon={icon} />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          if (!onLabelClick) return;
          haptic("light");
          onLabelClick();
        }}
        disabled={!onLabelClick}
        /*
          Clamped, not stepped at a breakpoint.

          This row carries the only control in the sheet that competes with its
          own label for width, and measurement at 320px is unambiguous: 16px
          leaves 82px for a 145px label. A `sm:` step would fix 320 and leave
          every width between the breakpoints wrong — see the "Start Free
          Download" clamp in project memory for the same problem. 4.1vw lands on
          13px at 320 and hits the 16px ceiling by 391, so the reference's own
          proportions are what a normal phone renders.
        */
        className="min-w-0 flex-1 truncate py-3 text-left text-[clamp(13px,4.1vw,16px)] font-medium tracking-[-0.01em] disabled:cursor-default"
      >
        {label}
      </button>
      {/*
        Tight on purpose. Measured at 393px: with `px-2.5` segments and a gap
        between them this control was 184px wide, which pushed "Playback speed:
        1×" into an ellipsis — and a row whose label is truncated to "Playback
        spe…" is not the row in the reference. `gap-0` and `px-2` bring it to
        the reference's proportions and leave the label whole down to 360px.
      */}
      <div
        role="group"
        aria-label={label}
        className="flex shrink-0 items-center rounded-[14px] bg-slate-100 p-[3px] dark:bg-white/10"
      >
        {options.map((opt) => {
          const active = opt === selected;
          return (
            <button
              key={String(opt)}
              type="button"
              aria-pressed={active}
              onClick={() => {
                haptic("selection");
                onSelect(opt);
              }}
              /*
                The segments give up the last few pixels before the label does.
                At 320px the label was still 6px short with the control at its
                old floor; a rung reading 10.6px instead of 11.5px on the
                narrowest phone in support is invisible, and an ellipsis in the
                middle of "Playback speed" is not. The tap target is set by the
                row height and `py-1.5`, not by the font, so nothing gets harder
                to hit.
              */
              className="relative rounded-[11px] px-1.5 py-1.5 text-[clamp(10.6px,3.4vw,13px)] font-semibold tabular-nums"
            >
              {active ? (
                <motion.span
                  layoutId={thumbId}
                  transition={reduce ? { duration: 0 } : springs.sheet}
                  className="absolute inset-0 rounded-[11px] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.18)] dark:bg-white/20"
                />
              ) : null}
              <span className={cn("relative", active ? "text-foreground" : "text-muted-foreground")}>
                {formatOption(opt)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  The sheet shell                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export function MediaActionSheet({
  open,
  onClose,
  label = "More options",
  children,
}: {
  open: boolean;
  onClose: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /*
    Drag offset, shared by the panel (as a transform) and the scrim (as an
    opacity). Both read the same motion value, so a drag never touches React.
  */
  const y = useMotionValue(0);
  const scrimFade = useTransform(y, [0, 320], [1, 0.15]);

  /*
    Once a dismiss is committed the panel must STOP being draggable, or framer's
    constraint spring pulls it back up to 0 at the same moment the exit
    animation is carrying it down — two animations, opposite directions, on one
    element. Freezing drag leaves the motion value where the finger left it and
    the exit continues from there.
  */
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => {
    setClosing(true);
    onClose();
  }, [onClose]);

  // A fresh open must start from rest, whatever the last drag left behind.
  useEffect(() => {
    if (open) {
      setClosing(false);
      y.set(0);
    }
  }, [open, y]);

  /*
    Drag is live only while the content is at its scroll top — see the header
    note. One ref guards the state so a scroll does not re-render per frame; the
    component only updates on the boundary crossing itself.
  */
  const [atTop, setAtTop] = useState(true);
  const atTopRef = useRef(true);
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const next = e.currentTarget.scrollTop <= 0;
    if (next === atTopRef.current) return;
    atTopRef.current = next;
    setAtTop(next);
  }, []);

  // Escape closes, and the body must not scroll underneath. Same body-scroll
  // convention (`overflowY`, never the shorthand) every viewer in this app uses.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflowY = prev;
    };
  }, [open, requestClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={label}>
          {/* Scrim. Two nested layers on purpose: the outer one owns the
              mount/unmount fade, the inner one owns the drag-linked dimming, so
              neither animation has to know about the other. NO backdrop blur —
              see the header note. */}
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: "linear" }}
          >
            <motion.button
              type="button"
              aria-label="Close menu"
              onClick={requestClose}
              style={{ opacity: reduce ? 1 : scrimFade }}
              className="h-full w-full bg-black/70"
            />
          </motion.div>

          {/* Entrance/exit layer — percentage transform, no drag. */}
          <motion.div
            className="relative w-full max-w-md"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={reduce ? { duration: 0 } : springs.sheet}
          >
            {/* Drag layer — pixel transform, composited. */}
            <motion.div
              drag={closing || reduce ? false : "y"}
              dragConstraints={{ top: 0, bottom: 0 }}
              // Up is locked so the sheet never lifts off its own edge; down is
              // near 1:1 so it tracks the finger instead of lagging behind it.
              dragElastic={{ top: 0, bottom: 0.9 }}
              dragMomentum={false}
              style={{ y, touchAction: atTop ? "none" : "pan-y" }}
              onDragEnd={(_, info) => {
                if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) {
                  haptic("light");
                  requestClose();
                }
              }}
              className={cn(
                "rounded-t-[28px] pb-[max(env(safe-area-inset-bottom),10px)]",
                // Opaque, not translucent-plus-blur: the ground behind this is a
                // playing video, and the sheet is the one surface that must never
                // cost a frame.
                "bg-[hsl(var(--frenz-canvas))]",
                "shadow-[0_-8px_40px_-12px_rgba(0,0,0,0.45)]",
              )}
            >
              {/* Grabber. Purely an affordance — it states that the sheet is
                  draggable before anyone has tried. */}
              <div className="flex justify-center pb-1.5 pt-2.5">
                <div className="h-[5px] w-10 rounded-full bg-slate-300 dark:bg-white/25" />
              </div>

              <div
                onScroll={onScroll}
                role="menu"
                aria-label={label}
                className="max-h-[78vh] space-y-3 overflow-y-auto overscroll-contain px-4 pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {children}
              </div>

              <div className="px-4 pt-2">
                <button
                  type="button"
                  onClick={requestClose}
                  className={cn(
                    "w-full rounded-[22px] bg-card py-4 text-[17px] font-semibold text-foreground",
                    "shadow-[0_8px_24px_-8px_rgba(15,23,42,0.16)] ring-1 ring-inset ring-slate-900/[0.06]",
                    "transition-colors duration-200 active:bg-slate-900/[0.055] active:duration-0",
                    "dark:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] dark:ring-white/10 dark:active:bg-white/[0.07]",
                  )}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
