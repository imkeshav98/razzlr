'use client'

// A brand's home under the top bar: the brief alone, sitting a little high, until the capsule
// opens Recent or Templates. Then the brief shrinks a little and moves up, and the panel rises
// under it; on phones the panel is a bottom sheet. The open panel lives in the address (?show=), so
// the capsule, the close button, Esc and the back button all only change that.
import { XIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { useSearchParams } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { homePanelHref, panelOf, type HomePanel } from '../lib/home-panel.ts'

/** What a panel shows: its title, a line beside or under it, and its content. */
export type HomePanelContent = { title: string; meta?: string | undefined; lead?: string; body: ReactNode }

const SLIDE = { type: 'spring', stiffness: 380, damping: 38 } as const

export function HomeStage({ home, brief, hint, closeLabel, panels }: {
  /** The brand home's path, which closing a panel goes back to. */
  home: string
  brief: ReactNode
  /** The line under the brief while no panel is open. */
  hint: string
  closeLabel: string
  panels: Record<HomePanel, HomePanelContent>
}) {
  const reduced = useReducedMotion()
  const panel = panelOf(useSearchParams().get('show'))
  const open = panel ? panels[panel] : null

  useEffect(() => {
    if (!panel) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) window.history.pushState(null, '', homePanelHref(home, null))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, home])

  const close = () => window.history.pushState(null, '', homePanelHref(home, null))

  return (
    <div data-testid="home-stage" data-show={panel ?? undefined}>
      <motion.div layout="position" transition={reduced ? { duration: 0 } : SLIDE} className={cn(!panel && 'pt-[8vh] md:pt-[14vh]')}>
        <div className={cn('origin-top transition-transform duration-[var(--enter)] ease-[var(--ease-out)]', panel && 'md:scale-[0.92]')}>
          {brief}
        </div>
        {!panel && <p className="-mt-4 text-center text-[13px] text-subtle max-md:hidden">{hint}</p>}
      </motion.div>

      {open && panel && (
        <>
          <div aria-hidden onClick={close} className="home-scrim fixed inset-0 z-30 bg-black/40 md:hidden" />
          <section
            key={panel}
            aria-labelledby="home-panel-title"
            data-testid={`home-panel-${panel}`}
            className="home-panel"
          >
            <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong md:hidden" />
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="home-panel-title" className="font-display text-lg font-semibold tracking-tight">{open.title}</h2>
                {open.lead && <p className="mt-1 text-sm text-muted">{open.lead}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {open.meta && <span className="text-[13px] text-muted tabular-nums">{open.meta}</span>}
                <button
                  type="button"
                  onClick={close}
                  aria-label={closeLabel}
                  title={closeLabel}
                  className="grid size-8 cursor-pointer place-items-center rounded-row text-subtle transition-colors duration-[var(--chrome-fast)] hover:bg-hover hover:text-text"
                >
                  <XIcon size={16} weight="bold" aria-hidden />
                </button>
              </div>
            </div>
            {open.body}
          </section>
        </>
      )}
    </div>
  )
}
