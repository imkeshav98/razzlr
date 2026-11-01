'use client'

// The property cards floating at the stage's top end (#83). With nothing selected they show the
// design: the Page card (its background), then Formats and Pages. With a selection they show the
// font when text is selected, then the selection's look and Arrange, with the numbers last (#60):
// as in the final mock, what changes how it looks comes first. Several layers show Arrange first. Each card is only as tall as what it
// holds, and controls are visual first, with numbers behind "Fine-tune".
import type { Editor } from '@dazbee/editor'
import type { Design, Paint } from '@dazbee/schema'
import { useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { ArrangePanel, useSelection } from './arrange-panel.tsx'
import { CARD, CardHeader, FineTune, PICKED_RING, SWATCHES } from './card.tsx'
import { FontPanel } from './font-panel.tsx'
import { FormatsPanel, useEditorDesign } from './formats-panel.tsx'
import { PagesPanel } from './pages-panel.tsx'
import { AddButton, PaintRow, Stack } from './paint-stack.tsx'
import { SelectionCards } from './selection-cards.tsx'
import { useBrandKit } from './use-brand-kit.ts'
import { ViewCard } from './view-card.tsx'


const solidOf = (design: Design, pageId: string) => {
  const fill = design.pages[pageId]?.fills[0]
  return fill?.type === 'solid' ? fill.color.slice(0, 7).toUpperCase() : null
}

const ordered = (design: Design) =>
  Object.entries(design.pages).sort(([a, x], [b, y]) => (x.order < y.order ? -1 : x.order > y.order ? 1 : a < b ? -1 : 1))

function Swatch({ hex, label, on, onPick }: { hex: string; label: string; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      data-swatch={hex}
      onClick={onPick}
      style={{ backgroundColor: hex }}
      className={cn(
        // Round and large, as in the mock.
        'size-7 shrink-0 cursor-pointer rounded-full border border-line-strong transition-transform duration-[var(--chrome-fast)] hover:scale-110',
        on && PICKED_RING,
      )}
    />
  )
}

function PageCard({ editor, brandId, pageId }: { editor: Editor; brandId: string; pageId: string }) {
  const t = useMessages()
  const { design } = useEditorDesign(editor)
  const brandColors = useBrandKit(brandId)?.colors ?? []
  const [fine, setFine] = useState(false)
  const current = solidOf(design, pageId)
  const name = design.pages[pageId]?.name ?? ''
  const fills = design.pages[pageId]?.fills ?? []
  // Each change runs on the page's fills as the document holds them then.
  const writeFills = (to: (now: Paint[]) => Paint[]) => editor.session.run('page.update', { id: pageId, fills: to(editor.design().pages[pageId]?.fills ?? []) })
  const paint = (hex: string) => {
    const color = hex.toUpperCase()
    if (/^#[0-9A-F]{6}$/.test(color) && color !== current) editor.session.run('page.update', { id: pageId, fills: [{ type: 'solid', color: `${color}FF` }] })
  }
  return (
    <section aria-labelledby="page-title" className={CARD} data-testid="page-card">
      <CardHeader id="page-title" title={t.editor.page.title} note={name} />
      {brandColors.length > 0 && (
        <div role="group" aria-label={t.editor.page.brandColors} data-testid="page-brand-colors" className="flex flex-wrap items-center gap-1 px-[18px] pt-0.5 pb-2.5">
          {brandColors.map((c) => {
            const hex = c.value.slice(0, 7).toUpperCase()
            return <Swatch key={c.token} hex={hex} label={`${c.name} ${hex}`} on={current === hex} onPick={() => paint(hex)} />
          })}
        </div>
      )}
      <div role="group" aria-label={t.editor.page.background} className="flex items-center justify-between gap-1 px-[18px] pt-0.5 pb-3.5">
        {SWATCHES.map((hex) => <Swatch key={hex} hex={hex} label={hex} on={current === hex} onPick={() => paint(hex)} />)}
      </div>
      <FineTune open={fine} onToggle={() => setFine(!fine)} label={t.editor.page.fineTune} />
      {fine && (
        <div className="flex flex-col gap-2.5 px-[18px] pb-4">
        <label className="flex items-center gap-2 text-xs text-muted">
          {t.editor.page.hex}
          <input
            name="page-colour"
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
        {/* The page's background as a stack of paints, as a layer's fill: colours, gradients, images. */}
        <div className="flex flex-col gap-2 border-t border-line pt-2.5" data-testid="page-fills">
          <div className="flex items-center justify-between text-xs font-semibold text-muted">
            {t.editor.page.layers}
            <AddButton label={t.editor.page.addLayer} onClick={() => writeFills((now) => [...now, now.length === 0 ? { type: 'solid', color: '#FFFFFFFF' } : { type: 'solid', color: '#00000033' }])} />
          </div>
          <Stack
            items={fills}
            field="fills"
            topFirst
            removeLabel={(n) => format(t.editor.props.remove, { name: t.editor.page.layer, n })}
            onWrite={writeFills}
            render={(item, n, change) => <PaintRow paint={item} name={format(t.editor.page.layerName, { n })} brandId={brandId} editor={editor} p={t.editor.props} onSet={change} />}
          />
        </div>
        </div>
      )}
    </section>
  )
}

export function PropertyCards({ editor, brandId, onRemoved }: { editor: Editor; brandId: string; onRemoved: (message: string) => void }) {
  const selected = useSelection(editor)
  const { design } = useEditorDesign(editor)
  // The page the Page card paints: the one last brought into view from Pages, or the first.
  const [shown, setShown] = useState<string | null>(null)
  const pageId = shown && design.pages[shown] ? shown : ordered(design)[0]?.[0]
  if (selected.length > 0) {
    return (
      <>
        <FontPanel editor={editor} brandId={brandId} />
        <SelectionCards editor={editor} brandId={brandId} ids={selected} arrange={<ArrangePanel editor={editor} />} />
        <ViewCard editor={editor} />
      </>
    )
  }
  return (
    <>
      {pageId && <PageCard editor={editor} brandId={brandId} pageId={pageId} />}
      <FormatsPanel editor={editor} onRemoved={onRemoved} />
      <PagesPanel editor={editor} onRemoved={onRemoved} onShow={setShown} />
      <ViewCard editor={editor} />
    </>
  )
}
