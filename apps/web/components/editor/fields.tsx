'use client'

// The property cards' fields, shared by every card that edits a value: a number that types, nudges
// and scrubs, a colour with its hex and opacity, and a choice from a list.
import { useRef, useState, type CSSProperties } from 'react'
import type { Editor } from '@dazbee/editor'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { Select } from '../ui/select.tsx'
import { KNOB } from './styles.ts'

export const FIELD = 'h-7 min-w-0 w-full rounded-row border border-line bg-surface px-1.5 font-mono text-[12px] tabular-nums text-text outline-none placeholder:text-subtle focus:border-accent'
export const SELECT = 'h-8 w-full bg-surface px-1.5 text-[12px]'

export const clamp = (n: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => Math.min(max, Math.max(min, n))
export const tidy = (n: number) => Math.round(n * 100) / 100

/**
 * A number, as a knob: drag it sideways to scrub the value (Shift for 10 times, Alt for a tenth on a
 * field with fractional steps), one undo step for the whole drag; click it, or tab to it, and type a
 * value and press Enter; nudge it with the arrow keys (Shift for 10). With `min` and `max` a fill
 * behind it shows where the value sits between them, Home and End go to them, and it is a slider;
 * without, a spin button.
 * With `onClear`, emptying the field calls it, for a value that can be left unset (its placeholder
 * shows then), mixed values too once something was typed; without, an empty field is ignored.
 */
export function NumberField({ label, name, value, step = 1, min, max, scale = 1, unit = '', placeholder, editor, testId, onSet, onShift, onClear }: {
  label: string
  name: string
  value: number | 'mixed' | undefined
  step?: number
  min?: number | undefined
  max?: number | undefined
  /** Shown as the value times this, such as 100 for a percentage. */
  scale?: number
  /** Shown after the value: %, ° or px. */
  unit?: string | undefined
  placeholder?: string
  /** Makes a drag one undo step; without one, a drag is as many changes as it makes. */
  editor?: Editor
  testId?: string
  onSet: (value: number) => void
  onShift: (by: number) => void
  onClear?: () => void
}) {
  const t = useMessages()
  const input = useRef<HTMLInputElement>(null)
  const shown = value === undefined || value === 'mixed' ? '' : String(tidy(value * scale))
  const [draft, setDraft] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const press = useRef<{ x: number; applied: number; end: (() => void) | null } | null>(null)
  const ranged = min !== undefined && max !== undefined && Number.isFinite(min) && Number.isFinite(max) && max > min
  const fill = ranged && typeof value === 'number' ? ((clamp(value, min, max) - min) / (max - min)) * 100 : 0
  /** One step, or ten with Shift, or a tenth with Alt where the steps are fractions. */
  const stepOf = (event: { shiftKey: boolean; altKey: boolean }) => step * (event.shiftKey ? 10 : event.altKey && step < 1 ? 0.1 : 1)
  const commit = (text: string) => {
    const typed = draft !== null
    setDraft(null)
    if (text.trim() === '') {
      if (onClear && (shown !== '' || (value === 'mixed' && typed))) onClear()
      return
    }
    const n = Number.parseFloat(text.replace(',', '.'))
    if (Number.isFinite(n) && text.trim() !== shown) onSet(clamp(n / scale, min, max))
  }
  const release = () => {
    const p = press.current
    press.current = null
    if (!p) return
    if (p.end) p.end()
    else input.current?.focus()
  }
  return (
    <div
      data-scrub={name}
      title={format(t.editor.props.scrub, { name })}
      style={{ '--fill': `${fill}%` } as CSSProperties}
      onPointerDown={(event) => {
        // A press on the field being typed in places the caret; anywhere else it starts a drag.
        if (event.button !== 0 || (typing && event.target === input.current)) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        press.current = { x: event.clientX, applied: 0, end: null }
      }}
      onPointerMove={(event) => {
        const p = press.current
        if (!p || (!p.end && Math.abs(event.clientX - p.x) < 3)) return
        p.end ??= editor?.beginGesture() ?? (() => undefined)
        const by = Math.round((event.clientX - p.x) / 2) * stepOf(event)
        if (by === p.applied) return
        onShift((by - p.applied) / scale)
        p.applied = by
      }}
      onPointerUp={release}
      onPointerCancel={release}
      className={KNOB}
    >
      <span className="relative min-w-0 truncate">{label}</span>
      <input
        ref={input}
        name={name}
        role={ranged ? 'slider' : 'spinbutton'}
        aria-label={name}
        aria-valuenow={typeof value === 'number' ? tidy(value * scale) : undefined}
        aria-valuemin={min === undefined || !Number.isFinite(min) ? undefined : tidy(min * scale)}
        aria-valuemax={max === undefined || !Number.isFinite(max) ? undefined : tidy(max * scale)}
        aria-valuetext={value === 'mixed' ? t.editor.props.mixed : shown ? `${shown}${unit}` : placeholder}
        data-testid={testId}
        inputMode="decimal"
        value={draft ?? shown}
        placeholder={value === 'mixed' ? t.editor.props.mixed : placeholder}
        onFocus={(event) => {
          setTyping(true)
          // What is typed replaces the value.
          const field = event.currentTarget
          requestAnimationFrame(() => field.select())
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          setTyping(false)
          if (draft !== null) commit(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget.value)
          else if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            setDraft(null)
            onShift(((event.key === 'ArrowUp' ? 1 : -1) * stepOf(event)) / scale)
          } else if ((event.key === 'Home' || event.key === 'End') && ranged && draft === null) {
            // A range's ends, as a slider's; while a value is being typed they move the caret.
            event.preventDefault()
            onSet(event.key === 'Home' ? min : max)
          } else return
          // Keys typed into a field are the field's, not the stage's.
          event.stopPropagation()
        }}
        className={cn('relative min-w-0 flex-1 cursor-[inherit] bg-transparent text-end font-mono text-[12px] text-text tabular-nums outline-none placeholder:text-subtle focus:cursor-text', typing && 'select-text')}
      />
      {unit && shown && <span aria-hidden className="relative -ms-2 font-mono text-[12px] text-text">{unit}</span>}
    </div>
  )
}

