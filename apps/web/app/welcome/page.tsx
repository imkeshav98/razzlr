// Onboarding (#109): who Dazbee is for, as three big cards, then "Paste your website" for the
// first brand (or client), named from the site's address. The app opens here until the workspace
// has a brand; the kind can be changed later in settings. It looks like the final mock's
// onboarding: the library's top bar, progress dashes over a bold headline, and the website in one
// wide field with its button at the end.
import { ArrowLeftIcon, ArrowRightIcon, GlobeIcon } from '@phosphor-icons/react/ssr'
import { WorkspaceKind } from '@razzlr/schema'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { KindCards } from '../../components/kind-cards.tsx'
import { TopBar } from '../../components/library-shell.tsx'
import { buttonStyles } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { createBrand, getWorkspace, updateWorkspace } from '../../lib/api.ts'
import { nameFromWebsite } from '../../lib/home.ts'
import { format } from '../../lib/i18n/index.ts'
import { getMessages } from '../../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

const STEPS = 2

/** The mock's progress dashes, one for each step, lit up to this one; the words are for screen readers. */
function Steps({ label, now }: { label: string; now: number }) {
  return (
    <p className="flex justify-center">
      <span className="sr-only">{label}</span>
      <span aria-hidden className="flex gap-2">
        {Array.from({ length: STEPS }, (_, i) => (
          <span key={i} className={cn('h-1.5 w-12 rounded-full transition-colors duration-[var(--chrome)]', i < now ? 'bg-accent' : 'bg-line-strong')} />
        ))}
      </span>
    </p>
  )
}

const HEADLINE = 'mt-6 text-center font-display text-3xl font-bold tracking-tight text-balance md:text-[2.75rem] md:leading-tight'
const LEAD = 'mx-auto mt-3 max-w-xl text-center text-muted text-balance'

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ step?: string; error?: string }> }) {
  const { step, error } = await searchParams
  const [t, workspace] = await Promise.all([getMessages(), getWorkspace()])
  const w = t.welcome
  const brandStep = step === 'brand'

  async function pickKind(form: FormData) {
    'use server'
    const kind = WorkspaceKind.safeParse(form.get('kind'))
    if (!kind.success) redirect('/welcome')
    await updateWorkspace({ kind: kind.data })
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
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip bg-bg">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] overflow-hidden opacity-70 [mask-image:linear-gradient(to_bottom,black_45%,transparent)]"><div className="aurora" /></div>
      <TopBar t={t} workspace={workspace.name}>
        <span className="truncate px-1.5 font-semibold text-text">{w.place}</span>
      </TopBar>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 pt-4 pb-16 md:px-8 md:pb-24">
        <Steps label={format(w.step, { n: brandStep ? 2 : 1 })} now={brandStep ? 2 : 1} />
        {brandStep
          ? (
            <>
              <h1 className={HEADLINE}>{w.websiteTitle}</h1>
              <p className={LEAD}>{format(w.websiteLead, { thing: w.thing[workspace.kind] })}</p>
              {/* One wide field with the button inside its end, as in the mock. The grid puts the
                  button in the field's row while the name stays next in the tab order. */}
              <form action={startBrand} className="isolate mx-auto mt-8 grid w-full max-w-2xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
                {/* The field's own ring would cut through the bar; the bar's edge shows focus instead. */}
                <label className="peer col-start-1 row-start-1 flex min-w-0 items-center gap-3 ps-5">
                  <GlobeIcon size={20} aria-hidden className="shrink-0 text-muted" />
                  <span className="sr-only">{w.website}</span>
                  <input name="website" inputMode="url" autoComplete="url" placeholder={w.websitePlaceholder} className="h-16 w-full min-w-0 bg-transparent text-base text-text placeholder:text-subtle md:text-lg" style={{ outline: 'none' }} autoFocus />
                </label>
                <span aria-hidden className="col-span-2 col-start-1 row-start-1 -z-10 h-16 rounded-[18px] border-[1.5px] border-line bg-surface shadow-panel transition-[border-color,box-shadow] duration-[var(--chrome-fast)] peer-hover:border-line-strong peer-focus-within:border-accent peer-focus-within:shadow-[0_0_0_4px_var(--accent-soft)]" />
                <label className="col-span-2 row-start-2 mt-5 flex flex-col gap-1.5 text-[13px] font-medium text-muted md:mx-5">
                  {w.name}
                  <input name="name" maxLength={120} placeholder={w.namePlaceholder} className="h-11 w-full rounded-[12px] border border-line bg-surface px-4 text-[15px] text-text transition-colors duration-[var(--chrome-fast)] placeholder:text-subtle hover:border-line-strong focus:border-accent focus:outline-none" />
                </label>
                {error === 'name' && <p role="alert" className="col-span-2 row-start-3 mt-3 text-sm text-danger md:mx-5">{w.needName}</p>}
                <div className="col-span-2 row-start-4 mt-6 flex justify-center">
                  <Link href="/welcome" className={buttonStyles({ variant: 'ghost', size: 'lg' })}>
                    <ArrowLeftIcon size={16} aria-hidden className="rtl:-scale-x-100" />
                    {w.back}
                  </Link>
                </div>
                <button
                  type="submit"
                  className="ai-glow relative col-start-2 row-start-1 me-2.5 inline-flex h-11 cursor-pointer items-center gap-2 rounded-[12px] px-5 text-[15px] font-semibold text-white shadow-panel transition-transform duration-[var(--chrome-fast)] active:scale-[0.97]"
                >
                  {w.open}
                  <ArrowRightIcon size={16} weight="bold" aria-hidden className="rtl:-scale-x-100" />
                </button>
              </form>
            </>
          )
          : (
            <>
              <h1 className={HEADLINE}>{w.title}</h1>
              <p className={LEAD}>{w.lead}</p>
              <div className="mt-8">
                <KindCards t={t} current={workspace.kind} action={pickKind} legend={w.title}>
                  <div className="mt-8 flex justify-center">
                    <button type="submit" className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'h-12 px-8 text-base font-semibold')}>
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
