import { CaretRightIcon } from '@phosphor-icons/react/ssr'
import Link from 'next/link'
import { ClientAvatar, LibraryShell } from '../components/library-shell.tsx'
import { listClients } from '../lib/api.ts'
import { getMessages } from '../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [t, clients] = await Promise.all([getMessages(), listClients()])
  return (
    <LibraryShell t={t} clients={clients}>
      <h1 className="font-display text-3xl font-semibold tracking-tight">{t.library.clients}</h1>
      <p className="mt-2 text-muted">{t.library.clientsLead}</p>
      {clients.length === 0
        ? <p className="mt-10 text-muted">{t.library.noClients}</p>
        : (
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((client, i) => (
              <li key={client.id} className="rise" style={{ animationDelay: `${i * 40}ms` }}>
                <Link
                  href={`/clients/${client.id}`}
                  className="group flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-panel transition-[border-color,transform] duration-[var(--chrome)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:border-line-strong"
                >
                  <ClientAvatar name={client.name} />
                  <span className="min-w-0 flex-1 truncate font-medium">{client.name}</span>
                  <CaretRightIcon size={16} aria-hidden className="text-subtle transition-transform duration-[var(--chrome)] group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
    </LibraryShell>
  )
}
