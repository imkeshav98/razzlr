// The app outside the editor: an icon rail, a secondary panel of clients and the main column.
import { SquaresFourIcon } from '@phosphor-icons/react/ssr'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import type { Messages } from '../lib/i18n/index.ts'
import type { ClientSummary } from '@razzlr/schema'
import { BrandMark } from './brand-mark.tsx'
import { LocaleSwitch } from './locale-switch.tsx'
import { ThemeSwitch } from './theme-switch.tsx'

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

export function ClientAvatar({ name, active = false }: { name: string; active?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-[7px] border text-[11px] font-semibold tracking-wide transition-colors duration-[var(--chrome-fast)]',
        active ? 'border-transparent bg-accent-solid text-on-accent' : 'border-line bg-raised text-muted',
      )}
    >
      {initials(name)}
    </span>
  )
}

export function LibraryShell({ t, clients, activeClientId, children }: {
  t: Messages
  clients: ClientSummary[]
  activeClientId?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg md:flex-row">
      <nav aria-label={t.app.name} className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2 md:w-16 md:flex-col md:border-e md:border-b-0 md:px-0 md:py-3">
        <Link href="/" className="rounded-[9px]" aria-label={t.app.name}>
          <BrandMark size={32} />
        </Link>
        <div className="flex gap-1 md:mt-4 md:flex-col">
          <Link href="/" aria-label={t.library.clients} aria-current="page" className="grid size-10 place-items-center rounded-row bg-accent-soft text-accent-text">
            <SquaresFourIcon size={20} weight="fill" aria-hidden />
          </Link>
        </div>
      </nav>

      <aside aria-label={t.library.clients} className="hidden w-64 shrink-0 flex-col border-e border-line bg-surface md:flex">
        <div className="flex h-14 items-center px-4">
          <h2 className="font-display text-[15px] font-semibold tracking-tight">{t.library.clients}</h2>
        </div>
        <ul className="flex flex-col gap-0.5 px-2">
          {clients.map((client) => {
            const active = client.id === activeClientId
            return (
              <li key={client.id}>
                <Link
                  href={`/clients/${client.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-10 items-center gap-2.5 rounded-row px-2 text-[13px] transition-colors duration-[var(--chrome-fast)]',
                    active ? 'bg-hover font-semibold text-text' : 'text-muted hover:bg-hover hover:text-text',
                  )}
                >
                  <ClientAvatar name={client.name} active={active} />
                  <span className="truncate">{client.name}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-end gap-2 border-b border-line px-4 md:px-8">
          <LocaleSwitch />
          <ThemeSwitch />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8 md:py-10">{children}</main>
      </div>
    </div>
  )
}
