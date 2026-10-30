'use client'

// The editor's chrome (#51): a left rail whose buttons open flyouts (Layers, Assets, AI, Brand),
// a right inspector, a bottom tool dock and a slot for the mini bar above the selection. The
// panels are empty until their tickets fill them; the stage in the middle is the editor itself.
import {
  CloudArrowUpIcon, CloudCheckIcon, CloudSlashIcon, CursorIcon, FrameCornersIcon, HandIcon, ImageIcon, ImagesIcon, PaletteIcon, PenNibIcon, ShapesIcon,
  SlidersHorizontalIcon, SparkleIcon, StackIcon, TextTIcon, XIcon, type Icon,
} from '@phosphor-icons/react'
import type { ShapeTool } from '@razzlr/editor'
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { useLocale, useMessages } from '../../lib/i18n/client.tsx'
import { dirOf } from '../../lib/i18n/index.ts'
import { BrandMark } from '../brand-mark.tsx'
import { LocaleSwitch } from '../locale-switch.tsx'
import { ThemeSwitch } from '../theme-switch.tsx'
import { Tooltip } from '../ui/tooltip.tsx'
import { ShapeTools } from './shape-menu.tsx'

type Panel = 'layers' | 'assets' | 'ai' | 'brand'
export type Tool = 'select' | 'frame' | 'shape' | 'text' | 'pen' | 'image' | 'hand'

