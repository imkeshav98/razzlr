'use client'

// Paints as the cards edit them (#219): a stack whose rows show the top coat first, as in Figma and
// Photoshop, and can be dragged into another order; each row's swatch opens a paint editor that
// switches it between a solid colour, a linear, radial or angular gradient and an image, and edits
// a gradient's stops (add, move, remove, colour and opacity, brand colours too) and its angle or
// centre. A row hides its paint without deleting it, and a gradient or image has its own opacity.
import { DotsSixVerticalIcon, EyeIcon, EyeSlashIcon, ImageIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react'
import * as Popover from '@radix-ui/react-popover'
import type { Editor } from '@dazbee/editor'
import type { Paint } from '@dazbee/schema'
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { useLocale, useMessages } from '../../lib/i18n/client.tsx'
import { dirOf, format, type Messages } from '../../lib/i18n/index.ts'
import { SEGMENTED, segment } from '../ui/segmented.tsx'
import { PICKED_RING } from './card.tsx'
import { Choice, clamp, ColorField, NumberField, tidy } from './fields.tsx'
import { ImagePickerButton } from './image-tool.tsx'
import { CHIP, FOCUS_RING, ICON_BUTTON, POPOVER } from './styles.ts'
import { useBrandKit } from './use-brand-kit.ts'

type P = Messages['editor']['props']
type Gradient = Extract<Paint, { type: 'linear' | 'radial' | 'angular' }>
type Stop = Gradient['stops'][number]
export const PAINT_TYPES = ['solid', 'linear', 'radial', 'angular', 'image'] as const
type PaintType = (typeof PAINT_TYPES)[number]

const thumbnail = (brandId: string, assetId: string) => `/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(assetId)}/thumbnail`
const stopsCss = (stops: Stop[], unit: 'percent' | 'degrees') => stops.map((s) => `${s.color} ${tidy(s.offset * (unit === 'percent' ? 100 : 360))}${unit === 'percent' ? '%' : 'deg'}`).join(', ')
/** A linear gradient's direction in degrees, clockwise from pointing right, as drawn in a square. */
const angleOf = (g: Extract<Paint, { type: 'linear' }>) => Math.round((Math.atan2(g.to.y - g.from.y, g.to.x - g.from.x) * 180) / Math.PI)
/** A linear gradient across the whole unit box at an angle, through its middle. */
const linearAt = (deg: number) => {
  const r = (deg * Math.PI) / 180
  const d = { x: Math.cos(r) / 2, y: Math.sin(r) / 2 }
  return { from: { x: tidy(0.5 - d.x), y: tidy(0.5 - d.y) }, to: { x: tidy(0.5 + d.x), y: tidy(0.5 + d.y) } }
}

/** A paint as a CSS background, close to what the renderer draws in the layer's box. */
export function paintBackground(paint: Paint, brandId: string): string {
  switch (paint.type) {
    case 'solid': return `linear-gradient(${paint.color}, ${paint.color})`
    case 'linear': return `linear-gradient(${angleOf(paint) + 90}deg, ${stopsCss(paint.stops, 'percent')})`
    case 'radial': return `radial-gradient(${tidy(paint.radius * 100)}% ${tidy(paint.radius * 100)}% at ${tidy(paint.center.x * 100)}% ${tidy(paint.center.y * 100)}%, ${stopsCss(paint.stops, 'percent')})`
    case 'angular': return `conic-gradient(from ${paint.angle + 90}deg at ${tidy(paint.center.x * 100)}% ${tidy(paint.center.y * 100)}%, ${stopsCss(paint.stops, 'degrees')})`
    case 'image': return `url("${thumbnail(brandId, paint.assetId)}") center / cover no-repeat`
  }
}

/** The paint a row turns into when its type is switched: the colours carried over where they can be. */
function convert(now: Paint, type: Exclude<PaintType, 'image'>): Paint {
  const keep = { ...(now.opacity === undefined ? {} : { opacity: now.opacity }), ...(now.visible === undefined ? {} : { visible: now.visible }) }
  const stops: Stop[] = now.type === 'solid'
    ? [{ offset: 0, color: now.color }, { offset: 1, color: `${now.color.slice(0, 7)}00` }]
    : now.type === 'image' ? [{ offset: 0, color: '#000000FF' }, { offset: 1, color: '#FFFFFFFF' }] : now.stops
  switch (type) {
    case 'solid': return { type, color: now.type === 'solid' ? now.color : stops[0]?.color ?? '#D9D9D9FF', ...keep }
    case 'linear': return { type, ...linearAt(90), stops, ...keep }
    case 'radial': return { type, center: { x: 0.5, y: 0.5 }, radius: 0.5, stops, ...keep }
    case 'angular': return { type, center: { x: 0.5, y: 0.5 }, angle: 0, stops, ...keep }
  }
}

/** A gradient's stops in order, as the renderer needs them. */
const sorted = (stops: Stop[]) => [...stops].sort((a, b) => a.offset - b.offset)
/** The colour a gradient has at an offset, for a stop added there. */
function colourAt(stops: Stop[], at: number): string {
  const list = sorted(stops)
  const after = list.findIndex((s) => s.offset >= at)
  const b = list[after] ?? list.at(-1)
  const a = list[after - 1] ?? b
  if (!a || !b) return '#000000FF'
  const t = b.offset === a.offset ? 0 : (at - a.offset) / (b.offset - a.offset)
  const channel = (i: number) => {
    const x = Number.parseInt(a.color.slice(i, i + 2), 16)
    const y = Number.parseInt(b.color.slice(i, i + 2), 16)
    return Math.round(x + (y - x) * t).toString(16).padStart(2, '0').toUpperCase()
  }
  return `#${channel(1)}${channel(3)}${channel(5)}${channel(7)}`
}

/** A paint's swatch over a checkerboard, so a see-through paint shows as one. */
export function PaintSwatch({ paint, brandId, className }: { paint: Paint; brandId: string; className?: string }) {
  return (
    <span aria-hidden className={cn('checker relative block overflow-hidden rounded-[6px] border border-line-strong', className)}>
      <span className="absolute inset-0" style={{ background: paintBackground(paint, brandId), opacity: paint.opacity ?? 1 }} />
    </span>
  )
}

/** The brand's colours as small round buttons that pick one. */
function BrandColours({ brandId, label, onPick }: { brandId: string; label: string; onPick: (color: string) => void }) {
  const colors = useBrandKit(brandId)?.colors ?? []
  if (colors.length === 0) return null
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {colors.map((c) => (
        <button
          key={c.token}
          type="button"
          aria-label={`${c.name} ${c.value.slice(0, 7)}`}
          title={c.name}
          onClick={() => onPick(c.value)}
          style={{ backgroundColor: c.value }}
          className={cn('size-6 cursor-pointer rounded-full border border-line-strong transition-transform duration-[var(--chrome-fast)] hover:scale-110', FOCUS_RING)}
        />
      ))}
    </div>
  )
}

