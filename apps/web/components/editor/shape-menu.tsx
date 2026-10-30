'use client'

// The shape tool in the tool dock (#44): one button draws the last shape picked, and the caret
// beside it opens a menu of every shape, each with its key. The menu is a list of radio items,
// moved through with the arrow keys, Home and End; Escape closes it and returns focus.
import {
  ArrowUpRightIcon, CaretUpIcon, CircleIcon, LineSegmentIcon, PentagonIcon, RectangleIcon, StarIcon, type Icon,
} from '@phosphor-icons/react'
import * as Popover from '@radix-ui/react-popover'
import type { ShapeTool } from '@razzlr/editor'
import { useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { Tooltip } from '../ui/tooltip.tsx'

export const SHAPES: { id: ShapeTool; icon: Icon; key?: string }[] = [
  { id: 'rect', icon: RectangleIcon, key: 'R' },
  { id: 'ellipse', icon: CircleIcon, key: 'O' },
  { id: 'polygon', icon: PentagonIcon },
  { id: 'star', icon: StarIcon },
  { id: 'line', icon: LineSegmentIcon, key: 'L' },
  { id: 'arrow', icon: ArrowUpRightIcon, key: 'Shift+L' },
]

const DOCK_BUTTON = 'grid h-9 cursor-pointer place-items-center rounded-row transition-colors duration-[var(--chrome-fast)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

export function ShapeTools({ active, shape, onPick }: { active: boolean; shape: ShapeTool; onPick: (shape: ShapeTool) => void }) {
  const t = useMessages()
  const [open, setOpen] = useState(false)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const current = SHAPES.find((s) => s.id === shape) ?? SHAPES[0] as (typeof SHAPES)[number]
  const label = t.editor.shapes[current.id]

  const move = (e: KeyboardEvent) => {
    const at = items.current.findIndex((item) => item === document.activeElement)
    const last = SHAPES.length - 1
    const next = { ArrowDown: at + 1 > last ? 0 : at + 1, ArrowUp: at - 1 < 0 ? last : at - 1, Home: 0, End: last }[e.key]
    if (next === undefined) return
    e.preventDefault()
    items.current[next]?.focus()
  }

  return (
    <div role="group" aria-label={t.editor.shapes.menu} className={cn('flex items-center rounded-row transition-colors duration-[var(--chrome-fast)]', active && 'bg-accent-solid text-on-accent')}>
      <Tooltip label={current.key ? `${label} · ${current.key}` : label}>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          data-tool="shape"
          data-shape={current.id}
          onClick={() => onPick(current.id)}
          className={cn(DOCK_BUTTON, 'w-8 ps-0.5', active ? 'text-on-accent' : 'text-muted hover:bg-hover hover:text-text')}
        >
          <current.icon size={18} weight={active ? 'fill' : 'regular'} aria-hidden />
        </button>
      </Tooltip>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Tooltip label={t.editor.shapes.more}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={t.editor.shapes.more}
              aria-haspopup="menu"
              data-testid="shape-menu"
              className={cn(DOCK_BUTTON, 'w-4', active ? 'text-on-accent/80 hover:text-on-accent' : 'text-subtle hover:bg-hover hover:text-text')}
            >
              <CaretUpIcon size={10} weight="bold" aria-hidden />
            </button>
          </Popover.Trigger>
        </Tooltip>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="center"
            sideOffset={10}
            onOpenAutoFocus={(e) => {
              e.preventDefault()
              items.current[SHAPES.findIndex((s) => s.id === shape)]?.focus()
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              move(e)
            }}
            className="z-50 w-52 rounded-card surface-frost border p-1 shadow-panel data-[state=open]:animate-[tooltip-in_var(--chrome-fast)_var(--ease-out)]"
          >
            <div role="menu" aria-label={t.editor.shapes.menu}>
              {SHAPES.map(({ id, icon: ShapeIcon, key }, i) => (
                <button
                  key={id}
                  ref={(el) => { items.current[i] = el }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={id === shape}
                  data-shape={id}
                  onClick={() => {
                    setOpen(false)
                    onPick(id)
                  }}
                  className={cn(
                    'flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-row px-2 text-[13px] outline-none transition-colors duration-[var(--chrome-fast)] hover:bg-hover focus-visible:bg-hover',
                    id === shape ? 'text-text' : 'text-muted',
                  )}
                >
                  <ShapeIcon size={16} weight={id === shape ? 'fill' : 'regular'} aria-hidden className={cn(id === shape && 'text-accent-text')} />
                  <span className="flex-1 text-start">{t.editor.shapes[id]}</span>
                  {key && <kbd className="font-mono text-[11px] text-subtle">{key}</kbd>}
                </button>
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