const PANELS: { id: Panel; icon: Icon }[] = [
  { id: 'layers', icon: StackIcon },
  { id: 'assets', icon: ImagesIcon },
  { id: 'ai', icon: SparkleIcon },
  { id: 'brand', icon: PaletteIcon },
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

/** The design's save state (#37) and how the badge shows it. */
const SAVE: Record<string, { icon: Icon; tone: string }> = {
  Saved: { icon: CloudCheckIcon, tone: 'border-success/30 text-success' },
  Saving: { icon: CloudArrowUpIcon, tone: 'border-line text-muted' },
  Offline: { icon: CloudSlashIcon, tone: 'border-warning/40 text-warning' },
}
/** Saving stays up at least this long, so a quick edit doesn't flicker the badge. */
const SAVING_HOLD_MS = 600

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

export function EditorShell({ brandId, brandName, designName, status, tool: shownTool, shape = 'rect', onToolChange, inspector, children }: {
  brandId: string
  brandName: string
  designName: string
  status: string
  /** The tool in use, when the editor decides it (a key, or drawing a shape ends); the dock keeps its own otherwise. */
  tool?: Tool
  /** The shape the shape tool draws (#44). */
  shape?: ShapeTool
  onToolChange?: (tool: Tool, shape: ShapeTool) => void
  /** The inspector's contents once the design is open; an empty state until then. */
  inspector?: ReactNode
  children: ReactNode
}) {
  const t = useMessages()
  const rtl = dirOf(useLocale()) === 'rtl'
  // Motion's own reduced-motion mode still fades; chrome should simply appear.
  const chrome = useReducedMotion() ? { duration: 0 } : CHROME
  const [panel, setPanel] = useState<Panel | null>(null)
  const [ownTool, setTool] = useState<Tool>('select')
  const tool = shownTool ?? ownTool
  const shown = useShownStatus(status)
  const save = SAVE[shown]
  const failed = shown.startsWith('Error')
  const panelTitle = (id: Panel) => t.editor[id]
  const panelEmpty = { layers: t.editor.layersEmpty, assets: t.editor.assetsEmpty, ai: t.editor.aiEmpty, brand: t.editor.brandEmpty }

  return (
    <MotionConfig reducedMotion="user">
        <div className="grid h-dvh grid-rows-[48px_minmax(0,1fr)] overflow-hidden bg-bg text-text">
          <header className="flex min-w-0 items-center gap-3 border-b border-line bg-surface ps-2 pe-3">
            <Link href="/" aria-label={t.library.home} className="grid size-9 place-items-center rounded-row hover:bg-hover">
              <BrandMark size={26} />
            </Link>
            <nav aria-label={t.library.designs} className="flex min-w-0 items-center gap-2 text-[13px]">
              <Link href={`/brands/${brandId}`} className="truncate text-muted transition-colors hover:text-text">{brandName}</Link>
              <span aria-hidden className="text-subtle">/</span>
              <h1 className="truncate font-semibold">{designName}</h1>
            </nav>
            <div className="ms-auto flex items-center gap-2">
              <span
                role="status"
                aria-atomic="true"
                aria-label={t.editor.status}
                data-testid="status"
                data-status={status}
                data-ready={save ? '' : undefined}
                title={save ? t.editor.statusHint[shown] : undefined}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors duration-[var(--chrome)]',
                  failed ? 'border-danger/40 text-danger' : save ? save.tone : 'border-line text-muted',
                )}
              >
                {save ? (
                  <save.icon size={14} weight={shown === 'Saved' ? 'fill' : 'regular'} aria-hidden className={cn(shown === 'Saving' && 'animate-pulse')} />
                ) : (
                  <span aria-hidden className={cn('size-1.5 rounded-full', failed ? 'bg-danger' : 'animate-pulse bg-subtle')} />
                )}
                {t.editor.statusText[shown] ?? shown}
                {shown === 'Offline' && <span className="hidden font-normal text-muted md:inline">{t.editor.statusHint.Offline}</span>}
              </span>
              <span className="hidden sm:contents">
                <LocaleSwitch />
              </span>
              <ThemeSwitch />
            </div>
          </header>

          <div className="relative flex min-h-0">
            <nav aria-label={t.editor.tools} className="z-20 flex w-14 shrink-0 flex-col items-center gap-1 border-e border-line bg-surface py-2">
              {PANELS.map(({ id, icon: PanelIcon }) => {
                const open = panel === id
                const ai = id === 'ai'
                return (
                  <Tooltip key={id} label={panelTitle(id)} side={rtl ? 'left' : 'right'}>
                    <button
                      type="button"
                      aria-label={panelTitle(id)}
                      aria-expanded={open}
                      aria-controls="editor-flyout"
                      onClick={() => setPanel(open ? null : id)}
                      className={cn(
                        'relative grid size-10 cursor-pointer place-items-center rounded-row transition-colors duration-[var(--chrome-fast)]',
                        open ? 'bg-hover text-text' : 'text-subtle hover:bg-hover hover:text-text',
                        ai && 'text-accent-text',
                      )}
                    >
                      {open && <motion.span layoutId="rail-mark" transition={chrome} aria-hidden className="absolute inset-y-2 -start-2 w-[3px] rounded-full bg-accent" />}
                      {ai && <span aria-hidden className="ai-glow absolute inset-1.5 rounded-[7px] opacity-20 blur-[6px]" />}
                      <PanelIcon size={20} weight={ai ? 'duotone' : open ? 'fill' : 'regular'} aria-hidden className="relative" />
                    </button>
                  </Tooltip>
                )
              })}
            </nav>

            <AnimatePresence>
              {panel && (
                <motion.section
                  key={panel}
                  id="editor-flyout"
                  aria-label={panelTitle(panel)}
                  initial={{ opacity: 0, x: rtl ? 12 : -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: rtl ? 12 : -12 }}
                  transition={chrome}
                  data-testid="flyout"
                  className="absolute inset-y-2 start-16 z-10 flex w-72 flex-col overflow-hidden rounded-card surface-frost border shadow-panel"
                >
                  <div className="flex h-12 shrink-0 items-center justify-between border-b border-line ps-4 pe-2">
                    <h2 className={cn('font-display text-[15px] font-semibold tracking-tight', panel === 'ai' && 'bg-[image:var(--ai-gradient)] bg-clip-text text-transparent')}>{panelTitle(panel)}</h2>
                    <button type="button" aria-label={t.editor.closePanel} onClick={() => setPanel(null)} className="grid size-8 cursor-pointer place-items-center rounded-row text-subtle hover:bg-hover hover:text-text">
                      <XIcon size={16} aria-hidden />
                    </button>
                  </div>
                  <p className="p-4 text-[13px] text-muted">{panelEmpty[panel]}</p>
                </motion.section>
              )}
            </AnimatePresence>

            <main className="canvas-dots relative min-w-0 flex-1 overflow-hidden">
              {children}
              <div role="toolbar" aria-label={t.editor.tools} className="absolute inset-x-0 bottom-4 z-10 mx-auto flex w-max items-center gap-0.5 rounded-card surface-frost border p-1 shadow-panel">
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
                          'grid size-9 cursor-pointer place-items-center rounded-row transition-colors duration-[var(--chrome-fast)]',
                          on ? 'bg-accent-solid text-on-accent' : 'text-muted hover:bg-hover hover:text-text',
                        )}
                      >
                        <ToolIcon size={18} weight={on ? 'fill' : 'regular'} aria-hidden />
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            </main>

            <aside aria-label={t.editor.inspector} className="hidden w-72 shrink-0 flex-col border-s border-line bg-surface lg:flex">
              <div className="flex h-12 items-center gap-2 border-b border-line px-4">
                <SlidersHorizontalIcon size={16} aria-hidden className="text-subtle" />
                <h2 className="text-[13px] font-semibold">{t.editor.inspector}</h2>
              </div>
              {inspector ?? <div className="grid flex-1 place-items-center p-6 text-center text-[13px] text-subtle">{t.editor.inspectorEmpty}</div>}
            </aside>
          </div>
        </div>
    </MotionConfig>
  )
}
