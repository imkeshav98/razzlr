// Onboarding (#109): who Dazbee is for, as three big cards, then "Paste your website" for the
// first brand (or client): an address names it and is kept as its website, or a plain name is
// typed (#203). The app opens here until the workspace has a brand; the kind can be changed later
// in settings. No card is picked on the first visit, so the kind is always a choice; Back from the
// website step (?step=kind) shows the one picked. It looks like the final mock's onboarding: the
// library's top bar, progress dashes over a bold headline, and the website in one wide field with
// its button at the end.
import { ArrowLeftIcon, ArrowRightIcon } from '@phosphor-icons/react/ssr'
import { WorkspaceKind } from '@dazbee/schema'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BrandStartForm } from '../../components/brand-start-form.tsx'
import { KindCards } from '../../components/kind-cards.tsx'
import { TopBar } from '../../components/library-shell.tsx'
import { buttonStyles } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { createBrand, getWorkspace, updateWorkspace } from '../../lib/api.ts'
import { brandFromForm } from '../../lib/home.ts'
import { brandWords, format } from '../../lib/i18n/index.ts'
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
  const revisit = step === 'kind'

  async function pickKind(form: FormData) {
    'use server'
    const kind = WorkspaceKind.safeParse(form.get('kind'))
    if (!kind.success) redirect('/welcome')
    await updateWorkspace({ kind: kind.data })
    redirect('/welcome?step=brand')
  }

  async function startBrand(form: FormData) {
    'use server'
    const brand = brandFromForm(form)
    if (!brand) redirect('/welcome?step=brand&error=name')
    const made = await createBrand(brand.name, brand.website)
    redirect(`/brands/${made.id}`)
  }

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip bg-bg">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] overflow-hidden opacity-70 [mask-image:linear-gradient(to_bottom,black_45%,transparent)]"><div className="aurora" /></div>
      <TopBar t={t} workspace={workspace}>
        <span className="truncate px-1.5 font-semibold text-text">{w.place}</span>
      </TopBar>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 pt-4 pb-16 md:px-8 md:pb-24">
        <Steps label={format(w.step, { n: brandStep ? 2 : 1 })} now={brandStep ? 2 : 1} />
        {brandStep
          ? (
            <>
              <h1 className={HEADLINE}>{w.websiteTitle}</h1>
              <p className={LEAD}>{format(w.websiteLead, { thing: w.thing[workspace.kind] })}</p>
              <BrandStartForm
                action={startBrand}
                words={{ start: t.library.start, placeholder: t.library.startPlaceholder, open: w.open, callIt: t.library.callIt, change: t.library.change, name: brandWords(t, workspace.kind).name }}
                error={error === 'name' ? w.needName : null}
                back={(
                  <Link href="/welcome?step=kind" className={buttonStyles({ variant: 'ghost', size: 'lg' })}>
                    <ArrowLeftIcon size={16} aria-hidden className="rtl:-scale-x-100" />
                    {w.back}
                  </Link>
                )}
              />
            </>
          )
          : (
            <>
              <h1 className={HEADLINE}>{w.title}</h1>
              <p className={LEAD}>{w.lead}</p>
              <div className="mt-8">
                <KindCards t={t} {...(revisit ? { current: workspace.kind } : {})} action={pickKind} legend={w.title}>
                  <div className="mt-8 flex justify-center">
                    {/* Dim until a card is picked: the form is invalid while its required radio is empty. */}
                    <button type="submit" className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'h-12 px-8 text-base font-semibold transition-opacity duration-[var(--chrome)] in-invalid:opacity-40')}>
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
