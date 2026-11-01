'use client'

// The zoom pill at the stage's bottom corner (#36): out, the zoom (which fits every frame when
// pressed), in. The same zooms are on Ctrl/Cmd+=, Ctrl/Cmd+- and Shift+1. On phones it moves to
// the top corner, since the capsule takes the bottom (#82).
import { MinusIcon, PlusIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { useLocale, useMessages } from '../../lib/i18n/client.tsx'
import { Tooltip } from '../ui/tooltip.tsx'

const BUTTON = 'grid h-8 min-w-8 cursor-pointer place-items-center rounded-row px-1.5 text-muted transition-colors duration-[var(--chrome-fast)] hover:bg-hover hover:text-text disabled:cursor-default disabled:opacity-40'

export function ZoomControl({ zoom, onZoomIn, onZoomOut, onFit }: {
  zoom: number | null
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
}) {
  const t = useMessages()
  const locale = useLocale()
  const percent = useMemo(() => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }), [locale])
  const off = zoom === null
  return (
    <div role="group" aria-label={t.editor.zoom} data-zoom className="absolute end-4 bottom-4 z-10 flex max-sm:top-20 max-sm:bottom-auto items-center gap-0.5 rounded-card surface-frost border p-1 shadow-panel">
      <Tooltip label={`${t.editor.zoomOut} · ${t.editor.zoomOutKey}`}>
        <button type="button" aria-label={t.editor.zoomOut} disabled={off} onClick={onZoomOut} className={BUTTON}>
          <MinusIcon size={16} aria-hidden />
        </button>
      </Tooltip>
      <Tooltip label={`${t.editor.zoomFit} · ${t.editor.zoomFitKey}`}>
        <button
          type="button"
          aria-label={t.editor.zoomFit}
          disabled={off}
          onClick={onFit}
          data-testid="zoom"
          className={`${BUTTON} w-14 font-mono text-xs tabular-nums text-text`}
        >
          {off ? '' : percent.format(zoom)}
        </button>
      </Tooltip>
      <Tooltip label={`${t.editor.zoomIn} · ${t.editor.zoomInKey}`}>
        <button type="button" aria-label={t.editor.zoomIn} disabled={off} onClick={onZoomIn} className={BUTTON}>
          <PlusIcon size={16} aria-hidden />
        </button>
      </Tooltip>
    </div>
  )
}
