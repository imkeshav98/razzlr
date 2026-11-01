'use client'

// The selection's property cards (#60): the shape's own settings (#151), position and size,
// appearance, fill, stroke, effects, text and auto layout, for one layer or several. A value the selected layers don't share shows as
// mixed; setting it gives them all the same one, and scrubbing or the arrow keys move each from its
// own. With more than one format the changes go to every format or to this one only. Each change
// is one undo step, and a scrub, however long, is one too.
import { MinusIcon, PlusIcon } from '@phosphor-icons/react'
import type { Editor } from '@razzlr/editor'
import { BlendMode, ContainerBlendMode, ImageFilter, LineEnd, type Design, type Effect, type ImageAdjust, type Paint, type Shape } from '@razzlr/schema'
import { useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format, type Messages } from '../../lib/i18n/index.ts'
import { CARD, CardHeader, FineTune } from './card.tsx'
import { ICON_BUTTON } from './formats-panel.tsx'
import { useLiveDesign } from './use-live-design.ts'

type Props = Readonly<Record<string, unknown>>
type Patch = Record<string, unknown>
type P = Messages['editor']['props']

const FIELD = 'h-7 min-w-0 w-full rounded-row border border-line bg-surface px-1.5 font-mono text-[12px] tabular-nums text-text outline-none placeholder:text-subtle focus:border-accent'
const SELECT = 'h-7 min-w-0 w-full rounded-row border border-line bg-surface px-1 text-[12px] text-text outline-none focus:border-accent'
const NEW_FILL: Paint = { type: 'solid', color: '#D9D9D9FF' }
const NEW_STROKE = { paint: { type: 'solid', color: '#1A1420FF' } as Paint, width: 2, align: 'center' as const }

/** What the cards act on: the layers, the frame they are shown in, and where changes go. */
interface Target {
  editor: Editor
  ids: string[]
  pageId: string
  formatId: string
  everyFormat: boolean
  /** Each layer's values in the frame: its own, with its format's overrides on top. */
  props: Props[]
  types: string[]
  /** The layers' names, for a card's note. */
  names: string[]
}

const set = (target: Target, to: (now: Props, i: number) => Patch | null) => {
  const index = new Map(target.ids.map((id, i) => [id, i]))
  return target.editor.setProps(target.ids, (id, now) => to(now, index.get(id) ?? 0), target.everyFormat, target.pageId, target.formatId)
}

/** The one value every layer has, or 'mixed'. */
function shared<T>(values: T[]): T | 'mixed' {
  const [first] = values
  const same = values.every((v) => JSON.stringify(v) === JSON.stringify(first))
  return same ? first as T : 'mixed'
}

const clamp = (n: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => Math.min(max, Math.max(min, n))
const tidy = (n: number) => Math.round(n * 100) / 100

/**
 * A number: type it and press Enter, nudge it with the arrow keys (Shift for 10), or drag its label
 * sideways to scrub it, one undo step for the whole drag.
 */
function NumberField({ label, name, value, step = 1, min, max, scale = 1, placeholder, editor, onSet, onShift }: {
  label: string
  name: string
  value: number | 'mixed' | undefined
  step?: number
  min?: number | undefined
  max?: number | undefined
  /** Shown as the value times this, such as 100 for a percentage. */
  scale?: number
  placeholder?: string
  editor: Editor
  onSet: (value: number) => void
  onShift: (by: number) => void
}) {
  const t = useMessages()
  const id = useId()
  const shown = value === undefined || value === 'mixed' ? '' : String(tidy(value * scale))
  const [draft, setDraft] = useState<string | null>(null)
  const scrub = useRef<{ x: number; applied: number; end: () => void } | null>(null)
  const commit = (text: string) => {
    setDraft(null)
    const n = Number.parseFloat(text.replace(',', '.'))
    if (Number.isFinite(n) && text.trim() !== shown) onSet(clamp(n / scale, min, max))
  }
  return (
    <div className="flex min-w-0 items-center gap-1">
      <label
        htmlFor={id}
        title={format(t.editor.props.scrub, { name })}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          scrub.current = { x: event.clientX, applied: 0, end: editor.beginGesture() }
        }}
        onPointerMove={(event) => {
          const s = scrub.current
          if (!s) return
          const by = Math.round((event.clientX - s.x) / 2) * step * (event.shiftKey ? 10 : 1)
          if (by === s.applied) return
          onShift((by - s.applied) / scale)
          s.applied = by
        }}
        onPointerUp={() => {
          scrub.current?.end()
          scrub.current = null
        }}
        onPointerCancel={() => {
          scrub.current?.end()
          scrub.current = null
        }}
        data-scrub={name}
        className="w-5 shrink-0 cursor-ew-resize text-center text-[11px] font-medium text-subtle select-none hover:text-text"
      >
        {label}
      </label>
      <input
        id={id}
        aria-label={name}
        inputMode="decimal"
        value={draft ?? shown}
        placeholder={value === 'mixed' ? t.editor.props.mixed : placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => draft !== null && commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget.value)
          else if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            setDraft(null)
            onShift(((event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1)) / scale)
          } else return
          // Keys typed into a field are the field's, not the stage's.
          event.stopPropagation()
        }}
        className={FIELD}
      />
    </div>
  )
}