/**
 * A gradient's stops on a bar: a click on the bar adds one there in the colour the gradient has,
 * a drag moves one (one undo step), the arrow keys move the focused one, Delete removes it.
 */
function GradientBar({ paint, picked, onPick, editor, p, onSet }: {
  paint: Gradient
  picked: number
  onPick: (i: number) => void
  editor: Editor
  p: P
  onSet: (to: (now: Gradient) => Gradient) => void
}) {
  const bar = useRef<HTMLDivElement>(null)
  const drag = useRef<{ i: number; end: () => void } | null>(null)
  const at = (clientX: number) => {
    const box = bar.current?.getBoundingClientRect()
    return box ? tidy(clamp((clientX - box.left) / box.width, 0, 1)) : 0
  }
  const move = (i: number, offset: number) => onSet((now) => ({ ...now, stops: now.stops.map((s, j) => (j === i ? { ...s, offset: tidy(clamp(offset, 0, 1)) } : s)) }))
  const remove = (i: number) => {
    if (paint.stops.length <= 2) return
    onSet((now) => ({ ...now, stops: now.stops.filter((_, j) => j !== i) }))
    onPick(Math.max(0, i - 1))
  }
  return (
    // The gradient runs left to right in the design whatever the language, as the stage does.
    <div dir="ltr" className="px-2">
      <div
        ref={bar}
        role="group"
        aria-label={p.stops}
        data-testid="gradient-bar"
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return
          const offset = at(e.clientX)
          onSet((now) => ({ ...now, stops: sorted([...now.stops, { offset, color: colourAt(now.stops, offset) }]) }))
          onPick(sorted([...paint.stops, { offset, color: '' }]).findIndex((s) => s.color === ''))
        }}
        className="checker relative h-6 cursor-copy rounded-[6px] border border-line-strong"
      >
        <span className="pointer-events-none absolute inset-0 rounded-[5px]" style={{ background: `linear-gradient(90deg, ${stopsCss(sorted(paint.stops), 'percent')})` }} />
        {paint.stops.map((stop, i) => (
          <button
            key={i}
            type="button"
            aria-label={format(p.stop, { n: i + 1, at: Math.round(stop.offset * 100) })}
            aria-pressed={picked === i}
            data-stop={i}
            onPointerDown={(e) => {
              e.stopPropagation()
              onPick(i)
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = { i, end: editor.beginGesture() }
            }}
            onPointerMove={(e) => {
              if (drag.current?.i === i) move(i, at(e.clientX))
            }}
            onPointerUp={() => {
              if (!drag.current) return
              // In order again, the stop dragged still picked.
              const moved = paint.stops[i]
              const order = sorted(paint.stops)
              if (order.some((s, j) => s !== paint.stops[j])) onSet((now) => ({ ...now, stops: sorted(now.stops) }))
              drag.current.end()
              drag.current = null
              if (moved) onPick(order.indexOf(moved))
            }}
            onKeyDown={(e: KeyboardEvent) => {
              const step = e.shiftKey ? 0.1 : 0.01
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') move(i, stop.offset + (e.key === 'ArrowRight' ? step : -step))
              else if (e.key === 'Delete' || e.key === 'Backspace') remove(i)
              else return
              e.preventDefault()
              e.stopPropagation()
            }}
            style={{ left: `${stop.offset * 100}%`, backgroundColor: stop.color }}
            className={cn('absolute top-1/2 size-4 -translate-1/2 cursor-grab rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)] active:cursor-grabbing', FOCUS_RING, picked === i && PICKED_RING)}
          />
        ))}
      </div>
    </div>
  )
}

