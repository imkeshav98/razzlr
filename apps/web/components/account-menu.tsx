'use client'

// The round avatar at the top end, as in the final mock. Language, theme, settings and signing out
// live behind it, so the top bar keeps to the work and one action.
import { GearSixIcon, SignOutIcon } from '@phosphor-icons/react'
import type { WorkspaceKind } from '@razzlr/schema'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { useMessages } from '../lib/i18n/client.tsx'
import { initialsOf } from '../lib/initials.ts'
import { LocaleSwitch } from './locale-switch.tsx'
import { ThemeSwitch } from './theme-switch.tsx'

const ROW = 'flex h-10 w-full cursor-pointer items-center gap-3 rounded-row px-3 text-start text-[13px] font-medium transition-colors duration-[var(--chrome-fast)] hover:bg-hover focus-visible:bg-hover focus-visible:outline-none'

export function AccountMenu({ name, kind, signedIn }: {
  /** The workspace's name, shown as the avatar's initials and at the menu's top. */
  name: string
  /** Who the workspace is for, named under its name. */
  kind: WorkspaceKind
  /** Whether there is a session to end, so Sign out shows (#58). */
  signedIn: boolean
}) {
  const t = useMessages()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    const onPress = (event: PointerEvent) => !box.current?.contains(event.target as Node) && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPress)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPress)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={t.account.open}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        data-testid="account-open"
        className="grid size-9 cursor-pointer place-items-center rounded-full bg-[image:var(--ai-gradient)] text-[13px] font-bold text-white shadow-[0_0_0_2px_var(--color-bg)] transition-transform duration-[var(--chrome-fast)] hover:scale-105"
      >
        <span aria-hidden>{initialsOf(name)}</span>
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={t.account.open} data-testid="account" className="pop-in-end absolute end-0 top-full z-40 mt-2 flex w-72 flex-col gap-1 rounded-card border surface-frost p-1.5 shadow-panel">
          {/* As in the final mock: the avatar beside the workspace's name. */}
          <div className="flex items-center gap-3 px-3 pt-2 pb-1.5">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-[image:var(--ai-gradient)] text-[13px] font-bold text-white">{initialsOf(name)}</span>
            <p className="flex min-w-0 flex-col">
              <span className="truncate font-display text-sm font-semibold">{name}</span>
              <span className="truncate text-[11px] text-muted">{t.account.kinds[kind]}</span>
            </p>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[13px] text-muted">{t.language.label}</span>
            <LocaleSwitch />
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[13px] text-muted">{t.theme.label}</span>
            <ThemeSwitch />
          </div>
          <div className="my-1 h-px bg-line" />
          <Link href="/settings" className={ROW} data-testid="settings-link">
            <GearSixIcon size={18} aria-hidden className="text-muted" />
            {t.account.settings}
          </Link>
          {signedIn && (
            <form action="/logout" method="post">
              <button type="submit" className={ROW} data-testid="sign-out">
                <SignOutIcon size={18} aria-hidden className="text-muted rtl:-scale-x-100" />
                {t.signIn.signOut}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