/** A colour as #RRGGBBAA: one part changed, the other as the document holds it now. */
export const withHex = (hex: string) => (now: string | undefined) => `${hex}${now?.slice(7, 9) || 'FF'}`
export const withOpacity = (alpha: number) => (now: string | undefined) =>
  `${now?.slice(0, 7) || '#000000'}${Math.round(clamp(alpha, 0, 1) * 255).toString(16).padStart(2, '0').toUpperCase()}`

/**
 * A colour: a swatch that opens the system picker, the hex, and its opacity as a percentage. A
 * change gives `onSet` the colour to build from the one the document holds then, so a hex and an
 * opacity committed one after the other each keep the other's change.
 */
export function ColorField({ name, value, onSet }: { name: string; value: string | 'mixed' | undefined; onSet: (to: (now: string | undefined) => string) => void }) {
  const t = useMessages()
  const p = t.editor.props
  const hex = value && value !== 'mixed' ? value.slice(0, 7).toUpperCase() : ''
  const alpha = value && value !== 'mixed' ? Number.parseInt(value.slice(7, 9) || 'FF', 16) / 255 : undefined
  const [draft, setDraft] = useState<string | null>(null)
  const commitHex = (text: string) => {
    setDraft(null)
    const h = (text.startsWith('#') ? text : `#${text}`).toUpperCase()
    if (/^#[0-9A-F]{6}$/.test(h) && h !== hex) onSet(withHex(h))
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <input
        name="colour"
        type="color"
        aria-label={format(p.colourOf, { name })}
        value={hex || '#000000'}
        onChange={(event) => onSet(withHex(event.target.value.toUpperCase()))}
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
          if (Number.isFinite(n) && hex && Math.round(n) !== Math.round((alpha ?? 1) * 100)) onSet(withOpacity(n / 100))
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

export function Choice<T extends string>({ name, value, options, labels, onSet }: { name: string; value: T | 'mixed' | undefined; options: readonly T[]; labels: Record<T, string>; onSet: (value: T) => void }) {
  const t = useMessages()
  return (
    <Select
      name="choice"
      label={name}
      value={value === 'mixed' || value === undefined ? '' : value}
      placeholder={t.editor.props.mixed}
      options={options.map((option) => ({ value: option, label: labels[option] }))}
      onChange={(next) => onSet(next as T)}
      className={SELECT}
    />
  )
}
