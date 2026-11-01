'use client'

// The brand kit's form (#53, #200): colours with names and values, fonts with names and families,
// the logo and the tone of voice. Each change shows at once and is saved a moment later. The
// editor's Brand flyout shows it in its Edit mode, with buttons that bind the selected layers to a
// colour or font; the brand home shows it in its Brand kit panel, laid out wide, without them.
import { CheckIcon, PaintBucketIcon, PlusIcon, TextAaIcon, UploadSimpleIcon, XIcon } from '@phosphor-icons/react'
import { AssetSummary, type BrandColor, type BrandFont, type BrandKit } from '@dazbee/schema'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { ASSET_ACCEPT, sendAsset } from '../../lib/upload-asset.ts'
import { Select } from '../ui/select.tsx'
import { DASHED_BUTTON } from './styles.ts'
import { useFontCatalog } from './font-panel.tsx'
import { saveKit, showKit } from './use-brand-kit.ts'

/** How long a run of changes (a colour picker's drag) waits before it is saved. */
const SAVE_DELAY_MS = 400

/** A colour as people type it: #RRGGBB, with the alpha only when it isn't opaque. */
export const shown = (value: string) => (value.slice(7).toUpperCase() === 'FF' ? value.slice(0, 7) : value).toUpperCase()
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

/**
 * Shows a kit change at once and saves it a moment later; a change still waiting is saved when the
 * component using this goes. `onShow` hears each change as it shows, as the editor's layers do.
 */
export function useKitSaver(brandId: string, onShow?: (kit: BrandKit) => void) {
  const [error, setError] = useState<string | null>(null)
  const saving = useRef<{ timer: ReturnType<typeof setTimeout> | null; kit: BrandKit | null }>({ timer: null, kit: null })
  const shows = useRef(onShow)
  shows.current = onShow

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
  useEffect(() => () => {
    if (saving.current.timer) clearTimeout(saving.current.timer)
    flush()
  }, [flush])

  const change = useCallback((next: BrandKit) => {
    showKit(brandId, next)
    shows.current?.(next)
    if (saving.current.timer) clearTimeout(saving.current.timer)
    saving.current = { kit: next, timer: setTimeout(flush, SAVE_DELAY_MS) }
  }, [brandId, flush])

  return { change, error }
}

/** Binds the selected layers to a kit colour or font, in the editor. */
export interface KitBinding {
  follows: (kind: 'color' | 'font', token: string) => boolean
  apply: (kind: 'color' | 'font', token: string) => void
  /** Whether anything is selected that can follow a colour, or a font. */
  canColor: boolean
  canFont: boolean
}