/** A colour: a swatch that opens the system picker, the hex, and its opacity as a percentage. */
function ColorField({ name, value, onSet }: { name: string; value: string | 'mixed' | undefined; onSet: (color: string) => void }) {
  const t = useMessages()
  const p = t.editor.props
  const hex = value && value !== 'mixed' ? value.slice(0, 7).toUpperCase() : ''
  const alpha = value && value !== 'mixed' ? Number.parseInt(value.slice(7, 9) || 'FF', 16) / 255 : undefined
  const [draft, setDraft] = useState<string | null>(null)
  const commitHex = (text: string) => {
    setDraft(null)
    const h = (text.startsWith('#') ? text : `#${text}`).toUpperCase()
    if (/^#[0-9A-F]{6}$/.test(h) && h !== hex) onSet(`${h}${value && value !== 'mixed' ? value.slice(7, 9) || 'FF' : 'FF'}`)
  }
  const withAlpha = (a: number) => `${hex || '#000000'}${Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0').toUpperCase()}`
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <input
        name="colour"
        type="color"
        aria-label={format(p.colourOf, { name })}
        value={hex || '#000000'}
        onChange={(event) => onSet(`${event.target.value.toUpperCase()}${value && value !== 'mixed' ? value.slice(7, 9) || 'FF' : 'FF'}`)}
        className="size-7 shrink-0 cursor-pointer rounded-row border border-line bg-surface p-0.5"
      />
      <input
        name="colour-hex"
        aria-label={format(p.hexOf, { name })}
        value={draft ?? hex}
        placeholder={value === 'mixed' ? p.mixed : ''}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => draft !== null && commitHex(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitHex(event.currentTarget.value)
          event.stopPropagation()
        }}
        className={cn(FIELD, 'uppercase')}
      />
      <input
        name="colour-opacity"
        aria-label={format(p.alpha, { name })}
        inputMode="numeric"
        key={alpha ?? 'mixed'}
        defaultValue={alpha === undefined ? '' : String(Math.round(alpha * 100))}
        placeholder={value === 'mixed' ? '–' : ''}
        onBlur={(event) => {
          const n = Number.parseFloat(event.target.value)
          if (Number.isFinite(n) && hex && Math.round(n) !== Math.round((alpha ?? 1) * 100)) onSet(withAlpha(n / 100))
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          event.stopPropagation()
        }}
        className={cn(FIELD, 'w-11 shrink-0 text-end')}
      />
    </div>
  )
}

function Choice<T extends string>({ name, value, options, labels, onSet }: { name: string; value: T | 'mixed' | undefined; options: readonly T[]; labels: Record<T, string>; onSet: (value: T) => void }) {
  const t = useMessages()
  return (
    <select name="choice" aria-label={name} value={value ?? ''} onChange={(event) => onSet(event.target.value as T)} className={SELECT}>
      {(value === 'mixed' || value === undefined) && <option value="mixed" disabled>{t.editor.props.mixed}</option>}
      {options.map((option) => <option key={option} value={option}>{labels[option]}</option>)}
    </select>
  )
}

function Card({ id, title, note, action, children }: { id: string; title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={CARD} data-testid={id}>
      <CardHeader id={`${id}-title`} title={title} note={note}>{action}</CardHeader>
      <div className="flex flex-col gap-2.5 px-[18px] pb-4 empty:hidden">{children}</div>
    </section>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={ICON_BUTTON}>
      <PlusIcon size={14} aria-hidden />
    </button>
  )
}
function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={ICON_BUTTON}>
      <MinusIcon size={14} aria-hidden />
    </button>
  )
}

const num = (props: Props, key: string) => props[key] as number

function LayoutCard({ target, p }: { target: Target; p: P }) {
  const fields = [
    { key: 'x', label: p.x, name: p.xName },
    { key: 'y', label: p.y, name: p.yName },
    { key: 'width', label: p.width, name: p.widthName, min: 0 },
    { key: 'height', label: p.height, name: p.heightName, min: 0 },
  ] as const
  // A group's box follows what it holds; its size and turn come from them.
  const sized = target.types.every((type) => type !== 'group' && type !== 'boolean')
  return (
    <Card id="layout-card" title={p.layout}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {fields.map((f) => (
          (f.key === 'width' || f.key === 'height') && !sized
            ? null
            : (
              <NumberField
                key={f.key}
                label={f.label}
                name={f.name}
                value={shared(target.props.map((pr) => num(pr, f.key)))}
                min={'min' in f ? f.min : undefined}
                editor={target.editor}
                onSet={(v) => set(target, () => ({ [f.key]: v }))}
                onShift={(by) => set(target, (now) => ({ [f.key]: tidy(clamp(num(now, f.key) + by, 'min' in f ? f.min : undefined)) }))}
              />
            )
        ))}
        {sized && (
          <NumberField
            label="°"
            name={p.rotationName}
            value={shared(target.props.map((pr) => num(pr, 'rotation') ?? 0))}
            editor={target.editor}
            onSet={(v) => set(target, () => ({ rotation: tidy(((v % 360) + 360) % 360) }))}
            onShift={(by) => set(target, (now) => ({ rotation: tidy((((num(now, 'rotation') ?? 0) + by) % 360 + 360) % 360) }))}
          />
        )}
      </div>
    </Card>
  )
}

function AppearanceCard({ target, p }: { target: Target; p: P }) {
  const containers = target.types.every((type) => type === 'group' || type === 'frame')
  const modes = containers ? ContainerBlendMode.options : BlendMode.options
  return (
    <Card id="appearance-card" title={p.appearance}>
      <div className="grid grid-cols-2 gap-x-3">
        <NumberField
          label="%"
          name={p.opacity}
          value={shared(target.props.map((pr) => num(pr, 'opacity') ?? 1))}
          scale={100}
          min={0}
          max={1}
          editor={target.editor}
          onSet={(v) => set(target, () => ({ opacity: tidy(v) }))}
          onShift={(by) => set(target, (now) => ({ opacity: tidy(clamp((num(now, 'opacity') ?? 1) + by, 0, 1)) }))}
        />
        <Choice
          name={p.blend}
          value={shared(target.props.map((pr) => pr.blendMode as string))}
          options={modes as readonly string[]}
          labels={p.blends as Record<string, string>}
          onSet={(mode) => set(target, () => ({ blendMode: mode }))}
        />
      </div>
    </Card>
  )
}

