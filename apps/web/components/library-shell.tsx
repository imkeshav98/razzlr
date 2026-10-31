// The app outside the editor: the same floating capsule the editor has (#110), a frosted card of
// brands beside the page when the workspace has a list to switch between, and the main column.
import type { Icon } from '@phosphor-icons/react'
import { CardsThreeIcon, GearSixIcon, SquaresFourIcon } from '@phosphor-icons/react/ssr'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import type { BrandWords, Messages } from '../lib/i18n/index.ts'
import type { BrandSummary } from '@razzlr/schema'
import { BrandMark } from './brand-mark.tsx'
import { LocaleSwitch } from './locale-switch.tsx'
import { SignOut } from './sign-out.tsx'
import { ThemeSwitch } from './theme-switch.tsx'

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

export function BrandAvatar({ name, active = false }: { name: string; active?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-[7px] border text-[11px] font-semibold tracking-wide transition-colors duration-[var(--chrome-fast)]',
        active ? 'border-transparent bg-accent-solid text-on-accent' : 'border-line bg-raised text-muted',
      )}
    >
      {initials(name)}
    </span>
  )
}

/** Where the capsule says you are. */
export type LibraryPlace = 'home' | 'settings'

function CapsuleLink({ href, label, icon: LinkIcon, current }: { href: string; label: string; icon: Icon; current: boolean }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'grid size-10 place-items-center rounded-full transition-colors duration-[var(--chrome-fast)]',
        current ? 'bg-accent-solid text-on-accent shadow-[0_6px_18px_-6px_rgb(194_16_108/0.7)]' : 'text-subtle hover:bg-hover hover:text-text',
      )}
    >
      <LinkIcon size={20} weight={current ? 'fill' : 'regular'} aria-hidden />
    </Link>
  )
}

export function LibraryShell({ t, words, brands, activeBrandId, showBrands = true, place = 'home', children }: {
  t: Messages
  /** "Clients" in an agency workspace, "Brands" otherwise. */
  words: BrandWords
  brands: BrandSummary[]
  activeBrandId?: string
  /** The brand list beside the page; a workspace with one brand and no clients goes without (#84). */
  showBrands?: boolean
  /** The capsule's lit entry. */
  place?: LibraryPlace
  children: ReactNode
}) {
  return (
    <div className="min-h-dvh bg-bg">
      <nav
        aria-label={t.app.name}
        data-testid="library-capsule"
        className={cn(
          'fixed z-30 flex gap-1 rounded-full surface-frost border p-1.5 shadow-panel',
          // A vertical capsule at the start edge, as in the editor; on phones a tab bar at the bottom.
          'start-3 top-1/2 -translate-y-1/2 flex-col max-md:start-1/2 max-md:top-auto max-md:bottom-3 max-md:translate-y-0 max-md:flex-row max-md:-translate-x-1/2 max-md:rtl:translate-x-1/2',
        )}
      >
        <CapsuleLink href="/" label={words.title} icon={SquaresFourIcon} current={place === 'home'} />
        {activeBrandId && <CapsuleLink href={`/brands/${activeBrandId}#templates`} label={t.library.templates} icon={CardsThreeIcon} current={false} />}
        <CapsuleLink href="/settings" label={t.library.settings} icon={GearSixIcon} current={place === 'settings'} />
      </nav>

      <div className="flex min-h-dvh flex-col md:ps-[4.75rem]">
        <header className="flex h-16 shrink-0 items-center gap-2 px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2 rounded-[9px]" aria-label={t.app.name}>
            <BrandMark size={30} />
            <span aria-hidden className="font-display text-lg font-semibold tracking-tight">{t.app.name}</span>
          </Link>
          <span className="ms-auto flex items-center gap-2">
            <LocaleSwitch />
            <ThemeSwitch />
            <SignOut />
          </span>
        </header>

        <div className="flex min-w-0 flex-1 gap-6 px-4 pb-24 md:px-6 md:pb-10">
          {showBrands && (
            <aside aria-label={words.title} className="sticky top-4 hidden h-fit max-h-[calc(100dvh-6rem)] w-60 shrink-0 flex-col overflow-y-auto rounded-card surface-frost border p-2 shadow-panel md:flex">
              <h2 className="px-2 pt-1.5 pb-2 font-display text-[15px] font-semibold tracking-tight">{words.title}</h2>
              <ul className="flex flex-col gap-0.5">
                {brands.map((brand) => {
                  const active = brand.id === activeBrandId
                  return (
                    <li key={brand.id}>
                      <Link
                        href={`/brands/${brand.id}`}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex h-10 items-center gap-2.5 rounded-row px-2 text-[13px] transition-colors duration-[var(--chrome-fast)]',
                          active ? 'bg-hover font-semibold text-text' : 'text-muted hover:bg-hover hover:text-text',
                        )}
                      >
                        <BrandAvatar name={brand.name} active={active} />
                        <span className="truncate">{brand.name}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </aside>
          )}
          <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 pt-2">{children}</main>
        </div>
      </div>
    </div>
  )
}
