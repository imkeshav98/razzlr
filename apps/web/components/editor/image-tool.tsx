'use client'

// The image tool in the tool dock: its button (or I) opens a picker of the brand's images with an
// upload from the computer; the image picked is placed where the next click or drag on a format
// lands. Closing the picker without a pick goes back to the select tool.
import { ImageIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import * as Popover from '@radix-ui/react-popover'
import type { PlacedAsset } from '@dazbee/editor'
import { AssetSummary } from '@dazbee/schema'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { ASSET_ACCEPT, sendAsset } from '../../lib/upload-asset.ts'
import { overlayScroll } from '../ui/overlay-scroll.ts'
import { Tooltip } from '../ui/tooltip.tsx'

const base = (brandId: string) => `/brands/${encodeURIComponent(brandId)}/assets`

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
  const [assets, setAssets] = useState<AssetSummary[] | null>(null)
  const [upload, setUpload] = useState<{ name: string; progress: number; error?: string } | null>(null)

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
        onPick(asset)
      })
      .catch((error: unknown) => setUpload({ name: file.name, progress: 0, error: error instanceof Error ? error.message : String(error) }))
  }

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
            className={cn(
              'grid size-10 cursor-pointer place-items-center rounded-[12px] transition-colors duration-[var(--chrome-fast)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
              active ? 'bg-accent-solid text-on-accent' : 'text-muted hover:bg-hover hover:text-text',
            )}
          >
            <ImageIcon size={20} weight={active ? 'fill' : 'regular'} aria-hidden />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={10}
          aria-label={t.imageTool.title}
          data-testid="image-picker"
          onKeyDown={(e) => e.stopPropagation()}
          className="pop-in z-50 flex max-h-[min(26rem,60dvh)] w-72 flex-col rounded-card surface-frost border shadow-panel"
        >
          <div className="flex shrink-0 flex-col gap-2 p-3 pb-2">
            <p className="font-display text-[13px] font-bold">{t.imageTool.title}</p>
            <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-strong text-xs font-semibold text-muted transition-colors duration-[var(--chrome-fast)] hover:border-accent hover:text-text focus-within:border-accent focus-within:text-text">
              <UploadSimpleIcon size={14} aria-hidden />
              {t.imageTool.upload}
              <input
                name="image-tool-upload"
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
            <p className="text-[11px] text-subtle">{t.imageTool.hint}</p>
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
                        className="grid aspect-square w-full cursor-pointer place-items-center overflow-hidden rounded-[10px] border border-line bg-bg/40 transition-colors duration-[var(--chrome-fast)] hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                      >
                        <img src={`${base(brandId)}/${encodeURIComponent(asset.id)}/thumbnail`} alt="" width={asset.width} height={asset.height} draggable={false} loading="lazy" className="size-full object-contain" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
