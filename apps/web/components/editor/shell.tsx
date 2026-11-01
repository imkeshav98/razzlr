'use client'

// The editor's chrome (#51): no top bar, but two islands floating at the top (#110); a capsule
// floating over the canvas whose buttons open flyouts (Layers, Assets, AI, Brand; #82); property
// cards floating at the top end (#83); a bottom tool dock and a slot for the mini bar above the
// selection. The canvas runs edge to edge under all of it; the stage is the editor itself, told
// which edges the chrome covers so it fits the ads between.
import {
  CloudArrowUpIcon, CloudCheckIcon, CloudSlashIcon, CursorIcon, FrameCornersIcon, HandIcon, ImageIcon, ImagesIcon, PaletteIcon, PenNibIcon, ShapesIcon,
  SlidersHorizontalIcon, SparkleIcon, StackIcon, TextTIcon, XIcon, type Icon,
} from '@phosphor-icons/react'
import type { ShapeTool } from '@razzlr/editor'
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { useLocale, useMessages } from '../../lib/i18n/client.tsx'
import { dirOf, format } from '../../lib/i18n/index.ts'
import { useValue, type ValueStore } from '../../lib/value-store.ts'
import { BrandMark } from '../brand-mark.tsx'
import { Tooltip } from '../ui/tooltip.tsx'
import { ShapeTools } from './shape-menu.tsx'

export type Panel = 'layers' | 'assets' | 'ai' | 'brand' | 'properties'
export type Tool = 'select' | 'frame' | 'shape' | 'text' | 'pen' | 'image' | 'hand'

const PANELS: { id: Panel; icon: Icon; phone?: true }[] = [
  { id: 'layers', icon: StackIcon },
  { id: 'assets', icon: ImagesIcon },
  { id: 'ai', icon: SparkleIcon },
  { id: 'brand', icon: PaletteIcon },
  // On phones the property cards are a bottom sheet, opened from the tab bar.
  { id: 'properties', icon: SlidersHorizontalIcon, phone: true },
]
const TOOLS: { id: Tool; icon: Icon; key: string }[] = [
  { id: 'select', icon: CursorIcon, key: 'V' },
  { id: 'frame', icon: FrameCornersIcon, key: 'F' },
  { id: 'shape', icon: ShapesIcon, key: 'R' },
  { id: 'text', icon: TextTIcon, key: 'T' },
  { id: 'pen', icon: PenNibIcon, key: 'P' },
  { id: 'image', icon: ImageIcon, key: 'I' },
  { id: 'hand', icon: HandIcon, key: 'H' },
]

const CHROME = { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as const }
/** The capsule's pink blob slides to the open panel on a spring, so it overshoots a little. */
const BLOB = { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 } as const
/** On arrival the blob is stretched along its travel and settles round: the squish. */
const SQUISH = { tall: { scaleX: 0.78, scaleY: 1.28 }, wide: { scaleX: 1.28, scaleY: 0.78 }, still: { scaleX: 1, scaleY: 1 } }

/**
 * The design's save state (#37) and how it shows: a small muted cloud while all is well (#110), so
 * it never competes with the work; Offline (and an error) colour it and say so in words.
 */
const SAVE: Record<string, { icon: Icon; tone: string; words?: boolean }> = {
  Saved: { icon: CloudCheckIcon, tone: 'text-subtle' },
  Saving: { icon: CloudArrowUpIcon, tone: 'text-subtle' },
  Offline: { icon: CloudSlashIcon, tone: 'text-warning', words: true },
}
/** Saving stays up at least this long, so a quick edit doesn't flicker the badge. */
const SAVING_HOLD_MS = 600

/** Lets the open flyout's content set the small grey note in its title row, as Layers does with its page and format. */
type Note = { owner: object; text: string } | null
const FlyoutNote = createContext<(change: (now: Note) => Note) => void>(() => undefined)

/**
 * Shows a note at the end of the open flyout's title row while the caller is mounted. A flyout
 * fading out clears only its own note, never the next one's.
 */
export function useFlyoutNote(text: string | null) {
  const setNote = useContext(FlyoutNote)
  const [owner] = useState(() => ({}))
  useEffect(() => {
    setNote(() => (text ? { owner, text } : null))
    return () => setNote((now) => (now?.owner === owner ? null : now))
  }, [setNote, owner, text])
}

/** Phones get the capsule as a bottom tab bar, so the blob travels sideways there. */
function usePhone() {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)')
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return phone
}

