'use client'

import { useEffect, useRef, useState } from 'react'
import { startEditor, type Editor } from '../../../lib/editor/editor.ts'
import styles from './stage.module.css'

declare global {
  interface Window { razzlr?: Editor }
}

export function EditorStage({ designId, formatId, syncUrl }: { designId: string; formatId: string | undefined; syncUrl: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('Starting')

  useEffect(() => {
    if (!canvas.current || !overlay.current) return
    let editor: Editor | undefined
    let cancelled = false
    startEditor({ canvas: canvas.current, overlay: overlay.current, designId, syncUrl, ...(formatId ? { formatId } : {}), onStatus: setStatus })
      .then((started) => {
        if (cancelled) return started.destroy()
        editor = started
        window.razzlr = started
      })
      .catch((error: unknown) => setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`))
    return () => {
      cancelled = true
      editor?.destroy()
      delete window.razzlr
    }
  }, [designId, formatId, syncUrl])

  return (
    <main className={styles.page}>
      <header className={styles.bar}>
        <span className={styles.name}>Razzlr</span>
        <span className={styles.design}>{designId}</span>
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
