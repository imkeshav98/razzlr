'use client'

// The layers panel (#59): the page's layer tree, topmost first, in step with the stage's selection.
// Drag a row to reorder it or drop it into a group; rename, lock and hide; expand groups. Every
// change is an editor call, so each is one undo step. Only the rows in view are in the page, so a
// page of hundreds of layers scrolls as smoothly as one of ten.
import {
  CaretRightIcon, CircleIcon, EyeIcon, EyeSlashIcon, FolderSimpleIcon, FrameCornersIcon, ImageIcon, LockSimpleIcon,
  LockSimpleOpenIcon, PenNibIcon, SquareIcon, TextTIcon, UniteIcon, type Icon,
} from '@phosphor-icons/react'
import { childrenOf } from '@razzlr/doc'
import type { Editor } from '@razzlr/editor'
import { canHold, LOCK_FLAGS, type Design } from '@razzlr/schema'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { cn } from '../../lib/cn.ts'
import { useLocale, useMessages } from '../../lib/i18n/client.tsx'
import { dirOf, format } from '../../lib/i18n/index.ts'
import { useOverlayScroll } from '../ui/overlay-scroll.ts'
import { useFlyoutNote } from './shell.tsx'
import { useLiveDesign } from './use-live-design.ts'

/** A row's height in pixels: every row is the same, which is what lets only the rows in view render. */
export const LAYER_ROW = 36
/** Rows rendered beyond each edge of the view, so a fast scroll never shows a gap. */
const OVERSCAN = 8
const INDENT = 16
const DRAG_TYPE = 'application/x-razzlr-layer'

type Layer = Design['nodes'][string]
interface Row { id: string; node: Layer; depth: number; parentId: string; hasChildren: boolean; position: number; siblings: number }
type Where = 'above' | 'below' | 'into'

const ordered = <T extends { order: string }>(items: Record<string, T>) =>
  Object.entries(items).sort(([a, x], [b, y]) => (x.order < y.order ? -1 : x.order > y.order ? 1 : a < b ? -1 : 1))

/** The page's layers as rows, topmost first, with the children of expanded layers under them. */
function rowsOf(design: Design, pageId: string, expanded: ReadonlySet<string>) {
  const rows: Row[] = []
  const walk = (parentId: string, depth: number) => {
    const children = childrenOf(design, parentId).reverse()
    for (const [position, [id, node]] of children.entries()) {
      const hasChildren = childrenOf(design, id).length > 0
      rows.push({ id, node, depth, parentId, hasChildren, position: position + 1, siblings: children.length })
      if (hasChildren && expanded.has(id)) walk(id, depth + 1)
    }
  }
  walk(pageId, 0)
  return rows
}

function iconOf(node: Layer): Icon {
  if (node.type === 'text') return TextTIcon
  if (node.type === 'group') return FolderSimpleIcon
  if (node.type === 'frame') return FrameCornersIcon
  if (node.type === 'boolean') return UniteIcon
  const props = node.props as { shape?: { kind?: string }; fills?: { type: string }[] }
  if (props.fills?.some((f) => f.type === 'image')) return ImageIcon
  if (props.shape?.kind === 'ellipse') return CircleIcon
  if (props.shape?.kind === 'path') return PenNibIcon
  return SquareIcon
}

const isLocked = (node: Layer) => LOCK_FLAGS.some((flag) => node.lock?.[flag])

/** The selection and the frame it is in, kept current. */
function useSelection(editor: Editor) {
  const [state, setState] = useState(() => ({ ids: editor.selection(), frame: editor.selectedFrame() }))
  useEffect(() => {
    const stop = editor.onSelection((ids) => setState({ ids, frame: editor.selectedFrame() }))
    return () => {
      stop()
    }
  }, [editor])
  return state
}

