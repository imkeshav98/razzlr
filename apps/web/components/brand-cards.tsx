// The Brands page's cards, as in the final mock: each brand on a card in its own colours,
// with its initials large and faint behind, its latest design's picture, its name and how many
// designs it has. The last card adds a brand.
import Link from 'next/link'
import type { BrandSummary } from '@dazbee/schema'
import { initialsOf } from '../lib/initials.ts'
import { tileOf } from '../lib/tile.ts'

export interface BrandCardData extends BrandSummary {
  designCount: number
  /** The kit's colours, as #RRGGBB. */
  colors: string[]
  /** The latest design's picture, when it has one. */
  latest: { src: string; width: number; height: number } | null
}

/** The card's ground: the kit's first two colours, or a calm tile steady for the brand. */
function groundOf(brand: BrandCardData) {
  const [a, b] = brand.colors
  if (a && b) return `linear-gradient(140deg, ${a}, ${b})`
  if (a) return `linear-gradient(140deg, ${a}, color-mix(in oklab, ${a} 55%, black))`
  return tileOf(brand.id)
}

export function BrandCard({ brand, count }: { brand: BrandCardData; count: string }) {
  return (
    <Link
      href={`/brands/${brand.id}`}
      data-brand={brand.id}
      className="lift group relative isolate flex h-52 flex-col justify-end overflow-hidden rounded-[20px] p-5 text-white shadow-panel focus-visible:outline-offset-4"
      style={{ backgroundImage: groundOf(brand) }}
    >
      <span aria-hidden className="pointer-events-none absolute -end-2 -top-9 -z-10 font-display text-[9rem] leading-none font-extrabold tracking-tighter opacity-20 select-none">
        {initialsOf(brand.name)}
      </span>
      {brand.latest && (
        <img
          src={brand.latest.src}
          alt=""
          width={brand.latest.width}
          height={brand.latest.height}
          loading="lazy"
          className="absolute end-5 top-5 -z-10 h-[56%] w-auto max-w-[42%] rotate-3 rounded-[8px] object-cover shadow-[0_14px_30px_-10px_rgb(0_0_0/0.6)] transition-transform duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:rotate-0 group-hover:scale-105 rtl:-rotate-3"
        />
      )}
      {/* A shade at the foot keeps the name readable on a light kit. */}
      <span aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-gradient-to-t from-black/55 to-transparent" />
      <span className="truncate font-display text-2xl font-extrabold tracking-tight">{brand.name}</span>
      <span className="mt-2 flex items-center gap-2 text-xs font-semibold">
        <span className="rounded-full bg-black/30 px-2.5 py-0.5 tabular-nums">{count}</span>
        {brand.colors.slice(0, 5).map((color, i) => (
          <span key={`${color}-${i}`} aria-hidden className="size-3.5 rounded-full ring-1 ring-white/50" style={{ backgroundColor: color }} />
        ))}
      </span>
    </Link>
  )
}
