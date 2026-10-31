// Onboarding (#109): who Razzlr is for, as three big cards, then "Paste your website" for the
// first brand (or client), named from the site's address. The app opens here until the workspace
// has a brand; the kind can be changed later in settings.
import { ArrowLeftIcon, ArrowRightIcon, GlobeIcon } from '@phosphor-icons/react/ssr'
import { WorkspaceKind } from '@razzlr/schema'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BrandMark } from '../../components/brand-mark.tsx'
import { KindCards } from '../../components/kind-cards.tsx'
import { LocaleSwitch } from '../../components/locale-switch.tsx'
import { ThemeSwitch } from '../../components/theme-switch.tsx'
import { buttonStyles } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { createBrand, getWorkspace, setWorkspaceKind } from '../../lib/api.ts'
import { nameFromWebsite } from '../../lib/home.ts'
import { format } from '../../lib/i18n/index.ts'
import { getMessages } from '../../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

const FIELD = 'h-12 w-full rounded-[14px] border border-line bg-surface px-4 text-base text-text transition-colors duration-[var(--chrome-fast)] placeholder:text-subtle hover:border-line-strong focus:border-accent focus:outline-none'

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ step?: string; error?: string }> }) {
  const { step, error } = await searchParams
  const [t, workspace] = await Promise.all([getMessages(), getWorkspace()])
  const w = t.welcome
  const brandStep = step === 'brand'

  async function pickKind(form: FormData) {
    'use server'
    const kind = WorkspaceKind.safeParse(form.get('kind'))
    if (!kind.success) redirect('/welcome')
    await setWorkspaceKind(kind.data)
    redirect('/welcome?step=brand')
  }

  async function startBrand(form: FormData) {
    'use server'
    const typed = String(form.get('name') ?? '').trim()
    const name = typed || nameFromWebsite(String(form.get('website') ?? ''))
    if (!name) redirect('/welcome?step=brand&error=name')
    const brand = await createBrand(name.slice(0, 120))
    redirect(`/brands/${brand.id}`)
  }

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-bg">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[40rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"><div className="aurora" /></div>
      <header className="flex h-16 items-center gap-2 px-4 md:px-8">
        <BrandMark size={30} />
        <span className="font-display text-lg font-semibold tracking-tight">{t.app.name}</span>
        <span className="ms-auto flex items-center gap-2"><LocaleSwitch /><ThemeSwitch /></span>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-4 pb-16 md:px-8">
        <p className="text-center font-mono text-xs tracking-wide text-subtle">{format(w.step, { n: brandStep ? 2 : 1 })}</p>
        {brandStep
          ? (
            <>
              <h1 className="mt-2 text-center font-display text-4xl font-semibold tracking-tight text-balance md:text-5xl">{w.websiteTitle}</h1>
              <p className="mx-auto mt-3 max-w-xl text-center text-muted text-balance">{format(w.websiteLead, { thing: w.thing[workspace.kind] })}</p>
              <form action={startBrand} className="mx-auto mt-8 flex w-full max-w-xl flex-col gap-3 rounded-[22px] surface-frost border p-4 shadow-panel md:p-5">
                <label className="flex flex-col gap-1.5 text-[13px] font-medium text-muted">
                  {w.website}
                  <span className="relative">
                    <GlobeIcon size={18} aria-hidden className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-subtle" />
                    <input name="website" inputMode="url" autoComplete="url" placeholder={w.websitePlaceholder} className={`${FIELD} ps-11`} autoFocus />
                  </span>
                </label>
                <label className="flex flex-col gap-1.5 text-[13px] font-medium text-muted">
                  {w.name}
                  <input name="name" maxLength={120} placeholder={w.namePlaceholder} className={FIELD} />
                </label>
                {error === 'name' && <p role="alert" className="text-sm text-danger">{w.needName}</p>}
                <div className="mt-2 flex items-center justify-between gap-3">
                  <Link href="/welcome" className={buttonStyles({ variant: 'ghost', size: 'lg' })}>
                    <ArrowLeftIcon size={16} aria-hidden className="rtl:-scale-x-100" />
                    {w.back}
                  </Link>
                  <button type="submit" className={buttonStyles({ variant: 'primary', size: 'lg' })}>
                    {w.open}
                    <ArrowRightIcon size={16} aria-hidden className="rtl:-scale-x-100" />
                  </button>
                </div>
              </form>
            </>
          )
          : (
            <>
              <h1 className="mt-2 text-center font-display text-4xl font-semibold tracking-tight text-balance md:text-5xl">{w.title}</h1>
              <p className="mx-auto mt-3 max-w-xl text-center text-muted text-balance">{w.lead}</p>
              <div className="mt-8">
                <KindCards t={t} current={workspace.kind} action={pickKind} legend={w.title}>
                  <div className="mt-6 flex justify-center">
                    <button type="submit" className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'h-12 rounded-full px-8 text-base')}>
                      {w.next}
                      <ArrowRightIcon size={18} aria-hidden className="rtl:-scale-x-100" />
                    </button>
                  </div>
                </KindCards>
              </div>
            </>
          )}
      </main>
    </div>
  )
}
