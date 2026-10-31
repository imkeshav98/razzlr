'use client'

// The selection's property cards (#60): position and size, appearance, fill, stroke, effects, text
// and auto layout, for one layer or several. A value the selected layers don't share shows as
// mixed; setting it gives them all the same one, and scrubbing or the arrow keys move each from its
// own. With more than one format the changes go to every format or to this one only. Each change
// is one undo step, and a scrub, however long, is one too.
import { MinusIcon, PlusIcon } from '@phosphor-icons/react'
import type { Editor } from '@razzlr/editor'
import { BlendMode, ContainerBlendMode, type Design, type Effect, type Paint } from '@razzlr/schema'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format, type Messages } from '../../lib/i18n/index.ts'
import { CARD, CardHeader } from './card.tsx'
import { ICON_BUTTON } from './formats-panel.tsx'

type Props = Readonly<Record<string, unknown>>
type Patch = Record<string, unknown>
type P = Messages['editor']['props']

const FIELD = 'h-7 min-w-0 w-full rounded-row border border-line bg-surface px-1.5 font-mono text-[12px] tabular-nums text-text outline-none placeholder:text-subtle focus:border-accent'
const SELECT = 'h-7 min-w-0 w-full rounded-row border border-line bg-surface px-1 text-[12px] text-text outline-none focus:border-accent'
const LABEL = 'text-[11px] font-medium text-muted'
const NEW_FILL: Paint = { type: 'solid', color: '#D9D9D9FF' }
const NEW_STROKE = { paint: { type: 'solid', color: '#1A1420FF' } as Paint, width: 2, align: 'center' as const }

/** The design and a count of its changes: the editor's design is live, the same object as it changes. */
export function useLiveDesign(editor: Editor) {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const stop = editor.onDraw(() => setVersion((v) => v + 1))
    return () => {
      stop()
    }
  }, [editor])
  return { design: editor.design(), version }
}

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
        type="color"
        aria-label={format(p.colourOf, { name })}
        value={hex || '#000000'}
        onChange={(event) => onSet(`${event.target.value.toUpperCase()}${value && value !== 'mixed' ? value.slice(7, 9) || 'FF' : 'FF'}`)}
        className="size-7 shrink-0 cursor-pointer rounded-row border border-line bg-surface p-0.5"
      />
      <input
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
    <select aria-label={name} value={value ?? ''} onChange={(event) => onSet(event.target.value as T)} className={SELECT}>
      {(value === 'mixed' || value === undefined) && <option value="mixed" disabled>{t.editor.props.mixed}</option>}
      {options.map((option) => <option key={option} value={option}>{labels[option]}</option>)}
    </select>
  )
}