/**
 * The status to show: the editor's own, except that Saving lingers a moment before Saved, so a
 * stream of edits reads as one save rather than a blink per keystroke.
 */
function useShownStatus(status: string) {
  const [shown, setShown] = useState(status)
  const [savingSince, setSavingSince] = useState(0)
  useEffect(() => {
    if (status === 'Saving' && shown !== 'Saving') {
      setSavingSince(Date.now())
      setShown(status)
      return
    }
    if (status === 'Saved' && shown === 'Saving') {
      const wait = savingSince + SAVING_HOLD_MS - Date.now()
      if (wait > 0) {
        const timer = setTimeout(() => setShown(status), wait)
        return () => clearTimeout(timer)
      }
    }
    setShown(status)
  }, [status, shown, savingSince])
  return shown
}

/** The design's save state at the end of the start island, read from the status store. */
function SaveStatus({ status, fitted }: { status: ValueStore<string>; fitted: boolean }) {
  const t = useMessages()
  const current = useValue(status)
  const shown = useShownStatus(current)
  const save = SAVE[shown]
  const failed = shown.startsWith('Error')
  return (
    <span
      role="status"
      aria-atomic="true"
      aria-label={t.editor.status}
      data-testid="status"
      data-status={current}
      data-ready={save && fitted ? '' : undefined}
      title={save ? t.editor.statusHint[shown] : undefined}
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 text-xs font-medium transition-colors duration-[var(--chrome)]',
        failed ? 'text-danger' : save ? save.tone : 'text-subtle',
      )}
    >
      {save ? (
        <save.icon size={17} aria-hidden className={cn(shown === 'Saving' && 'animate-pulse')} />
      ) : (
        <span aria-hidden className={cn('size-1.5 rounded-full', failed ? 'bg-danger' : 'animate-pulse bg-subtle')} />
      )}
      <span className={cn(!(failed || save?.words) && 'sr-only')}>{t.editor.statusText[shown] ?? shown}</span>
      {shown === 'Offline' && <span className="hidden font-normal text-muted md:inline">{t.editor.statusHint.Offline}</span>}
    </span>
  )
}

/** The stage's edges the floating chrome covers, in CSS pixels, left and right as on screen. */
export interface ChromeInsets { top: number; right: number; bottom: number; left: number }

/**
 * Measures how much of the stage the islands, the capsule, the cards and the dock cover. The
 * islands at the top (#110) cover the top. Of the other pieces, one in the stage's lower part covers
 * the bottom (the dock, and the capsule when it is the phones' tab bar); one on the left or right of
 * the middle covers that side. The phones' open sheet spans the stage, so fitting around it would
 * leave nothing: it counts for nothing, as do hidden pieces.
 */
function measureInsets(stage: DOMRect, tops: (Element | null)[], pieces: (Element | null)[]): ChromeInsets {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 }
  const gap = 12
  for (const top of tops) {
    const box = top?.getBoundingClientRect()
    if (box && box.width > 0 && box.height > 0) insets.top = Math.max(insets.top, box.bottom - stage.top + gap)
  }
  for (const piece of pieces) {
    const box = piece?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) continue
    if (box.top > stage.top + stage.height * 0.6) insets.bottom = Math.max(insets.bottom, stage.bottom - box.top + gap)
    else if (box.width > stage.width * 0.6) continue
    else if (box.left + box.width / 2 < stage.left + stage.width / 2) insets.left = Math.max(insets.left, box.right - stage.left + gap)
    else insets.right = Math.max(insets.right, stage.right - box.left + gap)
  }
  return insets
}

/**
 * The design's name in the crumb (#159): a click or Enter on it makes it a field; Enter or leaving
 * the field saves a new name, Esc keeps the old one.
 */
