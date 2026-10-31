// The floating property cards' shared look (#83).
import type { ReactNode } from 'react'

/** One floating card: frosted, rounded, as tall as its content. */
export const CARD = 'overflow-hidden rounded-card surface-frost border shadow-panel'

/** A card's title row: the name, an optional count, and an optional action at the end. */
export function CardHeader({ id, title, count, children }: { id: string; title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="flex h-11 items-center justify-between ps-4 pe-2">
      <h3 id={id} className="font-display text-[13px] font-semibold tracking-tight">
        {title}
        {count !== undefined && <span className="ms-1.5 font-mono text-xs font-normal text-subtle tabular-nums">{count}</span>}
      </h3>
      {children}
    </div>
  )
}
