'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SHAPE_TOOLS, startEditor, type Editor, type ShapeTool, type Tool } from '@razzlr/editor'
import { fetchSyncToken } from './actions.ts'
import { EditorShell, type ChromeInsets } from '../../../../../components/editor/shell.tsx'
import { FocusChip, UndoToast } from '../../../../../components/editor/formats-panel.tsx'
import { PropertyCards } from '../../../../../components/editor/property-cards.tsx'
import { ZoomControl } from '../../../../../components/editor/zoom-control.tsx'

declare global {
  interface Window { razzlr?: Editor }
}

async function assetBytes(brandId: string, assetId: string) {
  const response = await fetch(`/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(assetId)}`)
  if (!response.ok) throw new Error(`asset ${assetId}: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** Asks the offline worker to keep this page and everything it has loaded so far. */
async function keepForOffline() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  const urls = [location.href, ...performance.getEntriesByType('resource').map((entry) => entry.name)]
  registration.active?.postMessage({ type: 'keep', urls })
}

export function EditorStage({ designId, designName, brandId, brandName, formatId, syncUrl }: {
  designId: string
  designName: string
  brandId: string
  brandName: string
  formatId: string | undefined
  syncUrl: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('Starting')
  const [zoom, setZoom] = useState<number | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [removed, setRemoved] = useState<string | null>(null)
  // The dock follows the editor's tool: a key picks one, and drawing a shape goes back to select.
  const [tool, setEditorTool] = useState<Tool>('select')
  const [shape, setShape] = useState<ShapeTool>('rect')
  useEffect(() => {
    if (!editor) return
    const stop = editor.onTool((next) => {
      setEditorTool(next)
      if ((SHAPE_TOOLS as readonly string[]).includes(next)) setShape(next as ShapeTool)
    })
    return () => {
      stop()
    }
  }, [editor])
  const dockTool = tool === 'hand' || tool === 'select' || tool === 'pen' || tool === 'text' ? tool : 'shape'
  const dismissRemoved = useCallback(() => setRemoved(null), [])

  // The stage's edges the capsule, cards and dock cover (#83): the editor fits the ads between
  // them. The first time they are known the design is fitted again, since it opened fitted to the
  // whole stage. The editor counts as ready only after that, so nothing set on its camera (or
  // read from it) before then is undone by the fit.
  const [chrome, setChrome] = useState<{ insets: ChromeInsets; withCards: boolean } | null>(null)
  const onInsets = useCallback((insets: ChromeInsets, withCards: boolean) => setChrome({ insets, withCards }), [])
  const [fittedTo, setFittedTo] = useState<Editor | null>(null)
  useEffect(() => {
    if (!editor || !chrome) return
    editor.setInsets(chrome.insets)
    // Measured before the cards were in, the insets would fit the design under them.
    if (chrome.withCards && fittedTo !== editor) {
      editor.fitAll()
      setFittedTo(editor)
    }
  }, [editor, chrome, fittedTo])

  // Lets this page open again without a connection (#37): the worker keeps the page and what it
  // loaded, and the design itself is in IndexedDB.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').then(keepForOffline).catch(() => {
      // Without the worker the editor still works online; only reopening offline is lost.
    })
  }, [])

  useEffect(() => {
    if (!canvas.current || !overlay.current) return
    let editor: Editor | undefined
    const unmounted = new AbortController()
    startEditor({
      canvas: canvas.current, overlay: overlay.current, designId, syncUrl,
      syncToken: () => fetchSyncToken(brandId, designId), assetBytes: (assetId) => assetBytes(brandId, assetId),
      ...(formatId ? { formatId } : {}), onStatus: setStatus, onZoom: setZoom, signal: unmounted.signal,
    })
      .then((started) => {
        if (unmounted.signal.aborted) return started.destroy()
        editor = started
        window.razzlr = started
        setEditor(started)
        // CanvasKit and the fonts may have loaded before the worker was in charge.
        void keepForOffline()
      })
      .catch((error: unknown) => {
        if (!unmounted.signal.aborted) setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`)
      })
    return () => {
      unmounted.abort()
      editor?.destroy()
      delete window.razzlr
      setEditor(null)
      setZoom(null)
    }
  }, [brandId, designId, formatId, syncUrl])

  return (
    <EditorShell
      brandId={brandId}
      brandName={brandName}
      designName={designName}
      status={status}
      tool={dockTool}
      shape={shape}
      onToolChange={(tool, picked) => {
        setShape(picked)
        editor?.setTool(tool === 'hand' || tool === 'pen' || tool === 'text' ? tool : tool === 'shape' ? picked : 'select')
      }}
      onInsets={onInsets}
      fitted={editor !== null && fittedTo === editor}
      inspector={editor ? <PropertyCards editor={editor} onRemoved={setRemoved} /> : undefined}
    >
      {/* The design is a picture, so it never mirrors: the stage stays left to right in Arabic too. */}
      <div dir="ltr" className="absolute inset-0">
        <canvas ref={canvas} className="block size-full touch-none" data-testid="stage" />
        <div ref={overlay} className="stage-overlay pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
        <div data-slot="mini-bar" className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
          {editor && <FocusChip editor={editor} />}
        </div>
        <div className="pointer-events-none absolute start-4 bottom-4 z-10">
          {editor && removed && <UndoToast key={removed} editor={editor} message={removed} onDone={dismissRemoved} />}
        </div>
      </div>
      <ZoomControl
        zoom={editor ? zoom : null}
        onZoomIn={() => editor?.zoomIn()}
        onZoomOut={() => editor?.zoomOut()}
        onFit={() => editor?.fitAll()}
      />
    </EditorShell>
  )
}
