'use client'

// The brand kit (#53), in the Brand flyout. It opens as a picker, as in the final mock: the logo,
// the colours as named tiles and the fonts in their own face. Picking a colour or font binds the
// selected layers to it, so they follow the brand: change the colour and every design using it
// changes. Edit turns the flyout into the kit's form (kit-editor.tsx), where each change is saved
// as it is made.
import { CheckIcon, PencilSimpleIcon } from '@phosphor-icons/react'
import type { Editor } from '@dazbee/editor'
import { brandRef, brandVariables, type Design } from '@dazbee/schema'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { overlayScroll } from '../ui/overlay-scroll.ts'
import { FontPreview, useFontCatalog } from './font-panel.tsx'
import { useEditorDesign } from './formats-panel.tsx'
import { KitEditor, shown, useKitSaver } from './kit-editor.tsx'
import { loadKit, useBrandKit } from './use-brand-kit.ts'

function useSelection(editor: Editor) {
  const [ids, setIds] = useState(() => editor.selection())
  useEffect(() => {
    const stop = editor.onSelection(setIds)
    return () => {
      stop()
    }
  }, [editor])
  return ids
}

/** Whether every selected layer that can follow a token of this kind follows this one. */
function follows(design: Design, ids: string[], kind: 'color' | 'font', token: string) {
  const refs = ids.flatMap((id) => {
    const node = design.nodes[id]
    if (!node) return []
    if (kind === 'font') return node.type === 'text' ? [node.bindings?.fontFamily] : []
    return [node.type === 'text' ? node.bindings?.textColor : node.bindings?.fill]
  })
  return refs.length > 0 && refs.every((ref) => ref === brandRef(token))
}

export function BrandKitPanel({ editor, brandId }: { editor: Editor; brandId: string }) {
  const t = useMessages().editor.brandKit
  const kit = useBrandKit(brandId)
  const [editing, setEditing] = useState(false)
  const { catalog } = useFontCatalog(brandId)
  const { design } = useEditorDesign(editor)
  const selection = useSelection(editor)
  // A change shows at once in every bound layer too; one waiting to be saved is saved when the flyout closes.
  const { change, error } = useKitSaver(brandId, (next) => editor.setVariables(brandVariables(next)))

  useEffect(() => {
    void loadKit(brandId)
  }, [brandId])

  if (!kit) return <div className="p-4 text-[13px] text-muted" aria-busy="true" />

  const apply = (kind: 'color' | 'font', token: string) => {
    // A second press on what the selection already follows lets it go.
    editor.bindSelection(kind, follows(design, selection, kind, token) ? null : brandRef(token))
  }
  // As the mock's flyouts: small spaced capitals over each part, quiet fields, round swatches.
  const heading = 'text-[11px] font-bold tracking-[0.08em] text-subtle uppercase'
  const modeButton = 'flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-muted hover:border-line-strong hover:text-text'
  const textSelected = selection.some((id) => design.nodes[id]?.type === 'text')

  if (!editing) {
    const logo = kit.logoAssetId ? `/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(kit.logoAssetId)}/thumbnail` : null
    return (
      <div ref={overlayScroll} data-testid="brand-kit" data-mode="pick" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex items-start gap-3 px-[18px] pb-3">
          <p className="min-w-0 flex-1 text-xs leading-snug text-muted">{t.pickHint}</p>
          <button type="button" onClick={() => setEditing(true)} className={modeButton}>
            <PencilSimpleIcon size={13} aria-hidden />
            {t.edit}
          </button>
        </div>

        {logo && (
          <section aria-labelledby="kit-logo" className="flex flex-col gap-2.5 border-t border-line px-[18px] py-4">
            <h3 id="kit-logo" className={heading}>{t.logo}</h3>
            {/* The one logo on a light and a dark ground, to see how it reads on each. */}
            <div className="grid grid-cols-2 gap-2">
              {['bg-white', 'bg-[#1A1420]'].map((ground) => (
                <div key={ground} className={cn('grid aspect-[1.3] place-items-center overflow-hidden rounded-[10px] border border-line p-3', ground)}>
                  <img src={logo} alt="" className="size-full object-contain" />
                </div>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="kit-colors" className="flex flex-col gap-2.5 border-t border-line px-[18px] py-4">
          <h3 id="kit-colors" className={heading}>{t.colors}</h3>
          {kit.colors.length === 0
            ? <p className="text-xs text-muted">{t.noColors}</p>
            : (
              <ul className="grid grid-cols-5 gap-2">
                {kit.colors.map((c) => {
                  const on = follows(design, selection, 'color', c.token)
                  return (
                    <li key={c.token} data-token={c.token}>
                      <button
                        type="button"
                        aria-label={format(on ? t.unbind : t.apply, { name: c.name })}
                        aria-pressed={on}
                        disabled={selection.length === 0}
                        title={`${c.name} · ${shown(c.value)}`}
                        onClick={() => apply('color', c.token)}
                        className="group flex w-full cursor-pointer flex-col gap-1 text-start disabled:cursor-default"
                      >
                        <span
                          style={{ backgroundColor: c.value.slice(0, 7) }}
                          className={cn(
                            'block aspect-square w-full rounded-[10px] border border-line-strong transition-transform duration-[var(--chrome-fast)] group-enabled:group-hover:scale-105',
                            // The followed colour is ringed in pink with a gap, a shape and not only a colour.
                            on && 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--accent)]',
                          )}
                        />
                        <span className="truncate font-mono text-[10px] text-muted">{c.name}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
        </section>

        <section aria-labelledby="kit-fonts" className="flex flex-col gap-1 border-t border-line px-[18px] py-4">
          <h3 id="kit-fonts" className={cn(heading, 'pb-1.5')}>{t.fonts}</h3>
          {kit.fonts.length === 0
            ? <p className="text-xs text-muted">{t.noFonts}</p>
            : (
              <ul className="flex flex-col">
                {kit.fonts.map((f) => {
                  const on = follows(design, selection, 'font', f.token)
                  const family = catalog.find((x) => x.family === f.family)
                  return (
                    <li key={f.token} data-token={f.token} className="border-t border-line first:border-t-0">
                      <button
                        type="button"
                        aria-label={format(on ? t.unbind : t.apply, { name: f.name })}
                        aria-pressed={on}
                        disabled={!textSelected}
                        onClick={() => apply('font', f.token)}
                        className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-[8px] py-2 text-start enabled:hover:bg-hover disabled:cursor-default aria-pressed:text-accent-text"
                      >
                        <span className="min-w-0 flex-1">
                          {family ? <FontPreview brandId={brandId} family={family} big /> : <span className="block truncate text-[20px] font-semibold">{f.family}</span>}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted">{f.name}</span>
                        {on && <CheckIcon size={14} aria-hidden className="shrink-0" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
        </section>
        {error && <p role="alert" className="px-[18px] pb-4 text-xs text-danger">{format(t.saveFailed, { reason: error })}</p>}
      </div>
    )
  }

  return (
    <div ref={overlayScroll} data-testid="brand-kit" data-mode="edit" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-start gap-3 px-[18px] pb-3">
        <p className="min-w-0 flex-1 text-xs leading-snug text-muted">{t.applyHint}</p>
        <button type="button" onClick={() => setEditing(false)} className={modeButton}>
          <CheckIcon size={13} aria-hidden />
          {t.done}
        </button>
      </div>

      <KitEditor
        brandId={brandId}
        kit={kit}
        change={change}
        error={error}
        binding={{
          follows: (kind, token) => follows(design, selection, kind, token),
          apply,
          canColor: selection.length > 0,
          canFont: textSelected,
        }}
      />
    </div>
  )
}
