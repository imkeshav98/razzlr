'use client'

// The Arrange card (#42, #44, #83): align, distribute, group and combine the selection, the same
// actions as their shortcuts, which the tooltips show. Several layers line up with each other; one
// layer lines up with the format, or the group or frame it is in. Two or more shapes combine into
// a live boolean.
import {
  AlignBottomIcon, AlignCenterHorizontalIcon, AlignCenterVerticalIcon, AlignLeftIcon, AlignRightIcon, AlignTopIcon, ArrowsHorizontalIcon, ArrowsVerticalIcon, ExcludeSquareIcon,
  IntersectSquareIcon, SelectionPlusIcon, SubtractSquareIcon, UniteSquareIcon, type Icon,
} from '@phosphor-icons/react'
import { SHORTCUTS, type Editor, type ShortcutAction } from '@razzlr/editor'
import { useEffect, useState } from 'react'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { cn } from '../../lib/cn.ts'
import { Tooltip } from '../ui/tooltip.tsx'
import { CARD, CardHeader } from './card.tsx'
import { CHIP, ICON_BUTTON, useEditorDesign } from './formats-panel.tsx'

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
  { action: 'distributeHorizontal', icon: ArrowsHorizontalIcon },
  { action: 'distributeVertical', icon: ArrowsVerticalIcon },
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
  const { design } = useEditorDesign(editor)
  const names = selected.flatMap((id) => design.nodes[id]?.name ?? [])
  const button = ({ action, icon: ActionIcon }: { action: Action; icon: Icon }, disabled: boolean, look: 'tile' | 'icon' | 'chip' = 'icon') => {
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
          className={cn(
            look === 'icon' && ICON_BUTTON,
            // The align buttons are the big ones: square tiles, as in the mock.
            look === 'tile' && 'grid h-10 w-full cursor-pointer place-items-center rounded-[10px] border border-line text-muted transition-colors duration-[var(--chrome-fast)] hover:border-accent hover:text-text disabled:pointer-events-none disabled:opacity-30',
            look === 'chip' && CHIP,
            // Group is the card's main action, pink as in the mock.
            action === 'group' && 'h-8 border-transparent bg-accent-solid px-5 text-on-accent hover:border-transparent hover:bg-accent-solid-hover hover:text-on-accent',
          )}
        >
          {look === 'chip' && <span aria-hidden>{action === 'group' ? label : t.editor.arrange.distribute}</span>}
          {action !== 'group' && <ActionIcon size={look === 'tile' ? 20 : look === 'chip' ? 14 : 16} aria-hidden />}
        </button>
      </Tooltip>
    )
  }
  const several = selected.length > 1
  return (
    <section aria-labelledby="arrange-title" className={CARD} data-testid="arrange">
      <CardHeader
        id="arrange-title"
        title={several ? format(t.editor.arrange.selected, { n: selected.length }) : t.editor.arrange.title}
        note={names.join(', ')}
      />
      {/* The design never mirrors, so neither do left and right here. */}
      <div dir="ltr" role="group" aria-label={t.editor.arrange.align} className="grid grid-cols-6 gap-1.5 px-[18px] pb-3.5">
        {ALIGN.map((a) => button(a, selected.length === 0, 'tile'))}
      </div>
      <div dir="ltr" role="group" aria-label={t.editor.arrange.distribute} className="flex flex-wrap gap-1.5 px-[18px] pb-4">
        {DISTRIBUTE.map((d) => button(d, selected.length < 3, 'chip'))}
      </div>
      <div className="px-[18px]">
        <div dir="ltr" className="flex items-center justify-between gap-2 border-t border-line py-3">
          {button({ action: 'group', icon: SelectionPlusIcon }, selected.length < 2, 'chip')}
          <div role="group" aria-label={t.editor.arrange.combine} className="flex gap-0.5">
            {COMBINE.map((c) => button(c, selected.length < 2))}
          </div>
        </div>
      </div>
    </section>
  )
}
