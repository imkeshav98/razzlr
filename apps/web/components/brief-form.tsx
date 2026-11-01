'use client'

// The brief's form (#136), as in the final mock: a few words, then a chat-style toolbar. + adds a
// reference ad (one of the brand's designs) or uploads images into the brand's assets, each shown
// as a thumbnail above the brief; the Formats dropdown picks the formats to make; the Brand kit
// button opens the whole kit to pick from. Every choice is a form field, so Make drafts sends it
// with the brief. The format checkboxes are in the page from the start, so the form works before
// any script loads.
import { ArrowLeftIcon, CaretDownIcon, CheckIcon, CircleNotchIcon, LayoutIcon, PlusIcon, SparkleIcon, UploadSimpleIcon, XIcon } from '@phosphor-icons/react'
import * as Popover from '@radix-ui/react-popover'
import { FORMAT_PRESETS, type AssetSummary, type BrandKit } from '@razzlr/schema'
import { useRef, useState, type ReactNode } from 'react'
import { BRIEF_FORMATS, type BriefFormat } from '../lib/brief.ts'
import { cn } from '../lib/cn.ts'
import { useMessages } from '../lib/i18n/client.tsx'
import { format } from '../lib/i18n/index.ts'
import { ASSET_ACCEPT, sendAsset } from '../lib/upload-asset.ts'
import { overlayScroll } from './ui/overlay-scroll.ts'
import { Tooltip } from './ui/tooltip.tsx'

/** A design a brief can start from, with its picture's size when it has one. */
export type BriefReference = { id: string; name: string; updatedAt: string; cover: { width: number; height: number } | null }

type Popup = 'add' | 'formats' | 'kit'

interface Upload { key: string; name: string; progress: number; asset?: AssetSummary; error?: string }

const TOOL = cn(
  'inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-line px-3 text-[13px] font-semibold text-muted select-none',
  'transition-[background-color,border-color,color] duration-[var(--chrome-fast)] hover:border-line-strong hover:text-text',
  'aria-expanded:border-accent aria-expanded:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
)
const ROUND = cn(TOOL, 'w-9 justify-center px-0')
const PANEL = 'pop-in z-40 w-[min(18rem,calc(100vw-2rem))] rounded-card border surface-frost p-1.5 shadow-panel outline-none'
const ROW = 'flex w-full cursor-pointer items-center gap-3 rounded-row px-2.5 py-2 text-start text-[13px] text-text transition-colors duration-[var(--chrome-fast)] hover:bg-hover focus-visible:bg-hover focus-visible:outline-none'
const LABEL = 'px-1 pt-3 pb-1.5 text-[10px] font-bold tracking-[0.08em] text-subtle uppercase'

const designThumbnail = (brandId: string, design: BriefReference) =>
  `/brands/${encodeURIComponent(brandId)}/designs/${encodeURIComponent(design.id)}/thumbnail?v=${Date.parse(design.updatedAt)}`
const assetThumbnail = (brandId: string, assetId: string) =>
  `/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(assetId)}/thumbnail`

/** A format's outline in its proportions, at most `size` pixels on its long side. */
function Shape({ id, size }: { id: string; size: number }) {
  const preset = FORMAT_PRESETS.find((p) => p.id === id)
  if (!preset) return null
  const scale = size / Math.max(preset.width, preset.height)
  return <span aria-hidden className="block shrink-0 rounded-[2px] border-[1.5px] border-current" style={{ width: Math.max(5, preset.width * scale), height: Math.max(5, preset.height * scale) }} />
}

/** A tick that shows whether a part is picked, as a filled or empty box. */
function Tick({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn('grid size-4 shrink-0 place-items-center rounded-[4px] border-[1.5px]', on ? 'border-accent-solid bg-accent-solid text-on-accent' : 'border-line-strong')}>
      {on && <CheckIcon size={10} weight="bold" />}
    </span>
  )
}

