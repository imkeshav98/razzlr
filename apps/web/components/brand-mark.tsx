/**
 * Dazbee's mark: an ink Z on a yellow tile with a sparkle bee on its top-right corner. Below 32 px
 * it draws the favicon's simpler form, the tile and Z with one pink sparkle. Decorative; the name
 * sits beside it or in a label.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 100 100" width={size} height={size} className="shrink-0">
      {size < 32 ? (
        <>
          <rect x="4" y="12" width="80" height="80" rx="22" fill="#FFD23F" />
          <path d="M25,36 H63 L31,72 H65" fill="none" stroke="#15121A" strokeWidth="13" strokeLinejoin="round" strokeLinecap="round" />
          <path d="M82,0 Q82,16 98,16 Q82,16 82,32 Q82,16 66,16 Q82,16 82,0Z" fill="#FF48B0" />
        </>
      ) : (
        <>
          <defs>
            <mask id="dazbee-bee-gap" maskUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120">
              <rect x="-10" y="-10" width="120" height="120" fill="#fff" />
              <g transform="translate(78 25) scale(.72)" fill="#000" stroke="#000" strokeWidth="11" strokeLinejoin="round">
                <path d={WING_PINK} />
                <path d={WING_BLUE} />
                <rect x="-20" y="-12" width="40" height="24" rx="12" transform="rotate(-20)" />
                <path d={STINGER} />
              </g>
            </mask>
          </defs>
          <rect x="6" y="14" width="76" height="76" rx="22" fill="#FFD23F" mask="url(#dazbee-bee-gap)" />
          <path d="M26,36 H62 L32,70 H64" fill="none" stroke="#15121A" strokeWidth="11" strokeLinejoin="round" strokeLinecap="round" />
          <g transform="translate(78 25) scale(.72)">
            <path d={WING_PINK} fill="#FF48B0" />
            <path d={WING_BLUE} fill="#3D6BFF" />
            <path d={STINGER} fill="#15121A" />
            <g transform="rotate(-20)">
              <rect x="-20" y="-12" width="40" height="24" rx="12" fill="#FFD23F" />
              <rect x="-6" y="-14" width="6" height="28" fill="#15121A" />
              <rect x="6" y="-14" width="6" height="28" fill="#15121A" />
              <rect x="-20" y="-12" width="40" height="24" rx="12" fill="none" stroke="#15121A" strokeWidth="2.6" />
              <circle cx="-13" cy="-2" r="2.6" fill="#15121A" />
            </g>
          </g>
        </>
      )}
    </svg>
  )
}

const WING_PINK = 'M-7,-33 Q-7,-19 7,-19 Q-7,-19 -7,-5 Q-7,-19 -21,-19 Q-7,-19 -7,-33Z'
const WING_BLUE = 'M12,-34 Q12,-24 22,-24 Q12,-24 12,-14 Q12,-24 2,-24 Q12,-24 12,-34Z'
const STINGER = 'M16,-11.5 L28,-10.2 L19.5,-1.5Z'
