// A brand's kit (#53, #200), as the earlier mock's Brand kit page: the brand's name over the kit's
// whole form laid out wide (colours, fonts, logo and voice, each change saved as it is made), then
// the brand's latest designs, where the kit is used.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { HomeKit } from '../../../../components/home-kit.tsx'
import { LibraryShell } from '../../../../components/library-shell.tsx'
import { designCover, getBrandKit, getWorkspace, listBrands, listDesigns } from '../../../../lib/api.ts'
import { showsBrandList } from '../../../../lib/home.ts'
import { brandWords, format } from '../../../../lib/i18n/index.ts'
import { getMessages } from '../../../../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

/** How many of the latest designs show under the kit. */
const LATEST = 6

export default async function KitPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const [t, workspace, brands] = await Promise.all([getMessages(), getWorkspace(), listBrands()])
  const brand = brands.find((b) => b.id === brandId)
  if (!brand) notFound()
  const [kit, designs] = await Promise.all([getBrandKit(brand.id), listDesigns(brand.id)])
  const latest = (await Promise.all(designs.slice(0, LATEST).map(async (design) => ({ ...design, cover: await designCover(brand.id, design.id).catch(() => null) }))))
    .filter((design) => design.cover)

  return (
    <LibraryShell t={t} words={brandWords(t)} workspace={workspace} brands={brands} activeBrandId={brand.id} showBrands={showsBrandList(brands)} place="kit">
      <div className="flex flex-col gap-6 pt-2 md:pt-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="font-display text-3xl font-bold tracking-tight md:text-[2.5rem] md:leading-tight">{t.home.brandKit}</h1>
            <span className="text-sm font-medium text-muted">{brand.name}</span>
          </div>
          <p className="text-sm text-muted">{format(t.home.kit.panelLead, { brand: brand.name })}</p>
        </div>
        <HomeKit brandId={brand.id} kit={kit} />
        {latest.length > 0 && (
          <section aria-labelledby="kit-latest" className="flex flex-col gap-3">
            <h2 id="kit-latest" className="text-[11px] font-bold tracking-[0.08em] text-subtle uppercase">{t.library.latest}</h2>
            <ul className="flex gap-3 overflow-x-auto pb-1">
              {latest.map((design) => (
                <li key={design.id} className="shrink-0">
                  <Link href={`/brands/${brand.id}/designs/${design.id}`} prefetch={false} title={design.name} className="lift block h-28 overflow-hidden rounded-[12px] bg-raised shadow-panel">
                    <img
                      src={`/brands/${brand.id}/designs/${design.id}/thumbnail?v=${Date.parse(design.updatedAt)}`}
                      alt={design.name}
                      width={design.cover?.width}
                      height={design.cover?.height}
                      className="h-full w-auto object-cover"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </LibraryShell>
  )
}
