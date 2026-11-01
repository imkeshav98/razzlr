'use client'

import { useEffect } from 'react'
import { markRender } from '../lib/render.ts'

/** Marks the root with how this browser draws, once the page is up (#144). */
export function RenderProbe() {
  useEffect(() => {
    // A busy software-drawn page may never be idle, so the wait is capped.
    if (window.requestIdleCallback) window.requestIdleCallback(markRender, { timeout: 500 })
    else window.setTimeout(markRender, 1)
  }, [])
  return null
}