type ShapeKind = 'rect' | 'polygon' | 'star' | 'line'
/** The corners as the shape stores them, from the top left clockwise. */
const CORNERS = ['tl', 'tr', 'br', 'bl'] as const
/**
 * The order the fields sit in, two by two as the corners do: top left, top right, bottom left,
 * bottom right. They keep left to right in either direction, as the ad does.
 */
const CORNER_FIELDS = [0, 1, 3, 2] as const

/**
 * A shape's own settings (#151), for layers that are all the same kind: a rectangle's corner radius
 * or each corner's own, a polygon's sides, a star's points and inner radius, a line's ends.
 */
function ShapeCard({ target, p, kind }: { target: Target; p: P; kind: ShapeKind }) {
  const shapes = target.props.map((pr) => pr.shape as Shape)
  const value = (key: string) => shared(shapes.map((s) => (s as Record<string, unknown>)[key])) as number | string | 'mixed' | undefined
  const setShape = (change: (now: Record<string, unknown>) => Record<string, unknown>) =>
    set(target, (now) => ({ shape: { ...(now.shape as Record<string, unknown>), ...change(now.shape as Record<string, unknown>) } }))
  const field = (key: string, label: string, name: string, { min = 0, max, whole = false, scale = 1 }: { min?: number; max?: number; whole?: boolean; scale?: number } = {}) => {
    const fit = (n: number) => clamp(whole ? Math.round(n) : tidy(n), min, max)
    return (
      <NumberField
        label={label}
        name={name}
        value={value(key) as number | 'mixed' | undefined}
        min={min}
        max={max}
        scale={scale}
        step={scale === 1 ? 1 : 1 / scale}
        editor={target.editor}
        onSet={(v) => setShape(() => ({ [key]: fit(v) }))}
        onShift={(by) => setShape((now) => ({ [key]: fit(((now[key] as number | undefined) ?? 0) + by) }))}
      />
    )
  }
  // A rectangle with each corner's own radius keeps them in its corners; one radius for all drops them.
  const each = kind === 'rect' && shapes.every((s) => s.kind === 'rect' && s.corners)
  const eachCorner = (on: boolean) => set(target, (now) => {
    const { corners, ...rest } = now.shape as Record<string, unknown>
    const r = (rest.cornerRadius as number | undefined) ?? 0
    return { shape: on ? { ...rest, corners: [r, r, r, r] } : { ...rest, cornerRadius: (corners as number[] | undefined)?.[0] ?? r } }
  })
  const setCorner = (i: number, to: (r: number) => number) => setShape((now) => {
    const corners = [...((now.corners as number[] | undefined) ?? [0, 0, 0, 0])]
    corners[i] = tidy(Math.max(0, to(corners[i] ?? 0)))
    return { corners }
  })
  return (
    <Card id="shape-card" title={p.shapeKinds[kind]} note={target.names.join(', ')}>
      {kind === 'line'
        ? (
          <div className="grid grid-cols-2 gap-x-3">
            {(['start', 'end'] as const).map((end) => (
              <Choice
                key={end}
                name={p.lineEnd[end]}
                value={value(end) as LineEnd | 'mixed' | undefined}
                options={LineEnd.options}
                labels={p.lineEnds}
                onSet={(v) => setShape(() => ({ [end]: v }))}
              />
            ))}
          </div>
        )
        : (
          <div dir={each ? 'ltr' : undefined} className="grid grid-cols-2 gap-x-3 gap-y-2">
            {kind === 'polygon' && field('sides', '#', p.sides, { min: 3, max: 100, whole: true })}
            {kind === 'star' && field('points', '★', p.points, { min: 3, max: 100, whole: true })}
            {kind === 'star' && field('innerRadius', '%', p.innerRadius, { max: 1, scale: 100 })}
            {!each && field('cornerRadius', '◜', p.cornerRadius)}
            {each && CORNER_FIELDS.map((i) => CORNERS[i]).map((corner, n) => {
              const i = CORNER_FIELDS[n] ?? 0
              return (
              <NumberField
                key={corner}
                label={p.cornersShort[corner]}
                name={p.corners[corner]}
                value={shared(shapes.map((s) => (s.kind === 'rect' ? s.corners?.[i] : undefined)))}
                min={0}
                editor={target.editor}
                onSet={(v) => setCorner(i, () => v)}
                onShift={(by) => setCorner(i, (r) => r + by)}
              />
              )
            })}
          </div>
        )}
      {kind === 'rect' && (
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" name="each-corner" checked={each} onChange={(event) => eachCorner(event.target.checked)} />
          {p.eachCorner}
        </label>
      )}
    </Card>
  )
}

/** A list of paints, strokes or effects that every selected layer has the same of, or a way to make it so. */
function ListCard<T>({ id, title, p, target, field, fresh, render }: {
  id: string
  title: string
  p: P
  target: Target
  field: string
  fresh: T
  /** `change` takes the item as the document holds it when the change is made, not as last drawn. */
  render: (item: T, i: number, change: (to: (now: T) => T) => void) => ReactNode
}) {
  const lists = target.props.map((pr) => (pr[field] ?? []) as T[])
  const list = shared(lists)
  const write = (to: (now: T[]) => T[]) => set(target, (now) => ({ [field]: to((now[field] ?? []) as T[]) }))
  return (
    <Card id={id} title={title} action={<AddButton label={format(p.add, { name: title.toLowerCase() })} onClick={() => write((now) => [...(list === 'mixed' ? [] : now), fresh])} />}>
      {list === 'mixed'
        ? (
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            {p.mixedList}
            <button type="button" onClick={() => write(() => [fresh])} className="cursor-pointer font-medium text-accent-text hover:underline">{p.useOne}</button>
          </div>
        )
        : list.map((item, i) => (
          // Paints have no ids; their place in the list is what they are.
          <div key={i} className="flex items-center gap-1" data-item={`${field}-${i}`}>
            {render(item, i, (to) => write((now) => now.map((x, j) => (j === i ? to(x) : x))))}
            <RemoveButton label={format(p.remove, { name: title.toLowerCase(), n: i + 1 })} onClick={() => write((now) => now.filter((_, j) => j !== i))} />
          </div>
        ))}
    </Card>
  )
}