function DesignName({ name, onRename }: { name: string; onRename?: ((name: string) => Promise<void>) | undefined }) {
  const t = useMessages()
  const [editing, setEditing] = useState(false)
  const done = useRef(false)
  const title = 'truncate font-display text-sm font-semibold tracking-tight'
  if (!onRename) return <h1 className={title}>{name}</h1>
  if (!editing) {
    return (
      <h1 className={cn(title, 'min-w-0')}>
        <button type="button" title={format(t.library.renameDesign, { name })} onClick={() => setEditing(true)} className="max-w-full cursor-text truncate rounded-[6px] px-1 -mx-1 hover:bg-hover">
          {name}
        </button>
      </h1>
    )
  }
  const finish = (field: HTMLInputElement, save: boolean) => {
    if (done.current) return
    done.current = true
    const next = field.value.trim()
    setEditing(false)
    if (save && next && next !== name) void onRename(next)
  }
  return (
    <input
      name="design-name"
      aria-label={format(t.library.renameDesign, { name })}
      defaultValue={name}
      maxLength={120}
      autoFocus
      onFocus={(event) => {
        done.current = false
        event.currentTarget.select()
      }}
      onBlur={(event) => finish(event.currentTarget, true)}
      onKeyDown={(event) => {
        // Keys typed into the name are the name's, not the stage's.
        event.stopPropagation()
        if (event.key === 'Enter') finish(event.currentTarget, true)
        else if (event.key === 'Escape') finish(event.currentTarget, false)
      }}
      className="h-7 w-48 min-w-0 rounded-[6px] border border-accent bg-bg px-1.5 font-display text-sm font-semibold tracking-tight outline-none"
    />
  )
}

