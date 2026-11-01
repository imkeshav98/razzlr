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
    // Counted at the redraw after the document changed, so a burst of edits is one count per frame
    // and a redraw that only moved the view, such as a pan, is none.
    let changed = false
    const onUpdate = () => {
      changed = true
    }
    editor.doc.on('update', onUpdate)
    const stop = editor.onDraw(() => {
      if (!changed) return
      changed = false
      setVersion((v) => v + 1)
    })
    return () => {
      stop()
      editor.doc.off('update', onUpdate)
    }
  }, [editor])
  return { design: editor.design(), version }
}
