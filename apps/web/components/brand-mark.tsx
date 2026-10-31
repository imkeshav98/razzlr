/** Razzlr's mark: the AI gradient in a rounded square. Decorative; the name sits beside it or in a label. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span aria-hidden className="ai-glow relative grid shrink-0 place-items-center rounded-[9px] shadow-[0_6px_20px_-6px_rgb(255_72_176/0.55)]" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56} fill="none">
        <path d="M7 19V5h6.2a4.3 4.3 0 0 1 1 8.5L18 19" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
