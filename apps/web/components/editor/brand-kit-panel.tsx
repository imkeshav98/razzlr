'use client'

// The brand kit (#53), in the Brand flyout. It opens as a picker, as in the final mock: the logo,
// the colours as named tiles and the fonts in their own face. Picking a colour or font binds the
// selected layers to it, so they follow the brand: change the colour and every design using it
// changes. Edit turns the flyout into the kit's form (names, values, families, logo and tone of
// voice); each change there is saved as it is made.
import { CheckIcon, PaintBucketIcon, PencilSimpleIcon, PlusIcon, TextAaIcon, XIcon } from '@phosphor-icons/react'
import type { Editor } from '@razzlr/editor'
import { AssetSummary, brandRef, brandVariables, type BrandColor, type BrandFont, type BrandKit, type Design } from '@razzlr/schema'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { FontPreview, useFontCatalog } from './font-panel.tsx'
import { useEditorDesign } from './formats-panel.tsx'
import { loadKit, saveKit, showKit, useBrandKit } from './use-brand-kit.ts'

/** How long a run of changes (a colour picker's drag) waits before it is saved. */
const SAVE_DELAY_MS = 400

/** A colour as people type it: #RRGGBB, with the alpha only when it isn't opaque. */
const shown = (value: string) => (value.slice(7).toUpperCase() === 'FF' ? value.slice(0, 7) : value).toUpperCase()
/** A typed hex colour as the design stores it, #RRGGBBAA, or null when it isn't one. */
export function parseHex(text: string): string | null {
  const match = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(text.trim())
  return match ? `#${match[1]}${match[2] ?? 'FF'}`.toUpperCase() : null
}

