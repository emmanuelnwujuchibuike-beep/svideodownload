import { FrenzMark } from "@/components/brand/frenz-logo";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import type { PlatformId } from "@/types";
import { cn } from "@/lib/utils";

/**
 * The login hero — a composed brand constellation, not a stock photo.
 *
 * ── Why this replaced the AI portrait ─────────────────────────────────────────
 *
 * The previous hero was a single casual AI render that read as unprofessional
 * and collided with the headline. This is a designed composition instead: the
 * Frenz mark at the centre of a soft aura, ringed by the real platform logos the
 * product actually pulls from. It states the thesis — every platform, one place
 * — in the brand's own materials rather than a piece of stock art, and it owns a
 * bounded box so the title below it is never overlapped.
 *
 * ── A server component ────────────────────────────────────────────────────────
 *
 * No state, no effects — the motion is pure CSS: a gentle per-tile bob
 * (`login-float`, staggered so the ring breathes rather than pulses in unison)
 * and a slow aura pulse behind the mark. Deliberately NOT a spinning ring — that
 * reads as a gimmick and would tumble the logos; a still constellation that
 * only breathes is the more premium read. All gated by `motion-safe`.
 */

/** Recognisable, well-spread brands — the product's flagship sources. */
const RING: PlatformId[] = ["tiktok", "instagram", "youtube", "snapchat", "facebook", "twitter"];

/** Even placement around the circle, top-first. Radius is a % of the box. */
function ringPosition(index: number, count: number): { left: string; top: string } {
  const angle = (index / count) * 2 * Math.PI - Math.PI / 2; // start at 12 o'clock
  const r = 42;
  return {
    left: `${50 + r * Math.cos(angle)}%`,
    top: `${50 + r * Math.sin(angle)}%`,
  };
}

export function LoginCollage() {
  return (
    <div
      aria-hidden
      className="relative mx-auto aspect-square w-full max-w-[300px] max-h-[38vh]"
    >
      {/* Ambient aura — soft brand glow that anchors the composition. */}
      <div className="pointer-events-none absolute inset-[8%] rounded-full bg-gradient-to-br from-blue-500/25 via-violet-500/20 to-fuchsia-500/25 blur-3xl motion-safe:animate-login-pulse" />

      {/* Faint orbit guide, so the ring reads as intentional structure. */}
      <div className="pointer-events-none absolute inset-[12%] rounded-full border border-foreground/[0.07]" />

      {/* A still ring of platform tiles; each bobs gently on its own phase. */}
      <div className="absolute inset-0">
        {RING.map((id, i) => {
          const Icon = BRAND_ICONS[id];
          const platform = PLATFORMS[id];
          const pos = ringPosition(i, RING.length);
          return (
            <div
              key={id}
              className="absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 sm:h-[52px] sm:w-[52px]"
              style={pos}
            >
              <div
                className={cn(
                  "flex h-full w-full items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg ring-1 ring-inset ring-white/15 motion-safe:animate-login-float",
                  platform.accent,
                )}
                style={{ animationDelay: `${i * -0.9}s` }}
              >
                {Icon ? <Icon className="h-5 w-5 sm:h-6 sm:w-6" /> : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* The mark, centred and still. */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="rounded-[26px] bg-background/60 p-3 shadow-xl ring-1 ring-inset ring-border/60 backdrop-blur-sm">
          <FrenzMark size={56} priority />
        </div>
      </div>
    </div>
  );
}
