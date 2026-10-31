'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SHAPE_TOOLS, startEditor, type Editor, type ShapeTool, type Tool } from '@razzlr/editor'
import { fetchSyncToken } from './actions.ts'
import { EditorShell } from '../../../../../components/editor/shell.tsx'
import { FocusChip, FormatsPanel, UndoToast } from '../../../../../components/editor/formats-panel.tsx'
import { ArrangePanel } from '../../../../../components/editor/arrange-panel.tsx'
import { PagesPanel } from '../../../../../components/editor/pages-panel.tsx'
import { ZoomControl } from '../../../../../components/editor/zoom-control.tsx'
import { ExportMenu } from '../../../../../components/editor/export-menu.tsx'

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
      actions={editor ? <ExportMenu editor={editor} /> : undefined}
      inspector={editor ? (
        <>
          <ArrangePanel editor={editor} />
          <PagesPanel editor={editor} onRemoved={setRemoved} />
          <FormatsPanel editor={editor} onRemoved={setRemoved} />
        </>
      ) : undefined}
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
