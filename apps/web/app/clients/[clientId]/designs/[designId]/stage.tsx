'use client'

import { useEffect, useRef, useState } from 'react'
import { startEditor, type Editor } from '@razzlr/editor'
import { fetchSyncToken } from './actions.ts'
import { EditorShell } from '../../../../../components/editor/shell.tsx'
import { ZoomControl } from '../../../../../components/editor/zoom-control.tsx'

declare global {
  interface Window { razzlr?: Editor }
}

async function assetBytes(clientId: string, assetId: string) {
  const response = await fetch(`/clients/${encodeURIComponent(clientId)}/assets/${encodeURIComponent(assetId)}`)
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

export function EditorStage({ designId, designName, clientId, clientName, formatId, syncUrl }: {
  designId: string
  designName: string
  clientId: string
  clientName: string
  formatId: string | undefined
  syncUrl: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('Starting')
  const [zoom, setZoom] = useState<number | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)

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
      syncToken: () => fetchSyncToken(clientId, designId), assetBytes: (assetId) => assetBytes(clientId, assetId),
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
  }, [clientId, designId, formatId, syncUrl])

  return (
    <EditorShell
      clientId={clientId}
      clientName={clientName}
      designName={designName}
      status={status}
      onToolChange={(tool) => editor?.setTool(tool === 'hand' ? 'hand' : 'select')}
    >
      {/* The design is a picture, so it never mirrors: the stage stays left to right in Arabic too. */}
      <div dir="ltr" className="absolute inset-0">
        <canvas ref={canvas} className="block size-full touch-none" data-testid="stage" />
        <div ref={overlay} className="stage-overlay pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
        <div data-slot="mini-bar" className="pointer-events-none absolute inset-x-0 top-4 flex justify-center" />
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
