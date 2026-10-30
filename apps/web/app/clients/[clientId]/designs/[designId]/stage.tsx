'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { startEditor, type Editor } from '@razzlr/editor'
import { fetchSyncToken } from './actions.ts'
import styles from './stage.module.css'

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
    <main className={styles.page}>
      <header className={styles.bar}>
        <Link className={styles.name} href={`/clients/${clientId}`}>{clientName}</Link>
        <h1 className={styles.design}>{designName}</h1>
        <span className={styles.status} data-testid="status" role="status">{status}</span>
      </header>
      <div className={styles.stage}>
        <div className={styles.frame}>
          <canvas ref={canvas} className={styles.canvas} data-testid="stage" />
          <div ref={overlay} className={styles.overlay} aria-hidden />
        </div>
      </div>
      <footer className={styles.hint}>Click to select · drag to move · double-click text to type · ⌘/Ctrl+Z to undo</footer>
    </main>
  )
}
