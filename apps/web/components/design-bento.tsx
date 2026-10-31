// The brand's recent work as a bento (#84): real pictures of each design that fill their tiles.
// The latest design is large, a tall format (a story) takes a tall tile and a wide one (a banner)
// a wide tile; a dense grid packs the rest around them.
import Link from 'next/link'
import { shapeOf, type DesignSummary } from '@razzlr/schema'
import { cn } from '../lib/cn.ts'
import { format, type Messages } from '../lib/i18n/index.ts'

export interface BentoDesign extends DesignSummary {
  /** The primary format's size, when the design has a picture. */
  cover: { width: number; height: number } | null
}

/** A calm two-colour tile while a design has no picture, steady for each id. */
function tileOf(id: string) {
  let hash = 0
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return `linear-gradient(135deg, oklch(0.62 0.15 ${hue}), oklch(0.45 0.12 ${(hue + 40) % 360}))`
}

/** How many columns and rows a tile spans: the first is large, tall formats tall, wide ones wide. */
export function spanOf(design: BentoDesign, index: number): 'large' | 'tall' | 'wide' | 'one' {
  if (index === 0) return 'large'
  if (!design.cover) return 'one'
  const shape = shapeOf(design.cover.width, design.cover.height)
  return shape === 'tall' ? 'tall' : shape === 'wide' ? 'wide' : 'one'
}

const SPAN = { large: 'col-span-2 row-span-2', tall: 'row-span-2', wide: 'col-span-2', one: '' }

export function DesignBento({ t, locale, brandId, designs }: { t: Messages; locale: string; brandId: string; designs: BentoDesign[] }) {
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  return (
    // Rows as tall as a column is wide, so a single tile is square, the big one too, a story tile
    // is 1:2 and a banner 2:1: each picture fills its tile with little cut away.
    <div className="@container">
    <ul aria-label={t.home.recent} className="grid grid-flow-dense auto-rows-[calc((100cqw-0.75rem)/2)] grid-cols-2 gap-3 md:auto-rows-[calc((100cqw-2.25rem)/4)] md:grid-cols-4 xl:auto-rows-[calc((100cqw-3.75rem)/6)] xl:grid-cols-6">
      {designs.map((design, i) => {
        const span = spanOf(design, i)
        return (
          <li key={design.id} data-span={span} data-testid="bento-tile" className={cn('rise min-w-0', SPAN[span])} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
            <Link
              href={`/brands/${brandId}/designs/${design.id}`}
              // Not prefetched: up to 24 editor pages, each a design read, for the one that gets opened.
              // In CI those prefetches also held up the router's next navigation (#84).
              prefetch={false}
              title={format(t.library.edited, { when: when.format(new Date(design.updatedAt)) })}
              className="group relative block size-full overflow-hidden rounded-[16px] bg-raised shadow-panel transition-transform duration-[var(--chrome)] ease-[var(--ease-out)] hover:-translate-y-0.5 focus-visible:outline-offset-4"
            >
              {design.cover
                ? (
                  // Our own PNG through our own route; next/image would only re-encode it.
                  <img
                    src={`/brands/${brandId}/designs/${design.id}/thumbnail?v=${Date.parse(design.updatedAt)}`}
                    alt=""
                    width={design.cover.width}
                    height={design.cover.height}
                    loading={i < 6 ? 'eager' : 'lazy'}
                    className="absolute inset-0 size-full object-cover transition-transform duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:scale-[1.02]"
                  />
                )
                : (
                  <span aria-hidden className="absolute inset-0 grid place-items-center" style={{ background: tileOf(design.id) }}>
                    <span className="font-display text-4xl font-bold text-white/90">{design.name.trim().charAt(0).toUpperCase()}</span>
                  </span>
                )}
              {/* Only the name, on a short shade, as in the final mock; when it changed is in the title. */}
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pt-6 pb-2 text-white">
                <span className={cn('block truncate font-medium', span === 'large' ? 'text-sm' : 'text-[13px]')}>{design.name}</span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
    </div>
  )
}
