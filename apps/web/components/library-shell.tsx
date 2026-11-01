// The app outside the editor, as in the final mock: the editor's top bar (the mark, a crumb whose
// first part switches brand, the account avatar at the end), the same floating capsule the editor
// has (#110), and the page under a glow of the accent colours.
import { CaretDownIcon, SquaresFourIcon } from '@phosphor-icons/react/ssr'
import { cookies } from 'next/headers'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import type { BrandWords, Messages } from '../lib/i18n/index.ts'
import { SESSION_COOKIE } from '../lib/sign-in.ts'
import type { BrandSummary, WorkspaceSummary } from '@dazbee/schema'
import { initialsOf } from '../lib/initials.ts'
import { AccountMenu } from './account-menu.tsx'
import { BrandMark } from './brand-mark.tsx'
import { LibraryCapsule } from './library-capsule.tsx'
import { NewBrandRow } from './new-brand-row.tsx'
import { addBrand } from '../app/actions.ts'

export function BrandAvatar({ name, active = false }: { name: string; active?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-[7px] border text-[11px] font-semibold tracking-wide transition-colors duration-[var(--chrome-fast)]',
        active ? 'border-transparent bg-accent-solid text-on-accent' : 'border-line bg-raised text-muted',
      )}
    >
      {initialsOf(name)}
    </span>
  )
}

/** Where the capsule and the crumb say you are. */
export type LibraryPlace = 'home' | 'brands' | 'settings' | 'designs' | 'templates' | 'kit'

/**
 * The crumb's first part: the brand you are in, or the word for them all, with a menu of the
 * workspace's brands that ends with New brand. A <details>, so it opens before any script loads.
 */
function BrandSwitcher({ t, words, brands, active, showAll }: { t: Messages; words: BrandWords; brands: BrandSummary[]; active: BrandSummary | undefined; showAll: boolean }) {
  return (
    <details className="group relative" data-testid="brand-switcher">
      <summary
        aria-label={t.home.switchBrand}
        className="flex h-8 cursor-pointer list-none items-center gap-1 rounded-row px-1.5 text-muted transition-colors hover:bg-hover hover:text-text [&::-webkit-details-marker]:hidden"
      >
        <span className="max-w-48 truncate">{active?.name ?? words.title}</span>
        <CaretDownIcon size={12} weight="bold" aria-hidden className="transition-transform group-open:rotate-180" />
      </summary>
      <nav aria-label={words.title} className="pop-in-start absolute start-0 top-full z-40 mt-2 flex w-64 flex-col gap-0.5 rounded-card surface-frost p-1.5">
        {brands.map((brand) => {
          const current = brand.id === active?.id
          return (
            <Link
              key={brand.id}
              href={`/brands/${brand.id}`}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex h-10 items-center gap-2.5 rounded-row px-2 text-[13px] transition-colors duration-[var(--chrome-fast)]',
                current ? 'bg-hover font-semibold text-text' : 'text-muted hover:bg-hover hover:text-text',
              )}
            >
              <BrandAvatar name={brand.name} active={current} />
              <span className="truncate">{brand.name}</span>
            </Link>
          )
        })}
        <div className="my-1 h-px bg-line" />
        {showAll && (
          <Link href="/" className="flex h-9 items-center gap-2.5 rounded-row px-2 text-[13px] font-medium text-muted hover:bg-hover hover:text-text">
            <SquaresFourIcon size={16} aria-hidden />
            {words.all}
          </Link>
        )}
        <NewBrandRow action={addBrand} words={{ add: words.add, start: t.library.start, placeholder: t.library.startPlaceholder, callIt: t.library.callIt, change: t.library.change, name: words.name, create: t.library.create }} />
      </nav>
    </details>
  )
}

/**
 * The top bar of every page outside the editor: the mark at the start, a crumb, and the account
 * avatar at the end. Onboarding uses it too, with no brand to switch to yet.
 */
export async function TopBar({ t, workspace, children }: {
  t: Messages
  /** The workspace, for the account avatar and menu. */
  workspace: Pick<WorkspaceSummary, 'name'>
  /** The crumb. */
  children: ReactNode
}) {
  const jar = await cookies()
  return (
    <header className="relative z-30 flex h-[4.5rem] items-center gap-2 px-6">
      <Link href="/" aria-label={t.app.name} className="grid size-9 shrink-0 place-items-center rounded-row hover:bg-hover">
        <BrandMark size={28} />
      </Link>
      <div className="flex min-w-0 items-center gap-1 text-[13px]">{children}</div>
      <span className="ms-auto">
        <AccountMenu name={workspace.name} signedIn={jar.has(SESSION_COOKIE)} />
      </span>
    </header>
  )
}

export async function LibraryShell({ t, words, workspace, brands, activeBrandId, showBrands = true, place = 'home', glow = false, recentCount, children }: {
  t: Messages
  /** The words for the workspace's brands. */
  words: BrandWords
  /** The workspace, for the account avatar and menu. */
  workspace: Pick<WorkspaceSummary, 'name'>
  brands: BrandSummary[]
  activeBrandId?: string
  /** Whether the workspace has brands to switch between; one brand goes without (#84). */
  showBrands?: boolean
  /** The capsule's lit entry and the crumb's last part. */
  place?: LibraryPlace
  /** The slow aurora behind the top of the page, as on a brand's home. */
  glow?: boolean
  /** How many designs the brand has, on the capsule's Recent. */
  recentCount?: number
  children: ReactNode
}) {
  const active = brands.find((brand) => brand.id === activeBrandId)
  const placeName = { home: t.library.home, brands: words.title, settings: t.library.settings, designs: t.home.recent, templates: t.library.templates, kit: t.home.brandKit }[place]
  const brandHome = active ? `/brands/${active.id}` : null
  return (
    <div className="relative isolate min-h-dvh overflow-x-clip bg-bg">
      {glow && (
        <div aria-hidden data-testid="home-glow" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]">
          <div className="aurora" />
        </div>
      )}

      <LibraryCapsule
        label={t.app.name}
        current={place === 'designs' ? 'recent' : place === 'templates' || place === 'kit' ? place : place === 'settings' ? null : 'home'}
        links={[
          { entry: 'home', href: brandHome ?? '/', label: active ? t.library.home : words.title },
          ...(brandHome
            ? [
              { entry: 'recent' as const, href: `${brandHome}/designs`, label: t.home.recent, badge: recentCount },
              { entry: 'templates' as const, href: `${brandHome}/templates`, label: t.library.templates },
              { entry: 'kit' as const, href: `${brandHome}/kit`, label: t.home.brandKit },
            ]
            : []),
        ]}
      />

      <TopBar t={t} workspace={workspace}>
        {showBrands || active
          ? <BrandSwitcher t={t} words={words} brands={brands} active={active} showAll={showBrands} />
          : null}
        {/* On the Brands page the switcher already names it, so the crumb says it once. */}
        {place === 'brands' && !active
          ? null
          : (
            <>
              {(showBrands || active) && <span aria-hidden className="text-subtle">/</span>}
              <span className="truncate px-1.5 font-semibold text-text">{placeName}</span>
            </>
          )}
      </TopBar>

      <main className="mx-auto w-full min-w-0 max-w-[110rem] px-4 pb-28 md:ps-44 md:pe-16 md:pb-12">{children}</main>
    </div>
  )
}
