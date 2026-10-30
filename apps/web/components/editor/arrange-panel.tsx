'use client'

// Align and distribute the selection from the inspector (#42): the same actions as their
// shortcuts, which the tooltips show. Several layers line up with each other; one layer lines up
// with the format, or the group or frame it is in.
import {
  AlignBottomIcon, AlignCenterHorizontalIcon, AlignCenterVerticalIcon, AlignLeftIcon, AlignRightIcon, AlignTopIcon, ColumnsIcon, RowsIcon, type Icon,
} from '@phosphor-icons/react'
import { SHORTCUTS, type Editor, type ShortcutAction } from '@razzlr/editor'
import { useEffect, useState } from 'react'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { Tooltip } from '../ui/tooltip.tsx'
import { ICON_BUTTON } from './formats-panel.tsx'

type Action = Extract<ShortcutAction, `align${string}` | `distribute${string}`>
const ALIGN: { action: Action; icon: Icon }[] = [
  { action: 'alignLeft', icon: AlignLeftIcon },
  { action: 'alignCentre', icon: AlignCenterHorizontalIcon },
  { action: 'alignRight', icon: AlignRightIcon },
  { action: 'alignTop', icon: AlignTopIcon },
  { action: 'alignMiddle', icon: AlignCenterVerticalIcon },
  { action: 'alignBottom', icon: AlignBottomIcon },
]
const DISTRIBUTE: { action: Action; icon: Icon }[] = [
  { action: 'distributeHorizontal', icon: ColumnsIcon },
  { action: 'distributeVertical', icon: RowsIcon },
]

/** A shortcut as the tooltip shows it: Ctrl for Mod, or ⌘ and ⌥ on a Mac. */
function keyOf(action: ShortcutAction) {
  const spec: string = SHORTCUTS.find((s) => s.action === action)?.keys[0] ?? ''
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return spec.replace('Mod', mac ? '⌘' : 'Ctrl').replace('Alt', mac ? '⌥' : 'Alt')
}

/** The selected layers, kept current. */
function useSelection(editor: Editor) {
  const [ids, setIds] = useState(() => editor.selection())
  useEffect(() => {
    const stop = editor.onSelection(setIds)
    return () => {
      stop()
    }
  }, [editor])
  return ids
}

export function ArrangePanel({ editor }: { editor: Editor }) {
  const t = useMessages()
  const selected = useSelection(editor)
  const button = ({ action, icon: ActionIcon }: { action: Action; icon: Icon }, disabled: boolean) => {
    const label = t.editor.arrange[action]
    return (
      <Tooltip key={action} label={format(t.editor.arrange.withKey, { label, key: keyOf(action) })}>
        <button
          type="button"
          aria-label={label}
          aria-keyshortcuts={keyOf(action).replace('Ctrl', 'Control')}
          disabled={disabled}
          onClick={() => editor.perform(action)}
          data-action={action}
          className={ICON_BUTTON}
        >
          <ActionIcon size={16} aria-hidden />
        </button>
      </Tooltip>
    )
  }
  return (
    <section aria-labelledby="arrange-title" className="border-b border-line" data-testid="arrange">
      <div className="flex h-10 items-center ps-4 pe-2">
        <h3 id="arrange-title" className="text-xs font-semibold tracking-wide text-muted">{t.editor.arrange.title}</h3>
      </div>
      {/* The design never mirrors, so neither do left and right here. */}
      <div dir="ltr" className="flex items-center justify-between gap-1 px-3 pb-3">
        <div role="group" aria-label={t.editor.arrange.align} className="flex gap-0.5">
          {ALIGN.map((a) => button(a, selected.length === 0))}
        </div>
        <span aria-hidden className="h-5 w-px bg-line" />
        <div role="group" aria-label={t.editor.arrange.distribute} className="flex gap-0.5">
          {DISTRIBUTE.map((d) => button(d, selected.length < 3))}
        </div>
      </div>
    </section>
  )
}