export function EditorShell({ brandId, brandName, designName, onRename, status, tool: shownTool, shape = 'rect', onToolChange, onInsets, fitted = true, inspector, actions, account, panels, children }: {
  brandId: string
  brandName: string
  designName: string
  /** Saves a new name for the design; left out, the name can't be changed here. */
  onRename?: (name: string) => Promise<void>
  /** The editor's save state, or what it is doing before it opens. */
  status: ValueStore<string>
  /** The tool in use, when the editor decides it (a key, or drawing a shape ends); the dock keeps its own otherwise. */
  tool?: Tool
  /** The shape the shape tool draws (#44). */
  shape?: ShapeTool
  onToolChange?: (tool: Tool, shape: ShapeTool) => void
  /** Called with the stage's edges the chrome covers, whenever they change; `withCards` once the cards are in. */
  onInsets?: (insets: ChromeInsets, withCards: boolean) => void
  /** False until the stage has fitted the design between the chrome: the editor is not ready before. */
  fitted?: boolean
  /** The property cards, once the design is open. */
  inspector?: ReactNode
  /** The design's one action at the header's end: Share, holding Export and Save as template. */
  actions?: ReactNode
  /** The account avatar after it, with language, theme, settings and sign out. */
  account?: ReactNode
  /** What a flyout shows once its ticket fills it, such as the asset library (#52); an empty state until then. */
  panels?: Partial<Record<Panel, ReactNode>>
  children: ReactNode
}) {
  const t = useMessages()
  const rtl = dirOf(useLocale()) === 'rtl'
  // Motion's own reduced-motion mode still fades; chrome should simply appear.
  const reduced = useReducedMotion()
  const chrome = reduced ? { duration: 0 } : CHROME
  const phone = usePhone()
  const [panel, setPanel] = useState<Panel | null>(null)
  const [flyoutNote, setNote] = useState<Note>(null)
  const note = flyoutNote?.text ?? null
  const [ownTool, setTool] = useState<Tool>('select')
  const tool = shownTool ?? ownTool
  const panelTitle = (id: Panel) => (id === 'properties' ? t.editor.inspector : t.editor[id])
  const panelEmpty = { layers: t.editor.layersEmpty, assets: t.editor.assetsEmpty, ai: t.editor.aiEmpty, brand: t.editor.brandEmpty }
  const flyout = panel === 'properties' ? null : panel
  const hasCards = Boolean(inspector)

  const stage = useRef<HTMLElement>(null)
  const startIsland = useRef<HTMLDivElement>(null)
  const endIsland = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLElement>(null)
  const cards = useRef<HTMLElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const reported = useRef('')
  const report = useRef(onInsets)
  report.current = onInsets
  useLayoutEffect(() => {
    const measure = () => {
      if (!stage.current) return
      const box = stage.current.getBoundingClientRect()
      // On a phone the zoom pill sits under the end island, so the ads start below it.
      const zoom = box.width < 640 ? stage.current.querySelector('[data-zoom]') : null
      const insets = measureInsets(box, [startIsland.current, endIsland.current, zoom], [rail.current, cards.current, dock.current])
      const key = JSON.stringify([insets, hasCards])
      if (key === reported.current) return
      reported.current = key
      report.current?.(insets, hasCards)
    }
    const watch = new ResizeObserver(measure)
    for (const el of [stage.current, startIsland.current, endIsland.current, rail.current, cards.current, dock.current, stage.current?.querySelector('[data-zoom]')]) if (el) watch.observe(el)
    measure()
    return () => watch.disconnect()
  }, [hasCards])

  return (
    <MotionConfig reducedMotion="user">
        <div className="h-dvh overflow-hidden bg-bg text-text">
          <div className="relative flex h-full min-h-0">
          {/* No top bar (#110): two islands float over the canvas, the design's name and save state at
              the start and Share and the account at the end, clear of the rulers when they are on (top and
              left in either direction, so the insets swap in right-to-left). The start island sits on a
              small frosted pill, so its words read over an ad zoomed in under it; the end island's
              buttons are solid and need none. */}
          <header className="pointer-events-none absolute start-6 end-4 rtl:start-4 rtl:end-6 top-6 z-30 flex items-center justify-between gap-3">
            <div ref={startIsland} data-testid="island-start" className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full border surface-frost py-0.5 ps-0.5 pe-3 shadow-panel">
              <Link href="/" aria-label={t.library.home} className="grid size-9 shrink-0 place-items-center rounded-row hover:bg-hover">
                <BrandMark size={28} />
              </Link>
              <nav aria-label={t.library.designs} className="flex min-w-0 items-center gap-1.5 text-[13px]">
                <Link href={`/brands/${brandId}`} className="truncate text-muted transition-colors hover:text-text max-sm:hidden">{brandName}</Link>
                <span aria-hidden className="text-subtle max-sm:hidden">/</span>
                <DesignName name={designName} onRename={onRename} />
              </nav>
              <SaveStatus status={status} fitted={fitted} />
            </div>
            <div ref={endIsland} data-testid="island-end" className="pointer-events-auto flex shrink-0 items-center gap-2">
              {actions}
              {account}
            </div>
          </header>
            <nav
              ref={rail}
              aria-label={t.editor.tools}
              data-testid="rail"
              className={cn(
                // Clipped, so the AI button's moving glow stays inside and never shows on the canvas.
                'absolute z-20 flex gap-2 overflow-hidden rounded-full surface-frost border p-2 shadow-panel',
                // A vertical capsule at the start edge; on phones a tab bar floating at the bottom.
                'start-5 top-1/2 -translate-y-1/2 flex-col sm:p-2.5 max-sm:start-1/2 max-sm:top-auto max-sm:bottom-3 max-sm:translate-y-0 max-sm:flex-row max-sm:-translate-x-1/2 max-sm:rtl:translate-x-1/2',
              )}
            >
              {PANELS.map(({ id, icon: PanelIcon, phone: phoneOnly }) => {
                const open = panel === id
                const ai = id === 'ai'
                return (
                  <Tooltip key={id} label={panelTitle(id)} side={rtl ? 'left' : 'right'}>
                    <button
                      type="button"
                      aria-label={panelTitle(id)}
                      aria-expanded={open}
                      aria-controls={id === 'properties' ? 'editor-cards' : 'editor-flyout'}
                      data-panel={id}
                      onClick={() => setPanel(open ? null : id)}
                      className={cn(
                        'relative grid size-11 sm:size-13 cursor-pointer place-items-center rounded-full transition-colors duration-[var(--chrome-fast)]',
                        phoneOnly && 'sm:hidden',
                        open ? 'text-on-accent' : 'text-subtle hover:bg-hover hover:text-text',
                        ai && !open && 'text-accent-text',
                      )}
                    >
                      {open && (
                        <motion.span layoutId="rail-blob" transition={reduced ? { duration: 0 } : BLOB} aria-hidden data-testid="rail-blob" className="absolute inset-0">
                          <motion.span
                            key={id}
                            initial={reduced ? false : phone ? 'wide' : 'tall'}
                            animate="still"
                            variants={SQUISH}
                            transition={BLOB}
                            className={cn('absolute inset-0 rounded-full shadow-[0_6px_18px_-6px_rgb(194_16_108/0.7)]', ai ? 'ai-glow' : 'bg-accent-solid')}
                          />
                        </motion.span>
                      )}
                      {/* A still gradient: a blur over a sliding one would be redrawn on every frame. */}
                      {ai && !open && <span aria-hidden className="absolute inset-1.5 rounded-full bg-[image:var(--ai-gradient)] opacity-20 blur-[6px]" />}
                      <PanelIcon size={22} weight={ai ? 'duotone' : open ? 'fill' : 'regular'} aria-hidden className="relative" />
                    </button>
                  </Tooltip>
                )
              })}
            </nav>

            <AnimatePresence>
              {flyout && (
                <motion.section
                  key={flyout}
                  id="editor-flyout"
                  aria-label={panelTitle(flyout)}
                  initial={{ opacity: 0, x: rtl ? 12 : -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: rtl ? 12 : -12 }}
                  transition={chrome}
                  data-testid="flyout"
                  className="absolute start-[7.25rem] top-20 z-10 flex max-h-[calc(100%-5.75rem)] w-[21.5rem] flex-col overflow-hidden rounded-[16px] surface-frost border shadow-panel max-sm:inset-x-3 max-sm:start-3 max-sm:top-auto max-sm:bottom-[9rem] max-sm:w-auto"
                >
                  {/* The title at the start and, as in the mock, a small grey note at the end: the brand, or the page and format. */}
                  <div className="flex h-14 shrink-0 items-center gap-2 ps-[18px] pe-2">
                    <h2 className={cn('min-w-0 flex-1 truncate font-display text-[17px] font-bold tracking-tight', flyout === 'ai' && 'bg-[image:var(--ai-gradient)] bg-clip-text text-transparent')}>{panelTitle(flyout)}</h2>
                    {(note ?? (flyout === 'assets' || flyout === 'brand' ? brandName : null)) && (
                      <span data-testid="flyout-note" className="min-w-0 max-w-[60%] truncate text-[11px] font-medium text-muted">{note ?? brandName}</span>
                    )}
                    <button type="button" aria-label={t.editor.closePanel} onClick={() => setPanel(null)} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-subtle hover:bg-hover hover:text-text">
                      <XIcon size={14} aria-hidden />
                    </button>
                  </div>
                  <FlyoutNote.Provider value={setNote}>
                    {panels?.[flyout] ?? <p className="px-[18px] pb-4 text-[13px] text-muted">{panelEmpty[flyout]}</p>}
                  </FlyoutNote.Provider>
                </motion.section>
              )}
            </AnimatePresence>

            <main ref={stage} className="canvas-dots relative min-w-0 flex-1 overflow-hidden">
              {children}
              <div ref={dock} role="toolbar" aria-label={t.editor.tools} className={cn('absolute inset-x-0 bottom-4 z-10 mx-auto flex w-max max-sm:bottom-[5.25rem] items-center gap-1 rounded-[18px] surface-frost border p-1.5 shadow-panel', panel === 'properties' && 'max-sm:hidden')}>
                {TOOLS.map(({ id, icon: ToolIcon, key }) => {
                  if (id === 'shape') {
                    return (
                      <ShapeTools
                        key={id}
                        active={tool === 'shape'}
                        shape={shape}
                        onPick={(picked) => {
                          setTool('shape')
                          onToolChange?.('shape', picked)
                        }}
                      />
                    )
                  }
                  const label = t.editor[`tool${id[0]?.toUpperCase()}${id.slice(1)}` as `tool${Capitalize<Tool>}`]
                  const on = tool === id
                  return (
                    <Tooltip key={id} label={`${label} · ${key}`}>
                      <button
                        type="button"
                        aria-label={label}
                        aria-pressed={on}
                        data-tool={id}
                        onClick={() => {
                          setTool(id)
                          onToolChange?.(id, shape)
                        }}
                        className={cn(
                          'grid size-10 cursor-pointer place-items-center rounded-[12px] transition-colors duration-[var(--chrome-fast)]',
                          on ? 'bg-accent-solid text-on-accent' : 'text-muted hover:bg-hover hover:text-text',
                        )}
                      >
                        <ToolIcon size={20} weight={on ? 'fill' : 'regular'} aria-hidden />
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            </main>

            {hasCards && (
              <aside
                ref={cards}
                id="editor-cards"
                aria-label={t.editor.inspector}
                data-testid="cards"
                data-open={panel === 'properties' ? '' : undefined}
                className={cn(
                  // A stack at the top end, below the end island, each card only as tall as its content;
                  // past the room above the zoom pill the stack scrolls. Its gaps let clicks through.
                  'fade-more pointer-events-none absolute end-3 top-20 z-20 flex max-h-[calc(100%-9.5rem)] w-72 flex-col gap-2.5 overflow-y-auto overscroll-contain [scrollbar-width:none] *:pointer-events-auto',
                  // On phones, one sheet with a grab handle above the tab bar, opened from it; the dock
                  // steps aside while it is open (see .editor-cards).
                  'editor-cards max-sm:pointer-events-auto max-sm:inset-x-2 max-sm:top-auto max-sm:bottom-[5rem] max-sm:max-h-[55%] max-sm:w-auto max-sm:gap-0 max-sm:not-data-[open]:hidden',
                )}
              >
                {inspector}
              </aside>
            )}
          </div>
        </div>
    </MotionConfig>
  )
}
