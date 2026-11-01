'use client'

// The brand's asset library (#52), in the Assets flyout: upload several images at once and watch
// each one's progress, name and tag them, find them by either, and place one on the design by
// dragging it onto a format or by clicking it. Thumbnails are small copies the API made and stored;
// the design itself draws the original, decoded by CanvasKit.
import { MagnifyingGlassIcon, PencilSimpleIcon, UploadSimpleIcon, XIcon } from '@phosphor-icons/react'
import type { Editor } from '@razzlr/editor'
import { AssetSummary, type UpdateAsset } from '@razzlr/schema'
import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { ASSET_ACCEPT as ACCEPT, sendAsset as send } from '../../lib/upload-asset.ts'

/** What an asset dragged from the library carries, for the stage to place it. */
export const ASSET_DRAG_TYPE = 'application/x-razzlr-asset'
/** How long typing pauses before the library searches. */
const SEARCH_DELAY_MS = 150

export type DraggedAsset = Pick<AssetSummary, 'id' | 'name' | 'width' | 'height'>

/** The asset a drag from the library carries, or null when it carries none. */
export function draggedAsset(e: DragEvent): DraggedAsset | null {
  const data = e.dataTransfer.getData(ASSET_DRAG_TYPE)
  if (!data) return null
  const parsed = AssetSummary.pick({ id: true, name: true, width: true, height: true }).safeParse(JSON.parse(data))
  return parsed.success ? parsed.data : null
}

interface Upload { key: string; name: string; progress: number; error?: string }

const base = (brandId: string) => `/brands/${encodeURIComponent(brandId)}/assets`