/** One paint's editor: its type, then a solid's colour, a gradient's stops and shape, or an image. */
function PaintEditor({ paint, brandId, editor, p, onSet }: { paint: Paint; brandId: string; editor: Editor; p: P; onSet: (to: (now: Paint) => Paint) => void }) {
  const [picked, setPicked] = useState(0)
  const stop = paint.type === 'linear' || paint.type === 'radial' || paint.type === 'angular' ? paint.stops[Math.min(picked, paint.stops.length - 1)] : undefined
  const setGradient = (to: (now: Gradient) => Gradient) => onSet((now) => (now.type === 'linear' || now.type === 'radial' || now.type === 'angular' ? to(now) : now))
  const setStopColour = (color: (now: string | undefined) => string) => setGradient((now) => ({ ...now, stops: now.stops.map((s, j) => (j === Math.min(picked, now.stops.length - 1) ? { ...s, color: color(s.color) } : s)) }))
  const pct = (n: number) => tidy(n * 100)
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="paint-editor">
      <div role="radiogroup" aria-label={p.paintType} className={cn(SEGMENTED, 'justify-between')}>
        {PAINT_TYPES.map((type) => {
          const on = paint.type === type
          const label = type === 'solid' ? p.solid : p.paint[type]
          if (type === 'image' && !on) {
            return (
              <ImagePickerButton key={type} brandId={brandId} title={p.paint.image} testId="paint-image" className={segment(false)} onPick={(asset) => onSet((now) => ({ type: 'image', assetId: asset.id, fit: 'fill', opacity: now.opacity ?? 1, ...(now.visible === undefined ? {} : { visible: now.visible }) }))}>
                <span aria-hidden>{p.paintShort.image}</span>
              </ImagePickerButton>
            )
          }
          return (
            <button key={type} type="button" role="radio" aria-checked={on} aria-label={label} data-paint-type={type} onClick={() => type !== 'image' && !on && onSet((now) => convert(now, type))} className={segment(on)}>
              <span aria-hidden>{p.paintShort[type]}</span>
            </button>
          )
        })}
      </div>
      {paint.type === 'solid' && (
        <>
          <ColorField name={p.paintColour} value={paint.color} onSet={(to) => onSet((now) => (now.type === 'solid' ? { ...now, color: to(now.color) } : now))} />
          <BrandColours brandId={brandId} label={p.brandColours} onPick={(color) => onSet((now) => (now.type === 'solid' ? { ...now, color } : now))} />
        </>
      )}
      {(paint.type === 'linear' || paint.type === 'radial' || paint.type === 'angular') && (
        <>
          <GradientBar paint={paint} picked={picked} onPick={setPicked} editor={editor} p={p} onSet={setGradient} />
          <div className="flex items-center gap-1">
            <ColorField name={format(p.stopColour, { n: Math.min(picked, paint.stops.length - 1) + 1 })} value={stop?.color} onSet={setStopColour} />
            <button
              type="button"
              aria-label={p.removeStop}
              title={p.removeStop}
              disabled={paint.stops.length <= 2}
              onClick={() => {
                setGradient((now) => ({ ...now, stops: now.stops.filter((_, j) => j !== Math.min(picked, now.stops.length - 1)) }))
                setPicked(Math.max(0, picked - 1))
              }}
              className={ICON_BUTTON}
            >
              <MinusIcon size={14} aria-hidden />
            </button>
          </div>
          <BrandColours brandId={brandId} label={p.brandColours} onPick={(color) => setStopColour(() => color)} />
          <div className="grid grid-cols-3 gap-x-2">
            {paint.type === 'linear' && (
              <NumberField label="°" name={p.gradientAngle} value={angleOf(paint)} editor={editor} onSet={(v) => setGradient((now) => ({ ...now, ...linearAt(v) }))} onShift={(by) => setGradient((now) => (now.type === 'linear' ? { ...now, ...linearAt(angleOf(now) + by) } : now))} />
            )}
            {(paint.type === 'radial' || paint.type === 'angular') && (
              <>
                <NumberField label="X" name={p.gradientX} value={pct(paint.center.x)} min={0} max={100} editor={editor} onSet={(v) => setGradient((now) => (now.type === 'linear' ? now : { ...now, center: { ...now.center, x: tidy(v / 100) } }))} onShift={(by) => setGradient((now) => (now.type === 'linear' ? now : { ...now, center: { ...now.center, x: tidy(clamp(now.center.x + by / 100, 0, 1)) } }))} />
                <NumberField label="Y" name={p.gradientY} value={pct(paint.center.y)} min={0} max={100} editor={editor} onSet={(v) => setGradient((now) => (now.type === 'linear' ? now : { ...now, center: { ...now.center, y: tidy(v / 100) } }))} onShift={(by) => setGradient((now) => (now.type === 'linear' ? now : { ...now, center: { ...now.center, y: tidy(clamp(now.center.y + by / 100, 0, 1)) } }))} />
              </>
            )}
            {paint.type === 'radial' && (
              <NumberField label="R" name={p.gradientSize} value={pct(paint.radius)} min={1} editor={editor} onSet={(v) => setGradient((now) => (now.type === 'radial' ? { ...now, radius: tidy(Math.max(1, v) / 100) } : now))} onShift={(by) => setGradient((now) => (now.type === 'radial' ? { ...now, radius: tidy(Math.max(0.01, now.radius + by / 100)) } : now))} />
            )}
            {paint.type === 'angular' && (
              <NumberField label="°" name={p.gradientAngle} value={paint.angle} editor={editor} onSet={(v) => setGradient((now) => (now.type === 'angular' ? { ...now, angle: v } : now))} onShift={(by) => setGradient((now) => (now.type === 'angular' ? { ...now, angle: now.angle + by } : now))} />
            )}
          </div>
        </>
      )}
      {paint.type === 'image' && (
        <div className="flex items-center gap-2">
          <PaintSwatch paint={paint} brandId={brandId} className="size-12 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <ImagePickerButton brandId={brandId} title={p.replaceImageTitle} testId="paint-replace-image" className={cn(CHIP, FOCUS_RING, 'self-start')} onPick={(asset) => onSet((now) => (now.type === 'image' ? { ...now, assetId: asset.id } : now))}>
              <ImageIcon size={12} aria-hidden />
              <span aria-hidden>{p.replaceImage}</span>
            </ImagePickerButton>
            <Choice name={p.fit} value={paint.fit} options={['fill', 'fit', 'crop', 'tile'] as const} labels={p.fits} onSet={(fit) => onSet((now) => (now.type === 'image' ? { ...now, fit } : now))} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One paint in a list: its swatch, which opens its editor, then a solid's colour, or a gradient's
 * or image's name and opacity, and a button that hides it or shows it again.
 */
export function PaintRow({ paint, name, brandId, editor, p, onSet }: { paint: Paint; name: string; brandId: string; editor: Editor; p: P; onSet: (to: (now: Paint) => Paint) => void }) {
  const side = dirOf(useLocale()) === 'rtl' ? 'right' : 'left'
  const hidden = paint.visible === false
  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-1', hidden && 'opacity-50')} data-paint={paint.type}>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" aria-label={format(p.editPaint, { name })} data-testid="paint-swatch" className={cn('shrink-0 cursor-pointer rounded-[7px]', FOCUS_RING)}>
            <PaintSwatch paint={paint} brandId={brandId} className="size-7" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side={side} align="start" sideOffset={12} collisionPadding={12} aria-label={format(p.editPaint, { name })} onKeyDown={(e) => e.stopPropagation()} className={cn(POPOVER, 'w-80')}>
            <PaintEditor paint={paint} brandId={brandId} editor={editor} p={p} onSet={onSet} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {paint.type === 'solid'
        ? <ColorField name={name} value={paint.color} onSet={(to) => onSet((now) => (now.type === 'solid' ? { ...now, color: to(now.color) } : now))} />
        : (
          <>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{p.paint[paint.type]}</span>
            <div className="w-16 shrink-0">
              <NumberField
                label="%"
                name={format(p.alpha, { name })}
                value={paint.opacity ?? 1}
                scale={100}
                min={0}
                max={1}
                editor={editor}
                onSet={(v) => onSet((now) => ({ ...now, opacity: tidy(v) }))}
                onShift={(by) => onSet((now) => ({ ...now, opacity: tidy(clamp((now.opacity ?? 1) + by, 0, 1)) }))}
              />
            </div>
          </>
        )}
      <button
        type="button"
        aria-label={format(hidden ? p.showPaint : p.hidePaint, { name })}
        title={format(hidden ? p.showPaint : p.hidePaint, { name })}
        aria-pressed={hidden}
        data-testid="paint-visible"
        onClick={() => onSet((now) => {
          if (now.visible !== false) return { ...now, visible: false }
          const shown: Paint = { ...now }
          delete shown.visible
          return shown
        })}
        className={ICON_BUTTON}
      >
        {hidden ? <EyeSlashIcon size={14} aria-hidden /> : <EyeIcon size={14} aria-hidden />}
      </button>
    </div>
  )
}

/**
 * Rows of a list the cards edit (fills, strokes, effects): each with a remove button. With
 * `topFirst` the last item, the one drawn on top, is the first row, and rows can be dragged by
 * their grip, or moved with its arrow keys, into another order.
 */
export function Stack<T>({ items, field, topFirst = false, removeLabel, onWrite, render }: {
  items: T[]
  /** What the list holds, for each row's `data-item`, `<field>-<index>`. */
  field: string
  topFirst?: boolean
  /** The remove button's name for the row at a place, counted from 1 in the order shown. */
  removeLabel: (n: number) => string
  onWrite: (to: (now: T[]) => T[]) => void
  /** A row's content; `n` is its place in the order shown, from 1. */
  render: (item: T, n: number, change: (to: (now: T) => T) => void) => ReactNode
}) {
  const t = useMessages()
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const shown = items.map((_, i) => i)
  if (topFirst) shown.reverse()
  /** Moves the item at `from` to where the item at `to` is, as the document holds them. */
  const reorder = (from: number, to: number) => {
    if (from === to) return
    onWrite((now) => {
      const next = [...now]
      const [moved] = next.splice(from, 1)
      if (moved === undefined) return now
      next.splice(to, 0, moved)
      return next
    })
  }
  return (
    <>
      {shown.map((i, row) => {
        const item = items[i] as T
        const n = row + 1
        const style: CSSProperties | undefined = over === i && dragging !== null && dragging !== i ? { boxShadow: `inset 0 ${(dragging < i) === topFirst ? -2 : 2}px 0 var(--accent)` } : undefined
        return (
          // Paints have no ids; their place in the list is what they are.
          <div
            key={i}
            className="flex items-center gap-1 rounded-row"
            style={style}
            data-item={`${field}-${i}`}
            data-row={n}
            draggable={topFirst}
            onDragStart={(e) => {
              setDragging(i)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (dragging === null) return
              e.preventDefault()
              setOver(i)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragging !== null) reorder(dragging, i)
              setDragging(null)
              setOver(null)
            }}
            onDragEnd={() => {
              setDragging(null)
              setOver(null)
            }}
          >
            {topFirst && (
              <button
                type="button"
                aria-label={format(t.editor.props.moveRow, { n })}
                title={t.editor.props.moveHint}
                data-testid="row-grip"
                onKeyDown={(e) => {
                  // Up moves a row towards the top coat, which is the end of the list.
                  const to = e.key === 'ArrowUp' ? i + 1 : e.key === 'ArrowDown' ? i - 1 : null
                  if (to === null) return
                  e.preventDefault()
                  e.stopPropagation()
                  if (to >= 0 && to < items.length) reorder(i, to)
                }}
                className={cn('grid w-4 shrink-0 cursor-grab place-items-center self-stretch text-subtle hover:text-text active:cursor-grabbing', FOCUS_RING)}
              >
                <DotsSixVerticalIcon size={14} weight="bold" aria-hidden />
              </button>
            )}
            {render(item, n, (to) => onWrite((now) => now.map((x, j) => (j === i ? to(x) : x))))}
            <RemoveButton label={removeLabel(n)} onClick={() => onWrite((now) => now.filter((_, j) => j !== i))} />
          </div>
        )
      })}
    </>
  )
}

/** Takes one item out of a list the cards edit. */
export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={ICON_BUTTON}>
      <MinusIcon size={14} aria-hidden />
    </button>
  )
}

/** Adds an item to a list the cards edit. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={ICON_BUTTON}>
      <PlusIcon size={14} aria-hidden />
    </button>
  )
}
