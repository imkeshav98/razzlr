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
import { ICON_BUTTON, useEditorDesign } from './formats-panel.tsx'

const ordered = (design: Design) =>
  Object.entries(design.pages).sort(([a, x], [b, y]) => (x.order < y.order ? -1 : x.order > y.order ? 1 : a < b ? -1 : 1))

export function PagesPanel({ editor, onRemoved }: { editor: Editor; onRemoved: (message: string) => void }) {
  const t = useMessages()
  const { design } = useEditorDesign(editor)
  const pages = ordered(design)
  const [renaming, setRenaming] = useState<string | null>(null)
  // The page last brought into view from here; the stage itself shows every page.
  const [current, setCurrent] = useState<string | null>(null)
  const run = editor.session.run.bind(editor.session)

  const show = (id: string) => {
    setCurrent(id)
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

  return (
    <section aria-labelledby="pages-title" className="border-b border-line">
      <div className="flex h-10 items-center justify-between ps-4 pe-2">
        <h3 id="pages-title" className="text-xs font-semibold tracking-wide text-muted">
          {t.editor.pages.title}
          <span className="ms-1.5 font-mono font-normal text-subtle tabular-nums">{pages.length}</span>
        </h3>
        <Tooltip label={t.editor.pages.add}>
          <button type="button" aria-label={t.editor.pages.add} onClick={add} className={ICON_BUTTON}>
            <PlusIcon size={16} aria-hidden />
          </button>
        </Tooltip>
      </div>
      <ol aria-label={t.editor.pages.title} className="pb-2" data-testid="pages">
        {pages.map(([id, page], i) => (
          <li
            key={id}
            data-page={id}
            aria-current={current === id ? 'page' : undefined}
            className="group mx-2 flex h-[var(--row)] items-center gap-1 rounded-row ps-2 pe-0.5 hover:bg-hover aria-[current]:bg-accent-soft"
          >
            <span aria-hidden className="w-5 shrink-0 font-mono text-[11px] text-subtle tabular-nums">{i + 1}</span>
            {renaming === id ? (
              <input
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
                className="h-6 min-w-0 flex-1 rounded-[6px] border border-accent bg-surface px-1.5 text-[13px] outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => show(id)}
                onDoubleClick={() => setRenaming(id)}
                onKeyDown={(e) => e.key === 'F2' && setRenaming(id)}
                aria-label={format(t.editor.pages.show, { name: page.name })}
                className="min-w-0 flex-1 cursor-pointer truncate text-start text-[13px]"
              >
                {page.name}
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
        ))}
      </ol>
    </section>
  )
}
