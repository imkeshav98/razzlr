// Where the app opens (#84): a solo marketer or a company with one brand starts on that brand's
// brief; an agency, or anyone with several brands, starts on the list.
import type { BrandSummary, WorkspaceKind } from '@razzlr/schema'

/** The brand to open straight away, or null to show the list. */
export function openingBrand(kind: WorkspaceKind, brands: readonly BrandSummary[]): BrandSummary | null {
  return kind !== 'agency' && brands.length === 1 ? brands[0] ?? null : null
}

/** Whether the brand list shows beside a brand's page: always for an agency, otherwise once there are two. */
export const showsBrandList = (kind: WorkspaceKind, brands: readonly BrandSummary[]) => kind === 'agency' || brands.length > 1

/** The app opens on onboarding (#109) until the workspace has a brand. */
export const needsWelcome = (brands: readonly BrandSummary[]) => brands.length === 0

/**
 * A brand's name from its website's address (#109): `https://www.harbour-coffee.com/menu` gives
 * "Harbour Coffee". Null when the text is no address.
 */
export function nameFromWebsite(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  let host: string
  try {
    host = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).hostname
  } catch {
    return null
  }
  const labels = host.replace(/^www\./i, '').split('.').filter(Boolean)
  // The label before the public suffix: harbour-coffee in harbour-coffee.co.uk too.
  const second = labels.at(-2)
  const name = labels.length > 2 && second && second.length <= 3 ? labels.at(-3) : second ?? labels[0]
  if (!name || !/[a-z]/i.test(name)) return null
  return name.split(/[-_]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