function PaintRow({ paint, name, p, onSet }: { paint: Paint; name: string; p: P; onSet: (paint: Paint) => void }) {
  if (paint.type !== 'solid') return <span className="min-w-0 flex-1 truncate text-xs text-muted">{p.paint[paint.type]}</span>
  return <ColorField name={name} value={paint.color} onSet={(color) => onSet({ type: 'solid', color })} />
}

type Stroke = {
  paint: Paint
  width: number
  align: 'inside' | 'center' | 'outside'
  dashes?: number[]
  dashOffset?: number
  cap?: 'butt' | 'round' | 'square'
  join?: 'miter' | 'round' | 'bevel'
}

/** Dash and gap lengths as typed, "8 4", or null when they aren't a pattern; nothing typed is solid. */
function parseDashes(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean)
  const lengths = parts.map((part) => Number.parseFloat(part))
  if (lengths.some((n) => !Number.isFinite(n) || n < 0)) return null
  if (lengths.length > 0 && !lengths.some((n) => n > 0)) return null
  return lengths.map(tidy)
}

/** A stroke's dash pattern, typed as lengths: dash, gap, dash and so on. */
function DashField({ name, value, onSet }: { name: string; value: number[]; onSet: (dashes: number[]) => void }) {
  const t = useMessages()
  const shown = value.join(' ')
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (text: string) => {
    setDraft(null)
    const dashes = parseDashes(text)
    if (dashes && dashes.join(' ') !== shown) onSet(dashes)
  }
  return (
    <input
      name="dashes"
      aria-label={name}
      title={t.editor.props.dashesHint}
      value={draft ?? shown}
      placeholder={t.editor.props.solid}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => draft !== null && commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit(event.currentTarget.value)
        else if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
        event.stopPropagation()
      }}
      className={FIELD}
    />
  )
}

/** One stroke: its colour, width and position, then its dashes and the look of its ends and corners (#152). */
function StrokeRow({ stroke, i, p, editor, onSet }: { stroke: Stroke; i: number; p: P; editor: Editor; onSet: (to: (now: Stroke) => Stroke) => void }) {
  const n = { n: i + 1 }
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <PaintRow paint={stroke.paint} name={format(p.colour, n)} p={p} onSet={(paint) => onSet((now) => ({ ...now, paint }))} />
      <div className="grid grid-cols-2 gap-1">
        <NumberField label="W" name={format(p.strokeWidth, n)} value={stroke.width} min={0.5} step={0.5} editor={editor} onSet={(width) => onSet((now) => ({ ...now, width }))} onShift={(by) => onSet((now) => ({ ...now, width: tidy(clamp(now.width + by, 0.5)) }))} />
        <Choice name={format(p.strokeAlign, n)} value={stroke.align} options={['inside', 'center', 'outside'] as const} labels={p.aligns} onSet={(align) => onSet((now) => ({ ...now, align }))} />
        <DashField name={format(p.strokeDashes, n)} value={stroke.dashes ?? []} onSet={(dashes) => onSet((now) => ({ ...now, dashes }))} />
        <NumberField
          label="⇥"
          name={format(p.strokeDashOffset, n)}
          value={stroke.dashOffset ?? 0}
          editor={editor}
          onSet={(dashOffset) => onSet((now) => ({ ...now, dashOffset }))}
          onShift={(by) => onSet((now) => ({ ...now, dashOffset: tidy((now.dashOffset ?? 0) + by) }))}
        />
        <Choice name={format(p.strokeCap, n)} value={stroke.cap ?? 'butt'} options={['butt', 'round', 'square'] as const} labels={p.caps} onSet={(cap) => onSet((now) => ({ ...now, cap }))} />
        <Choice name={format(p.strokeJoin, n)} value={stroke.join ?? 'miter'} options={['miter', 'round', 'bevel'] as const} labels={p.joins} onSet={(join) => onSet((now) => ({ ...now, join }))} />
      </div>
    </div>
  )
}

const EFFECT_FIELDS = { dropShadow: ['x', 'y', 'blur', 'spread'], innerShadow: ['x', 'y', 'blur', 'spread'], glow: ['blur', 'spread'], layerBlur: ['radius'], backgroundBlur: ['radius'] } as const
const NEW_EFFECT: Record<Effect['type'], Effect> = {
  dropShadow: { type: 'dropShadow', x: 0, y: 8, blur: 24, spread: 0, color: '#00000040' },
  innerShadow: { type: 'innerShadow', x: 0, y: 4, blur: 12, spread: 0, color: '#00000040' },
  glow: { type: 'glow', blur: 24, spread: 0, color: '#FF48B080' },
  layerBlur: { type: 'layerBlur', radius: 8 },
  backgroundBlur: { type: 'backgroundBlur', radius: 16 },
}

