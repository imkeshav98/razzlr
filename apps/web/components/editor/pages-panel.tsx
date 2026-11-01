'use client'

// The design's pages in the inspector (#39): add, duplicate, rename, reorder and delete them, and
// bring one into view. Every change is a command, so it is one undo step and reaches the other tabs.
import { CaretDownIcon, CaretUpIcon, CopyIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import type { Editor } from '@razzlr/editor'
import type { Design } from '@razzlr/schema'
import { useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { Tooltip } from '../ui/tooltip.tsx'
import { CARD, CardHeader } from './card.tsx'
import { CHIP, ICON_BUTTON, useEditorDesign } from './formats-panel.tsx'

const ordered = (design: Design) =>
  Object.entries(design.pages).sort(([a, x], [b, y]) => (x.order < y.order ? -1 : x.order > y.order ? 1 : a < b ? -1 : 1))

export function PagesPanel({ editor, onRemoved, onShow }: { editor: Editor; onRemoved: (message: string) => void; onShow?: (pageId: string) => void }) {
  const t = useMessages()
  const { design } = useEditorDesign(editor)
  const pages = ordered(design)
  const [renaming, setRenaming] = useState<string | null>(null)
  // The page last brought into view from here; the stage itself shows every page.
  const [current, setCurrent] = useState<string | null>(null)
  const run = editor.session.run.bind(editor.session)

  const show = (id: string) => {
    setCurrent(id)
    onShow?.(id)
    // After the command's redraw, so a new page's row is in the grid already.
    requestAnimationFrame(() => editor.fitPage(id))
  }
  const rename = (id: string, name: string) => {
    setRenaming(null)
    const trimmed = name.trim()
    if (trimmed && trimmed !== design.pages[id]?.name) run('page.update', { id, name: trimmed })
  }
  const add = () => {
    // "Page N" after the last, skipping a name a page already has.
    const names = new Set(pages.map(([, p]) => p.name))
    let n = pages.length + 1
    while (names.has(format(t.editor.pages.newName, { n }))) n++
    show(run('page.add', { name: format(t.editor.pages.newName, { n }) }))
  }

  const formatCount = Object.keys(design.formats).length
  const primary = design.formats[design.meta.primaryFormatId]
  // Each page's tile: the primary format's proportions, filled with the page's background.
  const tile = primary ? { width: Math.round(36 * Math.min(1, primary.width / primary.height)), height: Math.round(36 * Math.min(1, primary.height / primary.width)) } : { width: 36, height: 36 }

  return (
    <section aria-labelledby="pages-title" className={CARD}>
      <CardHeader id="pages-title" title={t.editor.pages.title} count={pages.length} />
      <ol aria-label={t.editor.pages.title} className="flex flex-col gap-1 px-2.5" data-testid="pages">
        {pages.map(([id, page], i) => {
          const fill = page.fills[0]
          return (
            <li
              key={id}
              data-page={id}
              aria-current={current === id ? 'page' : undefined}
              className="group flex h-12 items-center gap-2.5 rounded-[10px] ps-1.5 pe-1 hover:bg-hover aria-[current]:bg-accent-soft"
            >
              <span aria-hidden className="grid size-9 shrink-0 place-items-center">
                <span
                  className="grid place-items-center rounded-[4px] border border-line-strong bg-hover font-mono text-[10px] font-semibold text-white tabular-nums [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]"
                  style={{ ...tile, backgroundColor: fill?.type === 'solid' ? fill.color : undefined }}
                >
                  {i + 1}
                </span>
              </span>
              {renaming === id ? (
                <input
                  name="page-name"
                  aria-label={t.editor.pages.rename}
                  defaultValue={page.name}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => rename(id, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') rename(id, e.currentTarget.value)
                    if (e.key === 'Escape') setRenaming(null)
                    e.stopPropagation()
                  }}
                  className="h-7 min-w-0 flex-1 rounded-[6px] border border-accent bg-surface px-1.5 text-[13px] outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => show(id)}
                  onDoubleClick={() => setRenaming(id)}
                  onKeyDown={(e) => e.key === 'F2' && setRenaming(id)}
                  aria-label={format(t.editor.pages.show, { name: page.name })}
                  className="flex min-w-0 flex-1 cursor-pointer flex-col items-start text-start"
                >
                  <span className="w-full truncate text-[13px]">{format(t.editor.pages.numbered, { n: i + 1, name: page.name })}</span>
                  <span className="w-full truncate text-[11px] text-muted">{format(formatCount === 1 ? t.editor.pages.formatsOne : t.editor.pages.formatsMany, { n: formatCount })}</span>
                </button>
              )}
              <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
                <Tooltip label={t.editor.pages.duplicate}>
                  <button
                    type="button"
                    aria-label={t.editor.pages.duplicate}
                    onClick={() => show(run('page.duplicate', { id, name: format(t.editor.pages.copyName, { name: page.name }) }))}
                    className={ICON_BUTTON}
                  >
                    <CopyIcon size={14} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip label={t.editor.pages.moveUp}>
                  <button type="button" aria-label={t.editor.pages.moveUp} disabled={i === 0} onClick={() => run('page.move', { id, before: pages[i - 1]?.[0] ?? null })} className={ICON_BUTTON}>
                    <CaretUpIcon size={14} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip label={t.editor.pages.moveDown}>
                  <button type="button" aria-label={t.editor.pages.moveDown} disabled={i === pages.length - 1} onClick={() => run('page.move', { id, before: pages[i + 2]?.[0] ?? null })} className={ICON_BUTTON}>
                    <CaretDownIcon size={14} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip label={t.editor.pages.remove}>
                  <button
                    type="button"
                    aria-label={t.editor.pages.remove}
                    disabled={pages.length === 1}
                    onClick={() => {
                      run('page.delete', { id })
                      if (current === id) setCurrent(null)
                      onRemoved(format(t.editor.pages.removed, { name: page.name }))
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
      </ol>
      <div className="px-[18px] pt-3 pb-4">
        <Tooltip label={t.editor.pages.add}>
          <button type="button" aria-label={t.editor.pages.add} onClick={add} className={CHIP}>
            <PlusIcon size={12} aria-hidden />
            {t.editor.pages.addShort}
          </button>
        </Tooltip>
      </div>
    </section>
  )
}