/** A token not yet in the kit, from a name: "Colour 3" gives colour-3. */
function newToken(kit: BrandKit, name: string) {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'token'
  const taken = new Set([...kit.colors, ...kit.fonts].map((x) => x.token))
  let token = base
  for (let n = 2; taken.has(token); n++) token = `${base}-${n}`
  return token
}

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
  const [error, setError] = useState<string | null>(null)
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const { catalog } = useFontCatalog(brandId)
  const { design } = useEditorDesign(editor)
  const selection = useSelection(editor)
  const saving = useRef<{ timer: ReturnType<typeof setTimeout> | null; kit: BrandKit | null }>({ timer: null, kit: null })

  useEffect(() => {
    void loadKit(brandId)
    fetch(`/brands/${encodeURIComponent(brandId)}/assets`)
      .then(async (response) => {
        if (response.ok) setAssets(AssetSummary.array().parse(await response.json()))
      })
      .catch(() => undefined)
  }, [brandId])

  const flush = useCallback(() => {
    const { kit: next } = saving.current
    saving.current = { timer: null, kit: null }
    if (!next) return
    saveKit(brandId, next)
      .then(async (response) => {
        if (response.ok) return setError(null)
        const body: unknown = await response.json().catch(() => null)
        setError(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `${response.status}`)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [brandId])
  // A change waiting to be saved is saved when the flyout closes.
  useEffect(() => () => {
    if (saving.current.timer) clearTimeout(saving.current.timer)
    flush()
  }, [flush])

  /** Shows a change at once, in the kit and in every bound layer, and saves it a moment later. */
  const change = (next: BrandKit) => {
    showKit(brandId, next)
    editor.setVariables(brandVariables(next))
    if (saving.current.timer) clearTimeout(saving.current.timer)
    saving.current = { kit: next, timer: setTimeout(flush, SAVE_DELAY_MS) }
  }

  if (!kit) return <div className="p-4 text-[13px] text-muted" aria-busy="true" />

  const setColor = (i: number, patch: Partial<BrandColor>) => change({ ...kit, colors: kit.colors.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const setFont = (i: number, patch: Partial<BrandFont>) => change({ ...kit, fonts: kit.fonts.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const apply = (kind: 'color' | 'font', token: string) => {
    // A second press on what the selection already follows lets it go.
    editor.bindSelection(kind, follows(design, selection, kind, token) ? null : brandRef(token))
  }
  const families = [...new Set(catalog.map((f) => f.family))]
  // As the mock's flyouts: small spaced capitals over each part, quiet fields, round swatches.
  const heading = 'text-[11px] font-bold tracking-[0.08em] text-subtle uppercase'
  const field = 'h-8 min-w-0 rounded-[8px] border border-line bg-bg/40 px-2 text-[13px] hover:border-line-strong focus:border-accent focus:outline-none'
  const iconButton = 'grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-subtle hover:bg-hover hover:text-text disabled:cursor-default disabled:opacity-40 aria-pressed:bg-accent-soft aria-pressed:text-accent-text'
  const addButton = 'flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-line-strong text-xs font-semibold text-muted hover:border-accent hover:text-text'
  const modeButton = 'flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-muted hover:border-line-strong hover:text-text'
  const textSelected = selection.some((id) => design.nodes[id]?.type === 'text')

  if (!editing) {
    const logo = kit.logoAssetId ? `/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(kit.logoAssetId)}/thumbnail` : null
    return (
      <div data-testid="brand-kit" data-mode="pick" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
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
    <div data-testid="brand-kit" data-mode="edit" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-start gap-3 px-[18px] pb-3">
        <p className="min-w-0 flex-1 text-xs leading-snug text-muted">{t.applyHint}</p>
        <button type="button" onClick={() => setEditing(false)} className={modeButton}>
          <CheckIcon size={13} aria-hidden />
          {t.done}
        </button>
      </div>

      <section aria-labelledby="kit-colors" className="flex flex-col gap-2.5 border-t border-line px-[18px] py-4">
        <h3 id="kit-colors" className={heading}>{t.colors}</h3>
        <ul className="flex flex-col gap-1.5">
          {kit.colors.map((c, i) => {
            const on = follows(design, selection, 'color', c.token)
            return (
              <li key={c.token} data-token={c.token} className="flex items-start gap-1.5">
                <input
                  name="colour"
                  type="color"
                  value={c.value.slice(0, 7)}
                  aria-label={format(t.pick, { name: c.name })}
                  onChange={(e) => setColor(i, { value: `${e.target.value}${c.value.slice(7)}`.toUpperCase() })}
                  className="h-16 w-12 shrink-0 cursor-pointer rounded-[12px] border border-line-strong bg-transparent p-0 [&::-webkit-color-swatch]:rounded-[11px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-moz-color-swatch]:rounded-[11px] [&::-moz-color-swatch]:border-0"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <input
                    name="colour-name"
                    key={`name-${c.name}`}
                    defaultValue={c.name}
                    aria-label={format(t.colorName, { n: i + 1 })}
                    maxLength={60}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && setColor(i, { name: e.target.value.trim() })}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    className={field}
                  />
                  <input
                    name="colour-hex"
                    key={`hex-${c.value}`}
                    defaultValue={shown(c.value)}
                    aria-label={format(t.colorValue, { name: c.name })}
                    spellCheck={false}
                    onBlur={(e) => {
                      const value = parseHex(e.target.value)
                      if (value && value !== c.value) setColor(i, { value })
                      else e.target.value = shown(c.value)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    className={cn(field, 'h-7 font-mono text-xs uppercase')}
                  />
                </div>
                <button
                  type="button"
                  aria-label={format(on ? t.unbind : t.apply, { name: c.name })}
                  aria-pressed={on}
                  disabled={selection.length === 0}
                  onClick={() => apply('color', c.token)}
                  className={iconButton}
                >
                  {on ? <CheckIcon size={15} aria-hidden /> : <PaintBucketIcon size={15} aria-hidden />}
                </button>
                <button type="button" aria-label={format(t.remove, { name: c.name })} onClick={() => change({ ...kit, colors: kit.colors.filter((_, j) => j !== i) })} className={iconButton}>
                  <XIcon size={13} aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
        <button
          type="button"
          onClick={() => {
            const name = format(t.newColor, { n: kit.colors.length + 1 })
            change({ ...kit, colors: [...kit.colors, { token: newToken(kit, name), name, value: '#000000FF' }] })
          }}
          className={addButton}
        >
          <PlusIcon size={13} aria-hidden />
          {t.addColor}
        </button>
      </section>

      <section aria-labelledby="kit-fonts" className="flex flex-col gap-2.5 border-t border-line px-[18px] py-4">
        <h3 id="kit-fonts" className={heading}>{t.fonts}</h3>
        <ul className="flex flex-col gap-1.5">
          {kit.fonts.map((f, i) => {
            const on = follows(design, selection, 'font', f.token)
            return (
              <li key={f.token} data-token={f.token} className="flex items-start gap-1.5">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <input
                    name="font-name"
                    key={`name-${f.name}`}
                    defaultValue={f.name}
                    aria-label={format(t.fontName, { n: i + 1 })}
                    maxLength={60}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== f.name && setFont(i, { name: e.target.value.trim() })}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    className={field}
                  />
                  <select name="font-family" value={f.family} aria-label={format(t.fontFamily, { name: f.name })} onChange={(e) => setFont(i, { family: e.target.value })} className={cn(field, 'h-7 text-xs')}>
                    {[...new Set([f.family, ...families])].map((family) => <option key={family} value={family}>{family}</option>)}
                  </select>
                </div>
                <button
                  type="button"
                  aria-label={format(on ? t.unbind : t.apply, { name: f.name })}
                  aria-pressed={on}
                  disabled={!textSelected}
                  onClick={() => apply('font', f.token)}
                  className={iconButton}
                >
                  {on ? <CheckIcon size={15} aria-hidden /> : <TextAaIcon size={15} aria-hidden />}
                </button>
                <button type="button" aria-label={format(t.remove, { name: f.name })} onClick={() => change({ ...kit, fonts: kit.fonts.filter((_, j) => j !== i) })} className={iconButton}>
                  <XIcon size={13} aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
        <button
          type="button"
          onClick={() => {
            const name = format(t.newFont, { n: kit.fonts.length + 1 })
            change({ ...kit, fonts: [...kit.fonts, { token: newToken(kit, name), name, family: families[0] ?? 'Noto Sans' }] })
          }}
          className={addButton}
        >
          <PlusIcon size={13} aria-hidden />
          {t.addFont}
        </button>
      </section>

      <section aria-labelledby="kit-logo" className="flex flex-col gap-2.5 border-t border-line px-[18px] py-4">
        <h3 id="kit-logo" className={heading}>{t.logo}</h3>
        <div className="flex items-center gap-2">
          <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[12px] border border-line bg-bg/40">
            {kit.logoAssetId && <img src={`/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(kit.logoAssetId)}/thumbnail`} alt="" className="size-full object-contain" />}
          </div>
          <select
            name="logo"
            value={kit.logoAssetId ?? ''}
            aria-label={t.logo}
            onChange={(e) => change({ ...kit, logoAssetId: e.target.value || null })}
            className={cn(field, 'flex-1')}
          >
            <option value="">{t.noLogo}</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
          </select>
        </div>
      </section>

      <section aria-labelledby="kit-voice" className="flex flex-col gap-2.5 border-t border-line px-[18px] py-4">
        <h3 id="kit-voice" className={heading}>{t.voice}</h3>
        <textarea
          name="voice"
          key={`voice-${kit.voice}`}
          defaultValue={kit.voice}
          aria-label={t.voice}
          placeholder={t.voiceHint}
          maxLength={2000}
          rows={3}
          onBlur={(e) => e.target.value !== kit.voice && change({ ...kit, voice: e.target.value })}
          className="resize-y rounded-[8px] border border-line bg-bg/40 px-2 py-1.5 text-[13px] placeholder:text-subtle hover:border-line-strong focus:border-accent focus:outline-none"
        />
      </section>
      {error && <p role="alert" className="px-[18px] pb-4 text-xs text-danger">{format(t.saveFailed, { reason: error })}</p>}
    </div>
  )
}
