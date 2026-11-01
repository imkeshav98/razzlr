// The Brands or Clients page (ADR-0011), as in the final mock: a card per brand in its own colours,
// with its latest design and how many it has, and a last card that adds one.
import { redirect } from 'next/navigation'
import { BrandCard, type BrandCardData } from '../components/brand-cards.tsx'
import { LibraryShell } from '../components/library-shell.tsx'
import { NewBrandCard } from '../components/new-brand-card.tsx'
import { createBrand, designCover, getBrandKit, getWorkspace, listBrands, listDesigns } from '../lib/api.ts'
import { needsWelcome, openingBrand } from '../lib/home.ts'
import { brandWords, format } from '../lib/i18n/index.ts'
import { getMessages } from '../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [t, workspace, brands] = await Promise.all([getMessages(), getWorkspace(), listBrands()])
  const words = brandWords(t, workspace.kind)
  if (needsWelcome(brands)) redirect('/welcome')
  const opening = openingBrand(workspace.kind, brands)
  if (opening) redirect(`/brands/${opening.id}`)

  const cards: BrandCardData[] = await Promise.all(brands.map(async (brand) => {
    const [designs, kit] = await Promise.all([listDesigns(brand.id), getBrandKit(brand.id).catch(() => null)])
    const latest = designs[0]
    const cover = latest ? await designCover(brand.id, latest.id).catch(() => null) : null
    return {
      ...brand,
      designCount: designs.length,
      colors: (kit?.colors ?? []).map((c) => c.value.slice(0, 7)),
      latest: latest && cover ? { src: `/brands/${brand.id}/designs/${latest.id}/thumbnail?v=${encodeURIComponent(latest.updatedAt)}`, ...cover } : null,
    }
  }))
  const count = (n: number) => (n === 0 ? t.library.noDesignsCount : n === 1 ? t.library.oneDesign : format(t.library.designCount, { n }))

  async function add(form: FormData) {
    'use server'
    const name = String(form.get('name') ?? '').trim()
    if (!name) return
    const brand = await createBrand(name.slice(0, 120))
    redirect(`/brands/${brand.id}`)
  }

  return (
    <LibraryShell t={t} words={words} workspace={workspace} brands={brands} place="brands">
      <h1 className="font-display text-4xl font-bold tracking-tight">{words.title}</h1>
      <p className="mt-2 text-muted">{words.lead}</p>
      <ul aria-label={words.title} className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((brand, i) => (
          <li key={brand.id} className="rise min-w-0" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
            <BrandCard brand={brand} count={count(brand.designCount)} />
          </li>
        ))}
        <li className="rise min-w-0" style={{ animationDelay: `${Math.min(cards.length, 12) * 40}ms` }}>
          <NewBrandCard action={add} words={{ add: words.add, name: words.name, create: t.library.create, cancel: t.library.cancel }} />
        </li>
      </ul>
    </LibraryShell>
  )
}
