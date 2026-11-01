'use client'

// Picking an image: a panel of the brand's images with an upload from the computer, shown by the
// image tool in the tool dock (its button, or I), by the Image card's Replace and by a fill's Add
// image. The tool places the image picked where the next click or drag on a format lands; closing
// its picker without a pick goes back to the select tool.
import { ImageIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import * as Popover from '@radix-ui/react-popover'
import type { PlacedAsset } from '@dazbee/editor'
import { AssetSummary } from '@dazbee/schema'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { useLocale, useMessages } from '../../lib/i18n/client.tsx'
import { dirOf, format } from '../../lib/i18n/index.ts'
import { ASSET_ACCEPT, sendAsset } from '../../lib/upload-asset.ts'
import { overlayScroll } from '../ui/overlay-scroll.ts'
import { Tooltip } from '../ui/tooltip.tsx'
import { ASSET_TILE, DASHED_BUTTON, dockTool, FOCUS_RING, POPOVER } from './styles.ts'

const base = (brandId: string) => `/brands/${encodeURIComponent(brandId)}/assets`

const PANEL = cn(POPOVER, 'flex max-h-[min(26rem,60dvh)] w-72 flex-col')

/**
 * The picker's own content: an upload and the brand's images, fetched while it shows. An upload
 * that ends after the picker closed picks nothing.
 */
function ImagePickerPanel({ brandId, open, title, hint, onPick }: { brandId: string; open: boolean; title: string; hint?: string; onPick: (asset: PlacedAsset) => void }) {
  const t = useMessages().editor
  const [assets, setAssets] = useState<AssetSummary[] | null>(null)
  const [upload, setUpload] = useState<{ name: string; progress: number; error?: string } | null>(null)
  const showing = useRef(open)
  useEffect(() => {
    showing.current = open
    return () => {
      showing.current = false
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const ask = new AbortController()
    fetch(base(brandId), { signal: ask.signal })
      .then(async (response) => {
        if (response.ok) setAssets(AssetSummary.array().parse(await response.json()))
      })
      // Offline: the picker keeps what it had, and an upload still works once back.
      .catch(() => undefined)
    return () => ask.abort()
  }, [brandId, open])

  const send = (file: File) => {
    setUpload({ name: file.name, progress: 0 })
    sendAsset(brandId, file, (progress) => setUpload({ name: file.name, progress }))
      .then((asset) => {
        setUpload(null)
        if (showing.current) onPick(asset)
      })
      .catch((error: unknown) => setUpload({ name: file.name, progress: 0, error: error instanceof Error ? error.message : String(error) }))
  }

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 p-3 pb-2">
        <p className="font-display text-[13px] font-bold">{title}</p>
        <label className={DASHED_BUTTON}>
          <UploadSimpleIcon size={14} aria-hidden />
          {t.imageTool.upload}
          <input
            name="image-picker-upload"
            type="file"
            accept={ASSET_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) send(file)
            }}
          />
        </label>
        {upload && (
          upload.error
            ? <p role="alert" className="text-xs text-danger">{format(t.imageTool.failed, { name: upload.name, reason: upload.error })}</p>
            : (
              <div
                role="progressbar"
                aria-label={format(t.imageTool.uploading, { name: upload.name })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(upload.progress * 100)}
                className="h-1 overflow-hidden rounded-full bg-hover"
              >
                <div className={cn('h-full rounded-full bg-accent-solid transition-[width]', upload.progress >= 1 && 'animate-pulse')} style={{ width: `${Math.max(4, upload.progress * 100)}%` }} />
              </div>
            )
        )}
        {hint && <p className="text-[11px] text-subtle">{hint}</p>}
      </div>
      <div ref={overlayScroll} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {assets && assets.length === 0 && <p className="text-[13px] text-muted">{t.imageTool.empty}</p>}
        {assets && assets.length > 0 && (
          <ul aria-label={t.imageTool.brand} className="grid grid-cols-3 gap-2">
            {assets.map((asset) => {
              const name = asset.name || t.assetLibrary.untitled
              return (
                <li key={asset.id} data-asset={asset.id}>
                  <button
                    type="button"
                    aria-label={format(t.imageTool.pick, { name })}
                    title={name}
                    onClick={() => onPick({ id: asset.id, name: asset.name, width: asset.width, height: asset.height })}
                    className={cn(ASSET_TILE, FOCUS_RING, 'w-full cursor-pointer hover:border-accent')}
                  >
                    <img src={`${base(brandId)}/${encodeURIComponent(asset.id)}/thumbnail`} alt="" width={asset.width} height={asset.height} draggable={false} loading="lazy" className="size-full object-contain" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

/** The image tool's dock button and its picker, open while the tool waits for an image. */
export function ImageTool({ brandId, active, open, onPress, onPick, onClose }: {
  brandId: string
  /** The image tool is the one in use. */
  active: boolean
  /** The picker shows: the tool is in use and has no image to place yet. */
  open: boolean
  onPress: () => void
  onPick: (asset: PlacedAsset) => void
  onClose: () => void
}) {
  const t = useMessages().editor
  const label = t.toolImage
  return (
    <Popover.Root open={open} onOpenChange={(next) => (next ? onPress() : onClose())}>
      <Tooltip label={`${label} · I`}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            data-tool="image"
            className={dockTool(active)}
          >
            <ImageIcon size={20} weight={active ? 'fill' : 'regular'} aria-hidden />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content side="top" align="center" sideOffset={10} aria-label={t.imageTool.title} data-testid="image-picker" onKeyDown={(e) => e.stopPropagation()} className={PANEL}>
          <ImagePickerPanel brandId={brandId} open={open} title={t.imageTool.title} hint={t.imageTool.hint} onPick={onPick} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** A button in a card that opens the picker beside it; the image picked goes to `onPick` and the picker closes. */
export function ImagePickerButton({ brandId, title, testId, className, children, onPick }: {
  brandId: string
  /** The picker's heading, and the button's name. */
  title: string
  testId: string
  className: string
  children: ReactNode
  onPick: (asset: PlacedAsset) => void
}) {
  const [open, setOpen] = useState(false)
  // The cards sit at the stage's end, so the picker opens towards its middle.
  const side = dirOf(useLocale()) === 'rtl' ? 'right' : 'left'
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={title} data-testid={testId} className={className}>{children}</button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side={side} align="start" sideOffset={12} collisionPadding={12} aria-label={title} data-testid={`${testId}-picker`} onKeyDown={(e) => e.stopPropagation()} className={PANEL}>
          <ImagePickerPanel
            brandId={brandId}
            open={open}
            title={title}
            onPick={(asset) => {
              setOpen(false)
              onPick(asset)
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
