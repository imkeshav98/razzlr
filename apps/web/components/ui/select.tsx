'use client'

// A dropdown in the app's own look, in place of the browser's: a field that opens a frosted list
// of options under it, as the final mock's menus are. The list is drawn over the page, so a card
// that clips its content never cuts it off. It works by keyboard as a listbox does: the arrows,
// Home and End move, Enter or Space picks, Esc closes, and typing jumps to an option.
import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn.ts'
import { useOverlayScroll } from './overlay-scroll.ts'

export interface SelectOption {
  value: string
  label: ReactNode
  /** The words a person types to jump to it, when the label is not plain text. */
  text?: string
  disabled?: boolean
}

export function Select({ name, label, value, options, onChange, placeholder, disabled = false, className, testId }: {
  name: string
  /** The field's accessible name. */
  label: string
  /** The picked option's value; one no option has shows the placeholder. */
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Shown while no option is picked, such as "Mixed" or "Add effect". */
  placeholder?: string
  disabled?: boolean
  /** The field's size and look; it comes with a border, the label and a caret. */
  className?: string
  testId?: string
}) {
  const id = useId()
  const field = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listRef = useOverlayScroll(list)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [place, setPlace] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null)
  const typed = useRef({ text: '', at: 0 })
  const picked = options.findIndex((o) => o.value === value)
  const current = options[picked]

  const close = (focus = true) => {
    setOpen(false)
    if (focus) field.current?.focus()
  }
  const openList = () => {
    if (disabled) return
    setActive(picked >= 0 ? picked : options.findIndex((o) => !o.disabled))
    setOpen(true)
  }
  const pick = (i: number) => {
    const option = options[i]
    if (!option || option.disabled) return
    close()
    if (option.value !== value) onChange(option.value)
  }
  const step = (from: number, by: number) => {
    for (let i = from + by; i >= 0 && i < options.length; i += by) if (!options[i]?.disabled) return i
    return from
  }

  // Under the field, or over it when there is no room below; as wide as the field, at least 10rem.
  // It follows the field as what holds the field scrolls, and closes once the field leaves the window.
  useLayoutEffect(() => {
    if (!open || !field.current) return
    const place = () => {
      const box = field.current?.getBoundingClientRect()
      if (!box) return
      if (box.bottom < 0 || box.top > window.innerHeight) return close(false)
      const height = Math.min(list.current?.scrollHeight ?? 240, 288)
      const up = box.bottom + 6 + height > window.innerHeight && box.top - 6 - height > 0
      const width = Math.max(box.width, 160)
      const rtl = getComputedStyle(field.current as Element).direction === 'rtl'
      // Kept 8 px inside the window, so a list wider than its field near the edge still shows whole.
      const left = Math.min(Math.max(rtl ? box.right - width : box.left, 8), window.innerWidth - width - 8)
      setPlace({ top: up ? box.top - 6 - height : box.bottom + 6, left, width, up })
    }
    const onScroll = (event: Event) => !list.current?.contains(event.target as Node) && place()
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  // A press outside closes the list.
  useEffect(() => {
    if (!open) return
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node
      if (!field.current?.contains(target) && !list.current?.contains(target)) close(false)
    }
    window.addEventListener('pointerdown', onPress)
    return () => window.removeEventListener('pointerdown', onPress)
  }, [open])

  // The active option stays in view, scrolling the list alone: scrollIntoView would scroll the page too.
  useEffect(() => {
    const box = list.current
    const option = open && active >= 0 ? box?.querySelectorAll<HTMLElement>('[role="option"]')[active] : undefined
    if (!box || !option) return
    if (option.offsetTop < box.scrollTop) box.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = option.offsetTop + option.offsetHeight - box.clientHeight
  }, [open, active])

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Keys on the field are the field's, not the stage's.
    event.stopPropagation()
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        openList()
      }
      return
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      close(event.key === 'Escape')
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => step(i, event.key === 'ArrowDown' ? 1 : -1))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActive(event.key === 'Home' ? step(-1, 1) : step(options.length, -1))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      pick(active)
    } else if (event.key.length === 1) {
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + event.key.toLowerCase(), at: now }
      const found = options.findIndex((o) => !o.disabled && (o.text ?? String(o.label)).toLowerCase().startsWith(typed.current.text))
      if (found >= 0) setActive(found)
    }
  }

  return (
    <>
      <button
        ref={field}
        type="button"
        name={name}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        data-value={value}
        data-testid={testId}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          'flex min-w-0 cursor-pointer items-center gap-1 rounded-row border border-line text-start text-text outline-none transition-colors duration-[var(--chrome-fast)] hover:border-line-strong focus-visible:border-accent disabled:cursor-default disabled:opacity-60 aria-expanded:border-accent',
          className,
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !current && 'text-muted')}>{current?.label ?? placeholder}</span>
        <CaretDownIcon size={11} weight="bold" aria-hidden className={cn('shrink-0 text-subtle transition-transform duration-[var(--chrome-fast)]', open && 'rotate-180')} />
      </button>
      {open && createPortal(
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          style={{ top: place?.top ?? -9999, left: place?.left ?? -9999, width: place?.width }}
          // The list sits outside the menu or dialog that holds its field; a press on it is not one
          // outside them, so it doesn't reach their close-on-outside-press listeners.
          onPointerDown={(event) => event.stopPropagation()}
          className={cn('pop-in fixed z-[60] max-h-72 overflow-y-auto overscroll-contain rounded-[12px] border surface-frost p-1 shadow-panel', place?.up && 'origin-bottom')}
        >
          {options.map((option, i) => (
            <li
              key={option.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === picked}
              aria-disabled={option.disabled || undefined}
              data-value={option.value}
              onPointerEnter={() => !option.disabled && setActive(i)}
              // The field keeps the focus, so the keys go on working there.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pick(i)}
              className={cn(
                'flex h-8 cursor-pointer items-center gap-2 rounded-[8px] px-2.5 text-[12.5px] text-text',
                i === active && 'bg-hover',
                i === picked && 'font-semibold text-accent-text',
                option.disabled && 'cursor-default opacity-40',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {i === picked && <CheckIcon size={13} weight="bold" aria-hidden className="shrink-0" />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  )
}
