'use client'

// The selection's property cards (#60), visual first as in the final mock (layout A): the look
// card (text size and colour, or the shape and its fill, or the image's filters), the effects as
// tiles, then Details, one folded row per card of numbers (#151 to #157). A value the selected
// layers don't share shows as mixed; setting it gives them all the same one, and scrubbing or the
// arrow keys move each from its own. With more than one format the changes go to every format or to
// this one only. Each change is one undo step, and a scrub or a slider drag, however long, is one too.
import { ArrowsClockwiseIcon, CaretRightIcon, ImageSquareIcon, XIcon } from '@phosphor-icons/react'
import { withImage, type Editor } from '@dazbee/editor'
import { BlendMode, boundFillIndex, brandRef, ContainerBlendMode, ImageFilter, LineEnd, type Design, type Effect, type ImageAdjust, type Paint, type Shape } from '@dazbee/schema'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format, type Messages } from '../../lib/i18n/index.ts'
import { Select } from '../ui/select.tsx'
import { CARD, CardHeader, FineTune, PICKED_RING, SWATCHES } from './card.tsx'
import { CHIP, DASHED_BUTTON, FOCUS_RING, SWATCH } from './styles.ts'
import { ImagePickerButton } from './image-tool.tsx'
import { useBrandKit } from './use-brand-kit.ts'
import { useLiveDesign } from './use-live-design.ts'
import { Choice, clamp, ColorField, FIELD, NumberField, tidy } from './fields.tsx'
import { AddButton, PaintRow, RemoveButton, Stack } from './paint-stack.tsx'

type Props = Readonly<Record<string, unknown>>
type Patch = Record<string, unknown>
type P = Messages['editor']['props']

const NEW_FILL: Paint = { type: 'solid', color: '#D9D9D9FF' }
/** A fill + adds over others: a see-through wash, so what was there still shows through it. */
const FILL_ON_TOP: Paint = { type: 'solid', color: '#00000033' }
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

/**
 * A checkbox for a value in the document. The cards see the document's change at the redraw after it,
 * so a press shows at once and holds until the document's value changes.
 */
function DocCheckbox({ name, checked, onSet }: { name: string; checked: boolean; onSet: (checked: boolean) => void }) {
  const [pressed, setPressed] = useState<boolean | null>(null)
  useEffect(() => setPressed(null), [checked])
  return (
    <input
      type="checkbox"
      name={name}
      checked={pressed ?? checked}
      onChange={(event) => {
        setPressed(event.target.checked)
        onSet(event.target.checked)
      }}
    />
  )
}

/** Which rows of the Details card are open; kept while the selection changes. */
const Folds = createContext<{ open: ReadonlySet<string>; toggle: (id: string) => void } | null>(null)

/**
 * A card of numbers. Inside Details it is a folded row, as in the mock: its name and a short summary
 * of its values, opening in place; its action (such as add) stays on the row. Elsewhere it is a
 * card of its own.
 */
