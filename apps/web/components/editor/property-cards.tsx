'use client'

// The property cards floating at the stage's top end (#83). With nothing selected they show the
// design: the Page card (its background), then Formats and Pages. With a selection they show
// Arrange; the selection's own properties join it with #60. Each card is only as tall as what it
// holds, and controls are visual first, with numbers behind "Fine-tune".
import { CheckIcon, PlusIcon } from '@phosphor-icons/react'
import type { Editor } from '@razzlr/editor'
import type { Design } from '@razzlr/schema'
import { useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { ArrangePanel, useSelection } from './arrange-panel.tsx'
import { CARD, CardHeader } from './card.tsx'
import { FormatsPanel, useEditorDesign } from './formats-panel.tsx'
import { PagesPanel } from './pages-panel.tsx'

/** Page backgrounds a click away; the Fine-tune row takes any colour. */
const SWATCHES = ['#FFFFFF', '#FBF7F2', '#1A1420', '#FF48B0', '#3D6BFF', '#FFD23F', '#3DD68C', '#FF6B3D'] as const

const solidOf = (design: Design, pageId: string) => {
  const fill = design.pages[pageId]?.fills[0]
  return fill?.type === 'solid' ? fill.color.slice(0, 7).toUpperCase() : null
}

const ordered = (design: Design) =>
  Object.entries(design.pages).sort(([a, x], [b, y]) => (x.order < y.order ? -1 : x.order > y.order ? 1 : a < b ? -1 : 1))

function PageCard({ editor, pageId }: { editor: Editor; pageId: string }) {
  const t = useMessages()
  const { design } = useEditorDesign(editor)
  const [fine, setFine] = useState(false)
  const current = solidOf(design, pageId)
  const name = design.pages[pageId]?.name ?? ''
  const paint = (hex: string) => {
    const color = hex.toUpperCase()
    if (/^#[0-9A-F]{6}$/.test(color) && color !== current) editor.session.run('page.update', { id: pageId, fills: [{ type: 'solid', color: `${color}FF` }] })
  }
  return (
    <section aria-labelledby="page-title" className={CARD} data-testid="page-card">
      <CardHeader id="page-title" title={format(t.editor.page.title, { name })} />
      <div role="group" aria-label={t.editor.page.background} className="grid grid-cols-8 gap-1.5 px-4 pb-3">
        {SWATCHES.map((hex) => {
          const on = current === hex
          return (
            <button
              key={hex}
              type="button"
              aria-label={hex}
              aria-pressed={on}
              data-swatch={hex}
              onClick={() => paint(hex)}
              style={{ backgroundColor: hex }}
              className={cn(
                'grid aspect-square w-full cursor-pointer place-items-center rounded-full border border-line-strong transition-transform duration-[var(--chrome-fast)] hover:scale-110',
                on && 'ring-2 ring-ring ring-offset-2 ring-offset-raised',
              )}
            >
              {/* Not by colour alone: the picked swatch carries a check, dark or light to stand out. */}
              {on && <CheckIcon size={14} weight="bold" aria-hidden className={hex === '#1A1420' || hex === '#3D6BFF' ? 'text-white' : 'text-[#1A1420]'} />}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        aria-expanded={fine}
        onClick={() => setFine(!fine)}
        className="flex h-9 w-full cursor-pointer items-center gap-1.5 border-t border-line px-4 text-xs font-medium text-muted transition-colors hover:text-text"
      >
        <PlusIcon size={12} aria-hidden className={cn('transition-transform duration-[var(--chrome-fast)]', fine && 'rotate-45')} />
        {t.editor.page.fineTune}
      </button>
      {fine && (
        <label className="flex items-center gap-2 px-4 pb-3 text-xs text-muted">
          {t.editor.page.hex}
          <input
            key={current ?? ''}
            defaultValue={current ?? ''}
            placeholder="#FFFFFF"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') paint(e.currentTarget.value.startsWith('#') ? e.currentTarget.value : `#${e.currentTarget.value}`)
            }}
            onBlur={(e) => paint(e.currentTarget.value.startsWith('#') ? e.currentTarget.value : `#${e.currentTarget.value}`)}
            className="h-8 min-w-0 flex-1 rounded-row border border-line bg-surface px-2 font-mono text-[13px] text-text uppercase outline-none focus:border-accent"
          />
        </label>
      )}
    </section>
  )
}

export function PropertyCards({ editor, onRemoved }: { editor: Editor; onRemoved: (message: string) => void }) {
  const selected = useSelection(editor)
  const { design } = useEditorDesign(editor)
  // The page the Page card paints: the one last brought into view from Pages, or the first.
  const [shown, setShown] = useState<string | null>(null)
  const pageId = shown && design.pages[shown] ? shown : ordered(design)[0]?.[0]
  if (selected.length > 0) return <ArrangePanel editor={editor} />
  return (
    <>
      {pageId && <PageCard editor={editor} pageId={pageId} />}
      <FormatsPanel editor={editor} onRemoved={onRemoved} />
      <PagesPanel editor={editor} onRemoved={onRemoved} onShow={setShown} />
    </>
  )
}
