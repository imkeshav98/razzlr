// A brand's designs as the earlier mock's masonry: columns of real pictures, each in its own shape,
// its name under it, with the tile menu (#159) on each.
import Link from 'next/link'
import type { DesignSummary } from '@dazbee/schema'
import { cn } from '../lib/cn.ts'
import { format, type Messages } from '../lib/i18n/index.ts'
import { tileOf } from '../lib/tile.ts'
import { TileMenu } from './tile-menu.tsx'

/** What a tile's menu does to a design (#159), as server actions. */
export interface DesignActions {
  rename: (designId: string, form: FormData) => Promise<void>
  duplicate: (designId: string) => Promise<void>
  remove: (designId: string) => Promise<void>
}

export interface MasonryDesign extends DesignSummary {
  /** The primary format's size, when the design has a picture. */
  cover: { width: number; height: number } | null
}

export function DesignMasonry({ t, locale, brandId, designs, actions }: {
  t: Messages
  locale: string
  brandId: string
  designs: MasonryDesign[]
  actions: DesignActions
}) {
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  return (
    <ul aria-label={t.home.recent} className="columns-2 gap-4 md:columns-3 xl:columns-4 2xl:columns-5">
      {designs.map((design, i) => (
        <li
          key={design.id}
          data-design={design.id}
          data-testid="design-tile"
          className="rise group/tile relative mb-4 break-inside-avoid"
          style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
        >
          <Link href={`/brands/${brandId}/designs/${design.id}`} prefetch={false} className="group flex flex-col gap-2 rounded-[16px] focus-visible:outline-offset-4">
            <span
              className="lift relative block overflow-hidden rounded-[16px] bg-raised shadow-panel"
              style={{ aspectRatio: design.cover ? `${design.cover.width} / ${design.cover.height}` : '1 / 1' }}
            >
              {design.cover
                ? (
                  // Our own PNG through our own route; next/image would only re-encode it.
                  <img
                    src={`/brands/${brandId}/designs/${design.id}/thumbnail?v=${Date.parse(design.updatedAt)}`}
                    alt=""
                    width={design.cover.width}
                    height={design.cover.height}
                    loading={i < 8 ? 'eager' : 'lazy'}
                    className="absolute inset-0 size-full object-cover transition-transform duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:scale-[1.02]"
                  />
                )
                : (
                  <span aria-hidden className="absolute inset-0 grid place-items-center" style={{ background: tileOf(design.id) }}>
                    <span className="font-display text-4xl font-bold text-white/90">{design.name.trim().charAt(0).toUpperCase()}</span>
                  </span>
                )}
            </span>
            <span className="flex min-w-0 flex-col px-1">
              <span className={cn('truncate text-[13px] font-semibold text-text')}>{design.name}</span>
              <span className="truncate text-[11px] text-muted">{format(t.library.edited, { when: when.format(new Date(design.updatedAt)) })}</span>
            </span>
          </Link>
          <TileMenu
            name={design.name}
            rename={actions.rename.bind(null, design.id)}
            duplicate={actions.duplicate.bind(null, design.id)}
            remove={actions.remove.bind(null, design.id)}
          />
        </li>
      ))}
    </ul>
  )
}