function Card({ id, title, note, summary, action, children }: { id: string; title: string; note?: string; summary?: string; action?: ReactNode; children: ReactNode }) {
  const folds = useContext(Folds)
  if (folds) {
    const open = folds.open.has(id)
    return (
      <section aria-labelledby={`${id}-title`} data-testid={id} data-open={open ? '' : undefined} className="border-t border-line first:border-t-0">
        <div className="flex min-h-11 items-center gap-1">
          <h3 id={`${id}-title`} className="min-w-0 flex-1">
            <button
              type="button"
              data-fold
              aria-expanded={open}
              onClick={() => folds.toggle(id)}
              className="group flex h-11 w-full cursor-pointer items-center gap-2 text-start text-[13px] font-semibold text-muted transition-colors duration-[var(--chrome-fast)] hover:text-text aria-expanded:text-text"
            >
              <span className="shrink-0">{title}</span>
              {!open && (summary ?? note) && <span className="min-w-0 flex-1 truncate text-end font-mono text-[11px] font-normal text-subtle">{summary ?? note}</span>}
              <CaretRightIcon size={12} weight="bold" aria-hidden className="ms-auto shrink-0 transition-transform duration-[var(--chrome-fast)] group-aria-expanded:rotate-90 rtl:-scale-x-100 rtl:group-aria-expanded:-rotate-90" />
            </button>
          </h3>
          {action}
        </div>
        {open && <div className="flex flex-col gap-2.5 pb-4">{children}</div>}
      </section>
    )
  }
  return (
    <section aria-labelledby={`${id}-title`} className={CARD} data-testid={id}>
      <CardHeader id={`${id}-title`} title={title} note={note}>{action}</CardHeader>
      <div className="flex flex-col gap-2.5 px-[18px] pb-4 empty:hidden">{children}</div>
    </section>
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
  const one = (key: string) => {
    const v = shared(target.props.map((pr) => num(pr, key)))
    return v === 'mixed' ? '–' : String(Math.round(v))
  }
  return (
    <Card id="layout-card" title={p.layout} summary={`${one('x')}, ${one('y')} · ${one('width')}×${one('height')}`}>
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
  const opacity = shared(target.props.map((pr) => num(pr, 'opacity') ?? 1))
  const blend = shared(target.props.map((pr) => (pr.blendMode as string | undefined) ?? 'normal'))
  return (
    <Card
      id="appearance-card"
      title={p.appearance}
      summary={`${opacity === 'mixed' ? '–' : Math.round(opacity * 100)}% · ${blend === 'mixed' ? p.mixed : (p.blends as Record<string, string>)[blend] ?? blend}`}
    >
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
function ShapeCard({ target, p, kind, look }: { target: Target; p: P; kind: ShapeKind; look?: ReactNode }) {
  const shapes = target.props.map((pr) => pr.shape as Shape)
  const value = (key: string) => shared(shapes.map((s) => (s as Record<string, unknown>)[key])) as number | string | 'mixed' | undefined
  const setShape = (change: (now: Record<string, unknown>) => Record<string, unknown>) =>
    set(target, (now) => ({ shape: { ...(now.shape as Record<string, unknown>), ...change(now.shape as Record<string, unknown>) } }))
  /** A slider, as in the mock: its range is what designs mostly use, and the shape keeps the schema's limits. */
  const slider = (key: string, name: string, { min, max, step = 1, show = (n: number) => String(Math.round(n)) }: { min: number; max: number; step?: number; show?: (n: number) => string }) => {
    const v = value(key) as number | 'mixed' | undefined
    return (
      <Slider
        name={name}
        value={v}
        min={min}
        max={max}
        step={step}
        display={v === undefined || v === 'mixed' ? '–' : show(v)}
        editor={target.editor}
        onSet={(n) => setShape(() => ({ [key]: step === 1 ? Math.round(n) : tidy(n) }))}
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
      {look}
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
          <>
            {kind === 'polygon' && slider('sides', p.sides, { min: 3, max: 24 })}
            {kind === 'star' && slider('points', p.points, { min: 3, max: 24 })}
            {kind === 'star' && slider('innerRadius', p.innerRadius, { min: 0.05, max: 0.95, step: 0.01, show: (n) => `${Math.round(n * 100)}%` })}
            {!each && slider('cornerRadius', p.cornerRadius, { min: 0, max: 200 })}
          <div dir="ltr" className="grid grid-cols-2 gap-x-3 gap-y-2 empty:hidden">
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
          </>
        )}
      {kind === 'rect' && (
        <label className="flex items-center gap-2 text-[12px]">
          <DocCheckbox name="each-corner" checked={each} onSet={eachCorner} />
          {p.eachCorner}
        </label>
      )}
    </Card>
  )
}

/** A list of paints, strokes or effects that every selected layer has the same of, or a way to make it so. */
function ListCard<T>({ id, title, p, target, field, fresh, onTop = fresh, topFirst = false, render, summaryOf }: {
  /** A few words on the list's values for its folded row. */
  summaryOf?: (list: T[]) => string
  /** What + adds over a list that has items already; `fresh` starts an empty one. */
  onTop?: T
  /** The last item, drawn on top, shows first, and rows can be reordered. */
  topFirst?: boolean
  id: string
  title: string
  p: P
  target: Target
  field: string
  fresh: T
  /** `n` is the row's place as shown, from 1; `change` takes the item as the document holds it when the change is made, not as last drawn. */
  render: (item: T, n: number, change: (to: (now: T) => T) => void) => ReactNode
}) {
  const lists = target.props.map((pr) => (pr[field] ?? []) as T[])
  const list = shared(lists)
  const write = (to: (now: T[]) => T[]) => set(target, (now) => ({ [field]: to((now[field] ?? []) as T[]) }))
  return (
    <Card
      id={id}
      title={title}
      summary={list === 'mixed' ? p.mixed : list.length === 0 ? p.none : summaryOf?.(list) ?? String(list.length)}
      action={<AddButton label={format(p.add, { name: title.toLowerCase() })} onClick={() => write((now) => (list === 'mixed' && !topFirst ? [fresh] : [...now, now.length === 0 ? fresh : onTop]))} />}
    >
      {list === 'mixed'
        ? (
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            {p.mixedList}
            <button type="button" onClick={() => write(() => [fresh])} className="cursor-pointer font-medium text-accent-text hover:underline">{p.useOne}</button>
          </div>
        )
        : <Stack items={list} field={field} topFirst={topFirst} removeLabel={(n) => format(p.remove, { name: title.toLowerCase(), n })} onWrite={write} render={render} />}
    </Card>
  )
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
function StrokeRow({ stroke, place, brandId, p, editor, onSet }: { stroke: Stroke; place: number; brandId: string; p: P; editor: Editor; onSet: (to: (now: Stroke) => Stroke) => void }) {
  const n = { n: place }
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <PaintRow paint={stroke.paint} name={format(p.strokeColour, n)} brandId={brandId} editor={editor} p={p} onSet={(to) => onSet((now) => ({ ...now, paint: to(now.paint) }))} />
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

/** One effect's numbers and colour, with its remove button. */
function EffectRow({ effect, i, target, p, write }: { effect: Effect; i: number; target: Target; p: P; write: (to: (now: Effect[]) => Effect[]) => void }) {
  const change = (to: (now: Effect) => Effect) => write((now) => now.map((x, j) => (j === i ? to(x) : x)))
  const effectName = p.effect[effect.type]
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2.5" data-item={`effects-${i}`}>
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
      {'color' in effect && <ColorField name={effectName} value={effect.color} onSet={(to) => change((now) => ({ ...now, color: to('color' in now ? now.color : undefined) }) as Effect)} />}
    </div>
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
    <Card id="text-card" title={p.textNumbers} summary={[style('fontSize'), style('color')].map((v) => (v === 'mixed' ? '–' : typeof v === 'string' ? v.slice(0, 7) : String(v))).join(' · ')}>
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
          onClear={() => setStyle('lineHeight', undefined)}
        />
        <NumberField label="↔" name={p.letterSpacing} value={(style('letterSpacing') ?? 0) as number | 'mixed'} step={0.1} editor={target.editor} onSet={(v) => setStyle('letterSpacing', v)} onShift={(by) => shiftStyle('letterSpacing', by)} />
        <Choice name={p.textCase} value={(style('textCase') ?? 'none') as string} options={['none', 'upper', 'lower', 'title']} labels={p.textCases} onSet={(v) => setStyle('textCase', v)} />
      </div>
      <ColorField name={p.textColour} value={style('color') as string | 'mixed'} onSet={(to) => set(target, (now) => ({ style: { ...(now.style as Style), color: to((now.style as Style).color) } }))} />
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
          <ColorField name={p.outline} value={outline.color} onSet={(to) => setStyle((now) => ({ outline: { ...(now.outline as object), color: to((now.outline as { color?: string } | undefined)?.color) } }))} />
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
      <CardHeader id="image-card-title" title={p.image} note={target.names.join(', ')}>
        <ImagePickerButton
          brandId={brandId}
          title={p.replaceImageTitle}
          testId="replace-image"
          className={cn(CHIP, FOCUS_RING, 'shrink-0')}
          onPick={(asset) => set(target, (now) => ({ fills: withImage((now.fills ?? []) as Paint[], asset.id) }))}
        >
          <ArrowsClockwiseIcon size={12} aria-hidden />
          <span aria-hidden>{p.replaceImage}</span>
        </ImagePickerButton>
      </CardHeader>
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
        <DocCheckbox name="wrap" checked={value('wrap') === true} onSet={(wrap) => setLayout(() => ({ wrap }))} />
        {p.wrap}
      </label>
    </Card>
  )
}

type Sizing = 'fixed' | 'hug' | 'fill'

/** How a layer sizes on each axis, as the renderer reads it: left unsaid, text hugs as its box mode says and the rest is fixed. */
function sizingOf(type: string, props: Props): { width: Sizing; height: Sizing } {
  const own = props.sizing as { width: Sizing; height: Sizing } | undefined
  if (own) return own
  if (type === 'text') return { width: props.boxMode === 'autoWidth' ? 'hug' : 'fixed', height: props.boxMode === 'fixed' ? 'fixed' : 'hug' }
  return { width: 'fixed', height: 'fixed' }
}

/**
 * How layers size and sit in an auto layout (#155): fixed, hugging what they hold or filling the
 * room on each axis, and, for children of an auto layout frame, kept out of the flow where they
 * are put.
 */
function FlowCard({ target, p, inFlow }: { target: Target; p: P; inFlow: boolean }) {
  const sizings = target.props.map((pr, i) => sizingOf(target.types[i] ?? '', pr))
  return (
    <Card id="flow-card" title={inFlow ? p.inAutoLayout : p.sizing}>
      <div className="grid grid-cols-2 gap-x-3">
        {(['width', 'height'] as const).map((axis) => (
          <Choice
            key={axis}
            name={p.sizingAxis[axis]}
            value={shared(sizings.map((s) => s[axis]))}
            options={['fixed', 'hug', 'fill'] as const}
            labels={p.sizings}
            onSet={(to) => set(target, (now, i) => ({ sizing: { ...sizingOf(target.types[i] ?? '', now), [axis]: to } }))}
          />
        ))}
      </div>
      {inFlow && (
        <label className="flex items-center gap-2 text-[12px]">
          <DocCheckbox
            name="absolute"
            checked={target.props.every((pr) => pr.absolute === true)}
            onSet={(absolute) => set(target, () => ({ absolute: absolute ? true : undefined }))}
          />
          {p.absolute}
        </label>
      )}
    </Card>
  )
}

type OwnGroup = keyof P['ownGroups']
/** Which card's words name a property a format can have of its own. */
const OWN_GROUP: Record<string, OwnGroup> = {
  x: 'layout', y: 'layout', width: 'layout', height: 'layout', rotation: 'layout', sizing: 'layout', absolute: 'layout',
  opacity: 'appearance', blendMode: 'appearance', visible: 'appearance',
  fills: 'fill', strokes: 'stroke', effects: 'effects', shape: 'shape',
  text: 'text', runs: 'text', style: 'text', align: 'text', verticalAlign: 'text', direction: 'text', boxMode: 'text', list: 'text', paragraphSpacing: 'text', maxLines: 'text', shrinkToFit: 'text',
  layout: 'autoLayout',
}

/**
 * What the format shown has of its own for the selected layers (#157), grouped as the cards are;
 * each group, or all of them, goes back to following the other formats in one undo step.
 */
function OwnChanges({ design, ids, formatId, editor, p }: { design: Design; ids: string[]; formatId: string; editor: Editor; p: P }) {
  const scope = `format:${formatId}` as const
  const byNode = design.overrides[scope] ?? {}
  const paths = [...new Set(ids.flatMap((id) => Object.keys(byNode[id] ?? {})))]
  if (paths.length === 0) return null
  const groups = new Map<OwnGroup, string[]>()
  for (const path of paths) {
    const group = OWN_GROUP[path] ?? 'other'
    groups.set(group, [...groups.get(group) ?? [], path])
  }
  const reset = (only?: string[]) => editor.session.run('override.reset', { ids, scope, ...(only ? { paths: only } : {}) })
  const name = design.formats[formatId]?.name ?? ''
  return (
    <div data-testid="own-changes" className="flex flex-col gap-1.5 px-1.5 pt-2">
      <div className="flex items-center justify-between gap-2 text-[11px] text-subtle">
        <span className="min-w-0 truncate">{format(p.ownChanges, { format: name })}</span>
        <button type="button" onClick={() => reset()} className="shrink-0 cursor-pointer font-semibold text-accent-text hover:underline">{p.resetAll}</button>
      </div>
      <ul className="flex flex-wrap gap-1">
        {[...groups].map(([group, groupPaths]) => (
          <li key={group}>
            <button
              type="button"
              onClick={() => reset(groupPaths)}
              aria-label={format(p.resetOwn, { name: p.ownGroups[group] })}
              title={format(p.resetOwn, { name: p.ownGroups[group] })}
              className="group flex h-6 cursor-pointer items-center gap-1 rounded-full border border-accent/50 bg-accent-soft px-2 text-[11px] font-medium text-accent-text hover:border-accent"
            >
              {p.ownGroups[group]}
              <XIcon size={10} weight="bold" aria-hidden className="opacity-70 group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A swatch of the look cards: round, ringed while it is the colour. */
function Swatch({ color, label, on, onPick }: { color: string; label: string; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onPick}
      style={{ backgroundColor: color }}
      className={cn(SWATCH, 'size-[22px]', on && PICKED_RING)}
    />
  )
}

/**
 * The colours a look card offers: the brand's own, which the layers then follow (change the colour
 * in the kit and they change too), or, with no kit colours, a fixed set painted as it is.
 */
function Swatches({ target, brandId, p, current, paint }: { target: Target; brandId: string; p: P; current: string | 'mixed' | undefined; paint: (hex: string) => void }) {
  const kit = useBrandKit(brandId)
  const now = current && current !== 'mixed' ? current.slice(0, 7).toUpperCase() : null
  const colors = kit?.colors ?? []
  // The colour it has now leads the row when the row does not hold it, as in the mock.
  const offered = colors.length > 0 ? colors.map((c) => c.value.slice(0, 7).toUpperCase()) : [...SWATCHES]
  return (
    <div role="group" aria-label={colors.length > 0 ? p.brandColours : p.colours} className="flex flex-wrap items-center gap-1.5">
      {now && !offered.includes(now) && <Swatch color={now} label={format(p.currentColour, { hex: now })} on onPick={() => undefined} />}
      {colors.length > 0
        ? colors.map((c) => (
          <Swatch key={c.token} color={c.value.slice(0, 7)} label={c.name} on={now === c.value.slice(0, 7).toUpperCase()} onPick={() => target.editor.bindSelection('color', brandRef(c.token))} />
        ))
        : SWATCHES.map((hex) => <Swatch key={hex} color={hex} label={hex} on={now === hex} onPick={() => paint(hex)} />)}
    </div>
  )
}

/** A slider for a number, as in the mock; a drag is one undo step. */
function Slider({ name, value, min, max, step = 1, display, editor, onSet }: {
  name: string
  value: number | 'mixed' | undefined
  min: number
  max: number
  step?: number
  /** The value as the row shows it at its end. */
  display: string
  editor: Editor
  onSet: (value: number) => void
}) {
  const drag = useRef<(() => void) | null>(null)
  const end = () => {
    drag.current?.()
    drag.current = null
  }
  const shown = value === 'mixed' || value === undefined ? min : clamp(value, min, max)
  return (
    <label className="grid grid-cols-[3.5rem_1fr_2.25rem] items-center gap-2 text-[12px] text-muted">
      <span className="truncate">{name}</span>
      <input
        type="range"
        name={name}
        min={min}
        max={max}
        step={step}
        value={shown}
        onPointerDown={() => {
          drag.current = editor.beginGesture()
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onChange={(event) => onSet(Number(event.target.value))}
        style={{ '--fill': `${((shown - min) / (max - min)) * 100}%` } as React.CSSProperties}
        className="slider"
      />
      <span className="text-end font-mono text-[11px] text-text tabular-nums">{value === 'mixed' ? '–' : display}</span>
    </label>
  )
}

/** Text's look, as in the mock: its size on a slider and its colour from the brand. */
function TextLook({ target, brandId, p }: { target: Target; brandId: string; p: P }) {
  const styles = target.props.map((pr) => pr.style as Style)
  const size = shared(styles.map((s) => s.fontSize))
  return (
    <Card id="text-look" title={p.text} note={target.names.join(', ')}>
      <Slider
        name={p.fontSize}
        value={size}
        min={8}
        max={240}
        display={size === 'mixed' ? '–' : String(Math.round(size))}
        editor={target.editor}
        onSet={(fontSize) => set(target, (now) => ({ style: { ...(now.style as Style), fontSize } }))}
      />
      <Swatches target={target} brandId={brandId} p={p} current={shared(styles.map((s) => s.color))} paint={(hex) => set(target, (now) => ({ style: { ...(now.style as Style), color: `${hex}${((now.style as Style).color ?? '').slice(7, 9) || 'FF'}` } }))} />
    </Card>
  )
}

/** A shape's or frame's look: its fill from the brand, painted over its first solid fill. */
function FillLook({ target, brandId, p }: { target: Target; brandId: string; p: P }) {
  // The fill a brand colour binds: the topmost one that shows.
  const bound = (fills: Paint[]) => fills[boundFillIndex(fills)] as Extract<Paint, { type: 'solid' }> | undefined
  const current = shared(target.props.map((pr) => bound((pr.fills ?? []) as Paint[])?.color))
  const paint = (hex: string) => set(target, (now) => {
    const fills = (now.fills ?? []) as Paint[]
    const i = boundFillIndex(fills)
    const color = `${hex}FF`
    return { fills: i < 0 ? [...fills, { type: 'solid', color }] : fills.map((f, j) => (j === i && f.type === 'solid' ? { ...f, color } : f)) }
  })
  // A picture goes into layers that have none; one that has a picture changes it from the Image card.
  const pictureless = target.props.every((pr) => !((pr.fills ?? []) as Paint[]).some((f) => f.type === 'image'))
  return (
    <div className="flex flex-col gap-3">
      <Swatches target={target} brandId={brandId} p={p} current={current} paint={paint} />
      {pictureless && <ImagePickerButton
        brandId={brandId}
        title={p.addImageTitle}
        testId="add-image"
        className={DASHED_BUTTON}
        onPick={(asset) => set(target, (now) => ({ fills: withImage((now.fills ?? []) as Paint[], asset.id) }))}
      >
        <ImageSquareIcon size={14} aria-hidden />
        <span aria-hidden>{p.addImage}</span>
      </ImagePickerButton>}
    </div>
  )
}

/** The letters each effect tile shows its effect on; the same in every language, as a font sample is. */
const TILE_SAMPLE = 'Aa'

type Tile = 'none' | 'shadow' | 'glow' | 'outline' | 'blur'
const TILE_EFFECT: Partial<Record<Tile, Effect['type']>> = { shadow: 'dropShadow', glow: 'glow', blur: 'layerBlur' }
/** How each tile draws its Aa, close to what the effect does. */
const TILE_LOOK: Record<Tile, string> = {
  none: '',
  shadow: '[text-shadow:3px_3px_0_rgb(0_0_0/0.55)]',
  glow: '[text-shadow:0_0_7px_var(--accent),0_0_14px_var(--accent)]',
  outline: 'text-transparent [-webkit-text-stroke:1px_var(--text)]',
  blur: 'blur-[1.5px]',
}

/**
 * The effects as tiles, as in the mock: none, a shadow, a glow, and an outline for text or a blur for
 * the rest. A tile turns its effect on or off; Fine-tune opens every effect's numbers, and adds the
 * ones without a tile.
 */
function EffectsCard({ target, p }: { target: Target; p: P }) {
  const [fine, setFine] = useState(false)
  const lists = target.props.map((pr) => (pr.effects ?? []) as Effect[])
  const list = shared(lists)
  const write = (to: (now: Effect[]) => Effect[]) => set(target, (now) => ({ effects: to((now.effects ?? []) as Effect[]) }))
  const text = target.types.every((type) => type === 'text')
  const tiles: Tile[] = ['none', 'shadow', 'glow', text ? 'outline' : 'blur']
  const outlined = (pr: Props) => ((pr.style as Style | undefined)?.outline as { width: number } | undefined)?.width ?? 0
  const on = (tile: Tile): boolean => {
    if (tile === 'outline') return target.props.every((pr) => outlined(pr) > 0)
    if (tile === 'none') return lists.every((l) => l.length === 0) && (!text || target.props.every((pr) => outlined(pr) === 0))
    return lists.every((l) => l.some((e) => e.type === TILE_EFFECT[tile]))
  }
  const press = (tile: Tile) => {
    if (tile === 'none') {
      set(target, (now) => ({ effects: [], ...(text ? { style: { ...(now.style as Style), outline: undefined } } : {}) }))
      return
    }
    if (tile === 'outline') {
      const off = on('outline')
      set(target, (now) => ({ style: { ...(now.style as Style), outline: off ? undefined : { width: 2, color: ((now.style as Style).outline as { color?: string } | undefined)?.color ?? '#000000FF' } } }))
      return
    }
    const type = TILE_EFFECT[tile] as Effect['type']
    const off = on(tile)
    write((now) => (off ? now.filter((e) => e.type !== type) : now.some((e) => e.type === type) ? now : [...now, NEW_EFFECT[type]]))
  }
  return (
    <section aria-labelledby="effects-card-title" className={CARD} data-testid="effects-card">
      <CardHeader id="effects-card-title" title={p.effects} />
      <div role="group" aria-label={p.effects} className="grid grid-cols-4 gap-[7px] px-[18px] pb-3.5">
        {tiles.map((tile) => (
          <button
            key={tile}
            type="button"
            aria-pressed={on(tile)}
            data-tile={tile}
            onClick={() => press(tile)}
            className="group flex min-w-0 cursor-pointer flex-col items-center gap-1 text-[11px] font-semibold text-muted aria-pressed:text-text"
          >
            <span className="grid aspect-square w-full place-items-center rounded-[10px] border border-line bg-bg/60 transition-colors duration-[var(--chrome-fast)] group-hover:border-line-strong group-aria-pressed:border-accent">
              <span aria-hidden className={cn('font-display text-[19px] font-extrabold text-text', TILE_LOOK[tile])}>{TILE_SAMPLE}</span>
            </span>
            {p.tiles[tile]}
          </button>
        ))}
      </div>
      <FineTune open={fine} onToggle={() => setFine(!fine)} label={p.fineTune} />
      {fine && (
        <div className="flex flex-col gap-2.5 px-[18px] pb-4">
          <Select
            name="add-effect"
            label={p.addEffect}
            value=""
            placeholder={p.addEffect}
            options={(Object.keys(NEW_EFFECT) as Effect['type'][]).map((type) => ({ value: type, label: p.effect[type] }))}
            onChange={(type) => {
              const fresh = NEW_EFFECT[type as Effect['type']]
              write((now) => [...(list === 'mixed' ? [] : now), fresh])
            }}
            className="h-7 w-full bg-bg/40 px-2 text-[12px] font-semibold"
          />
          {list === 'mixed'
            ? (
              <div className="flex items-center justify-between gap-2 text-xs text-muted">
                {p.mixedList}
                <button type="button" onClick={() => write(() => [])} className="cursor-pointer font-medium text-accent-text hover:underline">{p.useOne}</button>
              </div>
            )
            : list.map((effect, i) => <EffectRow key={i} effect={effect} i={i} target={target} p={p} write={write} />)}
        </div>
      )}
    </section>
  )
}

/** Where changes go when a design has more than one format: the one shown (as a canvas drag does), or every format. */
function ScopeSwitch({ everyFormat, onChange, p, children }: { everyFormat: boolean; onChange: (every: boolean) => void; p: P; children?: ReactNode }) {
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
      {children}
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
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const folds = { open, toggle: (id: string) => setOpen((was) => new Set(was.has(id) ? [...was].filter((x) => x !== id) : [...was, id])) }
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
  // Children of an auto layout frame, every one of them.
  const inFlow = live.every((id) => {
    const parent = design.nodes[design.nodes[id]?.parentId ?? '']
    return parent?.type === 'frame' && parent.props.layout !== undefined
  })
  // The topmost image fill, the one showing, when every selected layer has the same fills.
  const fills = shared(target.props.map((pr) => (pr.fills ?? []) as Paint[]))
  const imageIndex = fills === 'mixed' ? -1 : fills.findLastIndex((f) => f.type === 'image')
  const imageFill = fills !== 'mixed' && imageIndex >= 0 ? { index: imageIndex, paint: fills[imageIndex] as ImageFill } : null
  const ownShape = shapeKinds.size === 1 && (shapeKind === 'rect' || shapeKind === 'polygon' || shapeKind === 'star' || shapeKind === 'line') ? shapeKind : null
  return (
    <>
      {several && arrange}
      {Object.keys(design.formats).length > 1 && (
        <ScopeSwitch everyFormat={everyFormat} onChange={setEveryFormat} p={p}>
          <OwnChanges design={design} ids={live} formatId={formatId} editor={editor} p={p} />
        </ScopeSwitch>
      )}
      {/* The look first, as in the mock. */}
      {all('text') && <TextLook target={target} brandId={brandId} p={p} />}
      {imageFill
        ? <ImageCard target={target} p={p} brandId={brandId} index={imageFill.index} paint={imageFill.paint} />
        : all('graphic', 'frame', 'boolean') && (ownShape
          ? <ShapeCard target={target} p={p} kind={ownShape} look={ownShape === 'line' ? null : <FillLook target={target} brandId={brandId} p={p} />} />
          : (
            <section aria-labelledby="fill-look-title" className={CARD} data-testid="fill-look">
              <CardHeader id="fill-look-title" title={p.fill} note={target.names.join(', ')} />
              <div className="px-[18px] pb-4"><FillLook target={target} brandId={brandId} p={p} /></div>
            </section>
          ))}
      <EffectsCard target={target} p={p} />
      {!several && arrange}
      {/* Then the numbers, each card a folded row. */}
      <section aria-label={p.details} className={cn(CARD, 'px-[18px] py-1')} data-testid="details-card">
        <Folds.Provider value={folds}>
          {all('text') && <TextCard target={target} p={p} />}
          {all('text') && <ParagraphCard target={target} p={p} />}
          {all('graphic', 'frame', 'boolean') && (
            <ListCard<Paint>
              id="fill-card"
              title={p.fill}
              p={p}
              target={target}
              field="fills"
              fresh={NEW_FILL}
              onTop={FILL_ON_TOP}
              topFirst
              summaryOf={(list) => list.filter((paint) => paint.visible !== false).map((paint) => (paint.type === 'solid' ? paint.color.slice(0, 7) : p.paint[paint.type])).join(', ') || p.none}
              render={(paint, n, change) => <PaintRow paint={paint} name={format(p.colour, { n })} brandId={brandId} editor={editor} p={p} onSet={change} />}
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
              topFirst
              summaryOf={(list) => list.filter((stroke) => stroke.paint.visible !== false).map((stroke) => `${stroke.width} px`).join(', ') || p.none}
              render={(stroke, n, change) => <StrokeRow stroke={stroke} place={n} brandId={brandId} p={p} editor={editor} onSet={change} />}
            />
          )}
          <LayoutCard target={target} p={p} />
          <AppearanceCard target={target} p={p} />
          {all('frame') && <AutoLayoutCard target={target} p={p} />}
          {(inFlow || all('frame') && target.props.every((pr) => pr.layout)) && <FlowCard target={target} p={p} inFlow={inFlow} />}
        </Folds.Provider>
      </section>
    </>
  )
}
