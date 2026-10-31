'use client'

// The library's floating capsule: Home, Templates and Settings, with the editor capsule's pink blob
// under the lit entry. Each page renders its own capsule, so the tab remembers the last lit entry
// (sessionStorage) and the blob slides from there when the next page opens. Templates is a section
// of the brand's home, lit while the address ends in #templates.
import { CardsThreeIcon, GearSixIcon, HouseIcon, type Icon } from '@phosphor-icons/react'
import { animate, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { cn } from '../lib/cn.ts'

export type CapsuleEntry = 'home' | 'templates' | 'settings'

export type CapsuleLink = { entry: CapsuleEntry; href: string; label: string }

const ICONS: Record<CapsuleEntry, Icon> = { home: HouseIcon, templates: CardsThreeIcon, settings: GearSixIcon }

const LIT_KEY = 'razzlr.library-capsule'

/** The editor capsule's spring (components/editor/shell.tsx). */
const BLOB = { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 } as const

/** On arrival the blob is stretched along its travel and settles round: the squish. */
const SQUISH = { tall: [0.78, 1.28], wide: [1.28, 0.78] } as const

const readLit = (): string | null => {
  try {
    return sessionStorage.getItem(LIT_KEY)
  } catch {
    return null
  }
}

const saveLit = (entry: CapsuleEntry) => {
  try {
    sessionStorage.setItem(LIT_KEY, entry)
  } catch {
    // Storage off: the blob starts on the lit entry next time instead of sliding to it.
  }
}

export function LibraryCapsule({ label, links, current }: {
  /** The capsule's accessible name. */
  label: string
  links: CapsuleLink[]
  /** The entry for the page shown, which the server lights. */
  current: CapsuleEntry
}) {
  const reduced = useReducedMotion()
  const [lit, setLit] = useState<CapsuleEntry>(current)
  const nav = useRef<HTMLElement>(null)
  const blob = useRef<HTMLSpanElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  /** Where the blob was before `lit` changed, for it to slide from. */
  const origin = useRef<DOMRect | null>(null)
  const mounted = useRef(false)

  const slideFrom = useCallback((from: DOMRect | null) => {
    const element = blob.current
    if (!from || !element || reduced) return
    const to = element.getBoundingClientRect()
    const x = from.left - to.left
    const y = from.top - to.top
    if (!x && !y) return
    const [scaleX, scaleY] = Math.abs(x) > Math.abs(y) ? SQUISH.wide : SQUISH.tall
    animate(element, { x: [x, 0], y: [y, 0] }, BLOB)
    if (fill.current) animate(fill.current, { scaleX: [scaleX, 1], scaleY: [scaleY, 1] }, BLOB)
  }, [reduced])

  const move = useCallback((entry: CapsuleEntry) => {
    if (blob.current?.closest<HTMLElement>('[data-entry]')?.dataset.entry === entry) return
    origin.current = blob.current?.getBoundingClientRect() ?? null
    setLit(entry)
  }, [])

  const target = useCallback(
    (): CapsuleEntry => (current === 'home' && location.hash === '#templates' && links.some((link) => link.entry === 'templates') ? 'templates' : current),
    [current, links],
  )

  // On a page's first paint the blob starts where the last page left it. Once per page: later
  // moves come from clicks and history.
  const arrived = useRef(false)
  useLayoutEffect(() => {
    if (arrived.current) return
    arrived.current = true
    const last = readLit()
    const entry = target()
    const start = last && last !== entry ? nav.current?.querySelector(`[data-entry="${last}"]`)?.getBoundingClientRect() ?? null : null
    if (entry !== current) {
      origin.current = start ?? blob.current?.getBoundingClientRect() ?? null
      setLit(entry)
    } else {
      slideFrom(start)
      saveLit(entry)
    }
  }, [current, target, slideFrom])

  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    slideFrom(origin.current)
    origin.current = null
    saveLit(lit)
  }, [lit, slideFrom])

  // Back and forward between the home and its templates section.
  useEffect(() => {
    const sync = () => move(target())
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
    }
  }, [move, target])

  const onClick = (entry: CapsuleEntry) => (event: MouseEvent) => {
    // A new tab or window keeps this page as it is.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    move(entry)
  }

  return (
    <nav
      ref={nav}
      aria-label={label}
      data-testid="library-capsule"
      className={cn(
        'fixed z-30 flex gap-2 rounded-full surface-frost border p-2 shadow-panel',
        // A vertical capsule at the start edge, as in the editor; on phones a tab bar at the bottom.
        'start-4 top-1/2 -translate-y-1/2 flex-col max-md:start-1/2 max-md:top-auto max-md:bottom-3 max-md:translate-y-0 max-md:flex-row max-md:-translate-x-1/2 max-md:rtl:translate-x-1/2',
      )}
    >
      {links.map(({ entry, href, label: name }) => {
        const LinkIcon = ICONS[entry]
        const on = entry === lit
        return (
          <Link
            key={entry}
            href={href}
            aria-label={name}
            title={name}
            aria-current={entry === current ? 'page' : undefined}
            data-entry={entry}
            data-lit={on || undefined}
            onClick={onClick(entry)}
            className={cn(
              'relative grid size-11 place-items-center rounded-full transition-colors duration-[var(--chrome-fast)]',
              on ? 'text-on-accent' : 'text-subtle hover:bg-hover hover:text-text',
            )}
          >
            {on && (
              <span ref={blob} aria-hidden data-testid="capsule-blob" className="absolute inset-0">
                <span ref={fill} className="absolute inset-0 rounded-full bg-accent-solid shadow-[0_6px_18px_-6px_rgb(194_16_108/0.7)]" />
              </span>
            )}
            <LinkIcon size={22} weight={on ? 'fill' : 'regular'} aria-hidden className="relative" />
          </Link>
        )
      })}
    </nav>
  )
}
