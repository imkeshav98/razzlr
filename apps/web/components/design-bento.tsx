// The brand's recent work as a bento (#84): real pictures of each design that fill their tiles.
// The latest design is large, a tall format (a story) takes a tall tile and a wide one (a banner)
// a wide tile; a dense grid packs the rest around them.
import Link from 'next/link'
import { shapeOf, type DesignSummary } from '@dazbee/schema'
import { cn } from '../lib/cn.ts'
import { tileOf } from '../lib/tile.ts'
import { TileMenu } from './tile-menu.tsx'
import { format, type Messages } from '../lib/i18n/index.ts'

export interface BentoDesign extends DesignSummary {
  /** The primary format's size, when the design has a picture. */
  cover: { width: number; height: number } | null
}

export type BentoSpan = 'large' | 'tall' | 'wide' | 'one'

/** How many columns and rows a tile spans: the first is large, tall formats tall, wide ones wide. */
export function spanOf(design: BentoDesign, index: number): BentoSpan {
  return spanOfSize(design.cover, index)
}

/** The same for anything with a size, such as a template. */
export function spanOfSize(size: { width: number; height: number } | null, index: number): BentoSpan {
  if (index === 0) return 'large'
  if (!size) return 'one'
  const shape = shapeOf(size.width, size.height)
  return shape === 'tall' ? 'tall' : shape === 'wide' ? 'wide' : 'one'
}

export const SPAN: Record<BentoSpan, string> = { large: 'col-span-2 row-span-2', tall: 'row-span-2', wide: 'col-span-2', one: '' }

/** The bento's grid: rows as tall as a column is wide, 2, 4 or 6 columns by the container's width. */
export const BENTO_GRID = 'grid grid-flow-dense auto-rows-[calc((100cqw-0.75rem)/2)] grid-cols-2 gap-3 md:auto-rows-[calc((100cqw-2.25rem)/4)] md:grid-cols-4 xl:auto-rows-[calc((100cqw-3.75rem)/6)] xl:grid-cols-6'

/** A bento tile's frame, and the short shade at its foot that holds the name. */
export const TILE = 'lift group relative block size-full overflow-hidden rounded-[16px] bg-raised shadow-panel focus-visible:outline-offset-4'
export const TILE_SHADE = 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pt-6 pb-2 text-start text-white'

/** What a tile's menu does to a design (#159), as server actions. */
export interface DesignActions {
  rename: (designId: string, form: FormData) => Promise<void>
  duplicate: (designId: string) => Promise<void>
  remove: (designId: string) => Promise<void>
}

export function DesignBento({ t, locale, brandId, designs, eager = true, actions }: {
  /** Rename, Duplicate and Delete on each tile; left out, the tiles have no menu. */
  actions?: DesignActions
  t: Messages
  locale: string
  brandId: string
  designs: BentoDesign[]
  /** Whether the first pictures load at once; not while the bento waits closed, so none is fetched for nothing. */
  eager?: boolean
}) {
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  return (
    // Rows as tall as a column is wide, so a single tile is square, the big one too, a story tile
    // is 1:2 and a banner 2:1: each picture fills its tile with little cut away.
    <div className="@container">
    <ul aria-label={t.home.recent} className={BENTO_GRID}>
      {designs.map((design, i) => {
        const span = spanOf(design, i)
        return (
          <li key={design.id} data-design={design.id} data-span={span} data-testid="bento-tile" className={cn('rise group/tile relative min-w-0', SPAN[span])} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
            <Link
              href={`/brands/${brandId}/designs/${design.id}`}
              // Not prefetched: up to 24 editor pages, each a design read, for the one that gets opened.
              // In CI those prefetches also held up the router's next navigation (#84).
              prefetch={false}
              title={format(t.library.edited, { when: when.format(new Date(design.updatedAt)) })}
              className={TILE}
            >
              {design.cover
                ? (
                  // Our own PNG through our own route; next/image would only re-encode it.
                  <img
                    src={`/brands/${brandId}/designs/${design.id}/thumbnail?v=${Date.parse(design.updatedAt)}`}
                    alt=""
                    width={design.cover.width}
                    height={design.cover.height}
                    loading={eager && i < 6 ? 'eager' : 'lazy'}
                    className="absolute inset-0 size-full object-cover transition-transform duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:scale-[1.02]"
                  />
                )
                : (
                  <span aria-hidden className="absolute inset-0 grid place-items-center" style={{ background: tileOf(design.id) }}>
                    <span className="font-display text-4xl font-bold text-white/90">{design.name.trim().charAt(0).toUpperCase()}</span>
                  </span>
                )}
              {/* Only the name, on a short shade, as in the final mock; when it changed is in the title. */}
              <span className={TILE_SHADE}>
                <span className={cn('block truncate font-medium', span === 'large' ? 'text-sm' : 'text-[13px]')}>{design.name}</span>
              </span>
            </Link>
            {actions && (
              <TileMenu
                name={design.name}
                rename={actions.rename.bind(null, design.id)}
                duplicate={actions.duplicate.bind(null, design.id)}
                remove={actions.remove.bind(null, design.id)}
              />
            )}
          </li>
        )
      })}
    </ul>
    </div>
  )
}