export function BriefForm({ brandId, brandName, kit, references, action }: {
  brandId: string
  brandName: string
  kit: BrandKit
  references: BriefReference[]
  action: (form: FormData) => Promise<void>
}) {
  const t = useMessages()
  const h = t.home
  const k = h.kit
  const [open, setOpen] = useState<Popup | null>(null)
  const [adding, setAdding] = useState<'menu' | 'reference'>('menu')
  const [formats, setFormats] = useState<BriefFormat[]>([BRIEF_FORMATS[0]])
  const [reference, setReference] = useState<BriefReference | null>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [useKit, setUseKit] = useState(true)
  const [colors, setColors] = useState(() => new Set(kit.colors.map((c) => c.token)))
  const [fonts, setFonts] = useState(() => new Set(kit.fonts.map((f) => f.token)))
  const [logo, setLogo] = useState(true)
  const [voice, setVoice] = useState(true)
  const files = useRef<HTMLInputElement>(null)

  const toggle = (popup: Popup) => (next: boolean) => {
    setOpen(next ? popup : null)
    if (next && popup === 'add') setAdding('menu')
  }
  const flip = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  }

  const pickFormat = (id: BriefFormat, on: boolean) => setFormats((now) => {
    // The last picked format stays: a brief makes at least one.
    if (!on && now.length === 1) return now
    return on ? BRIEF_FORMATS.filter((f) => f === id || now.includes(f)) : now.filter((f) => f !== id)
  })

  const upload = (picked: File[]) => {
    for (const file of picked) {
      const key = crypto.randomUUID()
      const change = (patch: Partial<Upload>) => setUploads((all) => all.map((u) => (u.key === key ? { ...u, ...patch } : u)))
      setUploads((all) => [...all, { key, name: file.name, progress: 0 }])
      sendAsset(brandId, file, (progress) => change({ progress }))
        .then((asset) => change({ asset, progress: 1 }))
        .catch((e: unknown) => change({ error: e instanceof Error ? e.message : String(e) }))
    }
  }

  const formatFields = (
    <fieldset>
      <legend className="sr-only">{h.formats}</legend>
      {BRIEF_FORMATS.map((id) => {
        const on = formats.includes(id)
        const last = on && formats.length === 1
        return (
          <label key={id} className={cn(ROW, 'has-[:focus-visible]:bg-hover')} title={last ? h.lastFormat : undefined}>
            <input
              type="checkbox"
              name="format"
              value={id}
              checked={on}
              onChange={(e) => pickFormat(id, e.target.checked)}
              aria-describedby={last ? 'brief-last-format' : undefined}
              className="sr-only"
              data-testid={`brief-format-${id}`}
            />
            <Tick on={on} />
            <span className="grid w-5 shrink-0 place-items-center text-muted"><Shape id={id} size={16} /></span>
            <span className="flex-1">{h.chips[id]}</span>
          </label>
        )
      })}
      {formats.length === 1 && <p id="brief-last-format" className="px-2.5 pt-1 pb-1.5 text-[11px] text-subtle">{h.lastFormat}</p>}
    </fieldset>
  )

  const ring = kit.colors.length > 0
    ? `conic-gradient(${kit.colors.slice(0, 6).map((c, i, all) => `${c.value} ${(i / all.length) * 100}% ${((i + 1) / all.length) * 100}%`).join(', ')})`
    : undefined
  const kitEmpty = kit.colors.length === 0 && kit.fonts.length === 0 && !kit.logoAssetId && !kit.voice.trim()
  const hasAttachments = reference !== null || uploads.length > 0

  return (
    <form action={action} className="rounded-[20.5px] bg-surface p-3 md:px-5 md:py-4">
      {hasAttachments && (
        <ul aria-label={h.attachments} className="mb-2 flex flex-wrap gap-2 px-1 pt-1" data-testid="brief-attachments">
          {reference && (
            <Attachment
              name={reference.name}
              tag={h.referenceTag}
              removeLabel={format(h.remove, { name: reference.name })}
              onRemove={() => setReference(null)}
              testId="brief-reference"
            >
              {reference.cover && <img src={designThumbnail(brandId, reference)} alt="" className="size-full object-cover" />}
            </Attachment>
          )}
          {uploads.map((u) => (
            <Attachment
              key={u.key}
              name={u.error ? format(h.uploadFailed, { name: u.name, reason: u.error }) : u.asset ? u.name : format(h.uploading, { name: u.name })}
              tag={h.imageTag}
              removeLabel={format(h.remove, { name: u.name })}
              onRemove={() => setUploads((all) => all.filter((x) => x.key !== u.key))}
              failed={Boolean(u.error)}
              testId="brief-image"
            >
              {u.asset
                ? <img src={assetThumbnail(brandId, u.asset.id)} alt="" className="size-full object-cover" />
                : !u.error && <CircleNotchIcon size={18} aria-hidden className="animate-spin text-muted" />}
            </Attachment>
          ))}
        </ul>
      )}
      {reference && <input type="hidden" name="reference" value={reference.id} />}
      {uploads.flatMap((u) => (u.asset ? [<input key={u.key} type="hidden" name="image" value={u.asset.id} />] : []))}
      {useKit && (
        <>
          <input type="hidden" name="kit" value="on" />
          {kit.colors.filter((c) => colors.has(c.token)).map((c) => <input key={c.token} type="hidden" name="kitColor" value={c.token} />)}
          {kit.fonts.filter((f) => fonts.has(f.token)).map((f) => <input key={f.token} type="hidden" name="kitFont" value={f.token} />)}
          {kit.logoAssetId && logo && <input type="hidden" name="kitLogo" value={kit.logoAssetId} />}
          {kit.voice.trim() && voice && <input type="hidden" name="kitVoice" value="on" />}
        </>
      )}

      <label htmlFor="brief" className="sr-only">{h.brief}</label>
      <textarea
        id="brief"
        name="brief"
        rows={1}
        maxLength={2000}
        placeholder={h.briefPlaceholder}
        // One line, as in the final mock, growing with what is written.
        className="block max-h-48 min-h-9 w-full resize-none bg-transparent px-1 py-1 text-base text-text [field-sizing:content] placeholder:text-subtle focus:outline-none md:text-[17px]"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* + : a reference ad, or images uploaded to the brand's assets. */}
        <Popover.Root open={open === 'add'} onOpenChange={toggle('add')}>
          <Tooltip label={h.add}>
            <Popover.Trigger asChild>
              <button type="button" aria-label={h.add} className={ROUND} data-testid="brief-add">
                <PlusIcon size={16} weight="bold" aria-hidden />
              </button>
            </Popover.Trigger>
          </Tooltip>
          <Popover.Content align="start" sideOffset={8} collisionPadding={16} aria-label={adding === 'menu' ? h.add : h.pickReference} className={PANEL}>
            {adding === 'menu'
              ? (
                <div className="flex flex-col">
                  <button type="button" onClick={() => setAdding('reference')} className={ROW}>
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-row bg-hover text-muted"><LayoutIcon size={18} /></span>
                    <span className="min-w-0">
                      <span className="block font-semibold">{h.reference}</span>
                      <span className="block text-xs text-muted">{h.referenceHint}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(null)
                      files.current?.click()
                    }}
                    className={ROW}
                  >
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-row bg-hover text-muted"><UploadSimpleIcon size={18} /></span>
                    <span className="min-w-0">
                      <span className="block font-semibold">{h.upload}</span>
                      <span className="block text-xs text-muted">{h.uploadHint}</span>
                    </span>
                  </button>
                </div>
              )
              : (
                <div className="flex flex-col">
                  <div className="flex items-center gap-1 pb-1">
                    <button type="button" aria-label={h.back} onClick={() => setAdding('menu')} className="grid size-8 cursor-pointer place-items-center rounded-row text-subtle hover:bg-hover hover:text-text">
                      <ArrowLeftIcon size={16} aria-hidden className="rtl:-scale-x-100" />
                    </button>
                    <span className="text-[13px] font-semibold">{h.pickReference}</span>
                  </div>
                  {references.length === 0
                    ? <p className="px-2 pb-2 text-xs text-muted">{h.noReferences}</p>
                    : (
                      <ul ref={overlayScroll} aria-label={h.pickReference} className="grid max-h-72 grid-cols-3 gap-1.5 overflow-y-auto p-0.5" data-testid="brief-references">
                        {references.map((design) => (
                          <li key={design.id}>
                            <button
                              type="button"
                              aria-label={design.name}
                              aria-pressed={reference?.id === design.id}
                              title={design.name}
                              onClick={() => {
                                setReference(design)
                                setOpen(null)
                              }}
                              className="relative block aspect-square w-full cursor-pointer overflow-hidden rounded-[8px] border border-line bg-hover transition-colors hover:border-line-strong aria-pressed:border-accent"
                            >
                              {design.cover && <img src={designThumbnail(brandId, design)} alt="" width={design.cover.width} height={design.cover.height} loading="lazy" className="size-full object-cover" />}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
              )}
          </Popover.Content>
        </Popover.Root>
        <input
          id="brief-images"
          ref={files}
          type="file"
          accept={ASSET_ACCEPT}
          multiple
          hidden
          data-testid="brief-upload"
          onChange={(e) => {
            upload([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />

        {/* Formats: the four everyday ones, at least one picked. */}
        <Popover.Root open={open === 'formats'} onOpenChange={toggle('formats')}>
          <Popover.Trigger asChild>
            <button type="button" className={TOOL} data-testid="brief-formats">
              <span aria-hidden className="flex items-center gap-0.5">
                {formats.slice(0, 3).map((id) => <Shape key={id} id={id} size={13} />)}
              </span>
              {formats.length === 1 ? h.formatsOne : format(h.formatsMany, { n: formats.length })}
              <CaretDownIcon size={12} weight="bold" aria-hidden />
            </button>
          </Popover.Trigger>
          <Popover.Content align="start" sideOffset={8} collisionPadding={16} aria-label={h.formats} className={cn(PANEL, 'w-56')}>
            {formatFields}
          </Popover.Content>
        </Popover.Root>
        {/* While the dropdown is closed the same checkboxes stay in the form, hidden, so the picked
            formats are sent even before any script runs. */}
        {open !== 'formats' && <div hidden>{formatFields}</div>}

        {/* Brand kit: a ring in the kit's colours, pressed while the kit is in use. */}
        <Popover.Root open={open === 'kit'} onOpenChange={toggle('kit')}>
          <Tooltip label={useKit ? k.on : k.off}>
            <Popover.Trigger asChild>
              <button type="button" aria-label={h.brandKit} aria-pressed={useKit} className={cn(ROUND, useKit && 'border-accent bg-accent-soft')} data-testid="brief-kit">
                <span aria-hidden className={cn('relative size-[18px] rounded-full', !ring && 'border-[3px] border-line-strong')} style={ring ? { background: ring } : undefined}>
                  {ring && <span className={cn('absolute inset-[4px] rounded-full', useKit ? 'bg-[color-mix(in_oklab,var(--surface)_80%,var(--accent))]' : 'bg-surface')} />}
                </span>
              </button>
            </Popover.Trigger>
          </Tooltip>
          <Popover.Content align="start" sideOffset={8} collisionPadding={16} aria-label={h.brandKit} className={cn(PANEL, 'w-[min(20rem,calc(100vw-2rem))] p-3')} data-testid="brief-kit-panel">
            <div className="flex items-center gap-2 px-1">
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="shrink-0 font-display text-[15px] font-bold">{h.brandKit}</span>
                <span className="truncate text-xs font-medium text-muted">{brandName}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={useKit}
                aria-label={k.use}
                onClick={() => setUseKit(!useKit)}
                className={cn('relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-[var(--chrome-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', useKit ? 'bg-accent-solid' : 'bg-line-strong')}
              >
                <span aria-hidden className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-[inset-inline-start] duration-[var(--chrome-fast)]', useKit ? 'start-[18px]' : 'start-0.5')} />
              </button>
            </div>
            {kitEmpty
              ? <p className="px-1 pt-3 text-xs text-muted">{k.empty}</p>
              : (
                <div className={cn('transition-opacity duration-[var(--chrome-fast)]', !useKit && 'pointer-events-none opacity-45')} aria-disabled={!useKit || undefined}>
                  {kit.logoAssetId && (
                    <KitSection label={k.logo}>
                      <button type="button" aria-pressed={logo} disabled={!useKit} onClick={() => setLogo(!logo)} className={cn(ROW, 'px-1')}>
                        <span className={cn('size-10 shrink-0 overflow-hidden rounded-[8px] border bg-hover', logo ? 'border-accent' : 'border-line')}>
                          <img src={assetThumbnail(brandId, kit.logoAssetId)} alt="" className="size-full object-contain" />
                        </span>
                        <span className="flex-1 text-muted">{k.logo}</span>
                        <Tick on={logo} />
                      </button>
                    </KitSection>
                  )}
                  {kit.colors.length > 0 && (
                    <KitSection label={k.colors}>
                      <div className="grid grid-cols-4 gap-1.5 px-1">
                        {kit.colors.map((c) => {
                          const on = colors.has(c.token)
                          return (
                            <button
                              key={c.token}
                              type="button"
                              aria-pressed={on}
                              aria-label={c.name}
                              title={c.name}
                              disabled={!useKit}
                              onClick={() => setColors(flip(colors, c.token))}
                              data-token={c.token}
                              className="group flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-row py-1 focus-visible:outline-2 focus-visible:outline-ring"
                            >
                              <span
                                aria-hidden
                                className={cn('size-7 rounded-full border border-white/15 transition-shadow', on && 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--accent)]')}
                                style={{ backgroundColor: c.value }}
                              />
                              <span aria-hidden className={cn('w-full truncate text-center text-[10px]', on ? 'text-text' : 'text-subtle line-through')}>{c.name}</span>
                            </button>
                          )
                        })}
                      </div>
                    </KitSection>
                  )}
                  {kit.fonts.length > 0 && (
                    <KitSection label={k.fonts}>
                      {kit.fonts.map((f) => (
                        <button key={f.token} type="button" aria-pressed={fonts.has(f.token)} disabled={!useKit} onClick={() => setFonts(flip(fonts, f.token))} className={cn(ROW, 'px-1 py-1.5')} data-token={f.token}>
                          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                            <span className="truncate font-semibold">{f.family}</span>
                            <span className="shrink-0 text-xs text-muted">{f.name}</span>
                          </span>
                          <Tick on={fonts.has(f.token)} />
                        </button>
                      ))}
                    </KitSection>
                  )}
                  {kit.voice.trim() && (
                    <KitSection label={k.voice}>
                      <button type="button" aria-pressed={voice} disabled={!useKit} onClick={() => setVoice(!voice)} className={cn(ROW, 'items-start px-1 py-1.5')}>
                        <span className="line-clamp-2 min-w-0 flex-1 text-muted">{kit.voice}</span>
                        <Tick on={voice} />
                      </button>
                    </KitSection>
                  )}
                  <p className="mt-2.5 border-t border-line px-1 pt-2.5 text-xs text-muted tabular-nums" data-testid="brief-kit-summary">
                    {format(k.summary, { colors: colors.size, allColors: kit.colors.length, fonts: fonts.size, allFonts: kit.fonts.length })}
                  </p>
                </div>
              )}
          </Popover.Content>
        </Popover.Root>

        <button
          type="submit"
          title={h.makeHint}
          className="ai-glow relative ms-auto inline-flex h-10 cursor-pointer items-center gap-2 overflow-hidden rounded-[12px] px-5 text-sm font-semibold text-white shadow-panel transition-transform duration-[var(--chrome-fast)] active:scale-[0.97] motion-reduce:active:scale-100"
        >
          <span aria-hidden className="ai-sheen" />
          <SparkleIcon size={16} weight="fill" aria-hidden />
          {h.make}
        </button>
      </div>
    </form>
  )
}

/** One part of the kit: its small heading, then what can be picked. */
function KitSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <h3 className={LABEL}>{label}</h3>
      {children}
    </section>
  )
}

/** A thumbnail above the brief, its tag along the bottom and ✕ at the top end corner. */
function Attachment({ name, tag, removeLabel, onRemove, failed = false, testId, children }: {
  name: string
  tag: string
  removeLabel: string
  onRemove: () => void
  failed?: boolean
  testId: string
  children: ReactNode
}) {
  return (
    <li className="pop-in relative" title={name} data-testid={testId}>
      <span className={cn('relative grid size-16 place-items-center overflow-hidden rounded-[10px] border bg-hover', failed ? 'border-danger' : 'border-line')}>
        {children}
        <span aria-hidden className="absolute inset-x-0 bottom-0 truncate bg-[linear-gradient(to_top,rgb(0_0_0/0.7),transparent)] px-1 pt-2 pb-0.5 text-[9px] font-bold text-white">{tag}</span>
      </span>
      <span className="sr-only">{name}</span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="absolute -end-1.5 -top-1.5 grid size-5 cursor-pointer place-items-center rounded-full border border-line bg-raised text-subtle shadow-panel hover:text-text"
      >
        <XIcon size={10} weight="bold" aria-hidden />
      </button>
    </li>
  )
}
