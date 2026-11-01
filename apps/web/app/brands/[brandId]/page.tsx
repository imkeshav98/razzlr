// A brand's home (#84), as in the final mock: "What are we making for <brand>?" as a brief under a
// slow aurora. The brand's recent work (a bento of real pictures of each design) and its templates
// open under the brief from the capsule.
import { notFound, redirect } from 'next/navigation'
import { BriefComposer } from '../../../components/brief-composer.tsx'
import { BENTO_GRID, DesignBento, SPAN, spanOfSize, TILE, TILE_SHADE, type BentoDesign } from '../../../components/design-bento.tsx'
import { HomeStage } from '../../../components/home-stage.tsx'
import { LibraryShell } from '../../../components/library-shell.tsx'
import { cn } from '../../../lib/cn.ts'
import { createDesign, designCover, getBrandKit, getWorkspace, listBrands, listDesigns, listTemplates, startFromTemplate } from '../../../lib/api.ts'
import { briefDesign } from '../../../lib/brief.ts'
import { showsBrandList } from '../../../lib/home.ts'
import { panelOf } from '../../../lib/home-panel.ts'
import { brandWords, format } from '../../../lib/i18n/index.ts'
import { getLocale, getMessages } from '../../../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

/** How many designs the bento shows: the most recently changed. */
const BENTO_SIZE = 24

export default async function BrandPage({ params, searchParams }: { params: Promise<{ brandId: string }>; searchParams: Promise<{ show?: string }> }) {
  const [{ brandId }, { show }] = await Promise.all([params, searchParams])
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

  const recentBody = recent.length === 0
    ? (
      <div className="grid place-items-center rounded-[18px] border border-dashed border-line-strong px-6 py-14 text-center text-muted">
        {t.home.noDesigns}
      </div>
    )
    : <DesignBento t={t} locale={locale} brandId={brand.id} designs={recent} eager={panelOf(show) === 'recent'} />
  const templatesBody = templates.length === 0
    ? <p className="text-sm text-muted">{t.library.noTemplates}</p>
    : (
      <div className="@container">
        <ul aria-label={t.library.templates} className={BENTO_GRID}>
          {templates.map((template, i) => {
            // No large tile: a template's picture is a small copy, and blown up it would blur.
            const span = spanOfSize(template, i + 1)
            return (
              <li key={template.id} data-template={template.id} data-span={span} className={cn('rise min-w-0', SPAN[span])} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                <form action={start.bind(null, template.id)} className="size-full">
                  <button type="submit" aria-label={format(t.library.useTemplate, { name: template.name })} className={cn(TILE, 'cursor-pointer')}>
                    <img
                      src={`/brands/${brand.id}/templates/${template.id}/thumbnail`}
                      alt=""
                      width={template.width}
                      height={template.height}
                      loading="lazy"
                      className="absolute inset-0 size-full object-cover transition-transform duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:scale-[1.02]"
                    />
                    <span className={TILE_SHADE}>
                      <span className={cn('block truncate font-medium', span === 'large' ? 'text-sm' : 'text-[13px]')}>{template.name}</span>
                      <span className="block truncate text-[11px] text-white/75">{template.scope === 'workspace' ? words.all : brand.name}</span>
                    </span>
                  </button>
                </form>
              </li>
            )
          })}
        </ul>
      </div>
    )

  return (
    <LibraryShell t={t} words={words} workspace={workspace.name} brands={brands} activeBrandId={brand.id} showBrands={switcher} glow recentCount={designs.length}>
      <HomeStage
        home={`/brands/${brand.id}`}
        brief={<BriefComposer t={t} brandId={brand.id} brandName={brand.name} kit={kit} references={recent.map(({ id, name, updatedAt, cover }) => ({ id, name, updatedAt, cover }))} action={make} />}
        hint={t.home.panelHint}
        closeLabel={t.home.close}
        panels={{
          recent: { title: t.home.recent, meta: designs.length > 0 ? format(t.home.count, { count: designs.length }) : undefined, body: recentBody },
          templates: { title: t.library.templates, lead: t.library.templatesLead, body: templatesBody },
        }}
      />
    </LibraryShell>
  )
}
