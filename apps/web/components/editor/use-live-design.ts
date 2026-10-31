'use client'

import type { Editor } from '@razzlr/editor'
import { useEffect, useState } from 'react'

/**
 * The editor's design and a count of its changes. The design is live, the same object as it
 * changes, so the count is what tells a component to read it again (#59, #60).
 */
export function useLiveDesign(editor: Editor) {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const stop = editor.onDraw(() => setVersion((v) => v + 1))
    return () => {
      stop()
    }
  }, [editor])
  return { design: editor.design(), version }
}
