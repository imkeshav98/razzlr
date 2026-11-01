// A brand's designs (Recent in the capsule), as the earlier mock's masonry page: the brand's name
// with chips that filter by the primary format's shape, then every design in its own shape.
import { shapeOf } from '@dazbee/schema'
import { notFound } from 'next/navigation'
import { DesignMasonry, type MasonryDesign } from '../../../../components/design-masonry.tsx'
import { FilterChips } from '../../../../components/filter-chips.tsx'
import { LibraryShell } from '../../../../components/library-shell.tsx'
import { designCover, getWorkspace, listBrands, listDesigns } from '../../../../lib/api.ts'
import { showsBrandList } from '../../../../lib/home.ts'
import { brandWords, format } from '../../../../lib/i18n/index.ts'
import { getLocale, getMessages } from '../../../../lib/i18n/server.ts'
import { deleteDesignAction, duplicateDesignAction, renameDesignAction } from '../actions.ts'

export const dynamic = 'force-dynamic'

const SHAPES = ['square', 'portrait', 'story', 'landscape'] as const
type Shape = (typeof SHAPES)[number]

/** Which chip a picture's size falls under: a story is tall, landscape takes wide too. */
function chipOf(size: { width: number; height: number } | null): Shape | null {
  if (!size) return null
  const shape = shapeOf(size.width, size.height)
  return shape === 'tall' ? 'story' : shape === 'wide' ? 'landscape' : shape
}

export default async function DesignsPage({ params, searchParams }: { params: Promise<{ brandId: string }>; searchParams: Promise<{ shape?: string }> }) {
  const [{ brandId }, { shape }] = await Promise.all([params, searchParams])
  const [t, locale, workspace, brands] = await Promise.all([getMessages(), getLocale(), getWorkspace(), listBrands()])
  const brand = brands.find((b) => b.id === brandId)
  if (!brand) notFound()
  const summaries = await listDesigns(brand.id)
  // Only the sizes here: each picture is drawn when the browser asks for it, not before the page comes.
  const designs: MasonryDesign[] = await Promise.all(summaries.map(async (design) => ({ ...design, cover: await designCover(brand.id, design.id).catch(() => null) })))
  const picked = SHAPES.find((s) => s === shape) ?? null
  const shown = picked ? designs.filter((d) => chipOf(d.cover) === picked) : designs
  const here = `/brands/${brand.id}/designs`
  const l = t.library

  return (
    <LibraryShell t={t} words={brandWords(t)} workspace={workspace} brands={brands} activeBrandId={brand.id} showBrands={showsBrandList(brands)} place="designs" recentCount={designs.length}>
      <div className="flex flex-col gap-6 pt-2 md:pt-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-[2.5rem] md:leading-tight">{t.home.recent}</h1>
          <span className="text-sm font-medium text-muted tabular-nums">{designs.length > 0 ? format(t.home.count, { count: designs.length }) : l.noDesignsCount}</span>
        </div>
        {designs.length > 0 && (
          <FilterChips
            label={l.filters}
            chips={[
              { label: format(l.filterAll, { n: designs.length }), href: here, on: picked === null },
              ...SHAPES.map((s) => ({ label: l.shapes[s], href: `${here}?shape=${s}`, on: picked === s })),
            ]}
          />
        )}
        {designs.length === 0
          ? <div className="grid place-items-center rounded-[18px] border border-dashed border-line-strong px-6 py-14 text-center text-muted">{l.emptyRecent}</div>
          : shown.length === 0
            ? <p className="text-sm text-muted">{l.noShape}</p>
            : (
              <DesignMasonry
                t={t}
                locale={locale}
                brandId={brand.id}
                designs={shown}
                actions={{ rename: renameDesignAction.bind(null, brand.id), duplicate: duplicateDesignAction.bind(null, brand.id), remove: deleteDesignAction.bind(null, brand.id) }}
              />
            )}
      </div>
    </LibraryShell>
  )
}
