'use client'

// The Arrange card (#42, #44, #83): align, distribute, group and combine the selection, the same
// actions as their shortcuts, which the tooltips show. Several layers line up with each other; one
// layer lines up with the format, or the group or frame it is in. Two or more shapes combine into
// a live boolean.
import {
  AlignBottomIcon, AlignCenterHorizontalIcon, AlignCenterVerticalIcon, AlignLeftIcon, AlignRightIcon, AlignTopIcon, ColumnsIcon, ExcludeSquareIcon,
  IntersectSquareIcon, RowsIcon, SelectionPlusIcon, SubtractSquareIcon, UniteSquareIcon, type Icon,
} from '@phosphor-icons/react'
import { SHORTCUTS, type Editor, type ShortcutAction } from '@razzlr/editor'
import { useEffect, useState } from 'react'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { cn } from '../../lib/cn.ts'
import { Tooltip } from '../ui/tooltip.tsx'
import { CARD, CardHeader } from './card.tsx'
import { ICON_BUTTON } from './formats-panel.tsx'

type Action = Extract<ShortcutAction, `align${string}` | `distribute${string}` | `boolean${string}` | 'group'>
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

const COMBINE: { action: Action; icon: Icon }[] = [
  { action: 'booleanUnion', icon: UniteSquareIcon },
  { action: 'booleanSubtract', icon: SubtractSquareIcon },
  { action: 'booleanIntersect', icon: IntersectSquareIcon },
  { action: 'booleanExclude', icon: ExcludeSquareIcon },
]

/** A shortcut as the tooltip shows it: Ctrl for Mod, or ⌘ and ⌥ on a Mac. */
function keyOf(action: ShortcutAction) {
  const spec: string = SHORTCUTS.find((s) => s.action === action)?.keys[0] ?? ''
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return spec.replace('Mod', mac ? '⌘' : 'Ctrl').replace('Alt', mac ? '⌥' : 'Alt')
}

/** The selected layers, kept current. */
export function useSelection(editor: Editor) {
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
  const button = ({ action, icon: ActionIcon }: { action: Action; icon: Icon }, disabled: boolean, big = false) => {
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
          className={cn(ICON_BUTTON, big && 'h-10 w-full rounded-[10px] bg-hover/60')}
        >
          <ActionIcon size={big ? 20 : 16} aria-hidden />
        </button>
      </Tooltip>
    )
  }
  const label = (text: string) => <span className="text-xs text-muted">{text}</span>
  return (
    <section aria-labelledby="arrange-title" className={CARD} data-testid="arrange">
      <CardHeader id="arrange-title" title={t.editor.arrange.title} count={selected.length} />
      {/* The design never mirrors, so neither do left and right here. */}
      <div dir="ltr" role="group" aria-label={t.editor.arrange.align} className="grid grid-cols-6 gap-1 px-3 pb-3">
        {ALIGN.map((a) => button(a, selected.length === 0, true))}
      </div>
      <div dir="ltr" className="flex items-center justify-between gap-2 border-t border-line px-4 py-2">
        {label(t.editor.arrange.distribute)}
        <div role="group" aria-label={t.editor.arrange.distribute} className="flex gap-0.5">
          {DISTRIBUTE.map((d) => button(d, selected.length < 3))}
        </div>
      </div>
      <div dir="ltr" className="flex items-center justify-between gap-2 border-t border-line px-4 py-2">
        {label(t.editor.arrange.combine)}
        <div role="group" aria-label={t.editor.arrange.combine} className="flex gap-0.5">
          {button({ action: 'group', icon: SelectionPlusIcon }, selected.length < 2)}
          <span aria-hidden className="mx-1 h-5 w-px self-center bg-line" />
          {COMBINE.map((c) => button(c, selected.length < 2))}
        </div>
      </div>
    </section>
  )
}
