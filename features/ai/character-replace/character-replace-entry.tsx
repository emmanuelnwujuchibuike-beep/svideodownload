import { ArrowRight, BellRing, Clock3, Palette, PersonStanding } from "lucide-react";
import Link from "next/link";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ENTRY CARD — Character Replace, on the Frenz AI page
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 1, §5):
 *
 *     [Character Replace]
 *     Put yourself into your video
 *     Upload a photo and an existing video. Frenz AI will create a new
 *     version using your likeness while preserving the original performance.
 *     [Start Creating]
 *
 * "The card should communicate that this is a premium feature without
 * looking like an advertisement." So: the product's own mark (the existing
 * `FrenzLogo`, never a substitute), a small NEW indicator in the same chip
 * style the rest of Frenz AI uses, the owner's copy verbatim, and one action.
 * No ratings, no testimonials, no claims.
 *
 * ── 2026-09-14: "more professional and well organised and arranged" ─────────
 *
 * Owner: "upgrade the welcome page and start creating button to be more
 * professional and well organised and arranged… the design shouldn't break
 * the performance or cause any over heating."
 *
 * The card is now laid out in four rows a reader can scan in order — the
 * mark and label; the headline and the owner's sentence; three facts about
 * what the tool does (motion kept, colour natural, priced per second); the
 * action with the one line that matters after pressing it ("we notify you").
 * From `sm` up the facts sit beside a CSS-only photo → video figure, so the
 * card has a picture without a picture.
 *
 * ── 🔴 THE PERFORMANCE RULE ─────────────────────────────────────────────────
 * Still a SERVER component: static markup, one `<Link>`, nothing hydrated.
 * No images, no animation, no blur across the card — the figure is three
 * gradients and a border. The button's "premium" is a gradient hairline and
 * an inner highlight, both static. A hover translate is the only motion and
 * it is `motion-safe`.
 */
export function CharacterReplaceEntry({
  href,
  available = true,
  className,
}: {
  href: string;
  /** False when the operator has switched the tool off. */
  available?: boolean;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="character-replace-entry-title"
      className={cn(
        "relative overflow-hidden rounded-[1.6rem] bg-card/95 p-5 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10 sm:p-6",
        "shadow-[0_16px_40px_-24px_rgba(15,23,42,0.4)]",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 55% at 100% 0%, rgba(99,102,241,0.14) 0%, transparent 65%)," +
            "radial-gradient(50% 45% at 0% 100%, rgba(217,70,239,0.09) 0%, transparent 65%)",
        }}
      />

      {/* row 1 — the mark and the name */}
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#131a4a] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
          <FrenzLogo size={18} alt="" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-tight">Character Replace</p>
          <p className="text-[11px] leading-tight text-muted-foreground">Frenz AI · Wan 2.2</p>
        </div>
        <span className="ml-auto rounded-full border border-primary/25 bg-primary/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
          New
        </span>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-6">
        <div className="min-w-0">
          {/* row 2 — the headline and the owner's sentence, verbatim */}
          <h2 id="character-replace-entry-title" className="text-[1.6rem] font-bold leading-[1.08] tracking-[-0.035em] sm:text-[1.9rem]">
            Put yourself into <span className="text-gradient">your video</span>
          </h2>
          <p className="mt-2.5 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            Upload a photo and an existing video. Frenz AI will create a new version using your likeness while
            preserving the original performance.
          </p>

          {/* row 3 — what it does, as three facts */}
          <ul className="mt-4 grid grid-cols-3 gap-2" aria-label="What Character Replace does">
            <Fact icon={PersonStanding} title="Motion kept" detail="Every move, expression and camera pass stays." />
            <Fact icon={Palette} title="Colour natural" detail="Matched to your original, never oversaturated." />
            <Fact icon={Clock3} title="Per second" detail="You pay for the seconds you keep, refunded if we fail." />
          </ul>
        </div>

        {/* the figure — photo → video, in CSS alone; decorative, hidden on phones where the copy is the card */}
        <Figure />
      </div>

      {/* row 4 — the action */}
      {available ? (
        <div className="mt-6">
          <span className="block rounded-[1.2rem] bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 p-[1.5px] shadow-[0_14px_30px_-16px_rgba(79,70,229,0.55)] sm:inline-block">
            <Link
              href={href}
              prefetch={false}
              className={cn(
                "group flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-[calc(1.2rem-1.5px)] bg-foreground px-7",
                "text-[16px] font-semibold tracking-[-0.01em] text-background sm:min-w-[15rem]",
                "shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] transition duration-200",
                "motion-safe:hover:-translate-y-0.5 active:scale-[0.985]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              Start Creating
              <ArrowRight className="h-[18px] w-[18px] transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </span>
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <BellRing className="h-3.5 w-3.5 text-primary/70" aria-hidden />
            Takes a few minutes. You can leave — we notify you when it&apos;s ready.
          </p>
        </div>
      ) : (
        <p className="mt-5 text-[13px] font-semibold text-muted-foreground">Not available right now. Check back soon.</p>
      )}
    </section>
  );
}

function Fact({ icon: Icon, title, detail }: { icon: typeof Clock3; title: string; detail: string }) {
  return (
    <li className="rounded-2xl bg-secondary/55 px-2.5 py-2.5 ring-1 ring-inset ring-black/[0.03] dark:ring-white/[0.06]">
      <Icon className="h-4 w-4 text-primary" aria-hidden />
      <p className="mt-1.5 text-[12px] font-bold leading-tight tracking-[-0.01em]">{title}</p>
      <p className="mt-0.5 hidden text-[11px] leading-snug text-muted-foreground sm:block">{detail}</p>
    </li>
  );
}

/** Photo → video, drawn with gradients. `aria-hidden`: it says nothing the copy does not. */
function Figure() {
  return (
    <div aria-hidden className="hidden sm:flex sm:w-[11.5rem] sm:items-center sm:gap-2 sm:self-center">
      <span
        className="h-[5.25rem] w-[4.25rem] shrink-0 rounded-[0.9rem] ring-1 ring-inset ring-black/[0.06] dark:ring-white/10"
        style={{ background: "radial-gradient(60% 45% at 50% 32%, rgba(251,191,36,0.55) 0%, rgba(251,191,36,0.12) 60%, transparent 75%), linear-gradient(160deg, #e0e7ff 0%, #c7d2fe 100%)" }}
      />
      <span className="flex shrink-0 flex-col items-center gap-1 text-muted-foreground/70">
        <ArrowRight className="h-4 w-4" />
      </span>
      <span
        className="relative h-[6.5rem] flex-1 overflow-hidden rounded-[0.9rem] ring-1 ring-inset ring-black/[0.06] dark:ring-white/10"
        style={{ background: "linear-gradient(160deg, #0b0f1a 0%, #1e1b4b 55%, #4c1d95 100%)" }}
      >
        <span
          className="absolute left-1/2 top-[22%] h-9 w-7 -translate-x-1/2 rounded-full"
          style={{ background: "radial-gradient(50% 45% at 50% 35%, rgba(251,191,36,0.85) 0%, rgba(251,191,36,0.25) 70%, transparent 100%)" }}
        />
        <span className="absolute bottom-1.5 left-1.5 rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white/85">
          Result
        </span>
      </span>
    </div>
  );
}
