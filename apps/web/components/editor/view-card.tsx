'use client'

// The View card, as in the final mock: rulers are off until asked for, and snapping can be turned
// off for every drag. Shift+R turns the rulers on and off too, and the card follows it.
import type { Editor } from '@razzlr/editor'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { CARD } from './card.tsx'

const viewOf = (editor: Editor) => ({ rulers: editor.rulers(), snapping: editor.snapping() })

function useView(editor: Editor) {
  const [view, setView] = useState(() => viewOf(editor))
  useEffect(() => {
    setView(viewOf(editor))
    const stop = editor.onView(() => setView(viewOf(editor)))
    return () => {
      stop()
    }
  }, [editor])
  return view
}

const CHIP = 'h-8 flex-1 cursor-pointer rounded-row border text-xs font-semibold transition-colors duration-[var(--chrome-fast)]'

export function ViewCard({ editor }: { editor: Editor }) {
  const t = useMessages().editor.view
  const view = useView(editor)
  const chip = (on: boolean) => cn(CHIP, on ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-muted hover:border-line-strong hover:text-text')
  return (
    <section aria-label={t.title} data-testid="view-card" className={cn(CARD, 'flex gap-2 p-3')}>
      <button type="button" aria-pressed={view.snapping} onClick={() => editor.setSnapping(!view.snapping)} className={chip(view.snapping)}>
        {t.snap}
      </button>
      <button type="button" aria-pressed={view.rulers} title={t.rulersKey} onClick={() => editor.perform('toggleRulers')} className={chip(view.rulers)}>
        {t.rulers}
      </button>
    </section>
  )
}