function EffectsCard({ target, p }: { target: Target; p: P }) {
  const lists = target.props.map((pr) => (pr.effects ?? []) as Effect[])
  const list = shared(lists)
  const write = (to: (now: Effect[]) => Effect[]) => set(target, (now) => ({ effects: to((now.effects ?? []) as Effect[]) }))
  return (
    <Card
      id="effects-card"
      title={p.effects}
      action={(
        <select
          name="add-effect"
          aria-label={p.addEffect}
          value=""
          onChange={(event) => {
            const fresh = NEW_EFFECT[event.target.value as Effect['type']]
            write((now) => [...(list === 'mixed' ? [] : now), fresh])
          }}
          className="h-7 w-28 cursor-pointer rounded-full border border-line bg-bg/40 px-2 text-[12px] font-semibold text-muted hover:border-line-strong focus:border-accent focus:outline-none"
        >
          <option value="" disabled>{p.addEffect}</option>
          {Object.keys(NEW_EFFECT).map((type) => <option key={type} value={type}>{p.effect[type as Effect['type']]}</option>)}
        </select>
      )}
    >
      {list === 'mixed'
        ? (
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            {p.mixedList}
            <button type="button" onClick={() => write(() => [])} className="cursor-pointer font-medium text-accent-text hover:underline">{p.useOne}</button>
          </div>
        )
        : list.map((effect, i) => {
          const change = (to: (now: Effect) => Effect) => write((now) => now.map((x, j) => (j === i ? to(x) : x)))
          const effectName = p.effect[effect.type]
          return (
            <div key={i} className="flex flex-col gap-1.5 border-t border-line pt-2.5 first:border-t-0 first:pt-0" data-item={`effects-${i}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text">{effectName}</span>
                <RemoveButton label={format(p.remove, { name: effectName.toLowerCase(), n: i + 1 })} onClick={() => write((now) => now.filter((_, j) => j !== i))} />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {EFFECT_FIELDS[effect.type].map((field) => {
                  const value = (effect as unknown as Record<string, number>)[field] ?? 0
                  const min = field === 'x' || field === 'y' || (field === 'spread' && effect.type === 'dropShadow') ? undefined : 0
                  return (
                    <NumberField
                      key={field}
                      label={p.effectField[field].charAt(0)}
                      name={format(p.effectFieldName, { effect: effectName, n: i + 1, field: p.effectField[field] })}
                      value={value}
                      min={min}
                      editor={target.editor}
                      onSet={(v) => change((now) => ({ ...now, [field]: v }) as Effect)}
                      onShift={(by) => change((now) => ({ ...now, [field]: tidy(clamp(((now as unknown as Record<string, number>)[field] ?? 0) + by, min)) }) as Effect)}
                    />
                  )
                })}
              </div>
              {'color' in effect && <ColorField name={effectName} value={effect.color} onSet={(color) => change((now) => ({ ...now, color }) as Effect)} />}
            </div>
          )
        })}
    </Card>
  )
}

type Style = Record<string, unknown> & { fontSize: number; color: string; letterSpacing?: number; lineHeight?: number; textCase?: string }

function TextCard({ target, p }: { target: Target; p: P }) {
  const styles = target.props.map((pr) => pr.style as Style)
  const style = (key: string) => shared(styles.map((s) => s[key]))
  const setStyle = (key: string, value: unknown) => set(target, (now) => ({ style: { ...(now.style as Style), [key]: value } }))
  const shiftStyle = (key: string, by: number, min?: number, from = 0) =>
    set(target, (now) => {
      const s = now.style as Style
      return { style: { ...s, [key]: tidy(clamp(((s[key] as number | undefined) ?? from) + by, min)) } }
    })
  return (
    <Card id="text-card" title={p.text} note={target.names.join(', ')}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <NumberField label="Aa" name={p.fontSize} value={style('fontSize') as number | 'mixed'} min={1} editor={target.editor} onSet={(v) => setStyle('fontSize', v)} onShift={(by) => shiftStyle('fontSize', by, 1)} />
        <NumberField
          label="↕"
          name={p.lineHeight}
          value={style('lineHeight') as number | 'mixed' | undefined}
          step={0.05}
          min={0.5}
          placeholder={p.lineHeightAuto}
          editor={target.editor}
          onSet={(v) => setStyle('lineHeight', v)}
          onShift={(by) => shiftStyle('lineHeight', by, 0.5, 1.2)}
        />
        <NumberField label="↔" name={p.letterSpacing} value={(style('letterSpacing') ?? 0) as number | 'mixed'} step={0.1} editor={target.editor} onSet={(v) => setStyle('letterSpacing', v)} onShift={(by) => shiftStyle('letterSpacing', by)} />
        <Choice name={p.textCase} value={(style('textCase') ?? 'none') as string} options={['none', 'upper', 'lower', 'title']} labels={p.textCases} onSet={(v) => setStyle('textCase', v)} />
      </div>
      <ColorField name={p.textColour} value={style('color') as string | 'mixed'} onSet={(color) => setStyle('color', color)} />
      <div className="grid grid-cols-2 gap-x-3">
        <Choice
          name={p.textAlign}
          value={shared(target.props.map((pr) => (pr.align ?? 'start') as string))}
          options={['start', 'center', 'end', 'justify']}
          labels={p.textAligns}
          onSet={(align) => set(target, () => ({ align }))}
        />
        <Choice
          name={p.verticalAlign}
          value={shared(target.props.map((pr) => (pr.verticalAlign ?? 'top') as string))}
          options={['top', 'middle', 'bottom']}
          labels={p.verticalAligns}
          onSet={(verticalAlign) => set(target, () => ({ verticalAlign }))}
        />
      </div>
    </Card>
  )
}

type Toggle = { name: string; label: string; on: boolean | 'mixed'; onSet: (on: boolean) => void }

/** Buttons that each turn something on or off, such as underline; pressed while it is on. */
function Toggles({ items }: { items: Toggle[] }) {
  return (
    <div className="flex gap-1">
      {items.map((item) => (
        <button
          key={item.name}
          type="button"
          aria-label={item.name}
          title={item.name}
          aria-pressed={item.on === 'mixed' ? 'mixed' : item.on}
          onClick={() => item.onSet(item.on !== true)}
          className="h-7 min-w-8 cursor-pointer rounded-row border border-line px-2 text-[12px] text-muted hover:bg-hover aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-text"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The text's box and paragraphs (#153): how the box sizes, lines shown at most, shrinking to fit,
 * paragraph spacing, lists, underline and strikethrough, and an outline along the glyphs.
 */
function ParagraphCard({ target, p }: { target: Target; p: P }) {
  const value = (key: string) => shared(target.props.map((pr) => pr[key])) as unknown
  const styles = target.props.map((pr) => pr.style as Style)
  const style = (key: string) => shared(styles.map((s) => s[key]))
  const setStyle = (change: (now: Style) => Record<string, unknown>) => set(target, (now) => ({ style: { ...(now.style as Style), ...change(now.style as Style) } }))
  const flag = (key: string) => {
    const on = style(key)
    return on === 'mixed' ? 'mixed' : on === true
  }
  const shrink = value('shrinkToFit') as { min: number; max: number } | undefined | 'mixed'
  const outline = style('outline') as { width: number; color: string } | undefined | 'mixed'
  const outlined = outline === 'mixed' || (outline !== undefined && outline.width > 0)
  return (
    <Card id="paragraph-card" title={p.paragraph}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Choice name={p.boxMode} value={value('boxMode') as BoxMode | 'mixed' | undefined ?? 'autoHeight'} options={['autoWidth', 'autoHeight', 'fixed'] as const} labels={p.boxModes} onSet={(boxMode) => set(target, () => ({ boxMode }))} />
        <Choice name={p.list} value={(value('list') ?? 'none') as 'none' | 'bullet' | 'number' | 'mixed'} options={['none', 'bullet', 'number'] as const} labels={p.lists} onSet={(list) => set(target, () => ({ list: list === 'none' ? undefined : list }))} />
        <NumberField
          label="≡"
          name={p.maxLines}
          value={value('maxLines') as number | 'mixed' | undefined}
          min={0}
          placeholder={p.noLimit}
          editor={target.editor}
          // 0 lifts the limit.
          onSet={(v) => set(target, () => ({ maxLines: Math.round(v) >= 1 ? Math.round(v) : undefined }))}
          onShift={(by) => set(target, (now) => {
            const next = Math.round(((now.maxLines as number | undefined) ?? 0) + by)
            return { maxLines: next >= 1 ? next : undefined }
          })}
        />
        <NumberField
          label="¶"
          name={p.paragraphSpacing}
          value={(value('paragraphSpacing') ?? 0) as number | 'mixed'}
          min={0}
          editor={target.editor}
          onSet={(v) => set(target, () => ({ paragraphSpacing: v }))}
          onShift={(by) => set(target, (now) => ({ paragraphSpacing: tidy(clamp(((now.paragraphSpacing as number | undefined) ?? 0) + by, 0)) }))}
        />
      </div>
      <Toggles
        items={[
          { name: p.underline, label: 'U', on: flag('underline'), onSet: (on) => setStyle(() => ({ underline: on })) },
          { name: p.strikethrough, label: 'S', on: flag('strikethrough'), onSet: (on) => setStyle(() => ({ strikethrough: on })) },
          { name: p.shrinkToFit, label: p.shrinkToFitShort, on: shrink === 'mixed' ? 'mixed' : shrink !== undefined, onSet: (on) => set(target, (now) => {
            const size = (now.style as Style).fontSize
            return { shrinkToFit: on ? { min: tidy(Math.max(1, size / 2)), max: size } : undefined }
          }) },
          { name: p.outline, label: p.outlineShort, on: outline === 'mixed' ? 'mixed' : outlined, onSet: (on) => setStyle((now) => ({ outline: on ? { width: 2, color: (now.outline as { color?: string } | undefined)?.color ?? '#000000FF' } : undefined })) },
        ]}
      />
      {shrink !== undefined && shrink !== 'mixed' && (
        <div className="grid grid-cols-2 gap-x-3">
          {(['min', 'max'] as const).map((end) => (
            <NumberField
              key={end}
              label={end === 'min' ? '↓' : '↑'}
              name={p.shrinkSize[end]}
              value={shrink[end]}
              min={1}
              editor={target.editor}
              onSet={(v) => set(target, (now) => {
                const was = now.shrinkToFit as { min: number; max: number } | undefined
                if (!was) return null
                const next = { ...was, [end]: v }
                return { shrinkToFit: end === 'min' ? { min: Math.min(next.min, next.max), max: next.max } : { min: next.min, max: Math.max(next.min, next.max) } }
              })}
              onShift={(by) => set(target, (now) => {
                const was = now.shrinkToFit as { min: number; max: number } | undefined
                if (!was) return null
                const v = tidy(Math.max(1, was[end] + by))
                return { shrinkToFit: end === 'min' ? { min: Math.min(v, was.max), max: was.max } : { min: was.min, max: Math.max(v, was.min) } }
              })}
            />
          ))}
        </div>
      )}
      {outlined && outline !== 'mixed' && outline && (
        <div className="flex items-center gap-1">
          <div className="w-20 shrink-0">
            <NumberField
              label="W"
              name={p.outlineWidth}
              value={outline.width}
              min={0}
              step={0.5}
              editor={target.editor}
              onSet={(width) => setStyle((now) => ({ outline: { ...(now.outline as object), width } }))}
              onShift={(by) => setStyle((now) => {
                const was = now.outline as { width: number; color: string } | undefined
                return was ? { outline: { ...was, width: tidy(clamp(was.width + by, 0)) } } : {}
              })}
            />
          </div>
          <ColorField name={p.outline} value={outline.color} onSet={(color) => setStyle((now) => ({ outline: { ...(now.outline as object), color } }))} />
        </div>
      )}
    </Card>
  )
}

type BoxMode = 'autoWidth' | 'autoHeight' | 'fixed'

type ImageFill = Extract<Paint, { type: 'image' }>
const ADJUSTMENTS = ['exposure', 'contrast', 'saturation', 'temperature', 'tint'] as const
/** Each filter's tile: the image's picture with a CSS look near the one the renderer draws. */
const FILTER_LOOK: Record<ImageFilter, string> = {
  none: 'none',
  mono: 'grayscale(1)',
  sepia: 'sepia(0.85)',
  vivid: 'saturate(1.7) contrast(1.1)',
  fade: 'contrast(0.75) brightness(1.12) saturate(0.75)',
  warm: 'sepia(0.3) saturate(1.35) hue-rotate(-12deg)',
  cool: 'saturate(0.9) hue-rotate(18deg) brightness(1.04)',
}

/**
 * An image fill's own settings (#154): its filter as tiles of the picture itself, how it fits the
 * layer, and behind Fine-tune its opacity and adjustments (exposure, contrast, saturation,
 * temperature, tint). It acts on the first image fill the selected layers share.
 */
function ImageCard({ target, p, brandId, index, paint }: { target: Target; p: P; brandId: string; index: number; paint: ImageFill }) {
  const [fine, setFine] = useState(false)
  const setPaint = (change: (now: ImageFill) => Partial<ImageFill>) => set(target, (now) => {
    const fills = (now.fills ?? []) as Paint[]
    const at = fills[index]
    if (at?.type !== 'image') return null
    return { fills: fills.map((f, i) => (i === index ? { ...at, ...change(at) } : f)) }
  })
  const setAdjust = (key: keyof ImageAdjust, to: (n: number) => number) => setPaint((now) => {
    const adjust = { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, ...now.adjust }
    return { adjust: { ...adjust, [key]: Math.round(clamp(to(adjust[key]), -100, 100)) } }
  })
  const picture = `/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(paint.assetId)}/thumbnail`
  const filter = paint.filter ?? 'none'
  return (
    <section aria-labelledby="image-card-title" className={CARD} data-testid="image-card">
      <CardHeader id="image-card-title" title={p.image} note={target.names.join(', ')} />
      <div className="flex flex-col gap-3 px-[18px] pb-3">
        <div role="radiogroup" aria-label={p.filter} className="grid grid-cols-4 gap-1.5">
          {ImageFilter.options.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={filter === name}
              onClick={() => setPaint(() => ({ filter: name === 'none' ? undefined : name }))}
              className="group flex min-w-0 cursor-pointer flex-col items-center gap-1 text-[10px] font-semibold text-muted aria-checked:text-text"
            >
              <span className="block aspect-square w-full overflow-hidden rounded-[8px] border border-line group-aria-checked:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--accent)]">
                <img src={picture} alt="" draggable={false} loading="lazy" style={{ filter: FILTER_LOOK[name] }} className="size-full object-cover" />
              </span>
              <span className="w-full truncate text-center">{p.filters[name]}</span>
            </button>
          ))}
        </div>
        <Choice name={p.fit} value={paint.fit} options={['fill', 'fit', 'crop', 'tile'] as const} labels={p.fits} onSet={(fit) => setPaint(() => ({ fit }))} />
      </div>
      <FineTune open={fine} onToggle={() => setFine(!fine)} label={p.fineTune} />
      {fine && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-[18px] pb-4">
          <NumberField
            label="%"
            name={p.imageOpacity}
            value={paint.opacity}
            scale={100}
            min={0}
            max={1}
            editor={target.editor}
            onSet={(v) => setPaint(() => ({ opacity: tidy(v) }))}
            onShift={(by) => setPaint((now) => ({ opacity: tidy(clamp(now.opacity + by, 0, 1)) }))}
          />
          {ADJUSTMENTS.map((key) => (
            <NumberField
              key={key}
              label={p.adjustShort[key]}
              name={p.adjust[key]}
              value={paint.adjust?.[key] ?? 0}
              min={-100}
              max={100}
              editor={target.editor}
              onSet={(v) => setAdjust(key, () => v)}
              onShift={(by) => setAdjust(key, (n) => n + by)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

type Layout = { direction: 'row' | 'column'; gap: number; padding: Record<'top' | 'right' | 'bottom' | 'left', number>; justify: string; align: string; wrap: boolean; lineGap: number }

function AutoLayoutCard({ target, p }: { target: Target; p: P }) {
  const layouts = target.props.map((pr) => pr.layout as Layout | undefined)
  if (layouts.some((l) => !l)) {
    return (
      <Card id="auto-layout-card" title={p.autoLayout}>
        <button type="button" onClick={() => target.editor.perform('autoLayout')} className="h-8 cursor-pointer rounded-row border border-line text-[12px] font-medium hover:bg-hover">
          {p.addAutoLayout}
        </button>
      </Card>
    )
  }
  const value = (key: keyof Layout) => shared(layouts.map((l) => l?.[key]))
  const setLayout = (change: (l: Layout) => Partial<Layout>) => set(target, (now) => {
    const l = now.layout as Layout
    return { layout: { ...l, ...change(l) } }
  })
  return (
    <Card id="auto-layout-card" title={p.autoLayout}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Choice name={p.direction} value={value('direction') as Layout['direction'] | 'mixed'} options={['row', 'column'] as const} labels={p.directions} onSet={(direction) => setLayout(() => ({ direction }))} />
        <NumberField label="↔" name={p.gap} value={value('gap') as number | 'mixed'} editor={target.editor} onSet={(gap) => setLayout(() => ({ gap }))} onShift={(by) => setLayout((l) => ({ gap: tidy(l.gap + by) }))} />
        {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <NumberField
            key={side}
            label={p.paddingShort[side]}
            name={p.padding[side]}
            value={shared(layouts.map((l) => l?.padding[side] ?? 0))}
            editor={target.editor}
            onSet={(v) => setLayout((l) => ({ padding: { ...l.padding, [side]: v } }))}
            onShift={(by) => setLayout((l) => ({ padding: { ...l.padding, [side]: tidy(l.padding[side] + by) } }))}
          />
        ))}
        <Choice name={p.justify} value={value('justify') as string} options={['start', 'center', 'end', 'space-between']} labels={p.justifies} onSet={(justify) => setLayout(() => ({ justify }))} />
        <Choice name={p.alignItems} value={value('align') as string} options={['start', 'center', 'end']} labels={p.alignItemsOptions} onSet={(align) => setLayout(() => ({ align }))} />
      </div>
      <label className="flex items-center gap-2 text-[12px]">
        <input name="wrap" type="checkbox" checked={value('wrap') === true} onChange={(event) => setLayout(() => ({ wrap: event.target.checked }))} />
        {p.wrap}
      </label>
    </Card>
  )
}

/** Where changes go when a design has more than one format: the one shown (as a canvas drag does), or every format. */
function ScopeSwitch({ everyFormat, onChange, p }: { everyFormat: boolean; onChange: (every: boolean) => void; p: P }) {
  return (
    <section aria-label={p.applyTo} className={cn(CARD, 'p-1.5')} data-testid="scope-card">
      <div role="radiogroup" aria-label={p.applyTo} className="grid grid-cols-2 gap-1">
        {([false, true] as const).map((every) => (
          <button
            key={String(every)}
            type="button"
            role="radio"
            aria-checked={everyFormat === every}
            onClick={() => onChange(every)}
            className={cn('h-7 cursor-pointer rounded-row text-[12px] font-medium', everyFormat === every ? 'bg-accent-solid text-on-accent' : 'text-muted hover:bg-hover')}
          >
            {every ? p.everyFormat : p.thisFormat}
          </button>
        ))}
      </div>
      {everyFormat && <p className="px-1.5 pt-1.5 text-[11px] leading-snug text-subtle">{p.everyFormatHint}</p>}
    </section>
  )
}

/**
 * The selection's cards, after the font: the look first, then Arrange (first of all for several
 * layers, as the mock's "3 selected"), then position, size and the rest.
 */
export function SelectionCards({ editor, brandId, ids, arrange }: { editor: Editor; brandId: string; ids: string[]; arrange: ReactNode }) {
  const t = useMessages()
  const p = t.editor.props
  const { design } = useLiveDesign(editor)
  // Like a drag on the canvas, a change goes to the format shown unless every format is asked for.
  const [everyFormat, setEveryFormat] = useState(false)
  const [framePage, frameFormat] = editor.selectedFrame()?.split('/') ?? []
  const formatId = frameFormat && design.formats[frameFormat] ? frameFormat : design.meta.primaryFormatId
  const pageId = framePage ?? ''
  const live = ids.filter((id) => design.nodes[id])
  if (live.length === 0) return arrange
  const placedIn = (d: Design, id: string) => ({ ...d.nodes[id]?.props, ...d.overrides[`format:${formatId}`]?.[id] }) as Props
  const types = live.map((id) => design.nodes[id]?.type ?? '')
  const target: Target = {
    editor, ids: live, pageId, formatId, everyFormat: everyFormat || Object.keys(design.formats).length === 1, props: live.map((id) => placedIn(design, id)), types,
    names: live.map((id) => design.nodes[id]?.name ?? ''),
  }
  const all = (...kinds: string[]) => types.every((type) => kinds.includes(type))
  const several = live.length > 1
  const shapeKinds = new Set(live.map((id) => {
    const node = design.nodes[id]
    return node?.type === 'graphic' ? node.props.shape.kind : null
  }))
  const [shapeKind] = shapeKinds
  // The first image fill, when every selected layer has the same fills.
  const fills = shared(target.props.map((pr) => (pr.fills ?? []) as Paint[]))
  const imageIndex = fills === 'mixed' ? -1 : fills.findIndex((f) => f.type === 'image')
  const imageFill = fills !== 'mixed' && imageIndex >= 0 ? { index: imageIndex, paint: fills[imageIndex] as ImageFill } : null
  const ownShape = shapeKinds.size === 1 && (shapeKind === 'rect' || shapeKind === 'polygon' || shapeKind === 'star' || shapeKind === 'line') ? shapeKind : null
  return (
    <>
      {several && arrange}
      {Object.keys(design.formats).length > 1 && <ScopeSwitch everyFormat={everyFormat} onChange={setEveryFormat} p={p} />}
      {all('text') && <TextCard target={target} p={p} />}
      {all('text') && <ParagraphCard target={target} p={p} />}
      {ownShape && <ShapeCard target={target} p={p} kind={ownShape} />}
      {all('graphic', 'frame', 'boolean') && imageFill && <ImageCard target={target} p={p} brandId={brandId} index={imageFill.index} paint={imageFill.paint} />}
      {all('graphic', 'frame', 'boolean') && (
        <ListCard<Paint>
          id="fill-card"
          title={p.fill}
          p={p}
          target={target}
          field="fills"
          fresh={NEW_FILL}
          render={(paint, i, change) => <PaintRow paint={paint} name={format(p.colour, { n: i + 1 })} p={p} onSet={(next) => change(() => next)} />}
        />
      )}
      {all('graphic', 'boolean') && (
        <ListCard<Stroke>
          id="stroke-card"
          title={p.stroke}
          p={p}
          target={target}
          field="strokes"
          fresh={NEW_STROKE}
          render={(stroke, i, change) => <StrokeRow stroke={stroke} i={i} p={p} editor={editor} onSet={change} />}
        />
      )}
      <EffectsCard target={target} p={p} />
      {!several && arrange}
      <LayoutCard target={target} p={p} />
      <AppearanceCard target={target} p={p} />
      {all('frame') && <AutoLayoutCard target={target} p={p} />}
    </>
  )
}
