'use client'

// The property cards' fields, shared by every card that edits a value: a number that types, nudges
// and scrubs, a colour with its hex and opacity, and a choice from a list.
import { useId, useRef, useState } from 'react'
import type { Editor } from '@dazbee/editor'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { Select } from '../ui/select.tsx'

export const FIELD = 'h-7 min-w-0 w-full rounded-row border border-line bg-surface px-1.5 font-mono text-[12px] tabular-nums text-text outline-none placeholder:text-subtle focus:border-accent'
export const SELECT = 'h-7 w-full bg-surface px-1.5 text-[12px]'

export const clamp = (n: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => Math.min(max, Math.max(min, n))
export const tidy = (n: number) => Math.round(n * 100) / 100

/**
 * A number: type it and press Enter, nudge it with the arrow keys (Shift for 10), or drag its label
 * sideways to scrub it, one undo step for the whole drag. With `onClear`, emptying the field calls it,
 * for a value that can be left unset (its placeholder shows then), mixed values too once something
 * was typed; without, an empty field is ignored.
 */
export function NumberField({ label, name, value, step = 1, min, max, scale = 1, placeholder, editor, onSet, onShift, onClear }: {
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
  onClear?: () => void
}) {
  const t = useMessages()
  const id = useId()
  const shown = value === undefined || value === 'mixed' ? '' : String(tidy(value * scale))
  const [draft, setDraft] = useState<string | null>(null)
  const scrub = useRef<{ x: number; applied: number; end: () => void } | null>(null)
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
