import { ArrowLeftIcon, PlusIcon } from '@phosphor-icons/react/ssr'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { LibraryShell } from '../../../components/library-shell.tsx'
import { buttonStyles } from '../../../components/ui/button.tsx'
import { createDesign, getWorkspace, listBrands, listDesigns, listTemplates, startFromTemplate } from '../../../lib/api.ts'
import { brandWords, format } from '../../../lib/i18n/index.ts'
import { getLocale, getMessages } from '../../../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

/** A calm two-colour tile per design until real thumbnails arrive, steady for each id. */
function tileOf(id: string) {
  let hash = 0
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return `linear-gradient(135deg, oklch(0.62 0.15 ${hue}), oklch(0.45 0.12 ${(hue + 40) % 360}))`
}

export default async function BrandPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const [t, locale, workspace, brands] = await Promise.all([getMessages(), getLocale(), getWorkspace(), listBrands()])
  const words = brandWords(t, workspace.kind)
  const brand = brands.find((c) => c.id === brandId)
  if (!brand) notFound()
  const [designs, templates] = await Promise.all([listDesigns(brand.id), listTemplates(brand.id)])
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  const untitled = t.library.untitled

  async function create(form: FormData) {
    'use server'
    const name = String(form.get('name') ?? '').trim() || untitled
    const design = await createDesign(brandId, name)
    redirect(`/brands/${brandId}/designs/${design.id}`)
  }

  /** Starts a design from a template (#54): the brand's own copy, with fresh ids. */
  async function start(templateId: string) {
    'use server'
    const design = await startFromTemplate(brandId, templateId)
    redirect(`/brands/${brandId}/designs/${design.id}`)
  }

  return (
    <LibraryShell t={t} words={words} brands={brands} activeBrandId={brand.id}>
      <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-text md:hidden">
        <ArrowLeftIcon size={14} aria-hidden className="rtl:-scale-x-100" />
        {words.all}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-subtle">{t.library.designs}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{brand.name}</h1>
        </div>
        <form action={create} className="flex w-full gap-2 sm:w-auto">
          <label className="sr-only" htmlFor="design-name">{t.library.designName}</label>
          <input
            id="design-name"
            name="name"
            placeholder={t.library.designNamePlaceholder}
            maxLength={120}
            className="h-10 min-w-0 flex-1 rounded-row border border-line bg-surface px-3 text-sm text-text transition-colors duration-[var(--chrome-fast)] placeholder:text-subtle hover:border-line-strong focus:border-accent focus:outline-none sm:w-64"
          />
          <button type="submit" className={buttonStyles({ variant: 'primary', size: 'lg' })}>
            <PlusIcon size={16} weight="bold" aria-hidden />
            {t.library.newDesign}
          </button>
        </form>
      </div>

      {designs.length === 0
        ? (
          <div className="mt-10 grid place-items-center rounded-card border border-dashed border-line-strong px-6 py-16 text-center text-muted">
            {t.library.noDesigns}
          </div>
        )
        : (
          <ul aria-label={t.library.designs} className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {designs.map((design, i) => (
              <li key={design.id} className="rise" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                <Link href={`/brands/${brand.id}/designs/${design.id}`} className="group block rounded-card focus-visible:outline-offset-4">
                  <div className="canvas-dots relative grid aspect-[4/3] place-items-center overflow-hidden rounded-card border border-line transition-[border-color,transform,box-shadow] duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:border-line-strong group-hover:shadow-panel">
                    <div
                      aria-hidden
                      className="grid aspect-square w-[46%] place-items-center rounded-[6px] shadow-[0_10px_28px_-10px_rgb(0_0_0/0.5)] transition-transform duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:scale-[1.03]"
                      style={{ background: tileOf(design.id) }}
                    >
                      <span className="font-display text-3xl font-bold text-white/90">{design.name.trim().charAt(0).toUpperCase()}</span>
                    </div>
                  </div>
                  <span className="mt-2.5 block truncate text-sm font-medium text-text">{design.name}</span>
                  <span className="block text-xs text-subtle">{format(t.library.edited, { when: when.format(new Date(design.updatedAt)) })}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

      <section id="templates" aria-labelledby="templates-title" className="mt-14 scroll-mt-8">
        <h2 id="templates-title" className="font-display text-xl font-semibold tracking-tight">{t.library.templates}</h2>
        <p className="mt-1 text-sm text-muted">{t.library.templatesLead}</p>
        {templates.length === 0
          ? <p className="mt-6 text-sm text-muted">{t.library.noTemplates}</p>
          : (
            <ul aria-label={t.library.templates} className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {templates.map((template, i) => (
                <li key={template.id} data-template={template.id} className="rise" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                  <form action={start.bind(null, template.id)}>
                    <button type="submit" aria-label={format(t.library.useTemplate, { name: template.name })} className="group block w-full cursor-pointer rounded-card text-start focus-visible:outline-offset-4">
                      <div className="canvas-dots relative grid aspect-[4/3] place-items-center overflow-hidden rounded-card border border-line transition-[border-color,transform,box-shadow] duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:border-line-strong group-hover:shadow-panel">
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