export function LayersPanel({ editor }: { editor: Editor }) {
  const t = useMessages()
  const rtl = dirOf(useLocale()) === 'rtl'
  const { design, version } = useLiveDesign(editor)
  const selection = useSelection(editor)
  const selected = useMemo(() => new Set(selection.ids), [selection.ids])

  // The frame the panel shows: the selection's, or the first page in the primary format.
  const [framePage, frameFormat] = selection.frame?.split('/') ?? []
  const pageId = framePage && design.pages[framePage] ? framePage : ordered(design.pages)[0]?.[0] ?? ''
  const formatId = frameFormat && design.formats[frameFormat] ? frameFormat : design.meta.primaryFormatId
  const page = design.pages[pageId]
  // The title row's note says which frame the tree is of, as in the mock: "Page 1 · Square".
  useFlyoutNote(page ? [page.name, design.formats[formatId]?.name].filter(Boolean).join(' · ') : null)

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // A layer selected on the stage shows in the panel: the groups it is in open.
  useEffect(() => {
    const open = new Set<string>()
    for (const id of selection.ids) {
      for (let up = design.nodes[id]?.parentId; up && design.nodes[up]; up = design.nodes[up]?.parentId) open.add(up)
    }
    if ([...open].some((id) => !expanded.has(id))) setExpanded(new Set([...expanded, ...open]))
  }, [selection.ids, design, version, expanded])

  // The version is how the live design says it changed.
  const rows = useMemo(() => rowsOf(design, pageId, expanded), [design, version, pageId, expanded])
  const indexOf = useMemo(() => new Map(rows.map((row, i) => [row.id, i])), [rows])

  // Which rows are in view.
  const scroller = useRef<HTMLDivElement>(null)
  const scrollerRef = useOverlayScroll(scroller)
  // Kept in rows, not pixels: a scroll that shows no new row renders nothing.
  const [view, setView] = useState({ from: 0, to: Math.ceil(400 / LAYER_ROW) + OVERSCAN })
  const follow = useCallback((el: HTMLElement) => {
    const from = Math.max(0, Math.floor(el.scrollTop / LAYER_ROW) - OVERSCAN)
    const to = Math.ceil((el.scrollTop + el.clientHeight) / LAYER_ROW) + OVERSCAN
    setView((now) => (now.from === from && now.to === to ? now : { from, to }))
  }, [])
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    follow(el)
    const observer = new ResizeObserver(() => follow(el))
    observer.observe(el)
    return () => observer.disconnect()
  }, [follow])
  const first = view.from
  const last = Math.min(rows.length, view.to)

  // The row keyboard focus is on: the one the arrows move from. Tab lands on it.
  const [active, setActive] = useState<string | null>(null)
  const current = active && indexOf.has(active) ? active : selection.ids.find((id) => indexOf.has(id)) ?? rows[0]?.id ?? null
  const focusing = useRef(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; where: Where } | null>(null)
  const dragged = useRef<string | null>(null)

  /** Scrolls a row into view, then focuses it once it is rendered. */
  const reveal = useCallback((id: string) => {
    const el = scroller.current
    const i = indexOf.get(id)
    if (!el || i === undefined) return
    const top = i * LAYER_ROW
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + LAYER_ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + LAYER_ROW - el.clientHeight
    follow(el)
    setActive(id)
    focusing.current = true
  }, [indexOf, follow])
  useEffect(() => {
    if (!focusing.current || !current) return
    const row = scroller.current?.querySelector<HTMLElement>(`[data-layer="${CSS.escape(current)}"]`)
    if (row && document.activeElement !== row) row.focus({ preventScroll: true })
    if (row) focusing.current = false
  })

  const select = (id: string, add = false) => {
    const ids = add ? (selected.has(id) ? selection.ids.filter((s) => s !== id) : [...selection.ids, id]) : [id]
    editor.select(ids, pageId, formatId)
  }
  const toggle = (id: string, open = !expanded.has(id)) => {
    const next = new Set(expanded)
    if (open) next.add(id)
    else next.delete(id)
    setExpanded(next)
  }

  /** Moves a layer next to or into another, as the panel shows them. */
  const place = (id: string, target: Row, where: Where) => {
    if (id === target.id) return false
    if (where === 'into') {
      const moved = editor.moveLayer(id, target.id)
      if (moved) toggle(target.id, true)
      return moved
    }
    // Rows run topmost first; in the document the topmost is last. Above a row is after it there.
    const siblings = childrenOf(design, target.parentId).map(([sibling]) => sibling).filter((sibling) => sibling !== id)
    const at = siblings.indexOf(target.id)
    const before = where === 'below' ? target.id : siblings[at + 1]
    return editor.moveLayer(id, target.parentId, before)
  }

  /** Alt with the arrows: up and down among its siblings, into the group above it, or out of its group. */
  const shift = (row: Row, key: string) => {
    const siblings = childrenOf(design, row.parentId).map(([sibling]) => sibling)
    const at = siblings.indexOf(row.id)
    const inward = rtl ? 'ArrowLeft' : 'ArrowRight'
    if (key === 'ArrowUp') {
      const above = siblings[at + 1]
      return above !== undefined && editor.moveLayer(row.id, row.parentId, siblings[at + 2])
    }
    if (key === 'ArrowDown') {
      const below = siblings[at - 1]
      return below !== undefined && editor.moveLayer(row.id, row.parentId, below)
    }
    if (key === inward) {
      const above = siblings[at + 1]
      const holder = above && design.nodes[above]
      if (!above || !holder || !canHold(holder.type, row.node.type)) return false
      const moved = editor.moveLayer(row.id, above)
      if (moved) toggle(above, true)
      return moved
    }
    const parent = design.nodes[row.parentId]
    if (!parent) return false
    const outer = childrenOf(design, parent.parentId).map(([sibling]) => sibling)
    return editor.moveLayer(row.id, parent.parentId, outer[outer.indexOf(row.parentId) + 1])
  }

  const onKey = (event: KeyboardEvent<HTMLElement>, row: Row, i: number) => {
    if (renaming) return
    const inward = rtl ? 'ArrowLeft' : 'ArrowRight'
    const outward = rtl ? 'ArrowRight' : 'ArrowLeft'
    const go = (to: Row | undefined) => {
      if (!to) return
      select(to.id)
      reveal(to.id)
    }
    let handled = true
    if (event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      if (shift(row, event.key)) reveal(row.id)
    } else if (event.key === 'ArrowDown') go(rows[i + 1])
    else if (event.key === 'ArrowUp') go(rows[i - 1])
    else if (event.key === 'Home') go(rows[0])
    else if (event.key === 'End') go(rows.at(-1))
    else if (event.key === inward) {
      if (row.hasChildren && !expanded.has(row.id)) toggle(row.id, true)
      else if (row.hasChildren) go(rows[i + 1])
    } else if (event.key === outward) {
      if (row.hasChildren && expanded.has(row.id)) toggle(row.id, false)
      else go(rows.find((r) => r.id === row.parentId))
    } else if (event.key === 'Enter' || event.key === 'F2') setRenaming(row.id)
    else if (event.key === ' ') select(row.id, event.shiftKey || event.metaKey || event.ctrlKey)
    else handled = false
    // The stage's own shortcuts, such as Delete or lock and hide, still act on the selection.
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const whereOn = (event: DragEvent<HTMLElement>, row: Row): Where | null => {
    const id = dragged.current
    const node = id && design.nodes[id]
    if (!node || id === row.id) return null
    const box = event.currentTarget.getBoundingClientRect()
    const y = (event.clientY - box.top) / box.height
    if (canHold(row.node.type, node.type) && y > 0.25 && y < 0.75) return 'into'
    return y < 0.5 ? 'above' : 'below'
  }

  // The rows get one object whose calls reach the latest handlers, so a row that hasn't changed
  // isn't rendered again when the view scrolls or another row changes.
  const latest = useRef<RowApi | null>(null)
  latest.current = {
    focus: (id) => setActive(id),
    key: onKey,
    click: (id, add) => select(id, add),
    rename: (id) => setRenaming(id),
    renamed: (id, name, before) => {
      setRenaming(null)
      if (name !== null && name.trim() && name.trim() !== before) editor.renameLayer(id, name)
      reveal(id)
    },
    toggle: (id) => toggle(id),
    lock: (id, locked) => editor.setLocked([id], locked),
    hide: (id, hidden) => editor.setHidden([id], hidden, pageId, formatId),
    dragStart: (id) => {
      dragged.current = id
    },
    dragEnd: () => {
      dragged.current = null
      setDrop(null)
    },
    dragOver: (event, row) => {
      const where = whereOn(event, row)
      if (!where) return false
      if (drop?.id !== row.id || drop.where !== where) setDrop({ id: row.id, where })
      return true
    },
    dragLeave: (id) => {
      if (drop?.id === id) setDrop(null)
    },
    drop: (event, row) => {
      const where = whereOn(event, row)
      const from = dragged.current
      setDrop(null)
      if (!where || !from) return false
      place(from, row, where)
      return true
    },
  }
  const api = useMemo<RowApi>(() => {
    const call = <K extends keyof RowApi>(name: K) => ((...args: unknown[]) => (latest.current?.[name] as (...a: unknown[]) => unknown)(...args)) as RowApi[K]
    return {
      focus: call('focus'), key: call('key'), click: call('click'), rename: call('rename'), renamed: call('renamed'), toggle: call('toggle'),
      lock: call('lock'), hide: call('hide'), dragStart: call('dragStart'), dragEnd: call('dragEnd'), dragOver: call('dragOver'),
      dragLeave: call('dragLeave'), drop: call('drop'),
    }
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="layers">
      {rows.length === 0
        ? <p className="p-4 text-[13px] text-muted">{t.editor.layersPanel.empty}</p>
        : (
          <div
            ref={scrollerRef}
            onScroll={(event) => follow(event.currentTarget)}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2"
            data-testid="layers-scroller"
          >
            <div
              role="tree"
              aria-label={format(t.editor.layersPanel.tree, { page: page?.name ?? '' })}
              aria-multiselectable
              className="relative"
              style={{ height: rows.length * LAYER_ROW }}
            >
              {rows.slice(first, last).map((row, offset) => (
                <LayerRow
                  key={row.id}
                  row={row}
                  i={first + offset}
                  selected={selected.has(row.id)}
                  focusable={row.id === current}
                  renaming={renaming === row.id}
                  open={expanded.has(row.id)}
                  hidden={(design.overrides[`format:${formatId}`]?.[row.id]?.visible ?? row.node.props.visible) === false}
                  drop={drop?.id === row.id ? drop.where : null}
                  api={api}
                />
              ))}
            </div>
          </div>
        )}
      <p className="shrink-0 border-t border-line px-[18px] py-2.5 text-[11px] leading-snug text-subtle">{t.editor.layersPanel.hint}</p>
    </div>
  )
}

interface RowApi {
  focus: (id: string) => void
  key: (event: KeyboardEvent<HTMLElement>, row: Row, i: number) => void
  click: (id: string, add: boolean) => void
  rename: (id: string) => void
  renamed: (id: string, name: string | null, before: string) => void
  toggle: (id: string) => void
  lock: (id: string, locked: boolean) => void
  hide: (id: string, hidden: boolean) => void
  dragStart: (id: string) => void
  dragEnd: () => void
  dragOver: (event: DragEvent<HTMLElement>, row: Row) => boolean
  dragLeave: (id: string) => void
  drop: (event: DragEvent<HTMLElement>, row: Row) => boolean
}

/** One row of the tree. Rendered again only when something it shows changes. */
const LayerRow = memo(function LayerRow({ row, i, selected, focusable, renaming, open, hidden, drop, api }: {
  row: Row
  i: number
  selected: boolean
  focusable: boolean
  renaming: boolean
  open: boolean
  hidden: boolean
  drop: Where | null
  api: RowApi
}) {
  const t = useMessages()
  const { id, node, depth } = row
  const locked = isLocked(node)
  const LayerIcon = iconOf(node)
  return (
    <div
      key={id}
      role="treeitem"
      data-layer={id}
      aria-level={depth + 1}
      aria-setsize={row.siblings}
      aria-posinset={row.position}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? open : undefined}
      data-drop={drop ?? undefined}
      tabIndex={focusable ? 0 : -1}
      draggable={!renaming}
      onFocus={() => api.focus(id)}
      onKeyDown={(event) => api.key(event, row, i)}
      onClick={(event) => api.click(id, event.shiftKey || event.metaKey || event.ctrlKey)}
      onDoubleClick={() => api.rename(id)}
      onDragStart={(event) => {
        api.dragStart(id)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(DRAG_TYPE, id)
      }}
      onDragEnd={() => api.dragEnd()}
      onDragOver={(event) => {
        if (!api.dragOver(event, row)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={() => api.dragLeave(id)}
      onDrop={(event) => {
        if (api.drop(event, row)) event.preventDefault()
      }}
      // A 2 px gap between rows, so each selected row reads as its own pill.
      style={{ top: i * LAYER_ROW + 1, height: LAYER_ROW - 2, paddingInlineStart: 4 + depth * INDENT }}
      className={cn(
        'group absolute inset-x-1 flex cursor-default items-center gap-1.5 rounded-[8px] pe-1 text-[13px] font-medium outline-none select-none',
        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
        // The selected row is tinted pink, its type tile solid pink, as in the mock.
        selected ? 'bg-accent/20 text-text' : 'hover:bg-hover',
        drop === 'into' && 'ring-2 ring-accent ring-inset',
        hidden && 'text-subtle',
      )}
    >
      {drop === 'above' && <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-px h-0.5 rounded-full bg-accent" />}
      {drop === 'below' && <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />}
      {row.hasChildren
        ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={format(open ? t.editor.layersPanel.collapse : t.editor.layersPanel.expand, { name: node.name })}
            onClick={(event) => {
              event.stopPropagation()
              api.toggle(id)
            }}
            className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-row text-subtle hover:text-text"
          >
            <CaretRightIcon size={11} weight="bold" aria-hidden className={cn('transition-transform duration-[var(--chrome-fast)] rtl:-scale-x-100', open && 'rotate-90 rtl:-rotate-90')} />
          </button>
        )
        : <span aria-hidden className="size-4 shrink-0" />}
      <span aria-hidden className={cn('grid size-[22px] shrink-0 place-items-center rounded-[5px] transition-colors duration-[var(--chrome-fast)]', selected ? 'bg-accent-solid text-on-accent' : 'bg-text/10 text-muted')}>
        <LayerIcon size={13} weight={selected ? 'bold' : 'regular'} />
      </span>
      {renaming
        ? (
          <RenameField
            name={node.name}
            label={format(t.editor.layersPanel.rename, { name: node.name })}
            onDone={(name) => api.renamed(id, name, node.name)}
          />
        )
        : <span className={cn('min-w-0 flex-1 truncate', hidden && 'line-through decoration-subtle/60')}>{node.name}</span>}
      <RowToggle
        on={hidden}
        label={format(hidden ? t.editor.layersPanel.show : t.editor.layersPanel.hide, { name: node.name })}
        onToggle={() => api.hide(id, !hidden)}
        icon={hidden ? EyeSlashIcon : EyeIcon}
        testId="layer-hide"
      />
      <RowToggle
        on={locked}
        label={format(locked ? t.editor.layersPanel.unlock : t.editor.layersPanel.lock, { name: node.name })}
        onToggle={() => api.lock(id, !locked)}
        icon={locked ? LockSimpleIcon : LockSimpleOpenIcon}
        testId="layer-lock"
      />
    </div>
  )
})

/** Lock or hide on a row: shown while the row is hovered or focused, and always while it is on. */
function RowToggle({ on, label, onToggle, icon: ToggleIcon, testId }: { on: boolean; label: string; onToggle: () => void; icon: Icon; testId: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      aria-pressed={on}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      className={cn(
        'grid size-6 shrink-0 cursor-pointer place-items-center rounded-[6px] text-subtle hover:bg-hover hover:text-text',
        !on && 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
      )}
    >
      <ToggleIcon size={14} aria-hidden />
    </button>
  )
}

/** The name as a field: Enter or leaving it keeps the new name, Escape keeps the old one. */
function RenameField({ name, label, onDone }: { name: string; label: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name)
  const done = useRef(false)
  const finish = (next: string | null) => {
    if (done.current) return
    done.current = true
    onDone(next)
  }
  return (
    <input
      name="layer-name"
      // Focused as it opens: the person asked to rename this layer.
      autoFocus
      aria-label={label}
      value={value}
      maxLength={120}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') finish(value)
        else if (event.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(value)}
      className="h-6 min-w-0 flex-1 rounded-row border border-accent bg-raised px-1.5 text-[13px] outline-none"
    />
  )
}
