/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The Frenz AI backdrop — drawn, not downloaded
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08: give the AI Clean card "a premium background image like
 * the one above" — a deep cyan-and-magenta circuitry scene — and "every must be
 * light weight".
 *
 * ── 🔴 THOSE TWO ASKS PULL APART, AND LIGHTWEIGHT WINS ───────────────────────
 *
 * The reference is a photographic render. Shipped as one it would be 150-400 kB
 * of JPEG on a card that sits at the top of a page this project holds to a
 * ratcheted byte budget — for decoration, on a mobile connection, in a country
 * where data costs money. It would also need a light-mode variant, a srcset, a
 * licence, and it would still be a picture of an eye that has nothing to do
 * with removing captions from video.
 *
 * So the AESTHETIC is reproduced rather than the file: deep indigo ground,
 * cyan circuit traces, a luminous focal bloom, magenta only as an accent. All
 * of it is one inline SVG and two gradients — under a kilobyte, no network
 * request, no decode, correct in both themes, and scalable to any card size.
 *
 * ── Brand ────────────────────────────────────────────────────────────────────
 *
 * The reference leans hard on magenta. This does not: the standing brand rule
 * is that pink is never dominant, so the magenta appears as two short trace
 * segments and nothing else. The blue-to-purple sweep is the same one the Core
 * and the wordmark use.
 *
 * A server component — no hooks, no state, nothing animated. It is a backdrop,
 * and an idle animation behind a card is exactly the battery cost this project
 * refuses.
 */
export function FrenzAICircuitry({ className }: { className?: string }) {
  return (
    <div aria-hidden className={className}>
      {/* The ground. Deep indigo, not black — black would flatten the traces. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, hsl(229 60% 12%) 0%, hsl(240 55% 16%) 45%, hsl(262 50% 18%) 100%)",
        }}
      />

      {/* The focal bloom, where the light appears to come from. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 78% 18%, hsl(190 95% 55% / 0.42) 0%, transparent 55%), radial-gradient(90% 70% at 12% 88%, hsl(262 90% 62% / 0.38) 0%, transparent 60%)",
        }}
      />

      {/*
        The traces. One SVG, stroked paths only — no filters, no masks, nothing
        that would force an offscreen buffer. `vectorEffect` keeps the hairlines
        hairline at any card width.
      */}
      <svg
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        <g fill="none" strokeWidth="1" vectorEffect="non-scaling-stroke">
          {/* Cyan circuitry — the dominant accent. */}
          <g stroke="hsl(185 95% 60%)" opacity="0.34">
            <path d="M0 44h64l18 18h58" />
            <path d="M0 120h38l22-22h52l16 16h44" />
            <path d="M400 62h-70l-20 20h-46" />
            <path d="M400 148h-52l-18-18h-38" />
            <path d="M150 200v-34l20-20h60" />
            <path d="M262 0v30l-18 18v40" />
          </g>
          {/* Nodes. A circuit reads as one because of its junctions. */}
          <g fill="hsl(185 95% 68%)" stroke="none" opacity="0.55">
            {[
              [140, 62],
              [212, 114],
              [284, 82],
              [330, 130],
              [230, 146],
              [82, 62],
            ].map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.4" />
            ))}
          </g>
          {/* Magenta, twice, as an accent and never as the subject. */}
          <g stroke="hsl(320 90% 62%)" opacity="0.3">
            <path d="M400 30h-96l-14 14" />
            <path d="M0 176h72l16-16" />
          </g>
        </g>
      </svg>

      {/*
        A dark veil at the bottom so whatever sits on top keeps its contrast.
        The card's own text is white over this, and a busy backdrop is only
        premium while the words on it stay effortless to read.
      */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(to top, hsl(229 60% 8% / 0.85) 0%, transparent 62%)" }}
      />
    </div>
  );
}
