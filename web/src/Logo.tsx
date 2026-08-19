/**
 * VGPT.IL brand mark — a game cartridge that is also a price tag, carrying a
 * shekel with a marker line struck under it.
 *
 * Three ideas in one square: the contact pins along the bottom say *game* (no
 * other retail object has them), the cut corner and punched hole say *price
 * tag*, and ₪ underlined says *this price, in this currency, marked down*.
 * That last pun is the product's whole job.
 *
 * The outline follows `currentColor` so the mark sits correctly on any surface;
 * only the marker line is fixed to the brand amber. Reduced detail below ~28px:
 * the pins merge into the body at small sizes, so they're dropped and the
 * shekel carries the mark alone (`compact`).
 *
 * NOTE: the ₪ is live text in a system font, so its exact shape follows the
 * viewer's fonts. For anything distributed as an asset (app store icon, print)
 * it should be converted to outlines first.
 */
export function Logo({ size = 34, compact = false }: { size?: number; compact?: boolean }) {
  const small = compact || size < 28;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="VGPT.IL"
    >
      {/* cartridge body: rounded rect with the top-left corner cut, like a tag */}
      <path
        d="M22 4 H51 a5 5 0 0 1 5 5 V53 a5 5 0 0 1-5 5 H13 a5 5 0 0 1-5-5 V17 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={small ? 4.6 : 3.6}
        strokeLinejoin="round"
      />
      {!small && <circle cx="16.5" cy="12.5" r="2.8" fill="currentColor" />}
      <text
        x="32"
        y={small ? 40 : 39}
        textAnchor="middle"
        fontSize={small ? 31 : 29}
        fontWeight="700"
        fill="currentColor"
        fontFamily="ui-monospace, 'Segoe UI', Consolas, monospace"
      >
        ₪
      </text>
      {/* the marker line — the only fixed-colour element */}
      <rect
        x={small ? 18 : 19}
        y={small ? 43 : 42}
        width={small ? 28 : 26}
        height={small ? 5 : 4.2}
        rx={small ? 2.5 : 2.1}
        fill="#ffc14d"
      />
      {!small && (
        <>
          <rect x="20" y="50" width="6" height="4.5" rx="1.2" fill="currentColor" opacity="0.5" />
          <rect x="29" y="50" width="6" height="4.5" rx="1.2" fill="currentColor" opacity="0.5" />
          <rect x="38" y="50" width="6" height="4.5" rx="1.2" fill="currentColor" opacity="0.5" />
        </>
      )}
    </svg>
  );
}
