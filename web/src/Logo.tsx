/**
 * VGPT.IL brand mark. The stroke is a price line that dips into a "V" — at once
 * the brand initial and a price *valley* (the deal you're tracking) — inside an
 * amber "exchange board" tile, with a blue dot marking the tracked low price.
 * Distinctive and domain-driven (not a generic glyph), and legible at 16px.
 */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="VGPT.IL"
    >
      <rect x="2" y="2" width="36" height="36" rx="9" fill="#141a22" stroke="#ffc14d" strokeWidth="2.6" />
      {/* price line dipping into the V (a deal), with a small tick back up on each side */}
      <path
        d="M8 13.5 L11.5 11 L20 28 L28.5 11 L32 13.5"
        fill="none"
        stroke="#ffc14d"
        strokeWidth="3.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* tracked-low marker at the bottom of the valley */}
      <circle cx="20" cy="28" r="3.3" fill="#4db8ff" stroke="#141a22" strokeWidth="1.6" />
    </svg>
  );
}
