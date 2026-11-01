// The floating property cards' shared look (#83), as in the final mock: a frosted card with roomy
// padding, its title at the start and a small grey note at the end (what it acts on, or a count).
import { CaretRightIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

/** Colours a click away when the brand's kit has none; the Fine-tune rows take any colour. */
export const SWATCHES = ['#FFFFFF', '#FBF7F2', '#1A1420', '#FF48B0', '#3D6BFF', '#FFD23F', '#3DD68C', '#FF6B3D'] as const

/**
 * The ring round a picked swatch or tile, as in the mock: pink with a gap, a shape and not only a
 * colour, so it reads without colour vision too.
 */
export const PICKED_RING = 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--accent)]'

/** One floating card: frosted, rounded, as tall as its content. */
export const CARD = 'card-rise shrink-0 overflow-hidden rounded-[16px] surface-frost border shadow-panel'

/** A card's content under its title row. */
export const CARD_BODY = 'px-[18px] pb-4'

/**
 * A card's title row: the name at the start; at the end a small grey note (the layer or page it
 * acts on), a count, and an optional action.
 */
export function CardHeader({ id, title, note, count, children }: { id: string; title: string; note?: string | undefined; count?: number; children?: ReactNode }) {
  return (
    <div className={cn('flex h-12 items-center gap-2 ps-[18px]', children ? 'pe-2.5' : 'pe-[18px]')}>
      <h3 id={id} className="min-w-0 flex-1 truncate font-display text-[15px] font-bold tracking-tight">{title}</h3>
      {note && <span className="min-w-0 max-w-[60%] truncate text-[11px] font-medium text-muted">{note}</span>}
      {count !== undefined && <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">{count}</span>}
      {children}
    </div>
  )
}

/** "Fine-tune" as the mock draws it: a row under a hairline, its chevron turning down while open. */
export function FineTune({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <div className="px-[18px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-10 w-full cursor-pointer items-center justify-between border-t border-line text-xs font-semibold text-muted transition-colors duration-[var(--chrome-fast)] hover:text-text"
      >
        {label}
        <CaretRightIcon size={12} weight="bold" aria-hidden className={cn('transition-transform duration-[var(--chrome-fast)] rtl:-scale-x-100', open && 'rotate-90 rtl:-rotate-90')} />
      </button>
    </div>
  )
}
