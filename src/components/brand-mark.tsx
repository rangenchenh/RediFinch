import { cn } from '@/lib/utils';

/**
 * The RediFinch mark: five rounded bars, tallest in the centre.
 *
 * The geometry is transcribed from `scripts/generate-icon.mjs` rather than
 * re-drawn, so the in-app mark and the installed icon are the same artwork. If
 * one changes the other has to, which is the point — an icon and a logo that
 * drift apart read as a bug.
 *
 * Rendered as SVG rather than as a row of <span>s because the bars need to
 * scale together inside a fixed-size container without the gaps rounding
 * differently than the bars.
 */

/** Bar half-heights as a fraction of the icon box, centre-out. */
const WEIGHTS = [0.3, 0.52, 0.74, 0.52, 0.3];

/** Matches the generator: 7.5% bar width, 4.2% gap, in a 32-unit box. */
const BOX = 32;
const BAR_W = 0.075 * BOX;
const GAP = 0.042 * BOX;
const GROUP_W = WEIGHTS.length * BAR_W + (WEIGHTS.length - 1) * GAP;
const START_X = (BOX - GROUP_W) / 2;

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${BOX} ${BOX}`}
      className={cn('size-4', className)}
      role="img"
      aria-label="RediFinch"
      fill="currentColor"
    >
      {WEIGHTS.map((weight, i) => {
        const h = weight * BOX;
        return (
          <rect
            key={i}
            x={START_X + i * (BAR_W + GAP)}
            y={BOX / 2 - h / 2}
            width={BAR_W}
            height={h}
            // Square ends at the bar's own half-width would collapse to a
            // stadium; a slightly tighter radius keeps the bars reading as
            // individual strokes at 16 px.
            rx={BAR_W / 2}
          />
        );
      })}
    </svg>
  );
}
