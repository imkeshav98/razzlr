// The sign-in page's showcase: three copies of a sample ad that fan out over a slow aurora. Plain
// HTML and CSS (classes in globals.css), decoration only, so it is hidden from assistive tech.
import type { Messages } from '../../lib/i18n/en.ts'

const VARIANTS = ['teal', 'sunset', 'violet'] as const

export function AdFan({ sample }: { sample: Messages['signIn']['sample'] }) {
  return (
    <div className="signin-showcase" data-testid="sign-in-showcase">
      <div className="signin-glow"><div className="signin-aurora"><div /></div></div>
      <div className="ad-fan">
        {VARIANTS.map((variant) => (
          <div key={variant} className="sample-ad" data-variant={variant}>
            <span className="sample-ad-brand">{sample.brand}</span>
            <span className="sample-ad-headline">{sample.headline}</span>
            <span className="sample-ad-cup"><i /><i /></span>
            <span className="sample-ad-price">{sample.price}</span>
            <span className="sample-ad-cta">{sample.cta}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