function Card({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={CARD} data-testid={id}>
      <CardHeader id={`${id}-title`} title={title}>{action}</CardHeader>
      <div className="flex flex-col gap-2 px-4 pb-3">{children}</div>
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

/** A list of paints, strokes or effects that every selected layer has the same of, or a way to make it so. */
function ListCard<T>({ id, title, p, target, field, fresh, render }: {
  id: string
  title: string
  p: P
  target: Target
  field: string
  fresh: T
  render: (item: T, i: number, change: (next: T) => void) => ReactNode
}) {
  const lists = target.props.map((pr) => (pr[field] ?? []) as T[])
  const list = shared(lists)
  const write = (next: T[]) => set(target, () => ({ [field]: next }))
  return (
    <Card id={id} title={title} action={<AddButton label={format(p.add, { name: title.toLowerCase() })} onClick={() => write([...(list === 'mixed' ? [] : list), fresh])} />}>
      {list === 'mixed'
        ? (
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            {p.mixedList}
            <button type="button" onClick={() => write([fresh])} className="cursor-pointer font-medium text-accent-text hover:underline">{p.useOne}</button>
          </div>
        )
        : list.map((item, i) => (
          // Paints have no ids; their place in the list is what they are.
          <div key={i} className="flex items-center gap-1" data-item={`${field}-${i}`}>
            {render(item, i, (next) => write(list.map((x, j) => (j === i ? next : x))))}
            <RemoveButton label={format(p.remove, { name: title.toLowerCase(), n: i + 1 })} onClick={() => write(list.filter((_, j) => j !== i))} />
          </div>
        ))}
    </Card>
  )
}

function PaintRow({ paint, name, p, onSet }: { paint: Paint; name: string; p: P; onSet: (paint: Paint) => void }) {
  if (paint.type !== 'solid') return <span className="min-w-0 flex-1 truncate text-xs text-muted">{p.paint[paint.type]}</span>
  return <ColorField name={name} value={paint.color} onSet={(color) => onSet({ type: 'solid', color })} />
}

type Stroke = { paint: Paint; width: number; align: 'inside' | 'center' | 'outside' }

function StrokeRow({ stroke, i, p, editor, onSet }: { stroke: Stroke; i: number; p: P; editor: Editor; onSet: (stroke: Stroke) => void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <PaintRow paint={stroke.paint} name={format(p.colour, { n: i + 1 })} p={p} onSet={(paint) => onSet({ ...stroke, paint })} />
      <div className="grid grid-cols-2 gap-1">
        <NumberField label="W" name={format(p.strokeWidth, { n: i + 1 })} value={stroke.width} min={0.5} step={0.5} editor={editor} onSet={(width) => onSet({ ...stroke, width })} onShift={(by) => onSet({ ...stroke, width: tidy(clamp(stroke.width + by, 0.5)) })} />
        <Choice name={format(p.strokeAlign, { n: i + 1 })} value={stroke.align} options={['inside', 'center', 'outside'] as const} labels={p.aligns} onSet={(align) => onSet({ ...stroke, align })} />
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
  const write = (next: Effect[]) => set(target, () => ({ effects: next }))
  return (
    <Card
      id="effects-card"
      title={p.effects}
      action={(
        <select
          aria-label={p.addEffect}
          value=""
          onChange={(event) => write([...(list === 'mixed' ? [] : list), NEW_EFFECT[event.target.value as Effect['type']]])}
          className="h-7 w-28 rounded-row border border-line bg-surface px-1 text-[12px] text-muted"
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
            <button type="button" onClick={() => write([])} className="cursor-pointer font-medium text-accent-text hover:underline">{p.useOne}</button>
          </div>
        )
        : list.map((effect, i) => {
          const change = (next: Effect) => write(list.map((x, j) => (j === i ? next : x)))
          const effectName = p.effect[effect.type]
          return (
              <div key={i} className="flex flex-col gap-1 border-t border-line pt-2 first:border-t-0 first:pt-0" data-item={`effects-${i}`}>
              <div className="flex items-center justify-between">
                <span className={LABEL}>{effectName}</span>
                <RemoveButton label={format(p.remove, { name: effectName.toLowerCase(), n: i + 1 })} onClick={() => write(list.filter((_, j) => j !== i))} />
              </div>
              <div className="grid grid-cols-2 gap-1">
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
                      onSet={(v) => change({ ...effect, [field]: v } as Effect)}
                      onShift={(by) => change({ ...effect, [field]: tidy(clamp(value + by, min)) } as Effect)}
                    />
                  )
                })}
              </div>
              {'color' in effect && <ColorField name={effectName} value={effect.color} onSet={(color) => change({ ...effect, color })} />}
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
    <Card id="text-card" title={p.text}>
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
        <input type="checkbox" checked={value('wrap') === true} onChange={(event) => setLayout(() => ({ wrap: event.target.checked }))} />
        {p.wrap}
      </label>
    </Card>
  )
}

/** Where changes go when a design has more than one format: every format, or the one shown. */
function ScopeSwitch({ everyFormat, onChange, p }: { everyFormat: boolean; onChange: (every: boolean) => void; p: P }) {
  return (
    <section aria-label={p.applyTo} className={cn(CARD, 'p-1.5')} data-testid="scope-card">
      <div role="radiogroup" aria-label={p.applyTo} className="grid grid-cols-2 gap-1">
        {([true, false] as const).map((every) => (
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
      {!everyFormat && <p className="px-1.5 pt-1.5 text-[11px] leading-snug text-subtle">{p.thisFormatHint}</p>}
    </section>
  )
}

/** The selection's cards, after Arrange and the font. */
export function SelectionCards({ editor, ids }: { editor: Editor; ids: string[] }) {
  const t = useMessages()
  const p = t.editor.props
  const { design } = useLiveDesign(editor)
  const [everyFormat, setEveryFormat] = useState(true)
  const [framePage, frameFormat] = editor.selectedFrame()?.split('/') ?? []
  const formatId = frameFormat && design.formats[frameFormat] ? frameFormat : design.meta.primaryFormatId
  const pageId = framePage ?? ''
  const live = ids.filter((id) => design.nodes[id])
  if (live.length === 0) return null
  const placedIn = (d: Design, id: string) => ({ ...d.nodes[id]?.props, ...d.overrides[`format:${formatId}`]?.[id] }) as Props
  const types = live.map((id) => design.nodes[id]?.type ?? '')
  const target: Target = { editor, ids: live, pageId, formatId, everyFormat: everyFormat || Object.keys(design.formats).length === 1, props: live.map((id) => placedIn(design, id)), types }
  const all = (...kinds: string[]) => types.every((type) => kinds.includes(type))
  return (
    <>
      {Object.keys(design.formats).length > 1 && <ScopeSwitch everyFormat={everyFormat} onChange={setEveryFormat} p={p} />}
      <LayoutCard target={target} p={p} />
      <AppearanceCard target={target} p={p} />
      {all('graphic', 'frame', 'boolean') && (
        <ListCard<Paint>
          id="fill-card"
          title={p.fill}
          p={p}
          target={target}
          field="fills"
          fresh={NEW_FILL}
          render={(paint, i, change) => <PaintRow paint={paint} name={format(p.colour, { n: i + 1 })} p={p} onSet={change} />}
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
      {all('text') && <TextCard target={target} p={p} />}
      {all('frame') && <AutoLayoutCard target={target} p={p} />}
    </>
  )
}
