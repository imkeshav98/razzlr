// Onboarding (#109, ADR-0013): "Paste your website" for the first brand, where an address names it
// and is kept as its website, or a plain name is typed (#203). The app opens here until the
// workspace has a brand. It looks like the final mock's onboarding: the library's top bar, a bold
// headline, and the website in one wide field with its button at the end.
import { redirect } from 'next/navigation'
import { BrandStartForm } from '../../components/brand-start-form.tsx'
import { TopBar } from '../../components/library-shell.tsx'
import { createBrand, getWorkspace } from '../../lib/api.ts'
import { brandFromForm } from '../../lib/home.ts'
import { brandWords } from '../../lib/i18n/index.ts'
import { getMessages } from '../../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

const HEADLINE = 'text-center font-display text-3xl font-bold tracking-tight text-balance md:text-[2.75rem] md:leading-tight'
const LEAD = 'mx-auto mt-3 max-w-xl text-center text-muted text-balance'

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  const [t, workspace] = await Promise.all([getMessages(), getWorkspace()])
  const w = t.welcome

  async function startBrand(form: FormData) {
    'use server'
    const brand = brandFromForm(form)
    if (!brand) redirect('/welcome?error=name')
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
        <h1 className={HEADLINE}>{w.websiteTitle}</h1>
        <p className={LEAD}>{w.websiteLead}</p>
        <BrandStartForm
          action={startBrand}
          words={{ start: t.library.start, placeholder: t.library.startPlaceholder, open: w.open, callIt: t.library.callIt, change: t.library.change, name: brandWords(t).name }}
          error={error === 'name' ? w.needName : null}
        />
      </main>
    </div>
  )
}
