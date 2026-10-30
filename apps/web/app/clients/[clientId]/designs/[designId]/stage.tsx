'use client'

import { useEffect, useRef, useState } from 'react'
import { startEditor, type Editor } from '@razzlr/editor'
import { fetchSyncToken } from './actions.ts'
import { EditorShell } from '../../../../../components/editor/shell.tsx'

declare global {
  interface Window { razzlr?: Editor }
}

async function assetBytes(clientId: string, assetId: string) {
  const response = await fetch(`/clients/${encodeURIComponent(clientId)}/assets/${encodeURIComponent(assetId)}`)
  if (!response.ok) throw new Error(`asset ${assetId}: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
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

  useEffect(() => {
    if (!canvas.current || !overlay.current) return
    let editor: Editor | undefined
    const unmounted = new AbortController()
    startEditor({ canvas: canvas.current, overlay: overlay.current, designId, syncUrl, syncToken: () => fetchSyncToken(clientId, designId), assetBytes: (assetId) => assetBytes(clientId, assetId), ...(formatId ? { formatId } : {}), onStatus: setStatus, signal: unmounted.signal })
      .then((started) => {
        if (unmounted.signal.aborted) return started.destroy()
        editor = started
        window.razzlr = started
      })
      .catch((error: unknown) => {
        if (!unmounted.signal.aborted) setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`)
      })
    return () => {
      unmounted.abort()
      editor?.destroy()
      delete window.razzlr
    }
  }, [clientId, designId, formatId, syncUrl])

  return (
    <EditorShell clientId={clientId} clientName={clientName} designName={designName} status={status}>
      {/* The design is a picture, so it never mirrors: the stage stays left to right in Arabic too. */}
      <div dir="ltr" className="absolute inset-0 grid place-items-center overflow-auto p-6 pb-20">
        <div className="relative w-[min(720px,100%)] shadow-[0_0_0_1px_var(--line),0_24px_60px_-24px_rgb(0_0_0/0.55)]">
          <canvas ref={canvas} className="block h-auto w-full cursor-default touch-none bg-white" data-testid="stage" />
          <div ref={overlay} className="stage-overlay pointer-events-none absolute inset-0" aria-hidden />
          <div data-slot="mini-bar" className="pointer-events-none absolute inset-x-0 -top-12 flex justify-center" />
        </div>
      </div>
    </EditorShell>
  )
}
