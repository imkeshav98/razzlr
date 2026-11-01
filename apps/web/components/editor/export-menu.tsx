'use client'

// Export (#55, #56): pick pages, formats and PNG, JPG, PDF or SVG, and the editor's export worker
// draws them while the stage stays responsive. One file downloads as itself, more as a zip
// with a folder per format.
import type { Editor } from '@razzlr/editor'
import type { Design, ExportType } from '@razzlr/schema'
import { useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { Button } from '../ui/button.tsx'

const byOrder = <T extends { order: string }>(items: Record<string, T>) =>
  Object.entries(items).sort(([a, x], [b, y]) => (x.order < y.order ? -1 : x.order > y.order ? 1 : a < b ? -1 : 1))

function download(name: string, type: string, bytes: Uint8Array<ArrayBuffer>) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // The download has its own copy once it starts.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const sizeOf = ({ width, height }: { width: number; height: number }) => `${width} × ${height}`
const LABEL = 'text-xs font-semibold tracking-wide text-muted'
const CHOICE = 'flex h-8 cursor-pointer items-center gap-2 rounded-row px-2 text-[13px] hover:bg-hover'

/** The export form (#55), opened from the Share menu. */
export function ExportForm({ id, editor, design }: { id: string; editor: Editor; design: Design }) {
  const t = useMessages()
  const pages = byOrder(design.pages)
  const formats = byOrder(design.formats)
  const [page, setPage] = useState<string>('all')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(formats.map(([formatId]) => formatId)))
  const [type, setType] = useState<ExportType>('png')
  const [quality, setQuality] = useState(90)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pageIds = page === 'all' ? pages.map(([pageId]) => pageId) : [page]
  const formatIds = formats.map(([formatId]) => formatId).filter((formatId) => picked.has(formatId))
  const count = pageIds.length * formatIds.length
  const allPicked = formatIds.length === formats.length
  const toggle = (formatId: string) => {
    const next = new Set(picked)
    if (!next.delete(formatId)) next.add(formatId)
    setPicked(next)
  }

  const run = async () => {
    setError(null)
    setProgress({ done: 0, total: count })
    try {
      const file = await editor.exportFiles({ pageIds, formatIds, type, quality }, (done, total) => setProgress({ done, total }))
      download(file.name, file.type, file.bytes as Uint8Array<ArrayBuffer>)
    } catch (reason) {
      setError(format(t.editor.exports.failed, { reason: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div
      id={id}
      role="dialog"
      aria-label={t.editor.exports.title}
      data-testid="export"
      className="modal-in absolute end-0 top-full z-30 mt-2 flex w-72 flex-col gap-3 rounded-card border surface-frost p-3 shadow-panel"
    >
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>{t.editor.exports.pages}</span>
        <select
          name="page"
          value={page}
          onChange={(event) => setPage(event.target.value)}
          data-testid="export-page"
          className="h-8 rounded-row border border-line bg-raised px-2 text-[13px]"
        >
          <option value="all">{t.editor.exports.allPages}</option>
          {pages.map(([pageId, p]) => <option key={pageId} value={pageId}>{p.name}</option>)}
        </select>
      </label>

      <fieldset className="flex flex-col">
        <legend className={cn(LABEL, 'mb-1.5')}>{t.editor.exports.formats}</legend>
        <label className={CHOICE}>
          <input
            name="all-formats"
            type="checkbox"
            checked={allPicked}
            onChange={() => setPicked(allPicked ? new Set() : new Set(formats.map(([formatId]) => formatId)))}
          />
          {t.editor.exports.allFormats}
        </label>
        {formats.map(([formatId, f]) => (
          <label key={formatId} className={CHOICE}>
            <input name="format" type="checkbox" checked={picked.has(formatId)} onChange={() => toggle(formatId)} data-format={formatId} />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="font-mono text-xs text-subtle tabular-nums">{sizeOf(f)}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className={cn(LABEL, 'mb-1.5')}>{t.editor.exports.type}</legend>
        <div role="radiogroup" className="grid grid-cols-4 gap-1 rounded-row border border-line p-0.5">
          {(['png', 'jpg', 'pdf', 'svg'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              onClick={() => setType(value)}
              data-type={value}
              className={cn('h-7 cursor-pointer rounded-row text-[13px] font-medium uppercase', type === value ? 'bg-accent-solid text-on-accent' : 'text-muted hover:bg-hover')}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>

      {type === 'jpg' && (
        <label className="flex flex-col gap-1.5">
          <span className={cn(LABEL, 'flex justify-between')}>
            {t.editor.exports.quality}
            <span className="font-mono font-normal tabular-nums">{quality}</span>
          </span>
          <input name="quality" type="range" min={1} max={100} value={quality} onChange={(event) => setQuality(Number(event.target.value))} data-testid="export-quality" />
        </label>
      )}

      <Button variant="primary" disabled={count === 0 || progress !== null} onClick={() => void run()} data-testid="export-run">
        {progress
          ? format(t.editor.exports.making, { done: progress.done, total: progress.total })
          : count === 1 ? t.editor.exports.runOne : format(t.editor.exports.run, { n: count })}
      </Button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}
