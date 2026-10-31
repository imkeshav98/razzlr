// Where the app opens (#84): a solo marketer or a company with one brand starts on that brand's
// brief; an agency, or anyone with several brands, starts on the list.
import type { BrandSummary, WorkspaceKind } from '@razzlr/schema'

/** The brand to open straight away, or null to show the list. */
export function openingBrand(kind: WorkspaceKind, brands: readonly BrandSummary[]): BrandSummary | null {
  return kind !== 'agency' && brands.length === 1 ? brands[0] ?? null : null
}

/** Whether the brand list shows beside a brand's page: always for an agency, otherwise once there are two. */
export const showsBrandList = (kind: WorkspaceKind, brands: readonly BrandSummary[]) => kind === 'agency' || brands.length > 1
