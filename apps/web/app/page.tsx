import { CaretRightIcon } from '@phosphor-icons/react/ssr'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BrandAvatar, LibraryShell } from '../components/library-shell.tsx'
import { getWorkspace, listBrands } from '../lib/api.ts'
import { needsWelcome, openingBrand } from '../lib/home.ts'
import { brandWords } from '../lib/i18n/index.ts'
import { getMessages } from '../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [t, workspace, brands] = await Promise.all([getMessages(), getWorkspace(), listBrands()])
  const words = brandWords(t, workspace.kind)
  if (needsWelcome(brands)) redirect('/welcome')
  const opening = openingBrand(workspace.kind, brands)
  if (opening) redirect(`/brands/${opening.id}`)
  return (
    <LibraryShell t={t} words={words} workspace={workspace.name} brands={brands} place="brands">
      <h1 className="font-display text-4xl font-bold tracking-tight">{words.title}</h1>
      <p className="mt-2 text-muted">{words.lead}</p>
      {brands.length === 0
        ? <p className="mt-10 text-muted">{words.none}</p>
        : (
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {brands.map((brand, i) => (
              <li key={brand.id} className="rise" style={{ animationDelay: `${i * 40}ms` }}>
                <Link
                  href={`/brands/${brand.id}`}
                  className="group flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-panel transition-[border-color,transform] duration-[var(--chrome)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:border-line-strong"
                >
                  <BrandAvatar name={brand.name} />
                  <span className="min-w-0 flex-1 truncate font-medium">{brand.name}</span>
                  <CaretRightIcon size={16} aria-hidden className="text-subtle transition-transform duration-[var(--chrome)] group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
    </LibraryShell>
  )
}
