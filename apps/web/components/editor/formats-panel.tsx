'use client'

// The design's formats in the inspector (#38): add one from presets grouped by shape or as a
// custom size, rename, reorder, make primary, show one alone, remove. Every change is a command,
// so it is one undo step and reaches the other tabs.
import {
  ArrowsInSimpleIcon, CaretDownIcon, CaretUpIcon, PlusIcon, StarIcon, TrashIcon,
} from '@phosphor-icons/react'
import * as Popover from '@radix-ui/react-popover'
import type { Editor } from '@razzlr/editor'
import {
  FORMAT_LIMITS, FORMAT_PRESETS, FORMAT_SHAPES, formatSizeIssue, shapeOf, type Design,
} from '@razzlr/schema'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { Tooltip } from '../ui/tooltip.tsx'

export const ICON_BUTTON = 'grid size-7 shrink-0 cursor-pointer place-items-center rounded-row text-subtle transition-colors duration-[var(--chrome-fast)] hover:bg-hover hover:text-text disabled:pointer-events-none disabled:opacity-30'

/** The design as the editor holds it, kept current: every redraw hands over the latest one. */
export function useEditorDesign(editor: Editor) {
  const [design, setDesign] = useState(() => editor.design())
  const [focused, setFocused] = useState(() => editor.focused())
  useEffect(() => {
    const stop = editor.onDraw((drawn) => {
      setDesign(drawn)
      setFocused(editor.focused())
    })
    return () => {
      stop()
    }
  }, [editor])
  return { design, focused }
}

/** A size as the app writes it, in numerals that read the same in every locale. */
const sizeOf = ({ width, height }: { width: number; height: number }) => `${width} × ${height}`

const ordered = (design: Design) =>
  Object.entries(design.formats).sort(([a, x], [b, y]) => (x.order < y.order ? -1 : x.order > y.order ? 1 : a < b ? -1 : 1))

/** A small box with the format's own proportions. */
function Proportion({ width, height, className }: { width: number; height: number; className?: string }) {
  const scale = 14 / Math.max(width, height)
  return (
    <span aria-hidden className={cn('grid size-4 shrink-0 place-items-center', className)}>
      <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: Math.max(4, width * scale), height: Math.max(4, height * scale) }} />
    </span>
  )
}