async function save(brandId: string, id: string, update: UpdateAsset): Promise<AssetSummary> {
  const response = await fetch(`${base(brandId)}/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `${response.status}`)
  return AssetSummary.parse(body)
}

export function AssetLibrary({ editor, brandId }: { editor: Editor; brandId: string }) {
  const t = useMessages().editor.assetLibrary
  const [query, setQuery] = useState('')
  const [assets, setAssets] = useState<AssetSummary[] | null>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    const ask = new AbortController()
    const timer = setTimeout(() => {
      const q = query.trim()
      fetch(`${base(brandId)}${q ? `?q=${encodeURIComponent(q)}` : ''}`, { signal: ask.signal })
        .then(async (response) => {
          if (response.ok) setAssets(AssetSummary.array().parse(await response.json()))
        })
        // Offline, or a newer search took over: the list keeps what it had.
        .catch(() => undefined)
    }, version === 0 && !query ? 0 : SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
      ask.abort()
    }
  }, [brandId, query, version])

  const upload = useCallback((files: File[]) => {
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random()}`
      const change = (patch: Partial<Upload>) => setUploads((all) => all.map((u) => (u.key === key ? { ...u, ...patch } : u)))
      setUploads((all) => [...all, { key, name: file.name, progress: 0 }])
      send(brandId, file, (progress) => change({ progress }))
        .then(() => {
          setUploads((all) => all.filter((u) => u.key !== key))
          refresh()
        })
        .catch((error: unknown) => change({ error: error instanceof Error ? error.message : String(error) }))
    }
  }, [brandId, refresh])

  const replace = (asset: AssetSummary) => setAssets((all) => all?.map((a) => (a.id === asset.id ? asset : a)) ?? null)
  const edited = assets?.find((a) => a.id === editing)
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')

  return (
    <div
      data-testid="asset-library"
      className={cn('flex min-h-0 flex-1 flex-col', dropping && 'bg-accent-soft')}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDropping(false)
        upload([...e.dataTransfer.files])
      }}
    >
      <div className="flex shrink-0 flex-col gap-2 px-[18px] pb-3">
        <label className="flex h-9 items-center gap-2 rounded-[10px] border border-line bg-bg/40 px-2.5 focus-within:border-accent">
          <MagnifyingGlassIcon size={14} aria-hidden className="shrink-0 text-subtle" />
          <input
            name="asset-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t.search}
            placeholder={t.search}
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
          />
        </label>
        <label className="flex h-8 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-strong text-xs font-semibold text-muted hover:border-accent hover:text-text focus-within:border-accent">
          <UploadSimpleIcon size={14} aria-hidden />
          {dropping ? t.dropHere : t.upload}
          <input
            name="images"
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            onChange={(e) => {
              upload([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </label>
        {uploads.length > 0 && (
          <ul aria-label={t.upload} className="flex flex-col gap-1.5" data-testid="asset-uploads">
            {uploads.map((u) => (
              <li key={u.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className={cn('min-w-0 flex-1 truncate', u.error ? 'text-danger' : 'text-muted')} role={u.error ? 'alert' : undefined}>
                    {u.error ? format(t.uploadFailed, { name: u.name, reason: u.error }) : format(t.uploading, { name: u.name })}
                  </span>
                  {u.error && (
                    <button type="button" aria-label={t.done} onClick={() => setUploads((all) => all.filter((x) => x.key !== u.key))} className="grid size-5 cursor-pointer place-items-center rounded-row text-subtle hover:bg-hover hover:text-text">
                      <XIcon size={12} aria-hidden />
                    </button>
                  )}
                </div>
                {!u.error && (
                  <div
                    role="progressbar"
                    aria-label={format(t.uploading, { name: u.name })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(u.progress * 100)}
                    className="h-1 overflow-hidden rounded-full bg-hover"
                  >
                    <div className={cn('h-full rounded-full bg-accent-solid transition-[width]', u.progress >= 1 && 'animate-pulse')} style={{ width: `${Math.max(4, u.progress * 100)}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {edited && (
        <AssetDetails
          key={edited.id}
          asset={edited}
          brandId={brandId}
          onSaved={replace}
          onDone={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pt-1 pb-4">
        {assets && assets.length === 0 && (
          <p className="text-[13px] text-muted">{query.trim() ? format(t.none, { query: query.trim() }) : t.empty}</p>
        )}
        {assets && assets.length > 0 && (
          <ul aria-label={t.images} className="grid grid-cols-3 gap-2">
            {assets.map((asset) => {
              const name = asset.name || t.untitled
              return (
                <li key={asset.id} data-asset={asset.id} className="group relative flex min-w-0 flex-col gap-1">
                  <button
                    type="button"
                    draggable
                    aria-label={format(t.place, { name })}
                    title={t.placeHint}
                    onClick={() => editor.placeImage(asset)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify({ id: asset.id, name: asset.name, width: asset.width, height: asset.height }))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    className={cn(
                      'grid aspect-square cursor-grab place-items-center overflow-hidden rounded-[10px] border border-line bg-bg/40 transition-colors duration-[var(--chrome-fast)] hover:border-line-strong active:cursor-grabbing',
                      editing === asset.id && 'border-accent',
                    )}
                  >
                    <img src={`${base(brandId)}/${encodeURIComponent(asset.id)}/thumbnail`} alt="" width={asset.width} height={asset.height} draggable={false} loading="lazy" className="size-full object-contain" />
                  </button>
                  {/* Name and tags open from the tile's corner, shown on hover or focus, and while open. */}
                  <button
                    type="button"
                    aria-label={`${t.edit}: ${name}`}
                    aria-pressed={editing === asset.id}
                    onClick={() => setEditing(editing === asset.id ? null : asset.id)}
                    className="absolute end-1 top-1 grid size-6 cursor-pointer place-items-center rounded-full surface-frost border text-muted opacity-0 shadow-panel transition-opacity duration-[var(--chrome-fast)] group-hover:opacity-100 hover:text-text focus-visible:opacity-100 aria-pressed:text-accent-text aria-pressed:opacity-100"
                  >
                    <PencilSimpleIcon size={12} aria-hidden />
                  </button>
                  <span className={cn('min-w-0 truncate text-[11px] font-medium', asset.name ? 'text-muted' : 'text-subtle')} title={name}>{name}</span>
                  {asset.tags.length > 0 && <p className="-mt-0.5 truncate text-[10px] text-subtle">{asset.tags.join(' · ')}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/** An asset's name and tags, saved as they change: the name on Enter or leaving the field, each tag as it is added or removed. */
function AssetDetails({ asset, brandId, onSaved, onDone }: { asset: AssetSummary; brandId: string; onSaved: (asset: AssetSummary) => void; onDone: () => void }) {
  const t = useMessages().editor.assetLibrary
  const [name, setName] = useState(asset.name)
  const [tag, setTag] = useState('')
  const [error, setError] = useState<string | null>(null)
  const nameField = useRef<HTMLInputElement>(null)
  useEffect(() => nameField.current?.focus(), [])

  const commit = (update: UpdateAsset) => {
    setError(null)
    save(brandId, asset.id, update).then(onSaved).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }
  const saveName = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== asset.name) commit({ name: trimmed })
    else setName(asset.name)
  }
  const addTag = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' && e.key !== ',') return
    e.preventDefault()
    const word = tag.trim().toLowerCase()
    if (!word) return
    setTag('')
    if (!asset.tags.includes(word)) commit({ tags: [...asset.tags, word] })
  }

  return (
    <section aria-label={format(t.editing, { name: asset.name || t.untitled })} data-testid="asset-details" className="mx-[18px] mb-3 flex shrink-0 flex-col gap-2 rounded-[12px] border border-line bg-bg/40 p-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{t.name}</span>
        <input
          name="asset-name"
          ref={nameField}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className="h-8 rounded-row border border-line bg-raised px-2 text-[13px]"
        />
      </label>
      <div className="flex flex-col gap-1">
        <span id={`tags-${asset.id}`} className="text-xs text-muted">{t.tags}</span>
        {asset.tags.length > 0 && (
          <ul aria-labelledby={`tags-${asset.id}`} className="flex flex-wrap gap-1">
            {asset.tags.map((x) => (
              <li key={x} className="flex h-6 items-center gap-0.5 rounded-full bg-accent-soft ps-2 pe-0.5 text-xs text-accent-text">
                {x}
                <button type="button" aria-label={format(t.removeTag, { tag: x })} onClick={() => commit({ tags: asset.tags.filter((y) => y !== x) })} className="grid size-5 cursor-pointer place-items-center rounded-full hover:bg-hover">
                  <XIcon size={10} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          name="asset-tag"
          value={tag}
          maxLength={40}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={addTag}
          aria-label={t.addTag}
          placeholder={t.addTag}
          className="h-8 rounded-row border border-line bg-raised px-2 text-[13px] placeholder:text-subtle"
        />
      </div>
      {error && <p role="alert" className="text-xs text-danger">{format(t.saveFailed, { reason: error })}</p>}
      <button type="button" onClick={onDone} className="h-8 cursor-pointer self-end rounded-row px-3 text-[13px] font-medium text-muted hover:bg-hover hover:text-text">
        {t.done}
      </button>
    </section>
  )
}