export function KitEditor({ brandId, kit, change, error, binding, wide = false }: {
  brandId: string
  kit: BrandKit
  change: (next: BrandKit) => void
  error: string | null
  binding?: KitBinding
  /** Laid out across the brand home's panel instead of down the editor's flyout. */
  wide?: boolean
}) {
  const t = useMessages().editor.brandKit
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [upload, setUpload] = useState<{ progress: number } | { error: string } | null>(null)
  const files = useRef<HTMLInputElement>(null)
  const { catalog } = useFontCatalog(brandId)

  useEffect(() => {
    fetch(`/brands/${encodeURIComponent(brandId)}/assets`)
      .then(async (response) => {
        if (response.ok) setAssets(AssetSummary.array().parse(await response.json()))
      })
      .catch(() => undefined)
  }, [brandId])

  const setColor = (i: number, patch: Partial<BrandColor>) => change({ ...kit, colors: kit.colors.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const setFont = (i: number, patch: Partial<BrandFont>) => change({ ...kit, fonts: kit.fonts.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const uploadLogo = (file: File) => {
    setUpload({ progress: 0 })
    sendAsset(brandId, file, (progress) => setUpload({ progress }))
      .then((asset) => {
        setAssets((all) => [asset, ...all])
        setUpload(null)
        change({ ...kit, logoAssetId: asset.id })
      })
      .catch((e: unknown) => setUpload({ error: e instanceof Error ? e.message : String(e) }))
  }
  const families = [...new Set(catalog.map((f) => f.family))]
  // As the mock's flyouts: small spaced capitals over each part, quiet fields, round swatches.
  const heading = 'text-[11px] font-bold tracking-[0.08em] text-subtle uppercase'
  const section = wide
    ? 'flex min-w-0 flex-col gap-2.5 rounded-[16px] border border-line bg-bg/40 p-4'
    : 'flex flex-col gap-2.5 border-t border-line px-[18px] py-4'
  const field = 'h-8 min-w-0 rounded-[8px] border border-line bg-bg/40 px-2 text-[13px] hover:border-line-strong focus:border-accent focus:outline-none'
  const iconButton = 'grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-subtle hover:bg-hover hover:text-text disabled:cursor-default disabled:opacity-40 aria-pressed:bg-accent-soft aria-pressed:text-accent-text'

  const colours = (
    <section key="colours" aria-labelledby="kit-colors" className={section}>
      <h3 id="kit-colors" className={heading}>{t.colors}</h3>
      <ul className="flex flex-col gap-1.5">
        {kit.colors.map((c, i) => {
          const on = binding?.follows('color', c.token) ?? false
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
              {binding && (
                <button
                  type="button"
                  aria-label={format(on ? t.unbind : t.apply, { name: c.name })}
                  aria-pressed={on}
                  disabled={!binding.canColor}
                  onClick={() => binding.apply('color', c.token)}
                  className={iconButton}
                >
                  {on ? <CheckIcon size={15} aria-hidden /> : <PaintBucketIcon size={15} aria-hidden />}
                </button>
              )}
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
        className={DASHED_BUTTON}
      >
        <PlusIcon size={13} aria-hidden />
        {t.addColor}
      </button>
    </section>
  )

  const fonts = (
    <section key="fonts" aria-labelledby="kit-fonts" className={section}>
      <h3 id="kit-fonts" className={heading}>{t.fonts}</h3>
      <ul className="flex flex-col gap-1.5">
        {kit.fonts.map((f, i) => {
          const on = binding?.follows('font', f.token) ?? false
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
                <Select
                  name="font-family"
                  label={format(t.fontFamily, { name: f.name })}
                  value={f.family}
                  options={[...new Set([f.family, ...families])].map((family) => ({ value: family, label: family }))}
                  onChange={(family) => setFont(i, { family })}
                  className="h-7 bg-bg/40 px-2 text-xs"
                />
              </div>
              {binding && (
                <button
                  type="button"
                  aria-label={format(on ? t.unbind : t.apply, { name: f.name })}
                  aria-pressed={on}
                  disabled={!binding.canFont}
                  onClick={() => binding.apply('font', f.token)}
                  className={iconButton}
                >
                  {on ? <CheckIcon size={15} aria-hidden /> : <TextAaIcon size={15} aria-hidden />}
                </button>
              )}
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
        className={DASHED_BUTTON}
      >
        <PlusIcon size={13} aria-hidden />
        {t.addFont}
      </button>
    </section>
  )

  const logo = (
    <section key="logo" aria-labelledby="kit-logo" className={section}>
      <h3 id="kit-logo" className={heading}>{t.logo}</h3>
      <div className="flex items-center gap-2">
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[12px] border border-line bg-bg/40">
          {kit.logoAssetId && <img src={`/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(kit.logoAssetId)}/thumbnail`} alt="" className="size-full object-contain" />}
        </div>
        <Select
          name="logo"
          label={t.logo}
          value={kit.logoAssetId ?? ''}
          options={[{ value: '', label: t.noLogo }, ...assets.map((a) => ({ value: a.id, label: a.name || a.id }))]}
          onChange={(id) => change({ ...kit, logoAssetId: id || null })}
          className="h-8 min-w-0 flex-1 bg-bg/40 px-2 text-[13px]"
        />
        <button
          type="button"
          aria-label={t.uploadLogo}
          title={t.uploadLogo}
          disabled={upload !== null && 'progress' in upload}
          onClick={() => files.current?.click()}
          className={iconButton}
        >
          <UploadSimpleIcon size={15} aria-hidden />
        </button>
        <input
          ref={files}
          name="logo-file"
          type="file"
          accept={ASSET_ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) uploadLogo(file)
          }}
        />
      </div>
      {upload && 'progress' in upload && <p role="status" className="text-xs text-muted tabular-nums">{format(t.uploading, { percent: Math.round(upload.progress * 100) })}</p>}
      {upload && 'error' in upload && <p role="alert" className="text-xs text-danger">{format(t.uploadFailed, { reason: upload.error })}</p>}
    </section>
  )

  const voice = (
    <section key="voice" aria-labelledby="kit-voice" className={section}>
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
  )

  const failed = error && <p role="alert" className={cn('text-xs text-danger', !wide && 'px-[18px] pb-4')}>{format(t.saveFailed, { reason: error })}</p>

  // Wide: the logo and voice beside the colours and fonts, as the mock's panel; the flyout keeps the
  // editor's order, colours first.
  return wide
    ? (
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {colours}
          {fonts}
          <div className="flex min-w-0 flex-col gap-3">
            {logo}
            {voice}
          </div>
        </div>
        {failed}
      </div>
    )
    : (
      <>
        {colours}
        {fonts}
        {logo}
        {voice}
        {failed}
      </>
    )
}
