// A brand's templates (#54), as the earlier mock's Templates page: chips for this brand's or every
// brand's, then a card per template with its picture and name. Picking one starts a design from it;
// each card's menu renames or deletes it (#159).
import { notFound } from 'next/navigation'
import { FilterChips } from '../../../../components/filter-chips.tsx'
import { LibraryShell } from '../../../../components/library-shell.tsx'
import { TileMenu } from '../../../../components/tile-menu.tsx'
import { getWorkspace, listBrands, listTemplates } from '../../../../lib/api.ts'
import { showsBrandList } from '../../../../lib/home.ts'
import { brandWords, format } from '../../../../lib/i18n/index.ts'
import { getMessages } from '../../../../lib/i18n/server.ts'
import { deleteTemplateAction, renameTemplateAction, startTemplate } from '../actions.ts'

export const dynamic = 'force-dynamic'

const SCOPES = ['brand', 'workspace'] as const

export default async function TemplatesPage({ params, searchParams }: { params: Promise<{ brandId: string }>; searchParams: Promise<{ scope?: string }> }) {
  const [{ brandId }, { scope }] = await Promise.all([params, searchParams])
  const [t, workspace, brands] = await Promise.all([getMessages(), getWorkspace(), listBrands()])
  const brand = brands.find((b) => b.id === brandId)
  if (!brand) notFound()
  const templates = await listTemplates(brand.id)
  const picked = SCOPES.find((s) => s === scope) ?? null
  const shown = picked ? templates.filter((tpl) => tpl.scope === picked) : templates
  const here = `/brands/${brand.id}/templates`
  const l = t.library
  const words = brandWords(t)

  return (
    <LibraryShell t={t} words={words} workspace={workspace} brands={brands} activeBrandId={brand.id} showBrands={showsBrandList(brands)} place="templates">
      <div className="flex flex-col gap-6 pt-2 md:pt-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-[2.5rem] md:leading-tight">{l.templates}</h1>
          <span className="text-sm font-medium text-muted">{format(l.templatesFor, { brand: brand.name })}</span>
        </div>
        {templates.length > 0 && (
          <FilterChips
            label={l.filters}
            chips={[
              { label: l.scopes.all, href: here, on: picked === null },
              ...SCOPES.map((s) => ({ label: l.scopes[s], href: `${here}?scope=${s}`, on: picked === s })),
            ]}
          />
        )}
        {shown.length === 0
          ? <div className="grid place-items-center rounded-[18px] border border-dashed border-line-strong px-6 py-14 text-center text-muted">{l.noTemplates}</div>
          : (
            <ul aria-label={l.templates} className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {shown.map((template, i) => (
                <li key={template.id} data-template={template.id} className="rise group/tile relative min-w-0" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                  <form action={startTemplate.bind(null, brand.id, template.id)}>
                    <button type="submit" aria-label={format(l.useTemplate, { name: template.name })} className="group flex w-full cursor-pointer flex-col gap-2 text-start">
                      <span className="lift grid aspect-[5/4] w-full place-items-center overflow-hidden rounded-[18px] border border-line bg-raised p-4 shadow-panel">
                        <img
                          src={`/brands/${brand.id}/templates/${template.id}/thumbnail`}
                          alt=""
                          width={template.width}
                          height={template.height}
                          loading={i < 8 ? 'eager' : 'lazy'}
                          className="max-h-full max-w-full rounded-[6px] object-contain shadow-panel transition-transform duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:scale-[1.03]"
                        />
                      </span>
                      <span className="flex min-w-0 flex-col px-1">
                        <span className="truncate font-display text-[15px] font-bold">{template.name}</span>
                        <span className="truncate text-[12px] text-muted">{template.scope === 'workspace' ? words.all : brand.name}</span>
                      </span>
                    </button>
                  </form>
                  <TileMenu name={template.name} rename={renameTemplateAction.bind(null, brand.id, template.id)} remove={deleteTemplateAction.bind(null, brand.id, template.id)} />
                </li>
              ))}
            </ul>
          )}
      </div>
    </LibraryShell>
  )
}
