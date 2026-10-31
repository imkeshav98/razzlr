// A brand's home (#84): "What are we making for <brand>?" as a brief under a slow aurora, and the
// brand's recent work below it as a bento of real pictures of each design.
import { ArrowLeftIcon } from '@phosphor-icons/react/ssr'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { BriefComposer, briefDesign } from '../../../components/brief-composer.tsx'
import { DesignBento, type BentoDesign } from '../../../components/design-bento.tsx'
import { LibraryShell } from '../../../components/library-shell.tsx'
import { createDesign, designThumbnail, getBrandKit, getWorkspace, listBrands, listDesigns } from '../../../lib/api.ts'
import { showsBrandList } from '../../../lib/home.ts'
import { brandWords, format } from '../../../lib/i18n/index.ts'
import { getLocale, getMessages } from '../../../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

/** How many designs the bento shows: the most recently changed. */
const BENTO_SIZE = 24

export default async function BrandPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const [t, locale, workspace, brands] = await Promise.all([getMessages(), getLocale(), getWorkspace(), listBrands()])
  const words = brandWords(t, workspace.kind)
  const brand = brands.find((c) => c.id === brandId)
  if (!brand) notFound()
  const [designs, kit] = await Promise.all([listDesigns(brand.id), getBrandKit(brand.id)])
  const recent: BentoDesign[] = await Promise.all(designs.slice(0, BENTO_SIZE).map(async (design) => {
    // A picture that fails to draw leaves its tile plain; the rest of the page still comes.
    const cover = await designThumbnail(brand.id, design.id).catch(() => null)
    return { ...design, cover: cover && { width: cover.width, height: cover.height } }
  }))
  const untitled = t.library.untitled
  const presetName = t.editor.formats.preset
  const switcher = showsBrandList(workspace.kind, brands)

  async function make(form: FormData) {
    'use server'
    const brief = String(form.get('brief') ?? '').trim()
    const firstLine = brief.split('\n')[0]?.trim() ?? ''
    const name = (firstLine.length > 60 ? `${firstLine.slice(0, 59).trimEnd()}…` : firstLine) || untitled
    const formats = form.getAll('format').map(String)
    const design = await createDesign(brandId, name, briefDesign(name, formats, (id) => presetName[id] ?? id))
    redirect(`/brands/${brandId}/designs/${design.id}`)
  }

  return (
    <LibraryShell t={t} words={words} brands={brands} activeBrandId={brand.id} showBrands={switcher}>
      {switcher && (
        <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-text md:hidden">
          <ArrowLeftIcon size={14} aria-hidden className="rtl:-scale-x-100" />
          {words.all}
        </Link>
      )}
      <BriefComposer t={t} brandName={brand.name} kitColors={kit.colors.map((c) => c.value)} action={make} />

      <section aria-labelledby="recent-title" className="mt-2">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="recent-title" className="font-display text-lg font-semibold tracking-tight">{t.home.recent}</h2>
          {designs.length > 0 && <span className="font-mono text-xs text-subtle tabular-nums">{format(t.home.count, { count: designs.length })}</span>}
        </div>
        {recent.length === 0
          ? (
            <div className="grid place-items-center rounded-[18px] border border-dashed border-line-strong px-6 py-14 text-center text-muted">
              {t.home.noDesigns}
            </div>
          )
          : <DesignBento t={t} locale={locale} brandId={brand.id} designs={recent} />}
      </section>
    </LibraryShell>
  )
}
