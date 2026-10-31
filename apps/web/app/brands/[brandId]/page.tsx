// A brand's home (#84), as in the final mock: "What are we making for <brand>?" as a brief under a
// slow aurora, and the brand's recent work below it as a bento of real pictures of each design.
import { notFound, redirect } from 'next/navigation'
import { BriefComposer, briefDesign } from '../../../components/brief-composer.tsx'
import { DesignBento, type BentoDesign } from '../../../components/design-bento.tsx'
import { LibraryShell } from '../../../components/library-shell.tsx'
import { createDesign, designCover, getBrandKit, getWorkspace, listBrands, listDesigns, listTemplates, startFromTemplate } from '../../../lib/api.ts'
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
  const [designs, kit, templates] = await Promise.all([listDesigns(brand.id), getBrandKit(brand.id), listTemplates(brand.id)])
  const recent: BentoDesign[] = await Promise.all(designs.slice(0, BENTO_SIZE).map(async (design) => {
    // Only the sizes here: each picture is drawn when the browser asks for it, not before the page comes.
    const cover = await designCover(brand.id, design.id).catch(() => null)
    return { ...design, cover }
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

  /** Starts a design from a template (#54): the brand's own copy, with fresh ids. */
  async function start(templateId: string) {
    'use server'
    const design = await startFromTemplate(brandId, templateId)
    redirect(`/brands/${brandId}/designs/${design.id}`)
  }

  return (
    <LibraryShell t={t} words={words} workspace={workspace.name} brands={brands} activeBrandId={brand.id} showBrands={switcher} glow>
      <BriefComposer t={t} brandName={brand.name} kitColors={kit.colors.map((c) => c.value)} action={make} />

      <section aria-labelledby="recent-title">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 id="recent-title" className="font-display text-lg font-semibold tracking-tight">{t.home.recent}</h2>
          {designs.length > 0 && <span className="text-[13px] text-muted tabular-nums">{format(t.home.count, { count: designs.length })}</span>}
        </div>
        {recent.length === 0
          ? (
            <div className="grid place-items-center rounded-[18px] border border-dashed border-line-strong px-6 py-14 text-center text-muted">
              {t.home.noDesigns}
            </div>
          )
          : <DesignBento t={t} locale={locale} brandId={brand.id} designs={recent} />}
      </section>

      <section id="templates" aria-labelledby="templates-title" className="mt-12 scroll-mt-8">
        <h2 id="templates-title" className="font-display text-lg font-semibold tracking-tight">{t.library.templates}</h2>
        <p className="mt-1 text-sm text-muted">{t.library.templatesLead}</p>
        {templates.length === 0
          ? <p className="mt-6 text-sm text-muted">{t.library.noTemplates}</p>
          : (
            <ul aria-label={t.library.templates} className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {templates.map((template, i) => (
                <li key={template.id} data-template={template.id} className="rise" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                  <form action={start.bind(null, template.id)}>
                    <button type="submit" aria-label={format(t.library.useTemplate, { name: template.name })} className="group block w-full cursor-pointer rounded-card text-start focus-visible:outline-offset-4">
                      <div className="lift canvas-dots relative grid aspect-[4/3] place-items-center overflow-hidden rounded-card border border-line group-hover:border-line-strong">
                        <img
                          src={`/brands/${brand.id}/templates/${template.id}/thumbnail`}
                          alt=""
                          width={template.width}
                          height={template.height}
                          loading="lazy"
                          className="max-h-[76%] max-w-[76%] rounded-[4px] object-contain shadow-[0_10px_28px_-10px_rgb(0_0_0/0.5)] transition-transform duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:scale-[1.03]"
                        />
                      </div>
                      <span className="mt-2.5 block truncate text-sm font-medium text-text">{template.name}</span>
                      <span className="block text-xs text-subtle">{template.scope === 'workspace' ? words.all : brand.name}</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
      </section>
    </LibraryShell>
  )
}