export function FormatsPanel({ editor, onRemoved }: { editor: Editor; onRemoved: (message: string) => void }) {
  const t = useMessages()
  const { design, focused } = useEditorDesign(editor)
  const formats = ordered(design)
  const [renaming, setRenaming] = useState<string | null>(null)
  const run = editor.session.run.bind(editor.session)

  const rename = (id: string, name: string) => {
    setRenaming(null)
    const trimmed = name.trim()
    if (trimmed && trimmed !== design.formats[id]?.name) run('format.update', { id, name: trimmed })
  }

  return (
    <section aria-labelledby="formats-title" className="border-b border-line">
      <div className="flex h-10 items-center justify-between ps-4 pe-2">
        <h3 id="formats-title" className="text-xs font-semibold tracking-wide text-muted">
          {t.editor.formats.title}
          <span className="ms-1.5 font-mono font-normal text-subtle tabular-nums">{formats.length}</span>
        </h3>
        <AddFormat editor={editor} />
      </div>
      <ul aria-label={t.editor.formats.title} className="pb-2" data-testid="formats">
        {formats.map(([id, f], i) => {
          const primary = design.meta.primaryFormatId === id
          return (
            <li
              key={id}
              data-format={id}
              data-focused={focused === id ? '' : undefined}
              className="group mx-2 flex h-[var(--row)] items-center gap-1 rounded-row ps-1 pe-0.5 hover:bg-hover data-[focused]:bg-accent-soft"
            >
              <Tooltip label={primary ? t.editor.formats.primary : t.editor.formats.makePrimary}>
                <button
                  type="button"
                  aria-label={primary ? t.editor.formats.primary : t.editor.formats.makePrimary}
                  aria-pressed={primary}
                  onClick={() => primary || run('format.setPrimary', { id })}
                  className={cn(ICON_BUTTON, primary ? 'text-accent-text' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
                >
                  <StarIcon size={14} weight={primary ? 'fill' : 'regular'} aria-hidden />
                </button>
              </Tooltip>
              <Proportion width={f.width} height={f.height} className="text-subtle" />
              {renaming === id ? (
                <input
                  aria-label={t.editor.formats.rename}
                  defaultValue={f.name}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => rename(id, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') rename(id, e.currentTarget.value)
                    if (e.key === 'Escape') setRenaming(null)
                    e.stopPropagation()
                  }}
                  className="h-6 min-w-0 flex-1 rounded-[6px] border border-accent bg-surface px-1.5 text-[13px] outline-none"
                />
              ) : (
                <button
                  type="button"
                  onDoubleClick={() => setRenaming(id)}
                  onKeyDown={(e) => e.key === 'Enter' && setRenaming(id)}
                  aria-label={`${t.editor.formats.rename}: ${f.name}`}
                  className="min-w-0 flex-1 cursor-default truncate text-start text-[13px]"
                >
                  {f.name}
                </button>
              )}
              <span className="shrink-0 font-mono text-[11px] text-subtle tabular-nums group-hover:hidden group-focus-within:hidden">
                {sizeOf(f)}
              </span>
              <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
                <Tooltip label={focused === id ? t.editor.formats.exitFocus : t.editor.formats.focus}>
                  <button type="button" aria-label={t.editor.formats.focus} aria-pressed={focused === id} onClick={() => editor.focus(focused === id ? null : id)} className={ICON_BUTTON}>
                    <ArrowsInSimpleIcon size={14} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip label={t.editor.formats.moveUp}>
                  <button type="button" aria-label={t.editor.formats.moveUp} disabled={i === 0} onClick={() => run('format.update', { id, before: formats[i - 1]?.[0] ?? null })} className={ICON_BUTTON}>
                    <CaretUpIcon size={14} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip label={t.editor.formats.moveDown}>
                  <button type="button" aria-label={t.editor.formats.moveDown} disabled={i === formats.length - 1} onClick={() => run('format.update', { id, before: formats[i + 2]?.[0] ?? null })} className={ICON_BUTTON}>
                    <CaretDownIcon size={14} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip label={t.editor.formats.remove}>
                  <button
                    type="button"
                    aria-label={t.editor.formats.remove}
                    disabled={primary || formats.length === 1}
                    onClick={() => {
                      run('format.remove', { id })
                      onRemoved(format(t.editor.formats.removed, { name: f.name }))
                    }}
                    className={cn(ICON_BUTTON, 'hover:text-danger')}
                  >
                    <TrashIcon size={14} aria-hidden />
                  </button>
                </Tooltip>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function AddFormat({ editor }: { editor: Editor }) {
  const t = useMessages()
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const ids = { width: useId(), height: useId(), issue: useId() }
  const w = Number(width)
  const h = Number(height)
  const typed = width !== '' && height !== ''
  const issue = typed ? formatSizeIssue(w, h) : undefined
  const add = (name: string, width: number, height: number) => {
    const id = editor.session.run('format.add', { name, width, height })
    setOpen(false)
    setWidth('')
    setHeight('')
    // Show where the new format landed: every frame, with the new column at the end.
    if (editor.focused()) editor.focus(id)
    else editor.fitAll()
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (typed && !issue) add(sizeOf({ width: w, height: h }), w, h)
  }
  const issueText = issue && format(t.editor.formats.issue[issue], { min: FORMAT_LIMITS.minShortSide, max: FORMAT_LIMITS.maxSide })

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip label={t.editor.formats.add}>
        <Popover.Trigger asChild>
          <button type="button" aria-label={t.editor.formats.add} className={ICON_BUTTON}>
            <PlusIcon size={16} aria-hidden />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="left"
          align="start"
          sideOffset={12}
          aria-label={t.editor.formats.add}
          onKeyDown={(e) => e.stopPropagation()}
          className="z-50 flex max-h-[min(560px,var(--radix-popover-content-available-height))] w-72 flex-col overflow-hidden rounded-card border border-line bg-raised shadow-panel data-[state=open]:animate-[tooltip-in_var(--chrome-fast)_var(--ease-out)]"
        >
          <div className="min-h-0 flex-1 overflow-y-auto py-1" role="group" aria-label={t.editor.formats.presets}>
            {FORMAT_SHAPES.map((shape) => {
              const presets = FORMAT_PRESETS.filter((p) => shapeOf(p.width, p.height) === shape)
              return (
                <div key={shape} role="group" aria-label={t.editor.formats.shape[shape]}>
                  <h4 className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-subtle">{t.editor.formats.shape[shape]}</h4>
                  {presets.map((preset) => {
                    const name = t.editor.formats.preset[preset.id] ?? preset.id
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        data-preset={preset.id}
                        onClick={() => add(name, preset.width, preset.height)}
                        className="mx-1 flex h-[var(--row)] w-[calc(100%-8px)] cursor-pointer items-center gap-2 rounded-row px-3 text-start text-[13px] hover:bg-hover focus-visible:bg-hover"
                      >
                        <Proportion width={preset.width} height={preset.height} className="text-muted" />
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        <span className="font-mono text-[11px] text-subtle tabular-nums">
                          {sizeOf(preset)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <form onSubmit={submit} className="border-t border-line p-3" aria-label={t.editor.formats.custom}>
            <h4 className="pb-2 text-[11px] font-semibold tracking-wide text-subtle">{t.editor.formats.custom}</h4>
            <div className="flex items-end gap-2">
              {(['width', 'height'] as const).map((side) => (
                <label key={side} htmlFor={ids[side]} className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] text-muted">
                  {t.editor.formats[side]}
                  <input
                    id={ids[side]}
                    inputMode="numeric"
                    value={side === 'width' ? width : height}
                    onChange={(e) => (side === 'width' ? setWidth : setHeight)(e.currentTarget.value.replace(/[^\d]/g, ''))}
                    aria-invalid={issue ? true : undefined}
                    aria-describedby={issue ? ids.issue : undefined}
                    className={cn(
                      'h-[var(--row)] w-full rounded-row border bg-surface px-2 font-mono text-[13px] text-text tabular-nums outline-none focus:border-accent',
                      issue ? 'border-danger/60' : 'border-line',
                    )}
                  />
                </label>
              ))}
              <Button type="submit" variant="primary" disabled={!typed || Boolean(issue)}>{t.editor.formats.addCustom}</Button>
            </div>
            <p id={ids.issue} role="alert" className="min-h-4 pt-1.5 text-[11px] text-danger">{issueText}</p>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Over the stage while one format shows alone: which one, and the way back to all of them. */
export function FocusChip({ editor }: { editor: Editor }) {
  const t = useMessages()
  const { design, focused } = useEditorDesign(editor)
  const name = focused ? design.formats[focused]?.name : undefined
  if (!focused || name === undefined) return null
  return (
    <div role="status" data-testid="focus-chip" className="pointer-events-auto flex h-9 items-center gap-1 rounded-full border border-line bg-[var(--glass)] ps-3.5 pe-1 text-[13px] shadow-panel backdrop-blur-xl">
      <ArrowsInSimpleIcon size={14} aria-hidden className="text-accent-text" />
      <span className="ms-1">{format(t.editor.formats.focusing, { name })}</span>
      <Button variant="ghost" className="ms-1 h-7 rounded-full px-2.5 text-xs" onClick={() => editor.focus(null)}>{t.editor.formats.exitFocus}</Button>
    </div>
  )
}

const TOAST_MS = 8000

/** After a format or page is removed: says so, with undo, for a few seconds. */
export function UndoToast({ editor, message, onDone }: { editor: Editor; message: string; onDone: () => void }) {
  const t = useMessages()
  // It stays while the pointer or focus is on it, so the undo can't vanish from under a click.
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (held) return
    const timer = setTimeout(onDone, TOAST_MS)
    return () => clearTimeout(timer)
  }, [message, onDone, held])
  return (
    <div
      role="status"
      data-testid="removed-toast"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="rise pointer-events-auto flex h-10 items-center gap-2 rounded-card border border-line bg-raised ps-3.5 pe-1.5 text-[13px] shadow-panel">
      <TrashIcon size={14} aria-hidden className="text-subtle" />
      <span>{message}</span>
      <Button
        variant="ghost"
        className="h-7 px-2.5 text-xs font-semibold text-accent-text"
        onClick={() => {
          editor.session.undo()
          onDone()
        }}
      >
        {t.editor.formats.undo}
      </Button>
    </div>
  )
}
