'use client'

// The editor's one action at the top end, as in the final mock: a pink Share button. Its menu
// holds what leaves the editor, Export (#55) and Save as template (#54), and each opens its form
// in the same place.
import { BookmarkSimpleIcon, CaretRightIcon, DownloadSimpleIcon, ShareFatIcon } from '@phosphor-icons/react'
import type { Editor } from '@razzlr/editor'
import { useEffect, useId, useRef, useState } from 'react'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { ExportForm } from './export-menu.tsx'
import { useEditorDesign } from './formats-panel.tsx'
import { TemplateForm } from './template-menu.tsx'

type Open = 'menu' | 'export' | 'template' | null

const ROW = 'flex min-h-12 py-1.5 w-full cursor-pointer items-center gap-3 rounded-row px-3 text-start text-[13px] font-medium transition-colors duration-[var(--chrome-fast)] hover:bg-hover focus-visible:bg-hover focus-visible:outline-none'

export function ShareMenu({ editor, brandId, brandName, designName, everyBrand }: {
  editor: Editor
  brandId: string
  brandName: string
  designName: string
  /** How this workspace says "every brand": "All clients" in an agency (ADR-0011). */
  everyBrand: string
}) {
  const t = useMessages()
  const { design } = useEditorDesign(editor)
  const [open, setOpen] = useState<Open>(null)
  const box = useRef<HTMLDivElement>(null)
  const id = useId()

  // Closes on Escape or a press outside.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(null)
    const onPress = (event: PointerEvent) => !box.current?.contains(event.target as Node) && setOpen(null)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPress)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPress)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <Button
        variant="primary"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={id}
        onClick={() => setOpen(open ? null : 'menu')}
        data-testid="share-open"
        className="h-9 rounded-full px-4 text-sm font-semibold"
      >
        <ShareFatIcon size={16} weight="fill" aria-hidden className="rtl:-scale-x-100" />
        {t.editor.share.open}
      </Button>
      {open === 'menu' && (
        <div id={id} role="menu" aria-label={t.editor.share.title} className="pop-in-end absolute end-0 top-full z-30 mt-2 flex w-80 flex-col rounded-card border surface-frost p-1.5 shadow-panel">
          {/* As in the final mock: "Share" and the design's name, then each item with a line on what it does. */}
          <div className="flex items-baseline justify-between gap-3 px-3 pt-2 pb-2.5">
            <span className="font-display text-[15px] font-bold tracking-tight">{t.editor.share.open}</span>
            <span className="min-w-0 truncate text-[11px] font-medium text-muted">{designName}</span>
          </div>
          <button type="button" role="menuitem" className={ROW} onClick={() => setOpen('export')} data-testid="export-open">
            <DownloadSimpleIcon size={18} aria-hidden className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block">{t.editor.exports.open}</span>
              <span className="block truncate text-[11px] font-normal text-muted">{t.editor.share.exportHint}</span>
            </span>
            <CaretRightIcon size={14} aria-hidden className="shrink-0 text-subtle rtl:-scale-x-100" />
          </button>
          <button type="button" role="menuitem" className={ROW} onClick={() => setOpen('template')} data-testid="template-open">
            <BookmarkSimpleIcon size={18} aria-hidden className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block">{t.editor.templates.open}</span>
              <span className="block truncate text-[11px] font-normal text-muted">{format(t.editor.share.templateHint, { brand: brandName, all: everyBrand.toLowerCase() })}</span>
            </span>
            <CaretRightIcon size={14} aria-hidden className="shrink-0 text-subtle rtl:-scale-x-100" />
          </button>
        </div>
      )}
      {open === 'export' && <ExportForm id={id} editor={editor} design={design} />}
      {open === 'template' && <TemplateForm id={id} editor={editor} brandId={brandId} brandName={brandName} designName={designName} everyBrand={everyBrand} />}
    </div>
  )
}
