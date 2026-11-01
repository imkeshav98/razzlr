// A brand's home (#84), as in the final mock: "What are we making for <brand>?" as a brief under a
// slow aurora, and nothing else. The brand's designs, templates and kit are pages of their own,
// from the capsule.
import { notFound, redirect } from 'next/navigation'
import { BriefComposer } from '../../../components/brief-composer.tsx'
import { LibraryShell } from '../../../components/library-shell.tsx'
import { createDesign, designCover, getBrandKit, getWorkspace, listBrands, listDesigns } from '../../../lib/api.ts'
import { briefDesign } from '../../../lib/brief.ts'
import { brandPage, showsBrandList } from '../../../lib/home.ts'
import { brandWords } from '../../../lib/i18n/index.ts'
import { getMessages } from '../../../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

/** How many designs the brief offers as a reference ad: the most recently changed. */
const REFERENCES = 24

export default async function BrandPage({ params, searchParams }: { params: Promise<{ brandId: string }>; searchParams: Promise<{ show?: string }> }) {
  const [{ brandId }, { show }] = await Promise.all([params, searchParams])
  // The panels these pages replaced were linked as ?show=recent, ?show=templates and ?show=kit.
  const moved = brandPage(show)
  if (moved) redirect(`/brands/${brandId}/${moved}`)
  const [t, workspace, brands] = await Promise.all([getMessages(), getWorkspace(), listBrands()])
  const brand = brands.find((c) => c.id === brandId)
  if (!brand) notFound()
  const [designs, kit] = await Promise.all([listDesigns(brand.id), getBrandKit(brand.id)])
  const references = await Promise.all(designs.slice(0, REFERENCES).map(async ({ id, name, updatedAt }) => {
    // Only the sizes here: each picture is drawn when the browser asks for it, not before the page comes.
    const cover = await designCover(brand.id, id).catch(() => null)
    return { id, name, updatedAt, cover }
  }))
  const untitled = t.library.untitled
  const presetName = t.editor.formats.preset

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
    <LibraryShell t={t} words={brandWords(t)} workspace={workspace} brands={brands} activeBrandId={brand.id} showBrands={showsBrandList(brands)} glow recentCount={designs.length}>
      <div className="pt-[8vh] md:pt-[14vh]">
        <BriefComposer t={t} brandId={brand.id} brandName={brand.name} kit={kit} references={references} action={make} />
        <p className="-mt-4 text-center text-[13px] text-subtle max-md:hidden">{t.home.panelHint}</p>
      </div>
    </LibraryShell>
  )
}
